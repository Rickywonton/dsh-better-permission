[中文](README.md) | [English](README.en.md)

# Permission tiers（权限档位）

在 DSH 原有的三档权限（`read-only` / `workspace-write` / `danger-full-access`）之上，新增分级档位：
**每个档位有一道「风险上限」，低于上限的操作自动放行，高于上限的一律询问**。这样插件下载、装依赖、
跑构建这类日常操作不必反复点「允许」，而删文件、动系统、往外发东西仍然会停下来问。

## 风险分级

每条待批操作先被判成一级风险，档位的上限决定它是否自动放行：

| 风险 | 含义 | 例子 |
| --- | --- | --- |
| `read` 只读 | 只读不写 | `dir`、`Get-Content`、`git status`、`Get-ChildItem \| Select-String` |
| `write` 写入 | 会改动工作区内容 | `npm install`、`node build.js`、在工作区内新建/改写文件 |
| `destructive` 删除 / 覆盖 | 删除或覆盖已有文件 | `rm -rf`、`Remove-Item -Recurse`、`git reset --hard` |
| `system` 系统层 | 动系统配置或系统目录 | `reg add HKLM\...`、`sc config`、`Remove-Item C:\Windows\...`、写 `Program Files` |
| `outside` 工作区外 | 动工作区外的普通路径 | 写 `D:\other\...` |
| `publish` 对外发布 | 把内容送出去 | `git push`、`npm publish`、`curl -T`、`Invoke-RestMethod -Method Post`、`scp`、`ssh` |
| `unknown` 无法识别 | 规则表认不出的命令 | 陌生可执行名 |

判定基于命令文本（按 `&&` / `||` / `;` / `|` 切开逐段看）与工具参数里的路径，不依赖模型自述。

## 档位一览

| 档位 | 沙箱 | 自动放行上限 | 仍然询问 |
| --- | --- | --- | --- |
| `read-only` | 只读 | — | 全部 |
| `workspace-write`（默认） | 工作区内 | — | 全部 |
| `workspace-write-edits`<br>工作区内 · 写入自动 | 工作区内 | 写入 | 删除/覆盖、系统、外发；完全访问提权 |
| `workspace-write-trusted`<br>工作区内 · 受信放行 | 工作区内 | 写入 + 受信目录/受信命令的提权 | 删除、系统、外发 |
| `workspace-write-ai`<br>工作区内 · AI 判定 | 工作区内 | 写入，以及上限之外交给你配置的评审模型判断 | 系统层、对外发布、无法识别；模型拿不准或不可用时同样询问 |
| `workspace-write-guarded`<br>工作区内 · 高危才问 | 工作区内 | 删除/覆盖、工作区外 | 系统层、对外发布、无法识别 |
| `workspace-write-autopilot`<br>工作区内 · 自动放行 | 工作区内 | 全部 | 移除插件、版本豁免、安装脚本 |
| `danger-full-access` | 完全访问 | —（`approval: never`，不再询问） | — |

档位由 `@deepseek-ai/dsh-permission-presets` 表声明，因此**输入框的权限选择器、设置页里的默认档位、
`/permission` 命令都会自动出现新档位**，不需要额外的界面。

## 本对话放行规则（仿 Trae）

某条命令反复弹窗时，可以在审批弹窗里点 **「本对话总是允许这条命令『<签名>』」**：
它把这条命令的签名记进**本对话**的放行清单，并放行本次调用；之后同一签名在这个对话里直接通过。

签名是「动词级」的：`git status`、`git diff` 这种只读/写入动词只授权到 `动词 + 子命令`；
删除、系统、发布、无法识别的命令则按**整条命令（前 4 个 token）**授权，避免一条 `rm -rf xxx` 顺带放行别的 `rm`。

也可以手动管：

```
/allow                       # 列出本对话的放行规则
/allow git status            # 加入
/allow remove git status     # 移除
/allow clear                 # 清空
```

规则只在本对话内生效，写入 `kv` 存储（重启后仍在）。它**不能**越过档位的「始终询问」清单：
`system` / `publish` / `unknown` 这类在受信档位里仍然会问的操作，规则也不会自动放行。

需要模型参与判定时，档位规则里写 `ai: true`：命中上限之内照旧自动放行，上限之外先问评审模型，
模型说 `allow` 才放行，其余一律交回人工。`danger-full-access` 的提权永远不由模型决定。

## AI 判定模式

`workspace-write-ai` 档把「上限之外、但还不到必须问人」的那段交给一个你自己提供的模型：

```yaml
ai:
  baseUrl: https://api.example.com/v1   # OpenAI 兼容，插件自己拼 /chat/completions
  model: your-model
  apiKeyEnv: BETTER_PERMIT_API_KEY      # 或直接写 apiKey（不进日志）
  timeoutMs: 8000
  minConfidence: 0.6                    # 低于这个置信度就当"拿不准"
  maxTokens: 400
  maxHabits: 12                         # 每次最多带几条习惯给模型参考
```

行为约束：

- 只接受 JSON `{"verdict":"allow"|"ask","confidence":0..1,"reason":"…"}`；解析不出、超时、
  非 2xx、抛错、置信度不够，全部按 `ask` 处理（fail-closed），也就是回到问你。
- 只影响"要不要打扰你"：`danger-full-access` 提权仍然是确定性闸门，模型最多让 `workspace-write` 提权生效。
- 没配置 `baseUrl` / `model` / key 时，这个档位退化成"上限之外都问你"。

`GET /better-permit/approval/ai` 返回 `{configured, baseUrl, model, keySource, timeoutMs, minConfidence, lastCall}`；
`POST /better-permit/approval/ai/test` 发一次探针（成功 200 带 verdict，失败 502）。面板上有「测试连接」按钮。

## 审批超时暂缓

```yaml
holdMs: 30000      # 0 = 不限时（默认）；>0 时弹窗超过这么久没被回答就判为"暂缓"
holdAdvice: true   # 暂缓时顺带问一次评审模型：这操作能不能安全执行 / 该怎么绕
```

暂缓时：这次调用以 `rejected` 结束（不会执行），并且给这个对话排一条**一次性通知**——
模型的下一次工具调用会被拒一次，理由里说明"这一步在等你、不要用同样参数重试、先做不依赖它的步骤"。
通知只发一次，之后模型按正常规则继续。

## 习惯与 skill

每次放行/拒绝都会记进习惯库（`kv` unit `better-permit-habits`，最多 300 条，按最近使用淘汰）：

```yaml
maxHabits: 12        # 每次给评审模型看几条
maxHabitsInSkill: 40 # 导出 skill 时写几条
skillDir: D:\dsh-home\skills   # 默认 <DSH_HOME>/skills
```

- `GET /better-permit/approval/habits` 看习惯库。
- `POST /better-permit/approval/habits/skill` 把习惯写成 `<skillDir>/better-permit-habits/SKILL.md`，
  DSH 的 skill 目录热加载，写完即生效（面板上有「生成 / 更新 skill」按钮）。
- 生成的 SKILL.md 分「可以直接执行」「必须先问人」「判断原则」三段，来源是真实放行/拒绝记录。

## 审批解释

每次弹窗都带一段中文解释（`lib/explain.js`，端点 `GET /better-permit/approval/detail` 的 `explain`）：

```json
{
  "sentence": "会删除或覆盖已有内容，删掉的东西通常无法恢复。当前档位「工作区内 · AI 判定」只自动放行到「写入」这一档，所以来问你。",
  "local": "…",
  "source": "local",
  "level": "danger",
  "risk": { "key": "destructive", "label": "删除/覆盖", "hint": "会删除或覆盖已有文件" }
}
```

- **只讲后果与原因**：命令、工作目录、风险徽标弹窗里已有，解释不重复命令、不引用参数。
- `source: "model"`：评审模型已配置时问它一句（≤40 字，禁止复述命令与代码），6 秒上限。
- `source: "local"`：模型没配 / 超时 / 报错 / 答空时，用 `analysisOf(risk.key)` 的后果分析
  （只读 / 写入 / 删除覆盖 / 系统层 / 工作区外 / 对外发布 / 无法识别）加一句档位说明。
- `level`：`safe` / `caution` / `danger`，弹窗渲染成彩色徽标；`unknown` 一律 `danger`，
  解释里明说「按较高风险对待」，不会出现「无法判断」。
- 解释按 `callId` 缓存（最多 32 条），弹窗反复取数不会重复问模型。

## 每轮自动放行报告

`lib/reports.js` + `agent/turn-stopping`（serial）：一轮收尾时，把这一轮本插件返回过 `allowed-once`
的调用按「签名 + 风险」归类，写成一条 `developer/message`（`surfaceOp: "append"`）追加进对话：

```
本轮自动放行 3 次审批（未打扰你）：
· dir ×2 — 风险「只读」，由档位上限放行
· pnpm install ×1 — 风险「写入」，由本对话规则放行
```

- 放行人标注：档位上限 / 本对话规则 / 受信路径 / 评审模型。
- 报告是 `developer` 消息：聊天里渲染成一条注入行，但 `dsh-llm` 会把 developer 消息从模型可见消息里
  过滤掉（只用于工具声明增量），所以它不占模型上下文，只是一份给你看的账。
- 空轮不写；写失败只记日志（`category: 'report-failed'`），不影响会话。
- `GET /better-permit/approval/panel` 的 `reports` 返回最近 10 条（`{at, turn, count, text}`），
  设置页面板有对应卡片。

## 安全边界（所有档位一致）

- 只回答 `allowed-once`，从不改写审批策略、不安装常驻 hook、不阻止审批——没命中规则就 `next()` 交回原本的应答者。
- **移除插件**、**版本豁免**（`acceptRisk`）永远人工确认；`install_bundle` 带 `approvedBuilds` 时不自动放行。
- 判定依据不只靠文案：`tools/pre-execute` 先把这次调用的**参数**按 `callId` 记下，审批时据此核对；
  没有可信快照（例如调用与审批对不上、或参数读不到）时一律交回人工，fail-closed。
- 受信命令必须**整条命令以白名单前缀开头**，且不含 `; & | > < \` $ ( ) { }` 换行等 shell 元字符，
  因此 `pnpm install && rm -rf /` 不会被放行。
- 受信路径按 `path.resolve` 后做前缀比较（大小写不敏感、含分隔符边界），`D:/trusted-evil` 不会被当成 `D:/trusted`。
- 子会话（子 agent）在沿用默认档位时继承父会话档位，避免子任务回落成「每次询问」。

## 配置

`cordis.patch.yml` 里 `better-permit` 行的 `config`（任意字段可省略）：

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `inheritParentTier` | `true` | 子会话沿用父会话档位 |
| `defaultTier` | `workspace-write` | 视为「未选择」的档位，用于判断是否继承 |
| `pluginTools` | `['plugin_manager']` | 视为插件管理的工具名 |
| `guardedActions` | `['remove','exemption']` | 任何档位都必须人工确认的插件动作类别 |
| `requireBuildApproval` | `true` | 带安装脚本的安装不自动放行 |
| `trustedPaths` | `[]` | 受信目录前缀（相对路径按工作区根解析） |
| `trustedCommands` | `pnpm install` / `pnpm add` / `npm install` / `npm i` / `npm ci` | 受信命令前缀 |
| `trustedPackages` | `[]` | 受信包名或 scope（`@scope/*`），供自定义档位的 `install: trusted` 使用 |
| `shellTools` | `['pwsh','bash','shell','sh']` | 执行命令的工具名 |
| `journalSize` | `40` | 自动放行记录条数 |
| `holdMs` | `0` | 审批超过这么久（毫秒）没被回答就暂缓该操作；`0` = 不限时 |
| `holdAdvice` | `true` | 暂缓时问一次评审模型，给出替代建议 |
| `ai` | 见下方 | 评审模型配置（`baseUrl` / `model` / `apiKey` / `apiKeyEnv` / `timeoutMs` / `minConfidence` / `maxTokens` / `maxHabits` / `maxHabitsInSkill`） |
| `skillDir` | `<DSH_HOME>/skills` | 习惯 skill 的根目录 |
| `promptContext` | `true` | 注入一段提示，告知模型存在自动放行 |
| `tiers` | — | 覆盖/新增档位规则 |

档位规则形如：

```yaml
tiers:
  my-tier:
    label: 我的档位
    rank: 5
    plugin: { read: true, toggle: true, install: trusted, remove: false, exemption: false }
    maxRisk: write          # off | read | write | destructive | publish | all
    alwaysAsk: [system, publish, unknown]
    ai: true                # 上限之外先问评审模型
    escalate:
      workspace-write: all
      danger-full-access: trusted
    otherAsks: false
```

`install` / `escalate` 取值 `off` | `trusted` | `all`；`maxRisk` 是自动放行上限，`alwaysAsk` 里的风险级
即便低于上限也一律询问。

## 受信文件夹（按对话）

审批弹窗里会出现一个按钮：**信任此文件夹并允许本次（仅本对话）**。它把这次操作指向的目录
（命令取工作目录，文件操作取所在目录）加入**本对话**的受信清单，然后放行本次调用；之后在「受信放行」
及更宽的档位里，针对该目录内部的沙箱提权就能自动通过，其它目录照旧询问。

除了按对话的清单，还有一份**所有对话通用**的受信文件夹清单（在设置页面板里管理）；
判定时两份清单合并，按对话的那份只在对应对话里生效。

```
/trust                     # 列出本对话的受信文件夹
/trust add D:\work\proj    # 加入（相对路径按工作区根解析）
/trust remove D:\work\proj # 移除
/trust clear               # 清空
```

要点：

- 只对**本对话**生效，不影响其它对话；写入 `kv` 存储，重启后仍在（无存储时退化为进程内）。
- 只加宽 `workspace-write` 档位下的提权判定；**不会**让该目录内的命令获得完全访问权限，
  也不会绕过受信命令前缀的校验。
- 面板按钮只认 Host 侧那份「正在等待审批的调用」快照：没有待批调用时接口直接 409 拒绝，
  客户端无法凭空写入一个目录。
- `/trust` 是显式的人机命令，用它加目录不需要待批调用。

## 设置页面板：权限与信任

**设置 → 权限与信任**（`settings.section`，id `better-permit`）是一页可视化管理界面：

| 区域 | 内容 | 可做的操作 |
| --- | --- | --- |
| 档位与自动放行范围 | 每个档位的沙箱、自动放行上限、插件/提权维度、始终询问清单；用模型判定的档位带「AI 判定」徽标 | —（切档位用输入框选择器） |
| 风险分级 | 七级风险的说明与配色 | — |
| 评审模型 | `baseUrl` / `model` / key 来源、超时、置信度门槛、最近一次探针结果 | 「测试连接」（`POST /ai/test`） |
| 审批等待 | `holdMs` 是否启用、超过多久算暂缓 | 改配置里的 `holdMs` |
| 审批习惯 | 习惯库（签名、放行/拒绝次数、风险、最近一次）与 skill 文件路径 | 「生成 / 更新 skill」（`POST /habits/skill`） |
| 每轮自动放行报告 | 最近 10 条 `agent/turn-stopping` 时写进对话的报告原文（含轮次与次数） | —（报告本身写在对话里） |
| 所有对话通用 | 对所有对话生效的受信文件夹 | 添加（可点「浏览…」调原生选目录）、逐个移除 |
| 单个对话 | 下拉选一个对话，查看它的受信文件夹 | 添加、逐个移除、清空该对话 |
| 本对话放行规则 | 每个对话已记住的命令签名 | 逐条移除、整对话清空 |
| 各对话的受信文件夹 | 所有带受信文件夹的对话概览（按最近修改排序） | 逐个移除 |
| 配置里的信任清单 | `trustedPaths` / `trustedCommands` / `trustedPackages` 与工作区根（只读） | 改 `cordis.patch.yml` 的插件 `config` |
| 最近自动放行 | 最近 10 条自动放行与手动调整记录（含风险级） | — |

安全约定：

- 「所有对话通用」的条目会加宽**每个**对话的提权判定，属于全局放宽，界面上单独分区并标注。
- 面板写入走 Host 的 `/better-permit/approval/panel*` 端点：仅回环地址、同源校验、
  目录必须真实存在（`statSync().isDirectory()`），路径一律先 `resolve` 成绝对路径。
- 面板只改「哪些目录/命令算受信」，不改档位本身；档位仍然只能通过输入框选择器 / `/permission` 切换。

## 查看当前状态

`/tiers` 打印当前档位、风险上限、始终询问清单、各维度规则、评审模型、审批等待上限、习惯条数与
skill 路径、受信清单与本对话放行规则，以及最近 8 条自动放行记录；每次自动放行也会写入插件日志。

## 包结构

| 包 | 内容 |
| --- | --- |
| `better-permit`（本目录） | Host 半区：档位表 patch、风险分级器、裁决引擎、评审模型、习惯库、暂缓队列、受信清单与放行规则、`/tiers` `/trust` `/allow`、`/better-permit/approval/*` 端点 |
| `better-permit-ui`（`../better-permit-ui`） | 浏览器半区：审批弹窗里的风险徽标与两个快捷按钮、设置页「权限与信任」页面 |

拆成两个包不是设计偏好：`dsh-client-modules` 会把「这个包有没有 `dsh.client`」的扫描结果按
「行名 + baseUrl」永久缓存（连 `null` 也缓存，没有失效路径），所以一个包在装上之后才加的
`dsh.client` 声明永远不会被发现。浏览器半区因此单独成包，安装即生效。

## 开发

```pwsh
node test/engine.test.mjs    # 198 项离线断言：风险分级、档位上限、信任判定、放行规则、评审模型、习惯、暂缓、审批解释、每轮报告、waterfall 集成、命令、回环 API、面板端点
```

浏览器半区在旁边的 `../better-permit-ui`（`better-permit-ui`）：那里有 `client.js`
与它自己的冒烟测试（`node test/client.smoke.mjs`）。两个包都改完后各重载一次
（`plugin_manager set_bundle` 关→开），再刷新页面（客户端 bundle 不会自动热更）。

纯 JS、无依赖、无裸模块 import（本地链接插件解析不到 `@deepseek-ai/*`）；`tools/pre-execute`
只记录不裁决，`approval/request` 才做裁决，两者都用 prepend 注册。
