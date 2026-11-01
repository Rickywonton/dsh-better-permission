# 版本更新报告

每次发版往这里加一节，写清楚「为什么改、改了什么、怎么迁移」。`CHANGELOG.md` 是速览，
这里是完整记录，也是排查"这个行为是哪一版引入的"时的第一手材料。

| 版本 | 日期 | 主题 |
| --- | --- | --- |
| 0.6.0 | 2026-11-01 | 审批弹窗 AI 中文解释、每轮自动放行报告、README 双语 |
| 0.5.0 | 2026-11-01 | 改名 better-permit、AI 判定档、审批超时暂缓、习惯 skill |
| 0.4.1 | 2026-11-01 | 修面板空白（快照 hook 未传选择器） |
| 0.4.0 | 2026-11-01 | 指令风险分级、本对话放行规则（仿 Trae） |
| 0.3.0 | 2026-10-31 | 「权限与信任」面板、全局受信文件夹、拆出浏览器包 |
| 0.2.0 | 2026-10-31 | 审批弹窗里的「信任此文件夹」、`/trust` |
| 0.1.0 | 2026-10-31 | 三个新档位、`approval/request` 应答器、`/tiers` |

## 0.6.0 — 2026-11-01

### 为什么改

审批弹窗只告诉用户"某个工具想执行"，看不懂的命令（尤其 `Remove-Item`、`reg add` 这类）
仍然需要人去猜后果；而"自动放行"越多，事后越难知道这一轮到底替用户决定了什么。
这两件事都指向同一个缺口：**把判定结果翻译成人话，并留下可回看的账**。

### 改了什么

**审批解释。** `GET /better-permit/approval/detail` 现在多返回一个 `explain`：

```json
{ "sentence": "这一步会递归删除系统驱动目录，可能让设备无法启动。", "local": "…确定性说明…", "source": "model" }
```

- 评审模型已配置：`source: "model"`，由模型写一句中文（≤60 字，只讲"在做什么 + 最坏后果"）。
- 未配置、超时（6 秒上限）、报错、返回空：`source: "local"`，用命令、工作目录、风险等级、
  风险说明与"档位为什么没放行它"拼成确定性说明。
- 解释按 callId 缓存（最多 32 条），弹窗轮询不会重复问模型。
- 界面：审批弹窗里渲染成独立一段，标签区分「评审模型的解释」/「这一步在做什么」。

**每轮报告。** 挂 `agent/turn-stopping`（serial，收尾时机），把这一轮本插件返回过
`allowed-once` 的调用按「命令签名 + 风险」归类，写成一条 `developer/message`
（`surfaceOp: "append"`）追加到对话：

```
本轮自动放行 3 次审批（未打扰你）：
· dir ×2 — 风险「只读」，由档位上限放行
· pnpm install ×1 — 风险「写入」，由本对话规则放行
```

- 来源标注：档位上限 / 本对话规则 / 受信路径 / 评审模型。
- 只在真的自动放行过时才写，空轮不产生噪声；写失败只记日志，不影响会话。
- 设置页「每轮自动放行报告」卡片保留最近 10 条。

**文档。** 三份 README 顶部都加了 `[中文](README.md) | [English](README.en.md)`，
并新增 `README.en.md` 英文版（内容与中文版一一对应）。

### 怎么迁移

无需迁移：档位、配置键、端点都向后兼容；`explain` 与 `reports` 是新字段。
想用模型解释，配上 `ai.baseUrl` / `ai.model` / `ai.apiKeyEnv` 即可，配好即生效。

### 兼容性

- 新增文件：`lib/explain.js`、`lib/reports.js`。
- 新增面板数据：`reports`（`[{at, turn, count, text}]`）；`/detail` 新增 `explain`。
- 行为变化：每轮结束可能多一条 `developer/message`（仅当本轮有自动放行）。

## 0.5.0 — 2026-11-01

### 为什么改

上一版有两个档位实际上没人用：`workspace-write-safe` 只放行只读命令，比内置的
`workspace-write`（一条命令都要问）好不了多少；`workspace-write-plugins` 只管插件动作，
而写入类日常操作（装依赖、跑构建）才是弹窗的主力。同时用户提出三件新事：
让模型帮着判危险、审批久等不定时别把会话卡死、把反复出现的放行/拒绝沉淀成可复用的习惯。

### 改了什么

**命名。** 全仓库从 `dsh-permission-tiers` / `permission-tiers-ui` 改为 `better-permit` /
`better-permit-ui`；端点前缀 `/better-permit/approval`；插件行 id `better-permit`；
客户端 bundle id `better-permit-ui`。仓库目录与包目录同步改名。

**档位表。** 删两个、加一个，现在插件贡献 5 档（内置 3 档不动）：

| 档位 | 变化 |
| --- | --- |
| `workspace-write-safe` | 删除 |
| `workspace-write-plugins` | 删除 |
| `workspace-write-edits` | 保留（写入自动） |
| `workspace-write-trusted` | 保留（受信放行） |
| `workspace-write-ai` | 新增（AI 判定） |
| `workspace-write-guarded` | 保留（高危才问），`maxRisk` 由 `publish` 收紧为 `destructive` |
| `workspace-write-autopilot` | 保留（自动放行） |

**AI 判定。** 新增 `lib/ai.js`：OpenAI 兼容的 `/chat/completions`，只接受
`{"verdict":"allow"|"ask","confidence":0..1,"reason":"…"}`。规则：
上限之内照常自动放行；上限之外先问模型，`allow` 且置信度 ≥ `minConfidence` 才放行；
解析失败、超时、非 2xx、抛错一律当作 `ask`。`danger-full-access` 提权不由模型决定。

**审批超时暂缓。** `holdMs`（毫秒，默认 0）。超时后这次调用以 `rejected` 结束（不执行），
并给该对话排一条一次性通知；模型的下一次工具调用被拒一次并收到"这一步在等你，别重试"的提示。

**习惯库与 skill。** 每次放行/拒绝记入 `better-permit-habits`（`kv`，最多 300 条）。
`POST /better-permit/approval/habits/skill` 把它写成 `<skillDir>/better-permit-habits/SKILL.md`，
DSH 的 skill 目录热加载，写完即生效。

**界面。** 设置页新增「评审模型」「审批等待」「审批习惯」三块，档位表里带「AI 判定」徽标的行；
审批弹窗多一行评审模型状态。

### 怎么迁移

1. 先从旧包切走：`plugin_manager remove_bundle` `dsh-permission-tiers` 与 `dsh-permission-tiers-ui`。
2. 装新包：`plugin_manager install_bundle` 指向 `packages/better-permit` 与 `packages/better-permit-ui`。
3. 如果你正在用被删的两个档位，切到 `workspace-write-edits`（写入自动）或更宽档位。
4. 想用 AI 判定：在插件 `config.ai` 填 `baseUrl` / `model` / key（或 `apiKeyEnv`），再切到
   `workspace-write-ai`；面板「评审模型」卡片里可以「测试连接」。
5. 想启用暂缓：设 `holdMs`（例如 `30000`）。

### 兼容性

- 数据：`kv` unit 名称从 `permission-tier-trust` / `permission-tier-rules` 保持不变（只换包名），
  升级后受信文件夹与放行规则都还在；新增 `better-permit-habits`。
- 端点：旧前缀 `/permission-tiers/approval` 不再注册，客户端与脚本需改用 `/better-permit/approval`。
- 档位键：被删的两个键会让仍写着它们的 `cordis.patch.yml` 报未知档位，删掉即好。

## 0.4.1 — 2026-11-01

### 为什么改

`0.4.0` 交付后「权限与信任」页面在真实浏览器里空白，但探针区块正常、Host 端点也正常。

### 改了什么

`useSessions` / `useSessionStatus` 是 `useSnapshotSelector(selector)` 形状的快照 hook，
必须传选择器函数。面板此前把它们当可选参数调用（`props.useSessions()`），
`memoizedSelector` 里 `selector(nextSnapshot)` 抛 `TypeError: selector is not a function`，
React 吞掉整棵子树 → 页面空白；又因为渲染从未提交，取数 `useEffect` 一次都没跑。
现在传模块级稳定的 `selectAll`，状态行只在加载中/失败时显示。

### 兼容性

无行为变化，纯修复。

## 0.4.0 — 2026-11-01

### 为什么改

用户问"能不能按指令内容的安全系数再分几档"，并希望像 Trae 那样"这次对话里某条命令永久放行"。

### 改了什么

- 指令风险分级：`read` / `write` / `destructive` / `system` / `outside` / `publish` / `unknown`，
  档位用 `maxRisk` 定上限、`alwaysAsk` 定"即便在上限内也要问"的清单。
- 新增放行规则：`/allow`、`POST /allow`、`GET /rules`、面板规则区、审批弹窗按钮。
  只读/写入按动词级签名记，删除/系统/发布按整条命令前 4 个 token 记。
- 档位从 6 档扩到 7 档（当时含 `workspace-write-safe` / `-plugins`）。
- 面板新增「档位与自动放行范围」「风险分级」「本对话放行规则」。

### 兼容性

新增字段有默认值；旧的自定义档位不写 `maxRisk` 时按 `write` 处理。

## 0.3.0 — 2026-10-31

### 为什么改

`0.2.0` 的受信文件夹只能靠 `/trust` 命令或审批按钮管理，看不见全貌。

### 改了什么

- 新增「权限与信任」设置页（`settings.section`，id `better-permit`）：全局受信文件夹、
  按对话受信文件夹、各对话概览、配置里的信任清单、最近自动放行。
- 新增全局受信文件夹（`GLOBAL_KEY`），与按对话清单合并参与判定。
- 浏览器半区拆成独立包：`dsh-client-modules` 会把「包有没有 `dsh.client`」的扫描结果按
  「行名 + baseUrl」永久缓存（连 `null` 也缓存、没有失效路径），所以一个包在装上之后才加的
  `dsh.client` 声明永远不会被发现——拆包换名是唯一不需要重启 DSH 的解法。
- 审批详情组件注册到 `conversation.approval.detail` 时用 `priority: -1` 遮蔽内置命令预览
  （`single` 槽同优先级二次注册会直接抛错，priority 越低越先渲染）。

## 0.2.0 — 2026-10-31

### 为什么改

用户问"受信文件夹都有哪些、能不能在审批里一键加"。

### 改了什么

- 审批弹窗新增按钮「信任此文件夹并允许本次（仅本对话）」。
- 新增按对话的受信文件夹存储（`kv` unit `permission-tier-trust`）与 `/trust` 四个子命令。
- 受信文件夹只放宽"工作区内提权"，不放宽完全访问。
- `POST /trust` 只从 Host 的待批快照推导目录，客户端不能凭空写；无待批调用返回 409。

## 0.1.0 — 2026-10-31

### 为什么改

内置只有三档权限，第二档里所有需要提权的动作都要点一次「允许」，包括
`plugin_manager list_plugins` 这种纯读取和每天几十次的 `pnpm install`。

### 改了什么

- 三个新档位：`workspace-write-plugins`（插件免批准）、`workspace-write-trusted`（受信放行）、
  `workspace-write-autopilot`（自动放行）。
- `approval/request` 应答器：命中规则返回 `allowed-once`，否则 `next()` 交回内置应答器。
- `tools/pre-execute` 记录每个 `callId` 的参数快照，审批时据此核对（快照缺失即 fail-closed）。
- 插件动作分级、受信路径前缀、受信命令前缀、`/tiers` 命令。
