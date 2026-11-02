# Changelog

版本号跟随 `packages/*/package.json`。每个版本的详细内容另见 [`docs/RELEASES.md`](docs/RELEASES.md)。

## 0.6.2

- 修（重要）：**受信文件夹原先只在「受信放行」档位生效**，AI 判定 / 高危才问 / 自动放行三档完全无视它——
  那几档的提权门是 `all`，走的是 `maxRisk` 上限，从来没有查过受信清单。现在受信判定提到档位上限**之前**：
  命中受信目录的 `read` / `write` / `outside` 操作在**任何档位**都直接放行，AI 判定档也不会再去问评审模型。
- 安全边界（三条不变）：受信覆盖排在该档位 `alwaysAsk` 之后，硬停机依然有效；`destructive` 只有
  「受信的就是被删路径」（`scope === 'path'`）才算覆盖，只凭受信工作目录不会放行 `rm -rf`；
  `danger-full-access` 提权只在受信放行 / 高危才问档、且目标路径本身受信时才自动放行，AI 判定档的
  完全访问永远问你。
- `lib/trust.js`：`checkTrust()` 的返回增加 `scope`（`path` / `workdir` / `command` / `package`），
  `checkInstallTarget()` 同样带 `scope`，让裁决层能区分「受信的是路径」还是「只是在这个目录里跑」。
- `lib/engine.js`：新增受信覆盖与 `coveredByTrust()`；`escalate` 的 `all` / `trusted` 两个分支与
  非提权上限分支都先看受信判定。
- 面板与 `/tiers`：面板顶部说明、`/tiers` 的状态行都改成「受信文件夹在所有档位生效」，并写清完全访问的例外；
  prompt context 也告诉模型受信目录不受档位限制。
- 文档：三份 README（中/英）的受信文件夹与已知限制一节、`docs/TIERS.md` 的裁决顺序按新行为重写。
- 测试：主包 198 → **209** 项（新增 11 项覆盖各档位的受信行为与三条安全边界），界面包 72 项。

## 0.6.1

- 修：面板与审批弹窗里的主按钮会渲染成一块**纯白空按钮**。原因是「品牌色底 + `#fff` 文字」——
  品牌 token 与白色不保证有对比度，token 缺失时更会变成白底白字。主按钮改为「raised 表面 +
  品牌色边框/文字」，浅色深色主题都读得清。
- 改：审批解释不再复述命令/参数（弹窗里本来就有命令），只讲**后果**与**为什么问你**：
  按风险等级给出后果分析（只读 / 写入 / 删除覆盖 / 系统层 / 工作区外 / 对外发布 / 无法识别），
  再补一句档位说明（「只自动放行到 X 这一档，所以来问你」）。
- 改：评审模型的提示词收紧到 ≤40 字，明确禁止复述命令、引用代码、讲规则；看不出用途时要求直接
  说「按较高风险对待」。
- 新增：`explain.level`（`safe` / `caution` / `danger`）与 `explain.risk`，弹窗渲染成彩色徽标，
  `unknown` 一律 `danger`，不再出现「无法判断」的观感。
- 文档：两份 README 的「审批解释」一节按新行为重写；组件包「踩过的坑」补上按钮配色一条。
- 测试：主包 198 项、界面包 72 项。

## 0.6.0

- 审批弹窗新增中文解释：`GET /better-permit/approval/detail` 返回 `explain`（`{ sentence, local, source }`），
  配好评审模型时由模型写一句「这步在做什么、最坏什么后果」，否则用命令、风险等级与"档位为什么没放行它"
  拼出的确定性说明；模型慢/挂/返回空都会静默回落到这句，弹窗永远不会因为解释而卡住。
- 新增每轮自动放行报告：`agent/turn-stopping` 时把这一轮本插件替用户答应的审批汇总成一条
  `developer/message`（`surfaceOp: 'append'`）写进对话，列出命令类别、次数、风险与放行人
  （档位上限 / 本对话规则 / 评审模型）；设置页保留最近 10 条。
- 面板新增「每轮自动放行报告」卡片；审批弹窗把解释渲染成独立一段（标签区分「评审模型的解释」与「这一步在做什么」）。
- 新增 `lib/explain.js`、`lib/reports.js`；`/detail` 的解释按 callId 缓存，避免轮询重复问模型。
- 文档：三份 README 全部加上 `[中文](README.md) | [English](README.en.md)` 语言切换行，并新增英文版。
- 测试：主包 188 项、界面包 71 项。

## 0.5.0

- 改名：`dsh-permission-tiers` → **`better-permit`**，浏览器半区 → `better-permit-ui`，
  端点前缀 `/permission-tiers/approval` → `/better-permit/approval`，插件行 id `better-permit`。
- 删档：移除 `workspace-write-safe`（只读命令）与 `workspace-write-plugins`（插件免批准），
  它们的功能被 `workspace-write-edits` 及更宽档位覆盖。
- 新增档位 `workspace-write-ai`（工作区内 · AI 判定）：上限之外的操作先问你自己配置的评审模型。
- 新增评审模型客户端（`lib/ai.js`，OpenAI 兼容 `/chat/completions`）：只回 JSON 判定，超时/报错/
  低置信度一律 fail-closed 回落到人工；`danger-full-access` 提权不由模型决定。
- 新增审批超时暂缓（`holdMs` / `holdAdvice`）：弹窗久未回答就把这次调用判为暂缓，
  并给该对话排一条一次性通知，让模型改走不依赖它的步骤。
- 新增习惯库（`lib/habits.js`）与 skill 导出：允许/拒绝都记账，可写成
  `better-permit-habits` skill 文件供后续会话与评审模型参考。
- 面板新增「评审模型」「审批等待」「审批习惯」三块与档位的「AI 判定」徽标；
  审批弹窗新增评审模型行。
- 新端点：`GET /ai`、`POST /ai/test`、`GET /habits`、`POST /habits/skill`、`GET /deferrals`。

## 0.4.1

- 修：设置页「权限与信任」打开后空白。快照 hook（`useSessions` / `useSessionStatus`）需要传选择器函数，
  之前当可选参数用会抛 `TypeError: selector is not a function`，React 吞掉整个区块，
  而且渲染从未提交导致取数 `useEffect` 一次都不跑。现在传稳定的 `selectAll` 选择器。
- 修：面板状态行只在"加载中"或"请求失败"时显示，成功加载后不再显示冗余统计。

## 0.4.0

- 新增指令风险分级：`read` / `write` / `destructive` / `system` / `outside` / `publish` / `unknown`，
  每个档位有 `maxRisk` 上限与 `alwaysAsk` 强制询问清单。
- 新增三档：`workspace-write-safe`（只读命令）、`workspace-write-edits`（写入自动）、
  `workspace-write-guarded`（高危才问）；原 `workspace-write-plugins` / `-trusted` / `-autopilot` 改为带上限。
- 新增本对话放行规则（仿 Trae 的"本次对话永久放行某条命令"）：审批弹窗按钮、`/allow` 命令、
  `POST /allow`、`GET /rules` 与面板里的规则区。
- 审批弹窗现在显示风险徽标、档位上限，并说明"本档位为什么询问"。
- 面板新增「档位与自动放行范围」「风险分级」「本对话放行规则」三块。

## 0.3.0

- 新增「权限与信任」设置页面板：全局/单对话受信文件夹、各对话概览、配置里的信任清单、最近自动放行。
- 新增全局受信文件夹（跨对话生效）。
- 浏览器半区拆成独立的 `better-permit-ui` 包：`dsh-client-modules` 按「行名 + baseUrl」永久缓存
  扫描结果且没有失效路径，主包在加上 `dsh.client` 之前被扫描过一次就再也不会加载。

## 0.2.0

- 审批弹窗新增「信任此文件夹并允许本次（仅本对话）」按钮，配合 `/trust` 命令与按对话的受信存储。
- 受信目录只放宽"工作区内提权"，不放宽完全访问。

## 0.1.0

- 三个新档位：`workspace-write-plugins`、`workspace-write-trusted`、`workspace-write-autopilot`。
- `approval/request` 应答器 + `tools/pre-execute` 快照，插件动作分级、受信路径与受信命令前缀、`/tiers` 命令。
