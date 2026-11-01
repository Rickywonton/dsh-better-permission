[Chinese](README.md) | [English](README.en.md)

# Permission tiers

On top of DSH's three existing permission levels (`read-only` / `workspace-write` / `danger-full-access`), this adds graded tiers:
**every tier has a risk ceiling; operations below the ceiling are auto-approved, and anything above it always asks**. That way everyday operations such as
downloading plugins, installing dependencies and running builds do not need repeated "Allow" clicks, while deleting files, touching the system or sending things outward still stop to ask.

## Risk grading

Every pending operation is first graded, and the tier's ceiling decides whether it is auto-approved:

| Risk | Meaning | Examples |
| --- | --- | --- |
| `read` read-only | reads only, no writes | `dir`, `Get-Content`, `git status`, `Get-ChildItem \| Select-String` |
| `write` write | changes workspace content | `npm install`, `node build.js`, creating/rewriting files in the workspace |
| `destructive` delete / overwrite | deletes or overwrites existing files | `rm -rf`, `Remove-Item -Recurse`, `git reset --hard` |
| `system` system layer | changes system configuration or system directories | `reg add HKLM\...`, `sc config`, `Remove-Item C:\Windows\...`, writing to `Program Files` |
| `outside` outside the workspace | ordinary paths outside the workspace | writing `D:\other\...` |
| `publish` publish | sends content outward | `git push`, `npm publish`, `curl -T`, `Invoke-RestMethod -Method Post`, `scp`, `ssh` |
| `unknown` unknown | commands the rule table does not recognize | unfamiliar executable names |

Grading is based on the command text (split on `&&` / `||` / `;` / `|` and examined segment by segment) and on paths in tool arguments, not on what the model says about itself.

## Tier overview

| Tier | Sandbox | Auto-approval ceiling | Still asks |
| --- | --- | --- | --- |
| `read-only` | read-only | — | everything |
| `workspace-write` (default) | workspace | — | everything |
| `workspace-write-edits`<br>workspace · auto-write | workspace | write | delete/overwrite, system, publish; full-access escalation |
| `workspace-write-trusted`<br>workspace · trusted | workspace | write + escalation inside trusted folders / trusted commands | delete, system, publish |
| `workspace-write-ai`<br>workspace · AI review | workspace | write, plus actions above the ceiling judged by the reviewer model you configure | system, publish, unknown; also asks when the model is unsure or unavailable |
| `workspace-write-guarded`<br>workspace · high-risk only | workspace | delete/overwrite, outside the workspace | system, publish, unknown |
| `workspace-write-autopilot`<br>workspace · autopilot | workspace | everything | plugin removal, version exemptions, install scripts |
| `danger-full-access` | full access | — (`approval: never`, no more prompts) | — |

Tiers are declared by the `@deepseek-ai/dsh-permission-presets` table, so **the permission selector in the composer, the default tier on the Settings page,
and the `/permission` command all pick up the new tiers automatically** without extra UI.

## Per-conversation allow rules (Trae-style)

When a command prompts repeatedly, click **"Always allow this command '<signature>' in this conversation"** in the approval dialog:
it records the command's signature in **this conversation's** allow list and approves the current call; afterwards the same signature passes directly in this conversation.

The signature is verb-level: read/write verbs such as `git status` and `git diff` are authorized only up to `verb + subcommand`;
delete, system, publish and unknown commands are authorized by the **whole command (first 4 tokens)**, so one `rm -rf xxx` does not also allow other `rm` commands.

You can also manage them manually:

```
/allow                       # list this conversation's allow rules
/allow git status            # add
/allow remove git status     # remove
/allow clear                 # clear
```

Rules apply only within this conversation and are written to `kv` storage (they survive a restart). They **cannot** override a tier's "always ask" list:
operations such as `system` / `publish` / `unknown` that still ask under trusted tiers are not auto-approved by rules either.

When the model takes part in the decision, set `ai: true` in the tier rule: within the ceiling approval works as before; above the ceiling the reviewer model is asked first,
and only an `allow` lets the call through -- everything else goes back to a human. Escalation to `danger-full-access` is never decided by the model.

## AI review mode

The `workspace-write-ai` tier hands "above the ceiling but not yet requiring a human" to a model you provide:

```yaml
ai:
  baseUrl: https://api.example.com/v1   # OpenAI-compatible; the plugin appends /chat/completions itself
  model: your-model
  apiKeyEnv: BETTER_PERMIT_API_KEY      # or write apiKey directly (never logged)
  timeoutMs: 8000
  minConfidence: 0.6                    # below this confidence counts as "unsure"
  maxTokens: 400
  maxHabits: 12                         # how many habits to pass to the model at most
```

Behavior constraints:

- Only JSON `{"verdict":"allow"|"ask","confidence":0..1,"reason":"…"}` is accepted; unparseable output, timeouts,
  non-2xx responses, exceptions and insufficient confidence all count as `ask` (fail-closed), that is, back to asking you.
- It only affects "whether to interrupt you": escalation to `danger-full-access` is still a deterministic gate; at most the model can let a `workspace-write` escalation take effect.
- When `baseUrl` / `model` / key are not configured, this tier degrades to "ask you for everything above the ceiling".

`GET /better-permit/approval/ai` returns `{configured, baseUrl, model, keySource, timeoutMs, minConfidence, lastCall}`;
`POST /better-permit/approval/ai/test` sends one probe (200 with a verdict on success, 502 on failure). The panel has a "Test connection" button.

## Approval hold / deferral

```yaml
holdMs: 30000      # 0 = no limit (default); >0 means a dialog unanswered for this long is settled as "deferred"
holdAdvice: true   # on deferral, also ask the reviewer model once: can this run safely / how to route around it
```

On deferral: the call ends as `rejected` (it does not run), and a **one-shot notice** is queued for the conversation --
the model's next tool call is refused once, with a reason explaining "this step is waiting on you, do not retry with the same arguments, do the steps that do not depend on it first".
The notice is delivered only once; after that the model continues under the normal rules.

## Habits and the skill

Every allow/deny is recorded in the habit store (`kv` unit `better-permit-habits`, at most 300 entries, evicted in least-recently-used order):

```yaml
maxHabits: 12        # how many to show the reviewer model each time
maxHabitsInSkill: 40 # how many to write when exporting the skill
skillDir: D:\dsh-home\skills   # default <DSH_HOME>/skills
```

- `GET /better-permit/approval/habits` shows the habit store.
- `POST /better-permit/approval/habits/skill` writes the habits to `<skillDir>/better-permit-habits/SKILL.md`;
  DSH's skill directory is hot-reloaded, so the file takes effect immediately (the panel has a "Generate / update skill" button).
- The generated SKILL.md has three sections -- "can run directly", "must ask a human first" and "judgment principles" -- sourced from real allow/deny records.

## Approval explanations

Every dialog carries a Chinese explanation (`lib/explain.js`, the `explain` of `GET /better-permit/approval/detail`):

```json
{
  "sentence": "This deletes or overwrites existing content, and deleted files usually cannot be recovered. ...",
  "local": "…",
  "source": "local",
  "level": "danger",
  "risk": { "key": "destructive", "label": "delete / overwrite", "hint": "deletes or overwrites existing files" }
}
```

- **Consequence and reason only**: the command, working directory and risk badge are already in the dialog, so nothing here repeats the command or quotes its arguments.
- `source: "model"`: when a reviewer model is configured it writes one sentence (at most 40 characters, forbidden from restating the command or quoting code), 6-second cap.
- `source: "local"`: when the model is not configured / times out / errors / returns nothing, the explanation is `analysisOf(risk.key)` (read / write / destructive / system / outside / publish / unknown) plus one line about why the tier is asking.
- `level`: `safe` / `caution` / `danger`, rendered as a coloured badge; `unknown` is always `danger` and the text states it is treated as high risk, so the dialog never reads as "cannot judge".
- Explanations are cached by `callId` (at most 32), so repeated dialog fetches do not ask the model again.

## Per-turn auto-approval report

`lib/reports.js` + `agent/turn-stopping` (serial): at the end of a turn, the calls this plugin answered with `allowed-once` during
the turn are grouped by "signature + risk" and written as one `developer/message` (`surfaceOp: "append"`) appended to the conversation:

```
3 approvals auto-approved this turn (without interrupting you):
· dir x2 — risk "read", approved by the tier ceiling
· pnpm install x1 — risk "write", approved by this conversation's rule
```

- Who approved: tier ceiling / this conversation's rule / trusted path / reviewer model.
- Empty turns write nothing; a failed write is only logged (`category: 'report-failed'`) and does not affect the session.
- The `reports` field of `GET /better-permit/approval/panel` returns the latest 10 (`{at, turn, count, text}`), and the Settings panel has a matching card.

## Security boundaries (the same for every tier)

- It only answers `allowed-once`; it never rewrites the approval policy, installs no resident hooks and does not block approvals -- if no rule matches it calls `next()` back to the original answerer.
- **Plugin removal** and **version exemptions** (`acceptRisk`) always need human confirmation; `install_bundle` with `approvedBuilds` is not auto-approved.
- Decisions rely on more than text: `tools/pre-execute` first records the call's **arguments** by `callId`, and approval checks against them;
  without a trusted snapshot (for example the call and the approval do not match, or the arguments cannot be read) everything goes back to a human, fail-closed.
- Trusted commands must **start with a whitelist prefix as a whole command** and must not contain shell metacharacters such as `;`, `&`, `|`, `>`, `<`, a backtick, `$`, `(`, `)`, `{`, `}` or newlines,
  so `pnpm install && rm -rf /` is not approved.
- Trusted paths are compared as prefixes after `path.resolve` (case-insensitive, including separator boundaries), so `D:/trusted-evil` is not treated as `D:/trusted`.
- Sub-sessions (sub-agents) that keep the default tier inherit the parent session's tier, so sub-tasks do not fall back to "ask every time".

## Configuration

`config` of the `better-permit` line in `cordis.patch.yml` (any field may be omitted):

| Key | Default | Meaning |
| --- | --- | --- |
| `inheritParentTier` | `true` | sub-sessions keep the parent session's tier |
| `defaultTier` | `workspace-write` | the tier treated as "not selected", used to decide inheritance |
| `pluginTools` | `['plugin_manager']` | tool names treated as plugin management |
| `guardedActions` | `['remove','exemption']` | plugin action classes that always need a human under any tier |
| `requireBuildApproval` | `true` | installs with install scripts are not auto-approved |
| `trustedPaths` | `[]` | trusted directory prefixes (relative paths resolve against the workspace root) |
| `trustedCommands` | `pnpm install` / `pnpm add` / `npm install` / `npm i` / `npm ci` | trusted command prefixes |
| `trustedPackages` | `[]` | trusted package names or scopes (`@scope/*`), used by custom tiers with `install: trusted` |
| `shellTools` | `['pwsh','bash','shell','sh']` | tool names that execute commands |
| `journalSize` | `40` | number of auto-approval records |
| `holdMs` | `0` | defer the operation when approval is unanswered for this long (ms); `0` = no limit |
| `holdAdvice` | `true` | on deferral, ask the reviewer model once for an alternative |
| `ai` | see below | reviewer model config (`baseUrl` / `model` / `apiKey` / `apiKeyEnv` / `timeoutMs` / `minConfidence` / `maxTokens` / `maxHabits` / `maxHabitsInSkill`) |
| `skillDir` | `<DSH_HOME>/skills` | root directory for the habit skill |
| `promptContext` | `true` | inject a prompt telling the model that auto-approval exists |
| `tiers` | — | override/add tier rules |

A tier rule looks like this:

```yaml
tiers:
  my-tier:
    label: My tier
    rank: 5
    plugin: { read: true, toggle: true, install: trusted, remove: false, exemption: false }
    maxRisk: write          # off | read | write | destructive | publish | all
    alwaysAsk: [system, publish, unknown]
    ai: true                # ask the reviewer model above the ceiling
    escalate:
      workspace-write: all
      danger-full-access: trusted
    otherAsks: false
```

`install` / `escalate` take `off` | `trusted` | `all`; `maxRisk` is the auto-approval ceiling, and risk grades in `alwaysAsk`
always ask even when they are below the ceiling.

## Trusted folders (per conversation)

The approval dialog shows a button: **Trust this folder and allow this call (this conversation only)**. It adds the directory the operation points at
(the working directory for commands, the containing directory for file operations) to **this conversation's** trusted list and approves the current call;
afterwards, under the "trusted" tier and wider, sandbox escalation for that directory passes automatically, while other directories still ask.

Besides the per-conversation list there is a trusted-folder list **shared by all conversations** (managed in the Settings panel);
the two lists are merged at decision time, and the per-conversation one only applies in its own conversation.

```
/trust                     # list this conversation's trusted folders
/trust add D:\work\proj    # add (relative paths resolve against the workspace root)
/trust remove D:\work\proj # remove
/trust clear               # clear
```

Key points:

- It only applies to **this conversation** and does not affect other conversations; it is written to `kv` storage and survives a restart (it degrades to in-process when there is no storage).
- It only widens the escalation decision **into** the `workspace-write` sandbox; it **does not** give commands in that directory full access,
  and it does not bypass the trusted command prefix checks.
- The panel button only trusts the Host-side snapshot of "the call currently waiting for approval": with no pending call the endpoint returns 409,
  so a client cannot write a directory out of thin air.
- `/trust` is an explicit human command; adding a directory with it does not need a pending call.

## Settings panel: Permissions

**Settings -> Permissions** (`settings.section`, id `better-permit`) is a visual management page:

| Area | Contents | Actions |
| --- | --- | --- |
| Tiers and auto-approval scope | sandbox, auto-approval ceiling, plugin/escalation dimensions and always-ask list for each tier; tiers that use the model carry an "AI review" badge | — (switch tiers with the composer selector) |
| Risk grades | explanation and colors for the seven risk grades | — |
| Reviewer model | `baseUrl` / `model`, key source, timeout, confidence threshold, last probe result | "Test connection" (`POST /ai/test`) |
| Approval wait | whether `holdMs` is enabled and after how long a dialog is deferred | edit `holdMs` in config |
| Approval habits | habit store (signature, allow/deny counts, risk, last seen) and the skill file path | "Generate / update skill" (`POST /habits/skill`) |
| Per-turn auto-approval report | the latest 10 report texts written to the conversation at `agent/turn-stopping` (including turn and count) | — (the report itself is written into the conversation) |
| Shared by all conversations | trusted folders that apply to every conversation | add (with a "Browse..." button for the native directory picker), remove one by one |
| Single conversation | pick a conversation from the dropdown and view its trusted folders | add, remove one by one, clear that conversation |
| This conversation's allow rules | command signatures remembered per conversation | remove one by one, clear a whole conversation |
| Trusted folders by conversation | overview of every conversation that has trusted folders (most recently changed first) | remove one by one |
| Trust lists from config | `trustedPaths` / `trustedCommands` / `trustedPackages` and the workspace root (read-only) | edit the plugin `config` in `cordis.patch.yml` |
| Recent auto-approvals | the last 10 auto-approvals and manual adjustments (including risk grade) | — |

Security conventions:

- Entries under "shared by all conversations" widen escalation decisions for **every** conversation; this is a global relaxation, so it has its own section and is labeled as such.
- Panel writes go through the Host's `/better-permit/approval/panel*` endpoints: loopback only, same-origin check,
  the directory must really exist (`statSync().isDirectory()`), and paths are always `resolve`d to absolute paths first.
- The panel only changes "which directories/commands count as trusted", never the tier itself; tiers can still only be switched through the composer selector / `/permission`.

## Checking the current state

`/tiers` prints the current tier, risk ceiling, always-ask list, rules per dimension, reviewer model, approval wait limit, habit count and
skill path, trust lists and this conversation's allow rules, plus the last 8 auto-approval records; every auto-approval is also written to the plugin log.

## Package layout

| Package | Contents |
| --- | --- |
| `better-permit` (this directory) | Host half: tier-table patch, risk grader, decision engine, reviewer model, habit store, deferral queue, trust lists and allow rules, `/tiers` `/trust` `/allow`, `/better-permit/approval/*` endpoints |
| `better-permit-ui` (`../better-permit-ui`) | Browser half: risk badge and two shortcut buttons in the approval dialog, "Permissions" page under Settings |

The split into two packages is not a design preference: `dsh-client-modules` caches the scan result for "does this package have `dsh.client`"
permanently by "loader line name + baseUrl" (even `null` is cached, and there is no invalidation path), so a `dsh.client` declaration added
to a package after it was installed is never discovered. The browser half is therefore its own package and works as soon as it is installed.

## Development

```pwsh
node test/engine.test.mjs    # 198 offline checks: risk grading, tier ceilings, trust decisions, allow rules, reviewer model, habits, deferral, approval explanation, per-turn report, waterfall integration, commands, loopback API, panel endpoints
```

The browser half lives next door in `../better-permit-ui` (`better-permit-ui`): `client.js` and its own smoke test (`node test/client.smoke.mjs`).
After changing both packages, toggle each one off and on again (`plugin_manager set_bundle` off->on), then refresh the page (client bundles do not hot-reload).

Plain JS, no dependencies, no bare module imports (a locally linked plugin cannot resolve `@deepseek-ai/*`); `tools/pre-execute`
only records and does not decide, `approval/request` does the deciding, and both are registered with prepend.
