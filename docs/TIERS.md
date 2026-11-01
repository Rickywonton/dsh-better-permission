# 档位、风险与端点

面向想改规则或接客户端的人。所有数字与文案都来自
[`packages/permission-tiers/cordis.patch.yml`](../packages/permission-tiers/cordis.patch.yml)
与 `lib/tiers.js`、`lib/risk.js`。

## 档位表

内置三档由 DSH 自己声明，这个插件只覆盖 `permission` 这一行的 `presets`，把它们一起写回去：

```yaml
presets:
  read-only:                { sandbox: read-only,                        approval: ask }
  workspace-write:          { sandbox: workspace-write,                  approval: ask }
  workspace-write-safe:     { sandbox: workspace-write, approval: ask, name: 工作区内 · 只读命令 }
  workspace-write-plugins:  { sandbox: workspace-write, approval: ask, name: 工作区内 · 插件免批准 }
  workspace-write-edits:    { sandbox: workspace-write, approval: ask, name: 工作区内 · 写入自动 }
  workspace-write-trusted:  { sandbox: workspace-write, approval: ask, name: 工作区内 · 受信放行 }
  workspace-write-guarded:  { sandbox: workspace-write, approval: ask, name: 工作区内 · 高危才问 }
  workspace-write-autopilot: { sandbox: workspace-write, approval: ask, name: 工作区内 · 自动放行 }
  danger-full-access:       { sandbox: danger-full-access,               approval: never }
```

顺序有意义：`permission-presets` 用「沙箱模式 + 审批策略」反推档位时取**第一个**匹配项，
所以保守档必须排在前面，否则默认档会悄悄变成自动放行的档位。

每个档位在插件自己的 `config.tiers` 里可以有：

| 字段 | 作用 |
| --- | --- |
| `maxRisk` | 自动放行的风险上限（`off` / `read` / `write` / `destructive` / `publish` / `all`） |
| `alwaysAsk` | 即便在上限内也必须询问的风险键列表 |
| `plugin` | 插件管理动作的门：`off` / `read` / `trusted` / `all` |
| `escalate` | 沙箱提权的门：`off` / `trusted` / `all`（分别给工作区提权与完全访问提权） |
| `otherAsks` | 兜底：既不是插件动作也不是提权的其它审批请求是否自动放行 |

## 风险键与排序

```
off  <  read  <  write  <  destructive  =  system  <  publish  <  all
                                        unknown  =  最高（没有上限能放行它）
```

`outside`（工作区外的普通读写）与 `destructive` 同级，但**不在** `HIGH_RISK` 里，
因为「受信放行」档位正是为了清掉这一类：只有受信检查通过时才允许它。

## 命令签名（放行规则用）

- 只读动词、写入动词 → **动词级签名**：`git status`、`git add`、`pnpm install`
- 删除、系统、发布、无法识别 → **整条命令的前 4 个 token**：`rm -rf build`、`reg add HKLM\...`

这样一个 `rm` 的授权不会覆盖 `rm -rf C:\Windows`，而 `git status` 授权能覆盖它下面各种参数。

## HTTP 端点

全部挂在 `http://127.0.0.1:3079/permission-tiers/approval` 下，只接受回环地址；
带 `Origin` 头的写请求要求同源（跨源 403）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/detail?sessionId=&callId=` | 待批调用的工具名、命令、工作目录、风险、签名、档位上限、是否本应自动放行 |
| GET | `/panel` | 面板数据：`base`、`global`、`conversations`、`configured`、`rules`、`tiers`、`riskHints`、`recent` |
| POST | `/panel/trust` | `{scope:'global'\|'session', sessionId?, folder}` |
| POST | `/panel/untrust` | 同上，移除一条 |
| POST | `/panel/clear` | `{scope, sessionId?}`，清空范围 |
| POST | `/panel/rule-remove` | `{sessionId, pattern?}`（缺 pattern 时 400） |
| POST | `/panel/rule-clear` | `{sessionId}` |
| GET | `/trust?sessionId=` | 该对话的受信文件夹 |
| POST | `/trust` | `{sessionId, callId}` —— 从待批快照推导目录后写入；没有待批调用时 409 |
| GET | `/rules?sessionId=` | 该对话的放行规则 |
| POST | `/allow` | `{sessionId, callId}` —— 从待批快照取签名后写入；没有待批调用或签名时 409 |
| GET | `/candidates` | 待批复选目录（面板与按钮的候选来源） |

## 裁决顺序

`decideApproval()` 在 `lib/engine.js`，顺序固定：

1. 插件管理动作 → 走 `plugin` 门（`remove` / `exemption` 永远询问）
2. **本对话放行规则命中** → 放行
3. 风险在 `alwaysAsk` 里 → 询问
4. 风险超过 `maxRisk` → 询问
5. 沙箱提权 → 看 `escalate`（`trusted` 还要过受信检查）
6. 其它请求 → 看 `otherAsks`

任何一步"询问"都会调用 `next()`，把请求交回内置应答器，界面和 `never` 策略的行为与不装插件时一致。
