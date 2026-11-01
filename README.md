# dsh-permission-tiers

给 [DeepSeek Harness](https://github.com/deepseek-ai) 的权限系统做加法：把内置的三档权限
（`read-only` / `workspace-write` / `danger-full-access`）细分成 **8 档**，再加一套
**指令风险分级**、**受信文件夹**和**本对话放行规则**，让日常操作（装依赖、跑构建、列插件、安装插件）
不再每次都弹审批，同时把真正危险的动作留在人工确认里。

> 不是给所有操作开绿灯的"全自动"插件：每个档位都有一条明确的风险上限，上限之外照旧询问，
> 并且卸载插件、版本豁免、安装脚本这类动作在任何档位都会询问。

## 它解决的问题

内置权限只有三档，第二档（工作区内）里所有需要提权的动作都要点一次"允许"——包括
`plugin_manager list_plugins` 这种纯读取、`pnpm install` 这种每天几十次的常规动作。
这个插件在 Host 侧接住审批请求，按**当前档位的规则**判断能否自动放行；判不了就交回给用户，
行为与内置完全一致。

## 功能

- **8 档权限**：内置 3 档原样保留，新增 5 档递进（只读命令 → 插件免批准 → 写入自动 → 受信放行 → 高危才问 → 自动放行见下）。
- **风险分级**：每条命令在放行前先判风险（只读 / 写入 / 删除·覆盖 / 系统层 / 工作区外 / 对外发布 / 无法识别），
  档位只自动放行其上限以内的动作。
- **受信文件夹**：审批弹窗里一键「信任此文件夹并允许本次（仅本对话）」，也可 `/trust add <目录>`；
  受信目录内的路径可以提权到工作区内，受信命令前缀可以免询问执行。
- **本对话放行规则**：审批弹窗里一键「本对话总是允许这条命令」（类似 Trae），也可 `/allow add <命令>`。
  只读/写入类命令按**动词级签名**记录（`git status` / `git add`），删除、系统、发布类记录整条命令，
  避免一条 `rm` 授权变成"所有 rm 都放行"。
- **可视面板**：设置页新增「权限与信任」一页，总览档位上限、风险图例、全局/单对话受信文件夹、
  各对话放行规则、配置里的信任清单，以及最近自动放行记录。
- **可审计**：每次自动放行都写进插件日志（`/tiers` 可看最近记录，也进 Host 日志）。

## 档位

| 档位 | 沙箱 | 自动放行范围 | 仍然询问 |
| --- | --- | --- | --- |
| `read-only` | read-only | —（内置） | 一切 |
| `workspace-write` | 工作区内 | 插件列出、启用/停用、安装 | 其余一切（内置行为） |
| `workspace-write-safe` 只读命令 | 工作区内 | 只读命令、插件管理 | 写入、删除、系统、外发 |
| `workspace-write-plugins` 插件免批准 | 工作区内 | 只读命令、插件列出/启停/安装 | 移除插件、版本豁免、安装脚本、写入 |
| `workspace-write-edits` 写入自动 | 工作区内 | 只读 + 写入（含装依赖、跑构建） | 删除、系统、外发、完全访问提权 |
| `workspace-write-trusted` 受信放行 | 工作区内 | 写入 + 受信目录内的路径 + 受信前缀的命令 | 删除、系统、外发 |
| `workspace-write-guarded` 高危才问 | 工作区内 | 读、写、删除、完全访问提权 | 系统层、对外发布、识别不出的命令 |
| `workspace-write-autopilot` 自动放行 | 工作区内 | 全部提权与其它审批 | 移除插件、版本豁免、安装脚本 |
| `danger-full-access` | 完全访问 | —（内置，`approval: never`） | 不弹审批 |

档位表在 [`packages/permission-tiers/cordis.patch.yml`](packages/permission-tiers/cordis.patch.yml)，
风险上限用 `maxRisk`，即便在上限内也强制询问的用 `alwaysAsk`。

## 风险分级

| 键 | 含义 | 例子 |
| --- | --- | --- |
| `read` | 只读取 | `dir`、`Get-Content`、`git status`、`git log` |
| `write` | 在工作区内写入 | `pnpm install`、`node build.mjs`、`Set-Content out.txt` |
| `destructive` | 删除或覆盖可能还有用的东西 | `rm -rf build`、`Remove-Item x`、`git clean -fd` |
| `system` | 动系统层 | `reg add HKLM\...`、`sc config`、`setx PATH`、写 `C:\Windows` |
| `outside` | 工作区之外的普通读写 | 写 `D:\notes`（不在工作区里） |
| `publish` | 往外发东西 | `git push`、`npm publish`、`curl -T`、`scp` |
| `unknown` | 识别不出的动词 | 只在完全没有已知特征时才出现 |

上限的排序：`off < read < write < destructive < publish < all`
（`system` 与 `destructive` 同级，`unknown` 比一切都高，任何上限都拦不住它被自动放行）。

## 安装

这个插件由两个包组成（为什么必须拆成两个，见
[`packages/permission-tiers-ui/README.md`](packages/permission-tiers-ui/README.md)）：

- `packages/permission-tiers` — Host 半区：档位 patch、风险分级、裁决引擎、命令与 HTTP 端点
- `packages/permission-tiers-ui` — 浏览器半区：审批弹窗里的风险徽标与快捷按钮、设置页面板

在你的 DSH 会话里用 `plugin_manager` 各装一次（把路径换成本仓库的实际位置）：

```
plugin_manager install_bundle  target: D:\path\to\dsh-permission-tiers\packages\permission-tiers
plugin_manager install_bundle  target: D:\path\to\dsh-permission-tiers\packages\permission-tiers-ui
```

装完刷新 Web 界面（http://127.0.0.1:3079）：权限选择器和设置页会出现新档位，
设置页导航里会多出「权限与信任」。

也可以用 `/permission` 切换档位，或 `/tiers` 看当前档位的规则摘要。

> 包名用 `dsh-` 前缀（不用个人 scope），是为了将来能直接发到 npm。名字本身不影响安装：
> 只要 `package.json` 的 `name` 与 `cordis.patch.yml` 里那行 `name` 一致，装到哪个 profile 都能用。

## 使用

| 命令 | 作用 |
| --- | --- |
| `/permission <档位>` | 切换档位（内置命令） |
| `/tiers` | 当前档位、风险上限、始终询问清单、本对话放行规则、最近自动放行 |
| `/trust` | 列出本对话受信文件夹 |
| `/trust add <目录>` | 把目录加进本对话受信清单 |
| `/trust remove <目录>` / `/trust clear` | 移除 / 清空 |
| `/allow` | 列出本对话放行规则 |
| `/allow add <命令>` / `/allow remove <命令>` / `/allow clear` | 增删清空 |

审批弹窗里（仅当档位拒绝自动放行、必须询问时才会出现）多出两个快捷按钮：

- **「本对话总是允许这条命令「<签名>」」** — 记一条放行规则，然后放行本次
- **「信任此文件夹并允许本次（仅本对话）」** — 只对命令/路径类请求出现

## 安全模型

- 插件只在 `approval/request` 这个 waterfall 上作答，命中规则才返回 `allowed-once`，否则调 `next()`
  交回内置应答器（也就是用户）。**从不把 `never` 策略翻成放行**：`danger-full-access` 档位保持内置语义。
- 自动放行只对**已知形态**成立：命令文本、参数、工作目录都从 Host 自己的待批快照里取，
  客户端没有权限"声称"自己是谁。请求没有对应快照时一律询问（fail-closed）。
- 服务器端点只监听本机回环地址，并校验 `Origin`（跨源写请求 403）。
- 危险动作不在自动放行清单里：插件卸载、版本豁免（`set_version_exemption`）、带 `approvedBuilds`
  的安装脚本，在所有档位都会询问。
- 删除类命令的放行规则是**整条命令签名**，不是动词级，避免 `rm` 一次授权等于全部删除放行。

## 目录结构

```
packages/permission-tiers/         Host 半区
  index.js                         插件入口：监听器、命令、HTTP 端点
  lib/risk.js                      风险分级器
  lib/tiers.js                     档位表与规则归一化
  lib/engine.js                    裁决：allow / ask
  lib/trust.js                     受信路径与受信命令前缀
  lib/session-trust.js             按对话的受信文件夹存储
  lib/session-rules.js             按对话的命令放行规则存储
  lib/journal.js                   最近自动放行记录
  cordis.patch.yml                 档位表 + 插件挂载行
  test/engine.test.mjs             118 项离线断言
packages/permission-tiers-ui/      浏览器半区
  client.js                        审批详情组件 + 设置页面板
  test/client.smoke.mjs            冒烟测试（自带 hooks 引擎，真渲染组件）
docs/TIERS.md                      档位、风险、端点的完整表格
```

## 开发

只需要 Node（无第三方依赖，无构建步骤）：

```pwsh
cd packages/permission-tiers
node test/engine.test.mjs        # 118 checks

cd ../permission-tiers-ui
node test/client.smoke.mjs       # 渲染 + 交互冒烟
```

测试用临时目录做夹具，Windows 与 Linux 都能跑（CI 里两边都跑一遍）。

## 已知限制

- 风险分级是基于命令文本的启发式判断，不是沙箱：它能挡住"一看就危险"的命令，
  但挡不住伪装过的东西。真正的约束仍然是沙箱模式和档位的风险上限。
- 受信文件夹只在「受信放行」档位里放宽工作区提权，**不会**把档位提升成完全访问。
- 子会话默认继承父对话的档位；父对话改了档位，已经在跑的子会话不会跟着变。
- 放行规则按"命令签名"精确匹配：夹带参数的同一命令会被当成另一个签名（例如 `git status -s`），
  这是有意为之——规则越窄，误放行的面越小。

## English

Permission tiers for DeepSeek Harness: eight presets instead of three, an instruction
risk grader (read / write / destructive / system / outside / publish / unknown), per-conversation
trusted folders and per-conversation allow rules, plus a settings page that shows what each
tier auto-approves. The plugin only answers `approval/request` with `allowed-once` when a rule
covers the operation, and falls back to the built-in answerer otherwise; removals, version
exemptions and install scripts always ask. Install both packages with `plugin_manager
install_bundle`, then refresh the Web UI.

## License

MIT — see [LICENSE](LICENSE).
