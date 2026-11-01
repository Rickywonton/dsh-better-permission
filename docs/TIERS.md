# 档位、风险与端点

面向想改规则或接客户端的人。所有数字与文案都来自
[`packages/better-permit/cordis.patch.yml`](../packages/better-permit/cordis.patch.yml)
与 `lib/tiers.js`、`lib/risk.js`。

## 档位表

内置三档由 DSH 自己声明，这个插件只覆盖 `permission` 这一行的 `presets`，把它们一起写回去：

```yaml
presets:
  read-only:                 { sandbox: read-only,         approval: ask }
  workspace-write:           { sandbox: workspace-write,   approval: ask }
  workspace-write-edits:     { sandbox: workspace-write, approval: ask, name: 工作区内 · 写入自动 }
  workspace-write-trusted:   { sandbox: workspace-write, approval: ask, name: 工作区内 · 受信放行 }
  workspace-write-ai:        { sandbox: workspace-write, approval: ask, name: 工作区内 · AI 判定 }
  workspace-write-guarded:   { sandbox: workspace-write, approval: ask, name: 工作区内 · 高危才问 }
  workspace-write-autopilot: { sandbox: workspace-write, approval: ask, name: 工作区内 · 自动放行 }
  danger-full-access:        { sandbox: danger-full-access, approval: never }
```

顺序有意义：`permission-presets` 用「沙箱模式 + 审批策略」反推档位时取**第一个**匹配项，
所以保守档必须排在前面，否则默认档会悄悄变成自动放行的档位。

每个档位在插件自己的 `config.tiers` 里可以有：

| 字段 | 作用 |
| --- | --- |
| `maxRisk` | 自动放行的风险上限（`off` / `read` / `write` / `destructive` / `publish` / `all`） |
| `alwaysAsk` | 即便在上限内也必须询问的风险键列表 |
| `ai` | `true` 时，上限之外先问评审模型（模型说 allow 才放行，其余交回人工） |
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

## 习惯记录

`kv` unit `better-permit-habits`（`tables: ['habits']`，`layout: per-record`），每行：

```json
{ "signature": "git status", "tool": "pwsh", "risk": "read", "allow": 4, "block": 0,
  "first": 1762000000000, "last": 1762000900000, "source": "rule" }
```

`source` 取值 `rule`（命中本对话放行规则）、`tier`（档位上限内）、`ai`（评审模型放行）、`user`（人工拒绝）。
超过 `maxHabits`（默认 300）按 `last` 淘汰。

## 暂缓队列

`holdMs > 0` 时，超时的审批会把一条通知放进内存队列（每个对话一条，最多 24 条），
并在该对话的下一次 `tools/pre-execute` 里被消费一次：那次调用返回 `deny`，理由包含
「已暂缓执行」与后续建议。队列不做持久化——重启后丢弃，避免旧通知干扰新会话。

## HTTP 端点

全部挂在 `http://127.0.0.1:3079/better-permit/approval` 下，只接受回环地址；
带 `Origin` 头的写请求要求同源（跨源 403）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/detail?sessionId=&callId=` | 待批调用的工具名、命令、工作目录、风险、签名、档位上限、评审模型、是否本应自动放行 |
| GET | `/panel` | 面板数据：`base`、`global`、`conversations`、`configured`、`rules`、`tiers`、`riskHints`、`ai`、`hold`、`habits`、`deferrals`、`skill`、`recent` |
| POST | `/panel/trust` | `{scope:'global'\|'session', sessionId?, folder}` |
| POST | `/panel/untrust` | 同上，移除一条 |
| POST | `/panel/clear` | `{scope, sessionId?}`，清空范围 |
| POST | `/panel/rule-remove` | `{sessionId, pattern?}`（缺 pattern 时 400） |
| POST | `/panel/rule-clear` | `{sessionId}` |
| GET | `/trust?sessionId=` | 该对话的受信文件夹 |
| POST | `/trust` | `{sessionId, callId}` —— 从待批快照推导目录后写入；没有待批调用时 409 |
| GET | `/rules?sessionId=` | 该对话的放行规则 |
| POST | `/allow` | `{sessionId, callId}` —— 从待批快照取签名后写入；没有待批调用或签名时 409 |
| GET | `/ai` | 评审模型状态 + 使用它的档位列表 |
| POST | `/ai/test` | 发一次探针：200 带 verdict，502 带错误 |
| GET | `/habits` | 习惯库与 skill 路径 |
| POST | `/habits/skill` | 把习惯写成 `<skillDir>/better-permit-habits/SKILL.md` |
| GET | `/deferrals` | 待消费的暂缓通知 |
| GET | `/candidates` | 待批复选目录（面板与按钮的候选来源） |

## 裁决顺序

`decideApproval()` 在 `lib/engine.js`，顺序固定：

1. 插件管理动作 → 走 `plugin` 门（`remove` / `exemption` 永远询问）
2. **本对话放行规则命中** → 放行
3. 风险在 `alwaysAsk` 里 → 询问
4. 沙箱提权 → 看 `escalate`；`gate === 'all'` 且超上限时，若档位 `ai: true` 且目标是
   `workspace-write`，交给评审模型；`danger-full-access` 永远走确定性闸门
5. 非提权请求：超 `maxRisk` 且 `ai: true` → 交给评审模型；在上限内且 `ai: true` → 直接放行
6. 其余 → 看 `otherAsks`

任何一步"询问"都会调用 `next()`，把请求交回内置应答器；`holdMs > 0` 时这一步会加上超时，
超时以 `rejected` 结束并排一条暂缓通知。界面和 `never` 策略的行为与不装插件时一致。
