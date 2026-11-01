# Changelog

版本号跟随 `packages/*/package.json`。

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
- 浏览器半区拆成独立的 `permission-tiers-ui` 包：`dsh-client-modules` 按「行名 + baseUrl」永久缓存
  扫描结果且没有失效路径，主包在加上 `dsh.client` 之前被扫描过一次就再也不会加载。

## 0.2.0

- 审批弹窗新增「信任此文件夹并允许本次（仅本对话）」按钮，配合 `/trust` 命令与按对话的受信存储。
- 受信目录只放宽"工作区内提权"，不放宽完全访问。

## 0.1.0

- 三个新档位：`workspace-write-plugins`、`workspace-write-trusted`、`workspace-write-autopilot`。
- `approval/request` 应答器 + `tools/pre-execute` 快照，插件动作分级、受信路径与受信命令前缀、`/tiers` 命令。
