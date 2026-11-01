[Chinese](README.md) | [English](README.en.md)

# better-permit

An addition to the permission system of [DeepSeek Harness](https://github.com/deepseek-ai): it splits the three built-in permission levels
(`read-only` / `workspace-write` / `danger-full-access`) into **8 tiers**, and adds **instruction risk grading**,
**trusted folders**, **per-conversation allow rules**, and an optional **AI review** mode,
so that everyday operations (installing dependencies, running builds, listing plugins, installing plugins) no longer prompt for approval every time,
while genuinely dangerous actions still stay in human confirmation.

> This is not an "allow everything" plugin: every tier has an explicit risk ceiling, anything above the ceiling still asks,
> and actions such as removing a plugin, version exemptions, and install scripts ask under every tier.

## The problem it solves

The built-in permission system has only three levels, and under the second one (workspace-write) every action that needs escalation requires clicking "Allow" --
including pure reads such as `plugin_manager list_plugins` and routine actions such as `pnpm install` that happen dozens of times a day.
This plugin catches approval requests on the Host side and decides, according to **the current tier's rules**, whether it can auto-approve them; if it cannot decide, the request goes back to the user,
and the behavior is exactly the same as the built-in one.

## Features

- **8 permission tiers**: the 3 built-in tiers are kept as they are, and 5 graded tiers are added: auto-write -> trusted -> **AI review** -> high-risk only -> autopilot.
- **Risk grading**: every command is graded before approval (read / write / destructive / system / outside / publish / unknown);
  a tier only auto-approves actions within its ceiling.
- **AI review mode**: the `workspace-write-ai` tier hands the range "above the ceiling but not yet requiring a human" to an
  OpenAI-compatible model you configure (you provide `baseUrl` / `model` / key). If the model cannot understand the command, times out, errors, or has insufficient confidence,
  it always falls back to asking you; it **cannot** widen permissions to full access.
- **Approval hold / deferral**: when `holdMs > 0`, if the approval dialog is left unanswered for longer than that, the plugin settles the call as "deferred"
  and tells the model once, on its next tool call, why ("this step is waiting on you, do something else first"), so the model can plan an alternative route itself.
- **Habit capture**: every allow/deny is recorded in a habit store and can be exported as a skill file (`better-permit-habits`),
  which later sessions and the reviewer model can glance at first.
- **Trusted folders**: one-click "trust this folder and allow this call (this conversation only)" in the approval dialog, or `/trust add <dir>`.
- **Per-conversation allow rules**: one-click "always allow this command in this conversation" in the approval dialog (similar to Trae), or `/allow add <command>`.
- **Approval explanation**: every dialog explains, in Chinese, what the step is doing and what the worst outcome would be.
  With a reviewer model configured the sentence is written by the model; otherwise it is composed from the command, the risk grade
  and why the tier did not approve it (a model timeout, error or empty answer falls back to that sentence).
- **Per-turn auto-approval report**: when a turn ends, the approvals handled for you during that turn are summarized into one report
  appended to the conversation, listing command classes, counts, risk and who approved (tier ceiling / this conversation's rule /
  reviewer model); the panel keeps the latest 10.
- **Visual panel**: a new "Permissions" page under Settings, overviewing tier ceilings, the risk legend, reviewer model status, approval wait settings,
  the habit store, per-turn reports, global/per-conversation trusted folders, per-conversation allow rules, and recent auto-approvals.
- **Auditable**: every auto-approval is written to the plugin log (`/tiers` shows recent records; they also go to the Host log).

## Tiers

| Tier | Sandbox | Auto-approved scope | Still asks |
| --- | --- | --- | --- |
| `read-only` | read-only | — (built-in) | everything |
| `workspace-write` | workspace | plugin listing, enable/disable, install | everything else (built-in behavior) |
| `workspace-write-edits` auto-write | workspace | read + write (including dependency installs and builds), plugin management | destructive, system, publish, full-access escalation |
| `workspace-write-trusted` trusted | workspace | write + paths inside trusted folders + commands with trusted prefixes | destructive, system, publish |
| `workspace-write-ai` AI review | workspace | read + write, plus higher-risk actions the model judges safe | system, publish, unrecognized commands, anything the model is unsure about |
| `workspace-write-guarded` high-risk only | workspace | read, write, destructive, outside the workspace, full-access escalation | system, publish, unrecognized commands |
| `workspace-write-autopilot` autopilot | workspace | all escalations and other approvals | plugin removal, version exemptions, install scripts |
| `danger-full-access` | full access | — (built-in, `approval: never`) | no prompts |

The tier table lives in [`packages/better-permit/cordis.patch.yml`](packages/better-permit/cordis.patch.yml);
the risk ceiling is `maxRisk`, actions that must ask even below the ceiling are in `alwaysAsk`, and tiers that involve the model use `ai: true`.

## Risk grading

| Key | Meaning | Examples |
| --- | --- | --- |
| `read` | read only | `dir`, `Get-Content`, `git status`, `git log` |
| `write` | writes inside the workspace | `pnpm install`, `node build.mjs`, `Set-Content out.txt` |
| `destructive` | deletes or overwrites things that may still be needed | `rm -rf build`, `Remove-Item x`, `git clean -fd` |
| `system` | touches the system layer | `reg add HKLM\...`, `sc config`, `setx PATH`, writing to `C:\Windows` |
| `outside` | ordinary reads/writes outside the workspace | writing `D:\notes` (not in the workspace) |
| `publish` | sends things outward | `git push`, `npm publish`, `curl -T`, `scp` |
| `unknown` | verb not recognized | only appears when there are no known traits at all |

Ceiling order: `off < read < write < destructive < publish < all`
(`system` ranks with `destructive`, and `unknown` sits above everything, so no ceiling can let it through).

## Configuring AI review mode

Fill in your own model service (an OpenAI-compatible `/chat/completions`) under the plugin's `config.ai`:

```yaml
ai:
  baseUrl: https://api.example.com/v1    # do not include /chat/completions
  model: your-model-name
  apiKeyEnv: BETTER_PERMIT_API_KEY       # or write apiKey directly
  timeoutMs: 8000
  minConfidence: 0.6
  maxHabits: 12                          # how many habits to pass to the model at most
```

Then switch to the `workspace-write-ai` tier. The "Reviewer model" card on the Settings page has a "Test connection" button,
and `GET /better-permit/approval/ai` also shows where the key comes from: `config` / `env:NAME` / `none`.

## Enabling approval hold / deferral

`holdMs` (milliseconds, default `0` = no limit):

```yaml
holdMs: 30000      # if nobody clicks the dialog for 30 seconds, settle this call as "deferred"
holdAdvice: true   # on deferral, also ask the model once: can this run safely / how to route around it
```

A deferral does not cancel the dialog you already have open; it only means the model does not have to wait for it --
the model's next tool call is refused once and receives the hint "this step is waiting on you, do something else first", then it continues.

## Habits and the skill

`GET /better-permit/approval/habits` shows the habit store; clicking "Generate / update skill" in the panel writes the habits into a
skill file (default `D:\dsh-home\skills\better-permit-habits\SKILL.md`, changeable with `skillDir`).
DSH's skill directory is hot-reloaded, so the file takes effect as soon as it is written.

## Approval explanations

Every dialog carries a Chinese explanation (the `explain` field of `GET /better-permit/approval/detail`):

```json
{ "sentence": "This step recursively deletes the system driver directory and may leave the device unable to boot.", "source": "model" }
```

- `source: "model"`: a reviewer model is configured and writes one sentence (at most 60 characters, covering only "what it is doing + the worst consequence").
- `source: "local"`: when the model is not configured, times out (6-second cap), errors or returns nothing, a deterministic explanation composed from the command, working directory, risk grade and "why the tier did not approve it".
- Explanations are cached by `callId`, so repeated dialog fetches do not ask the model again.

## Per-turn auto-approval report

At the end of a turn (`agent/turn-stopping`), the plugin summarizes the approvals it auto-approved during that turn into one report
appended to the conversation:

```
3 approvals auto-approved this turn (without interrupting you):
· dir x2 — risk "read", approved by the tier ceiling
· pnpm install x1 — risk "write", approved by this conversation's rule
```

Empty turns write nothing; a failed write is only logged and does not affect the session. The "Per-turn auto-approval report" card
on the Settings page keeps the latest 10, and they are also available from the `reports` field of `GET /better-permit/approval/panel`.

## Installation

The plugin consists of two packages (why they must be split is explained in
[`packages/better-permit-ui/README.md`](packages/better-permit-ui/README.md)):

- `packages/better-permit` — Host half: tier patch, risk grading, decision engine, commands and HTTP endpoints
- `packages/better-permit-ui` — browser half: risk badge and shortcut buttons in the approval dialog, Settings page panel

Install each one once in your DSH session with `plugin_manager` (replace the paths with the actual location of this repository):

```
plugin_manager install_bundle  target: D:\path\to\better-permit\packages\better-permit
plugin_manager install_bundle  target: D:\path\to\better-permit\packages\better-permit-ui
```

After installing, refresh the Web UI (http://127.0.0.1:3079): the new tiers appear in the permission selector and on the Settings page,
and "Permissions" is added to the Settings navigation.

You can also switch tiers with `/permission`, or see a summary of the current tier's rules with `/tiers`.

> The package names are unscoped (`better-permit` / `better-permit-ui`), so they can be published to npm later. The name itself does not affect installation:
> as long as the `name` in `package.json` and the `name` in the `cordis.patch.yml` row agree, it works in any profile.

## Usage

| Command | Purpose |
| --- | --- |
| `/permission <tier>` | switch tiers (built-in command) |
| `/tiers` | current tier, risk ceiling, always-ask list, reviewer model, approval wait, habit count, this conversation's allow rules, recent auto-approvals |
| `/trust` | list this conversation's trusted folders |
| `/trust add <dir>` | add a directory to this conversation's trusted list |
| `/trust remove <dir>` / `/trust clear` | remove / clear |
| `/allow` | list this conversation's allow rules |
| `/allow add <command>` / `/allow remove <command>` / `/allow clear` | add, remove, clear |

The approval dialog (which only appears when the tier refuses to auto-approve and a human must be asked) gains two shortcut buttons:

- **"Always allow this command '<signature>' in this conversation"** — records an allow rule, then approves this call
- **"Trust this folder and allow this call (this conversation only)"** — only shown for command/path requests

## Security model

- The plugin only answers on the `approval/request` waterfall; it returns `allowed-once` only when a rule matches, otherwise it calls `next()`
  and hands the request back to the built-in answerer (that is, the user). It **never turns a `never` policy into an allow**: the `danger-full-access` tier keeps the built-in semantics.
- Auto-approval only holds for **known shapes**: command text, arguments and working directory all come from the Host's own pending snapshot,
  and the client has no way to "claim" to be something else. Requests without a matching snapshot always ask (fail-closed).
- Server endpoints listen only on the loopback address and validate `Origin` (cross-origin write requests get 403).
- Dangerous actions are not on the auto-approval list: plugin removal, version exemptions (`set_version_exemption`), and installs with
  `approvedBuilds` ask under every tier.
- Allow rules for destructive commands are the **whole-command signature**, not verb-level, so that one `rm` grant does not mean all deletions are allowed.
- The reviewer model only affects "whether to interrupt you", not the sandbox: escalation to `danger-full-access` always goes through the deterministic gate,
  and at most the model can let a `workspace-write` escalation take effect; when the model is unavailable everything falls back to a human.

## Repository layout

```
packages/better-permit/         Host half
  index.js                         plugin entry: listeners, commands, HTTP endpoints
  lib/risk.js                      risk grader
  lib/tiers.js                     tier table and rule normalization
  lib/engine.js                    decision: allow / ask / hand to the model
  lib/ai.js                        reviewer model client (OpenAI-compatible)
  lib/habits.js                    habit store + skill export
  lib/hold.js                      approval hold and notice text
  lib/explain.js                   plain-language explanation for the approval dialog (one model sentence / deterministic paragraph)
  lib/reports.js                   grouping and rendering of the per-turn auto-approval report
  lib/trust.js                     trusted paths and trusted command prefixes
  lib/session-trust.js             per-conversation trusted-folder storage
  lib/session-rules.js             per-conversation command allow-rule storage
  lib/journal.js                   recent auto-approval records
  cordis.patch.yml                 tier table + plugin mount line
  test/engine.test.mjs             188 offline checks
packages/better-permit-ui/      browser half
  client.js                        approval detail component + Settings page panel
  test/client.smoke.mjs            smoke test (own hooks engine, really renders components)
docs/TIERS.md                      full tables of tiers, risks and endpoints
docs/RELEASES.md                   what changed in each release
```

## Development

Only Node is needed (no third-party dependencies, no build step):

```pwsh
cd packages/better-permit
node test/engine.test.mjs        # 188 checks

cd ../better-permit-ui
node test/client.smoke.mjs       # 71 checks: render + interaction smoke test
```

The tests use temporary directories as fixtures and run on both Windows and Linux (CI runs both).

## Known limitations

- Risk grading is a heuristic over command text, not a sandbox: it stops commands that look dangerous at a glance,
  but it does not stop disguised ones. The real constraint is still the sandbox mode and the tier's risk ceiling.
- Trusted folders only relax workspace escalation in the "trusted" tier; they **do not** promote the tier to full access.
- The reviewer model sees the command text and working directory, not the command's real side effects; its judgment is only used to reduce interruptions.
- After an approval hold, the previous dialog is still on screen; reopening it no longer affects the model (that step has already ended as "deferred").
- Sub-sessions inherit the parent conversation's tier by default; if the parent changes tiers, sub-sessions that are already running do not follow.
- Allow rules match the exact "command signature": the same command with extra arguments is a different signature (for example `git status -s`),
  and that is intentional -- the narrower the rule, the smaller the surface for accidental approval.

## Summary

Permission tiers for DeepSeek Harness: eight presets instead of three, an instruction risk
grader (read / write / destructive / system / outside / publish / unknown), per-conversation
trusted folders and allow rules, an optional AI reviewer tier that consults your own
OpenAI-compatible model, a plain-language explanation in every approval dialog, a per-turn
report of everything that was auto-approved, a "pause after N seconds" mode that tells the agent
to move on instead of waiting forever, and a habit log that can be exported as a skill. The plugin only answers
`approval/request` with `allowed-once` when a rule covers the operation, and falls back to the
built-in answerer otherwise; removals, version exemptions and install scripts always ask, and
the reviewer can never widen the sandbox to full access. Install both packages with
`plugin_manager install_bundle`, then refresh the Web UI.

## License

MIT — see [LICENSE](LICENSE).
