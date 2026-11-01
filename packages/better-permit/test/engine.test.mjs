/**
 * Offline checks for the tier rules, the trust checks and the full approval
 * waterfall (with a fake Context, so no DSH runtime is involved).
 *
 *   node test/engine.test.mjs
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

// Fixtures live in a temp folder, so the suite runs on any platform and leaves
// nothing behind — a few checks really stat a folder.
const sandboxRoot = mkdtempSync(join(tmpdir(), 'better-permit-test-'))
const WS = join(sandboxRoot, 'ws')
const TRUSTED = join(sandboxRoot, 'trusted')
const TRUSTED_EVIL = join(sandboxRoot, 'trusted-evil')
mkdirSync(join(WS, 'proj'), { recursive: true })
mkdirSync(TRUSTED, { recursive: true })
mkdirSync(TRUSTED_EVIL, { recursive: true })
import { DEFAULT_TIERS, mergeTiers, parseEscalation, categoryOf } from '../lib/tiers.js'
import { decideApproval } from '../lib/engine.js'
import { normalizeTrust, targetFolders, checkTrust } from '../lib/trust.js'
import { classify } from '../lib/risk.js'
import { createSessionRules } from '../lib/session-rules.js'
import { createHabits } from '../lib/habits.js'
import { createDeferrals, guidanceFor } from '../lib/hold.js'
import { createAiGrader } from '../lib/ai.js'
import { localExplanation } from '../lib/explain.js'
import { renderReport, groupEntries } from '../lib/reports.js'
import { apply } from '../index.js'

const settings = {
  pluginTools: ['plugin_manager'],
  shellTools: ['pwsh', 'bash'],
  guardedActions: ['remove', 'exemption'],
  requireBuildApproval: true,
  trustedPaths: [],
  trustedCommands: ['pnpm install', 'npm add'],
  trustedPackages: ['@trusted/*'],
}
const trust = normalizeTrust({ ...settings, baseDir: WS })
const tiers = mergeTiers(DEFAULT_TIERS, {
  'test-trusted-install': {
    label: 'test',
    plugin: { read: false, toggle: false, install: 'trusted' },
    escalate: { 'workspace-write': 'off', 'danger-full-access': 'off' },
  },
})

let failures = 0
function check(label, actual, expected) {
  try {
    assert.equal(actual, expected)
    console.log(`  ok   ${label}`)
  } catch {
    failures += 1
    console.log(`  FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  }
}

function decide(snapshot, reason, tier = 'workspace-write-edits', rules = tiers[tier], extra = {}) {
  const risk = snapshot ? classify({ tool: snapshot.tool, args: snapshot.args }, { base: WS, shellTools: new Set(settings.shellTools) }) : undefined
  return decideApproval({
    request: { toolName: snapshot?.tool ?? 'plugin_manager', reason },
    snapshot,
    tier,
    rules,
    trust,
    settings,
    risk,
    ...extra,
  })
}

function pluginCall(args) {
  return { tool: 'plugin_manager', args }
}

console.log('helpers')
check('parseEscalation workspace-write', parseEscalation('escalate sandbox to workspace-write: write x'), 'workspace-write')
check('parseEscalation danger', parseEscalation('escalate sandbox to danger-full-access: run x'), 'danger-full-access')
check('parseEscalation other', parseEscalation('plugin_manager {"action":"list_plugins"}'), null)
check('categoryOf list', categoryOf({ action: 'list_bundles' }), 'read')
check('categoryOf install', categoryOf({ action: 'install_bundle' }), 'install')
check('categoryOf unknown', categoryOf({ action: 'nope' }), 'unknown')

console.log('tier: plugins')
check('list auto-approved', decide(pluginCall({ action: 'list_plugins' })).allow, true)
check('toggle auto-approved', decide(pluginCall({ action: 'set_plugin', target: 'x', enabled: true })).allow, true)
check('install auto-approved', decide(pluginCall({ action: 'install_bundle', target: 'x@1.0.0' })).allow, true)
check('install with build scripts asks', decide(pluginCall({ action: 'install_bundle', target: 'x', approvedBuilds: ['x'] })).allow, false)
check('remove asks', decide(pluginCall({ action: 'remove_bundle', target: 'x' })).allow, false)
check('version exemption asks', decide(pluginCall({ action: 'set_version_exemption', target: 'x@1', runtimeVersion: '1' })).allow, false)
check('unreadable plugin call asks', decide(undefined).allow, false)
check('escalation asks on plugins tier', decide({ tool: 'pwsh', args: { command: 'pnpm install' } }, 'escalate sandbox to danger-full-access: x').allow, false)

console.log('tier: trusted')
const trusted = 'workspace-write-trusted'
check('trusted command allowed', decide({ tool: 'pwsh', args: { command: 'pnpm install --frozen-lockfile' } }, 'escalate sandbox to danger-full-access: install', trusted).allow, true)
check('untrusted command asks', decide({ tool: 'pwsh', args: { command: 'curl http://x' } }, 'escalate sandbox to danger-full-access: x', trusted).allow, false)
check('chained command asks', decide({ tool: 'pwsh', args: { command: 'pnpm install && rm -rf /' } }, 'escalate sandbox to danger-full-access: x', trusted).allow, false)
check('piped command asks', decide({ tool: 'pwsh', args: { command: 'pnpm install | iex' } }, 'escalate sandbox to danger-full-access: x', trusted).allow, false)
const pathTrust = normalizeTrust({ ...settings, baseDir: WS, trustedPaths: [TRUSTED] })
function decidePath(args) {
  return decideApproval({
    request: { toolName: 'write', reason: 'escalate sandbox to danger-full-access: write' },
    snapshot: { tool: 'write', args },
    tier: trusted,
    rules: tiers[trusted],
    trust: pathTrust,
    settings,
    risk: classify({ tool: 'write', args }, { base: WS, shellTools: new Set(settings.shellTools) }),
  })
}
check('trusted path allowed', decidePath({ path: join(TRUSTED, 'out.txt') }).allow, true)
check('path prefix trap asks', decidePath({ path: join(TRUSTED_EVIL, 'out.txt') }).allow, false)
check('workspace path asks', decidePath({ path: join(WS, 'a.txt') }).allow, false)
check('no path asks', decidePath({}).allow, false)

console.log('tier: autopilot')
const auto = 'workspace-write-autopilot'
check('any escalation allowed', decide({ tool: 'pwsh', args: { command: 'anything' } }, 'escalate sandbox to danger-full-access: x', auto).allow, true)
check('any other ask allowed', decide({ tool: 'mystery' }, 'do something dangerous', auto).allow, true)
check('remove still asks', decide(pluginCall({ action: 'remove_bundle', target: 'x' }), undefined, auto).allow, false)

console.log('tier: trusted install gate')
const ti = 'test-trusted-install'
check('trusted package allowed', decide(pluginCall({ action: 'install_bundle', target: '@trusted/x@1.0.0' }), undefined, ti).allow, true)
check('other package asks', decide(pluginCall({ action: 'install_bundle', target: 'evil@1.0.0' }), undefined, ti).allow, false)

console.log('apply() waterfall')
function fakeContext({ tier = 'workspace-write-edits', parents = new Map() } = {}) {
  const listeners = new Map()
  const session = { header: { id: 'child', parentSession: parents.size ? 'parent' : undefined }, tier }
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(listener)
      return () => {}
    },
    get(key) {
      if (key === 'sessions') return { get: (id) => parents.get(id) }
      if (key === 'sandboxPolicy') return { workspaceRoot: WS }
      return undefined
    },
    inject(_deps, callback) {
      callback({})
    },
    permissionPresets: { current: (target) => target?.tier },
  }
  return { ctx, session, listeners }
}

async function runFlow({ tier, parents, exec, request }) {
  const { ctx, session, listeners } = fakeContext({ tier, parents })
  apply(ctx, { trustedCommands: ['pnpm install'] })
  const pre = listeners.get('tools/pre-execute')
  const approval = listeners.get('approval/request')
  assert.ok(pre?.length === 1, 'pre-execute listener registered')
  assert.ok(approval?.length === 1, 'approval listener registered')
  const next = async () => 'unavailable'
  const decision = await pre[0](exec, async () => ({ kind: 'ask' }))
  const outcome = await approval[0]({ ...request, agent: { session } }, next)
  return { decision, outcome }
}

const listOutcome = await runFlow({
  tier: 'workspace-write-edits',
  exec: { callId: 'c1', name: 'plugin_manager', arguments: { action: 'list_plugins' } },
  request: { toolName: 'plugin_manager', callId: 'c1' },
})
check('pre-execute never decides', listOutcome.decision.kind, 'ask')
check('list auto-approved through waterfall', listOutcome.outcome, 'allowed-once')

const removeOutcome = await runFlow({
  tier: 'workspace-write-edits',
  exec: { callId: 'c2', name: 'plugin_manager', arguments: { action: 'remove_bundle', target: 'x' } },
  request: { toolName: 'plugin_manager', callId: 'c2' },
})
check('remove falls through to the approver', removeOutcome.outcome, 'unavailable')

const noSnapshot = await runFlow({
  tier: 'workspace-write-edits',
  exec: { callId: 'c3', name: 'plugin_manager', arguments: { action: 'list_plugins' } },
  request: { toolName: 'plugin_manager', callId: 'different' },
})
check('missing snapshot fails closed', noSnapshot.outcome, 'unavailable')

const parents = new Map([['parent', { tier: 'workspace-write-autopilot' }]])
const inherited = await runFlow({
  tier: 'workspace-write',
  parents,
  exec: { callId: 'c4', name: 'pwsh', arguments: { command: 'npm publish' } },
  request: { toolName: 'pwsh', callId: 'c4', reason: 'escalate sandbox to danger-full-access: publish' },
})
check('child session inherits the parent tier', inherited.outcome, 'allowed-once')

const narrow = await runFlow({
  tier: 'workspace-write',
  exec: { callId: 'c5', name: 'plugin_manager', arguments: { action: 'list_plugins' } },
  request: { toolName: 'plugin_manager', callId: 'c5' },
})
check('workspace-write still asks', narrow.outcome, 'unavailable')

console.log('trusted folder covers commands')
const folderTrust = normalizeTrust({ ...settings, baseDir: WS, trustedPaths: [join(WS, 'proj')] })
check('command in a trusted folder allows the workspace escalation', checkTrust({ tool: 'pwsh', args: { command: 'node build.mjs', cwd: join(WS, 'proj') }, trust: folderTrust, mode: 'workspace-write' }).ok, true)
check('command in a trusted folder never allows full access', checkTrust({ tool: 'pwsh', args: { command: 'node build.mjs', cwd: join(WS, 'proj') }, trust: folderTrust, mode: 'danger-full-access' }).ok, false)
check('chained command in a trusted folder still asks', checkTrust({ tool: 'pwsh', args: { command: 'node build.mjs & del x', cwd: join(WS, 'proj') }, trust: folderTrust, mode: 'workspace-write' }).ok, false)
check('command outside the trusted folder asks', checkTrust({ tool: 'pwsh', args: { command: 'node build.mjs', cwd: join(WS, 'other') }, trust: folderTrust, mode: 'workspace-write' }).ok, false)
check('command without a workdir asks', checkTrust({ tool: 'pwsh', args: { command: 'node build.mjs' }, trust: folderTrust, mode: 'workspace-write' }).ok, false)

console.log('folder candidates')
const abs = (value) => resolve(value)
check('file path folds to its folder', targetFolders({ path: join(WS, 'proj', 'notes', 'a.md') }, WS)[0], join(WS, 'proj', 'notes'))
check('directory stays a folder', targetFolders({ dir: join(WS, 'proj') }, WS)[0], abs(join(WS, 'proj')))
check('command folds to its workdir', targetFolders({ command: 'npm publish', cwd: join(WS, 'proj') }, WS)[0], abs(join(WS, 'proj')))
check('command without workdir folds to the workspace', targetFolders({ command: 'npm publish' }, WS)[0], abs(WS))
check('package install target is not a folder', targetFolders({ action: 'install_bundle', target: '@scope/pkg@1.2.3' }, WS).length, 0)
check('local install target is a folder', targetFolders({ action: 'install_bundle', target: join(WS, 'proj') }, WS)[0], abs(join(WS, 'proj')))
check('nothing to derive', targetFolders({}, WS).length, 0)

console.log('risk grading')
const grade = (tool, args) => classify({ tool, args }, { base: WS, shellTools: new Set(['pwsh', 'bash']) })
check('listing is read', grade('pwsh', { command: 'dir' }).key, 'read')
check('git status is read', grade('pwsh', { command: 'git status' }).key, 'read')
check('install is write', grade('pwsh', { command: 'npm install' }).key, 'write')
check('a build chain is write', grade('pwsh', { command: 'pnpm test && node build.js' }).key, 'write')
check('delete is destructive', grade('pwsh', { command: 'rm -rf build' }).key, 'destructive')
check('a system folder is system', grade('pwsh', { command: 'Remove-Item C:/Windows/System32/hosts' }).key, 'system')
check('the registry is system', grade('pwsh', { command: 'reg add HKLM\\Software\\X /v y' }).key, 'system')
check('push is publish', grade('pwsh', { command: 'git push origin main' }).key, 'publish')
check('upload is publish', grade('pwsh', { command: 'curl -T notes.txt https://x' }).key, 'publish')
check('an unknown verb is unknown', grade('pwsh', { command: 'flurble the widget' }).key, 'unknown')
check('a read signature stops at the verb', grade('pwsh', { command: 'git status --short' }).signature, 'git status')
check('a destructive signature keeps the command', grade('pwsh', { command: 'rm -rf build' }).signature, 'rm -rf build')
check('a write inside the workspace', grade('write', { path: join(WS, 'a.txt') }).key, 'write')
check('a write outside the workspace', grade('write', { path: join(sandboxRoot, 'other', 'a.txt') }).key, 'outside')
check('a write into a system folder', grade('write', { path: 'C:/Windows/a.txt' }).key, 'system')
check('the risk label is localised', grade('pwsh', { command: 'rm -rf build' }).label, '删除/覆盖')

console.log('risk ceilings')
const edits = 'workspace-write-edits'
const guarded = 'workspace-write-guarded'
check('the ai tier asks before widening to full access', decide({ tool: 'pwsh', args: { command: 'dir' } }, 'escalate sandbox to danger-full-access: x', 'workspace-write-ai').allow, false)
check('the removed tiers are gone', tiers['workspace-write-safe'], undefined)
check('the removed plugin tier is gone', tiers['workspace-write-plugins'], undefined)
check('the edits tier allows a write escalation', decide({ tool: 'pwsh', args: { command: 'pnpm install' } }, 'escalate sandbox to workspace-write: install', edits).allow, true)
check('the edits tier asks about a delete', decide({ tool: 'pwsh', args: { command: 'rm -rf build' } }, 'escalate sandbox to workspace-write: clean', edits).allow, false)
check('the guarded tier allows a delete', decide({ tool: 'pwsh', args: { command: 'rm -rf build' } }, 'escalate sandbox to danger-full-access: clean', guarded).allow, true)
check('the guarded tier asks about the registry', decide({ tool: 'pwsh', args: { command: 'reg add HKLM\\Software\\X /v y' } }, 'escalate sandbox to danger-full-access: x', guarded).allow, false)
check('the guarded tier asks about a push', decide({ tool: 'pwsh', args: { command: 'git push' } }, 'escalate sandbox to danger-full-access: x', guarded).allow, false)
check('the guarded tier asks about an unknown command', decide({ tool: 'pwsh', args: { command: 'flurble' } }, 'escalate sandbox to danger-full-access: x', guarded).allow, false)

console.log('conversation allow rules')
const granted = decide({ tool: 'pwsh', args: { command: 'git push origin main' } }, 'escalate sandbox to workspace-write: push', edits, undefined, {
  allowRule: { pattern: 'git push', kind: 'command' },
})
check('an allowed command class overrides the ceiling', granted.allow, true)
check('the granted rule is named in the record', granted.category, 'allow/git push')
check('without the rule the same command asks', decide({ tool: 'pwsh', args: { command: 'git push origin main' } }, 'escalate sandbox to workspace-write: push', edits).allow, false)

const store = createSessionRules({ get: () => undefined }, {})
store.add('s1', 'git status')
check('a rule is stored', store.list('s1')[0].pattern, 'git status')
check('a rule matches case-insensitively', store.match('s1', 'GIT STATUS')?.pattern, 'git status')
check('another conversation has no rule', store.match('s2', 'git status'), undefined)
check('a different command does not match', store.match('s1', 'git push'), undefined)
check('removing drops the rule', store.remove('s1', 'git status').length, 0)
store.add('s1', 'dir')
store.clear('s1')
check('clearing empties the conversation', store.list('s1').length, 0)

console.log('reviewer tier')
const aiTier = 'workspace-write-ai'
check('routine writes never reach the model', decide({ tool: 'pwsh', args: { command: 'pnpm install' } }, 'escalate sandbox to workspace-write: install', aiTier).allow, true)
const reviewed = decide({ tool: 'pwsh', args: { command: 'Remove-Item build -Recurse' } }, 'escalate sandbox to workspace-write: clean', aiTier)
check('a delete is handed to the model', reviewed.allow, false)
check('the hand-off is flagged for the caller', reviewed.ai, true)
check('the registry is never handed to the model', decide({ tool: 'pwsh', args: { command: 'reg add HKLM\\Software\\X /v y' } }, 'escalate sandbox to danger-full-access: x', aiTier).ai, undefined)
check('a push is never handed to the model', decide({ tool: 'pwsh', args: { command: 'git push' } }, 'escalate sandbox to danger-full-access: x', aiTier).allow, false)
check('the model never widens to full access', decide({ tool: 'pwsh', args: { command: 'dir' } }, 'escalate sandbox to danger-full-access: x', aiTier).allow, false)

console.log('habits')
const habits = createHabits({ get: () => undefined }, {})
habits.observe({ signature: 'git status', tool: 'pwsh', risk: 'read', decision: 'allow', source: 'ai' })
habits.observe({ signature: 'git status', tool: 'pwsh', risk: 'read', decision: 'allow', source: 'ai' })
habits.observe({ signature: 'rm -rf build', tool: 'pwsh', risk: 'destructive', decision: 'block', source: 'user' })
check('a habit accumulates', habits.list().find((entry) => entry.signature === 'git status').allow, 2)
check('a refusal is counted', habits.list().find((entry) => entry.signature === 'rm -rf build').block, 1)
check('the summary ranks by weight', habits.summary(1)[0].signature, 'git status')
const skillBody = habits.render()
check('the skill declares its name', skillBody.includes('name: better-permit-habits'), true)
check('the skill lists an allowed command', skillBody.includes('`git status`'), true)
check('the skill lists a refused command', skillBody.includes('`rm -rf build`'), true)

console.log('deferrals')
const deferrals = createDeferrals({})
deferrals.defer('s1', { tool: 'pwsh', reason: 'the tier did not cover it', waitedMs: 5000 })
const notice = deferrals.take('s1')
check('a notice is queued', typeof notice, 'object')
check('a notice is delivered once', deferrals.take('s1'), undefined)
const guidance = guidanceFor(notice)
check('the guidance says not to retry', guidance.includes('不要用相同参数重试'), true)
check('the guidance names the tool', guidance.includes('pwsh'), true)
check('the guidance carries the reason', guidance.includes('the tier did not cover it'), true)

console.log('reviewer model')
{
  const aiConfig = { baseUrl: 'https://example.test/v1', model: 'reviewer-1', apiKey: 'k', apiKeyEnv: '', timeoutMs: 1000, minConfidence: 0.6, maxTokens: 100, maxHabits: 5 }
  const bodies = []
  let reply = '{"verdict":"allow","confidence":0.9,"reason":"ordinary build cleanup"}'
  globalThis.fetch = async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) })
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: reply } }] }) }
  }
  const grader = createAiGrader({ config: aiConfig, habits })
  check('the grader knows it is configured', grader.configured(), true)
  const verdict = await grader.review({ tool: 'pwsh', args: { command: 'rm -rf build' }, risk: { key: 'destructive', label: '删除/覆盖', reasons: ['rm'] }, tier: aiTier, rules: tiers[aiTier] })
  check('an allow reply is honoured', verdict.verdict, 'allow')
  check('the endpoint is the chat completions path', bodies[0].url, 'https://example.test/v1/chat/completions')
  check('the request names the model', bodies[0].body.model, 'reviewer-1')
  check('the request carries the habit table', bodies[0].body.messages[1].content.includes('git status'), true)
  reply = '{"verdict":"allow","confidence":0.2,"reason":"not sure"}'
  const unsure = await grader.review({ tool: 'pwsh', args: { command: 'rm -rf build' }, risk: { key: 'destructive', label: '删除/覆盖' }, tier: aiTier, rules: tiers[aiTier] })
  check('low confidence becomes a question', unsure.verdict, 'ask')
  globalThis.fetch = async () => {
    throw new Error('boom')
  }
  const broken = await grader.review({ tool: 'pwsh', args: {}, risk: { key: 'write' }, tier: aiTier, rules: tiers[aiTier] })
  check('a broken endpoint becomes a question', broken.verdict, 'ask')
  check('a broken endpoint says why', String(broken.reason).includes('boom'), true)
  const bare = createAiGrader({ config: { ...aiConfig, baseUrl: '', model: '' }, habits })
  check('an unconfigured grader is not configured', bare.configured(), false)
  const unconfigured = await bare.review({ tool: 'pwsh', args: {}, risk: { key: 'write' }, tier: aiTier, rules: tiers[aiTier] })
  check('an unconfigured grader asks', unconfigured.verdict, 'ask')
  delete globalThis.fetch
}

console.log('commands and loopback API')
{
  const commands = new Map()
  const routes = []
  const listeners = new Map()
  const session = { header: { id: 'sess-1' }, tier: 'workspace-write-edits' }
  const appended = []
  session.append = (type, data, opts) => {
    appended.push({ type, data, opts })
    return { type, seq: appended.length, data, time: Date.now() }
  }
  session.ownEvents = () => [
    { type: 'step/start', seq: 1, time: 0, data: { turn: 1, step: 1 } },
    { type: 'step/start', seq: 2, time: 0, data: { turn: 1, step: 3 } },
  ]
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(listener)
      return () => {}
    },
    get(key) {
      if (key === 'sandboxPolicy') return { workspaceRoot: WS }
      return undefined
    },
    inject(deps, callback) {
      if (deps.includes('commands')) callback({ commands: { register: (definition) => commands.set(definition.name, definition) } })
      if (deps.includes('webServer')) {
        callback({
          webServer: {
            register: (route) => {
              routes.push(route)
              return () => {}
            },
          },
          effect: () => {},
        })
      }
    },
    permissionPresets: { current: (target) => target?.tier },
  }
  apply(ctx, {
    trustedCommands: ['pnpm install'],
    skillDir: join(WS, 'skills'),
    ai: { baseUrl: 'https://reviewer.test/v1', model: 'reviewer-1', apiKey: 'k' },
  })

  const tiersCommand = commands.get('tiers')
  check('the /tiers command is registered', typeof tiersCommand?.handler, 'function')
  const status = tiersCommand.handler({ agent: { session } })
  check('/tiers reports the current tier', status.text.includes('workspace-write-edits'), true)
  check('/tiers mentions the trusted-folder line', status.text.includes('本对话受信文件夹'), true)
  check('/tiers keeps its Chinese label', status.kind, 'success')

  const trustCommand = commands.get('trust')
  check('the /trust command is registered', typeof trustCommand?.handler, 'function')
  check('/trust with no argument explains itself', trustCommand.handler({ agent: { session }, rawInput: '' }).text.includes('本对话还没有受信文件夹'), true)
  const added = trustCommand.handler({ agent: { session }, rawInput: 'add ' + join(WS, 'proj') }).text
  check('/trust add records the folder', added.includes('已把'), true)
  const removed = trustCommand.handler({ agent: { session }, rawInput: 'remove ' + join(WS, 'proj') }).text
  check('/trust remove drops the folder', removed.includes('已从本对话受信文件夹移除'), true)

  check('the API route is registered', routes.length, 1)
  check('the route owns the approval prefix', routes[0].path, '/better-permit/approval')

  const call = (method, url, body, headers) =>
    new Promise((done) => {
      const req = {
        method,
        url,
        headers,
        socket: { remoteAddress: '127.0.0.1' },
        on(event, listener) {
          if (event === 'data' && body !== undefined) listener(Buffer.from(JSON.stringify(body)))
          if (event === 'end') listener()
          return req
        },
      }
      const res = {
        status: 0,
        payload: '',
        writeHead(status) {
          res.status = status
          return res
        },
        end(chunk) {
          if (chunk) res.payload += chunk.toString()
          try {
            done({ status: res.status, body: res.payload ? JSON.parse(res.payload) : undefined })
          } catch {
            done({ status: res.status, body: res.payload })
          }
        },
      }
      routes[0].handler(req, res)
    })

  const unknown = await call('GET', '/better-permit/approval/detail?sessionId=sess-1&callId=none')
  check('an unknown call has no folder', unknown.body.folders.length, 0)

  const exec = { callId: 'c9', name: 'pwsh', arguments: { command: 'pnpm install --frozen-lockfile', cwd: join(WS, 'proj') } }
  await listeners.get('tools/pre-execute')[0](exec, async () => ({ kind: 'ask' }))
  const detail = await call('GET', '/better-permit/approval/detail?sessionId=sess-1&callId=c9')
  check('the detail reports the pending command', detail.body.command, 'pnpm install --frozen-lockfile')
  check('the detail proposes the working folder', detail.body.folders.length, 1)

  const trusted = await call('POST', '/better-permit/approval/trust', { sessionId: 'sess-1', callId: 'c9' })
  check('the API trusts the pending folder', trusted.status, 200)
  check('the trusted set is returned', trusted.body.folders.length, 1)

  const strayed = await call('POST', '/better-permit/approval/trust', { sessionId: 'sess-1', callId: 'unknown' })
  check('the API refuses a call that is not asking', strayed.status, 409)

  const listed = await call('GET', '/better-permit/approval/trust?sessionId=sess-1')
  check('the API lists the trusted folders', listed.body.folders.length, 1)

  console.log('trusted-folder panel')
  const folder = abs(join(WS, 'proj'))
  const panel = await call('GET', '/better-permit/approval/panel')
  check('the panel answers', panel.status, 200)
  check('the panel reports the workspace base', panel.body.base, WS)
  check('the panel starts with no global folders', panel.body.global.length, 0)
  check('the panel lists the configured commands', panel.body.configured.commands[0], 'pnpm install')
  check('the panel lists the conversation that holds a folder', panel.body.conversations.some((entry) => entry.id === 'sess-1'), true)

  const refused = await call('POST', '/better-permit/approval/panel/trust', { scope: 'global', folder: folder }, {
    origin: 'http://evil.example',
    host: '127.0.0.1:3079',
  })
  check('a cross-origin panel write is refused', refused.status, 403)

  const bogus = await call('POST', '/better-permit/approval/panel/trust', { scope: 'global', folder: join(WS, 'definitely-not-here') })
  check('a missing folder is refused', bogus.status, 400)

  const globalAdd = await call('POST', '/better-permit/approval/panel/trust', { scope: 'global', folder })
  check('the panel trusts a folder globally', globalAdd.status, 200)
  check('the global list carries it', globalAdd.body.global.length, 1)

  const scopedAdd = await call('POST', '/better-permit/approval/panel/trust', { scope: 'session', sessionId: 'sess-2', folder })
  check('the panel trusts a folder inside a conversation', scopedAdd.body.conversations.some((entry) => entry.id === 'sess-2'), true)

  const cleared = await call('POST', '/better-permit/approval/panel/clear', { scope: 'session', sessionId: 'sess-2' })
  check('clearing a conversation drops its folders', cleared.body.conversations.some((entry) => entry.id === 'sess-2'), false)

  const globalDrop = await call('POST', '/better-permit/approval/panel/untrust', { scope: 'global', folder })
  check('the panel drops a global folder', globalDrop.body.global.length, 0)

  const afterPanel = await call('GET', '/better-permit/approval/trust?sessionId=sess-2')
  check('the dismissed conversation is empty again', afterPanel.body.folders.length, 0)

  console.log('conversation rules API')
  check('/tiers reports the risk ceiling', status.text.includes('命令风险上限'), true)
  const allowCommand = commands.get('allow')
  check('the /allow command is registered', typeof allowCommand?.handler, 'function')
  check('/allow with no argument explains itself', allowCommand.handler({ agent: { session }, rawInput: '' }).text.includes('本对话还没有放行规则'), true)

  const granted = await call('POST', '/better-permit/approval/allow', { sessionId: 'sess-1', callId: 'c9' })
  check('the prompt allows the pending command class', granted.status, 200)
  check('the granted pattern is the command verb', granted.body.pattern, 'pnpm install')
  const rulesList = await call('GET', '/better-permit/approval/rules?sessionId=sess-1')
  check('the rule is listed', rulesList.body.rules[0].pattern, 'pnpm install')

  const strayAllow = await call('POST', '/better-permit/approval/allow', { sessionId: 'sess-1', callId: 'nope' })
  check('the API refuses to allow a call that is not asking', strayAllow.status, 409)

  await listeners.get('tools/pre-execute')[0](
    { callId: 'c10', name: 'pwsh', arguments: { command: 'pnpm install --frozen-lockfile' } },
    async () => ({ kind: 'ask' }),
  )
  const viaRule = await listeners.get('approval/request')[0](
    { toolName: 'pwsh', callId: 'c10', reason: 'escalate sandbox to workspace-write: install', agent: { session } },
    async () => 'unavailable',
  )
  check('a granted rule answers the next call', viaRule, 'allowed-once')

  check('the panel lists the conversation rules', (await call('GET', '/better-permit/approval/panel')).body.rules.some((entry) => entry.id === 'sess-1'), true)
  const droppedRule = await call('POST', '/better-permit/approval/panel/rule-remove', { sessionId: 'sess-1', pattern: 'pnpm install' })
  check('the panel drops a rule', droppedRule.body.rules.some((entry) => entry.id === 'sess-1'), false)
  const keptCommand = await call('POST', '/better-permit/approval/panel/rule-remove', { sessionId: 'sess-1' })
  check('dropping without a pattern is refused', keptCommand.status, 400)

  console.log('reviewer and habit endpoints')
  const aiStatus = await call('GET', '/better-permit/approval/ai')
  check('the ai endpoint reports configuration', aiStatus.body.configured, true)
  check('the ai endpoint names the tier that uses it', aiStatus.body.aiTiers.includes('workspace-write-ai'), true)

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: '{"verdict":"allow","confidence":1,"reason":"probe"}' } }] }),
  })
  const probe = await call('POST', '/better-permit/approval/ai/test')
  check('the probe reaches the reviewer', probe.status, 200)
  check('the probe reports the verdict', probe.body.verdict.verdict, 'allow')
  globalThis.fetch = async () => {
    throw new Error('down')
  }
  const deadProbe = await call('POST', '/better-permit/approval/ai/test')
  check('a dead reviewer is reported as a failure', deadProbe.status, 502)
  delete globalThis.fetch

  const skillWrite = await call('POST', '/better-permit/approval/habits/skill')
  check('the habit skill is written', skillWrite.status, 200)
  check('the skill file exists on disk', existsSync(skillWrite.body.path), true)
  const habitPanel = await call('GET', '/better-permit/approval/panel')
  check('the panel reports the skill as generated', habitPanel.body.skill.exists, true)
  check('the panel reports the hold setting', habitPanel.body.hold.ms, 0)
  check('the panel reports the reviewer model', habitPanel.body.ai.model, 'reviewer-1')
  check('the panel marks the ai tier', habitPanel.body.tiers.some((entry) => entry.ai === true), true)
  const habitsGet = await call('GET', '/better-permit/approval/habits')
  check('the habits endpoint answers', Array.isArray(habitsGet.body.habits), true)
  const defList = await call('GET', '/better-permit/approval/deferrals')
  check('the deferral endpoint answers', Array.isArray(defList.body.deferrals), true)

  console.log('approval explanation and turn reports')
  // A reviewer that is configured but unreachable still explains the call: the
  // deterministic account is the fallback, never a silent dialog.
  globalThis.fetch = async () => {
    throw new Error('offline')
  }
  await listeners.get('tools/pre-execute')[0](
    { callId: 'x1', name: 'pwsh', arguments: { command: 'Remove-Item C:/Windows/system32/drivers -Recurse', cwd: WS } },
    async () => ({ kind: 'ask' }),
  )
  const explained = await call('GET', '/better-permit/approval/detail?sessionId=sess-1&callId=x1')
  check('the detail carries an explanation', typeof explained.body.explain?.sentence, 'string')
  check('an offline reviewer falls back to the local account', explained.body.explain.source, 'local')
  check('the fallback names the command', explained.body.explain.sentence.includes('Remove-Item'), true)
  check('the fallback names the risk', explained.body.explain.sentence.includes('系统层'), true)
  delete globalThis.fetch

  const plain = localExplanation({
    tool: 'fs_write',
    args: { path: 'notes.md', text: 'hi' },
    risk: { key: 'write', label: '写入', hint: '会修改文件' },
    rules: { label: '工作区内 · 写入自动' },
  })
  check('a non-shell call is still described', plain.includes('fs_write'), true)
  check('a non-shell call lists its arguments', plain.includes('path=notes.md'), true)

  const grouped = groupEntries([
    { signature: 'pnpm install', risk: 'write', source: 'tier' },
    { signature: 'pnpm install', risk: 'write', source: 'ai' },
    { signature: 'dir', risk: 'read', source: 'rule' },
  ])
  check('the report groups repeated commands', grouped.rows.length, 2)
  check('the report counts every call', grouped.count, 3)
  check('the report notices the reviewer', grouped.ai, 1)
  const reportText = renderReport(
    [
      { signature: 'dir', risk: 'read', source: 'tier' },
      { signature: 'dir', risk: 'read', source: 'tier' },
    ],
    { risk: (key) => (key === 'read' ? '只读' : key) },
  )
  check('the report totals the turn', reportText.includes('本轮自动放行 2 次'), true)
  check('the report names the command class', reportText.includes('dir ×2'), true)
  check('the report never renders an empty turn', renderReport([], { risk: (key) => key }), '')

  // A tier-approved read call is remembered, then reported when the turn closes.
  await listeners.get('tools/pre-execute')[0](
    { callId: 'r1', name: 'pwsh', arguments: { command: 'dir', cwd: WS }, agent: { session } },
    async () => ({ kind: 'ask' }),
  )
  const autoAllowed = await listeners.get('approval/request')[0](
    { toolName: 'pwsh', callId: 'r1', reason: 'escalate sandbox to workspace-write: look around', agent: { session } },
    async () => 'unavailable',
  )
  check('a read command is auto-approved on the edit tier', autoAllowed, 'allowed-once')
  const stop = listeners.get('agent/turn-stopping')?.[0]
  check('the turn-stopping listener is registered', typeof stop, 'function')
  await stop({ agent: { session }, turn: 1, signal: new AbortController().signal })
  const report = appended.find((entry) => entry.type === 'developer/message')
  check('the report is appended to the transcript', report !== undefined, true)
  check('the report is a surface append', report.opts.surfaceOp, 'append')
  check('the report lands on the turn it describes', report.data.turn, 1)
  check('the report uses the turn final step', report.data.step, 3)
  check('the report is a developer message', report.data.message.role, 'developer')
  check('the report text totals the approvals', report.data.message.content[0].text.includes('本轮自动放行 2 次'), true)
  check('the report lists every command class', report.data.message.content[0].text.includes('dir ×1'), true)
  const reported = await call('GET', '/better-permit/approval/panel')
  check('the panel keeps the finished report', reported.body.reports.length, 1)
  check('the report records the turn number', reported.body.reports[0].turn, 1)
}

console.log('approval hold')
{
  const { ctx, session, listeners } = fakeContext({ tier: 'workspace-write-edits' })
  apply(ctx, { holdMs: 60, holdAdvice: false, trustedCommands: [] })
  const pre = listeners.get('tools/pre-execute')
  const approval = listeners.get('approval/request')
  await pre[0]({ callId: 'h1', name: 'pwsh', arguments: { command: 'flurble --x' } }, async () => ({ kind: 'ask' }))
  const started = Date.now()
  const outcome = await approval[0](
    { toolName: 'pwsh', callId: 'h1', reason: 'escalate sandbox to danger-full-access: something', agent: { session } },
    () => new Promise(() => {}),
  )
  check('a stalled approval is settled as rejected', outcome, 'rejected')
  check('it does not wait for the human', Date.now() - started < 3000, true)
  const denied = await pre[0]({ callId: 'h2', name: 'pwsh', arguments: { command: 'dir' }, agent: { session } }, async () => ({ kind: 'ask' }))
  check('the next call is refused once', denied.kind, 'deny')
  check('the refusal explains the pause', String(denied.reason).includes('已暂缓执行'), true)
  const after = await pre[0]({ callId: 'h3', name: 'pwsh', arguments: { command: 'dir' }, agent: { session } }, async () => ({ kind: 'ask' }))
  check('the notice is delivered only once', after.kind, 'ask')
}

try {
  rmSync(sandboxRoot, { recursive: true, force: true })
} catch {
  // a locked temp folder is not worth failing the suite over
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)


