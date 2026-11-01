/**
 * Permission tiers — graded, rule-based auto-approval layered on top of the
 * built-in permission presets.
 *
 * The permission-presets service owns which sandbox mode and approval policy a
 * session runs with. This plugin adds the missing half: for the wider tiers it
 * answers selected `approval/request` events itself (`allowed-once`) so routine
 * operations no longer interrupt the user, while everything the tier does not
 * declare keeps flowing to the normal approver.
 *
 * Two seams are used:
 *  - `tools/pre-execute` only *records* the tool arguments per call id (the
 *    approval request itself carries no arguments), then always continues.
 *  - `approval/request` decides, using the record, the active tier and the
 *    trust lists. Not matching means `next()` — never a denial.
 */
import { resolve as toAbsolute, join } from 'node:path'
import { statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { DEFAULT_TIERS, mergeTiers, gateText, orderedTiers } from './lib/tiers.js'
import { decideApproval } from './lib/engine.js'
import { normalizeTrust, describeTrust, targetFolders } from './lib/trust.js'
import { classify, describeRisk, labelOf, rankOf, RISK_HINTS, withinCeiling } from './lib/risk.js'
import { createJournal } from './lib/journal.js'
import { createSessionTrust } from './lib/session-trust.js'
import { createSessionRules } from './lib/session-rules.js'
import { createAiGrader } from './lib/ai.js'
import { createHabits } from './lib/habits.js'
import { createDeferrals, guidanceFor } from './lib/hold.js'
import { createExplainer } from './lib/explain.js'
import { createReports, renderReport } from './lib/reports.js'

export const name = 'better-permit'
export const inject = ['approval', 'permissionPresets', 'tools']

/** Marker the `Promise.race` in handOver resolves with when the wait expires. */
const TIMEOUT = Symbol('approval hold timeout')

const DEFAULTS = {
  defaultTier: 'workspace-write',
  pluginTools: ['plugin_manager'],
  shellTools: ['pwsh', 'bash', 'shell', 'sh'],
  guardedActions: ['remove', 'exemption'],
  trustedCommands: ['pnpm install', 'pnpm add', 'npm install', 'npm i', 'npm ci'],
  journalSize: 40,
  ai: {
    baseUrl: '',
    model: '',
    apiKey: '',
    apiKeyEnv: '',
    timeoutMs: 8000,
    minConfidence: 0.6,
    maxTokens: 400,
    maxHabits: 12,
  },
  holdMs: 0,
  holdAdvice: true,
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function number(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function holdOf(input) {
  if (Number.isFinite(input.holdMs)) return Math.max(0, input.holdMs)
  if (Number.isFinite(input.holdSeconds)) return Math.max(0, input.holdSeconds * 1000)
  return DEFAULTS.holdMs
}

function aiConfigOf(input) {
  const ai = input && typeof input === 'object' ? input : {}
  return {
    baseUrl: text(ai.baseUrl, DEFAULTS.ai.baseUrl),
    model: text(ai.model, DEFAULTS.ai.model),
    apiKey: text(ai.apiKey, DEFAULTS.ai.apiKey),
    apiKeyEnv: text(ai.apiKeyEnv, DEFAULTS.ai.apiKeyEnv),
    timeoutMs: number(ai.timeoutMs, DEFAULTS.ai.timeoutMs, 500, 60000),
    minConfidence: number(ai.minConfidence, DEFAULTS.ai.minConfidence, 0, 1),
    maxTokens: number(ai.maxTokens, DEFAULTS.ai.maxTokens, 64, 4000),
    maxHabits: number(ai.maxHabits, DEFAULTS.ai.maxHabits, 0, 60),
  }
}

function listOf(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice()
  return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
}

function normalizeConfig(config) {
  const input = config && typeof config === 'object' ? config : {}
  return {
    inheritParentTier: input.inheritParentTier !== false,
    defaultTier: typeof input.defaultTier === 'string' && input.defaultTier ? input.defaultTier : DEFAULTS.defaultTier,
    pluginTools: listOf(input.pluginTools, DEFAULTS.pluginTools),
    shellTools: listOf(input.shellTools, DEFAULTS.shellTools),
    guardedActions: listOf(input.guardedActions, DEFAULTS.guardedActions),
    requireBuildApproval: input.requireBuildApproval !== false,
    trustedPaths: listOf(input.trustedPaths, []),
    trustedCommands: listOf(input.trustedCommands, DEFAULTS.trustedCommands),
    trustedPackages: listOf(input.trustedPackages, []),
    journalSize: Number.isFinite(input.journalSize) ? input.journalSize : DEFAULTS.journalSize,
    promptContext: input.promptContext !== false,
    command: input.command !== false,
    baseDir: typeof input.baseDir === 'string' && input.baseDir ? input.baseDir : undefined,
    tiers: input.tiers && typeof input.tiers === 'object' ? input.tiers : undefined,
    ai: aiConfigOf(input.ai),
    holdMs: holdOf(input),
    holdAdvice: input.holdAdvice !== false,
    skillDir: text(input.skillDir, ''),
  }
}

const SNAPSHOT_KEYS = [
  'action',
  'target',
  'registry',
  'enabled',
  'acceptRisk',
  'approvedBuilds',
  'runtimeVersion',
  'path',
  'file_path',
  'filePath',
  'paths',
  'from',
  'to',
  'command',
  'cmd',
  'cwd',
  'workdir',
  'destination',
  'dir',
  'url',
]

function trimValue(value) {
  if (typeof value === 'string') return value.length > 300 ? value.slice(0, 300) : value
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === 'string' || typeof entry === 'number')
      .slice(0, 20)
      .map((entry) => (typeof entry === 'string' && entry.length > 120 ? entry.slice(0, 120) : entry))
  }
  return undefined
}

function snapshotArguments(args) {
  const out = {}
  if (!args || typeof args !== 'object') return out
  for (const key of SNAPSHOT_KEYS) {
    const value = trimValue(args[key])
    if (value !== undefined) out[key] = value
  }
  return out
}

function workspaceRootOf(ctx) {  try {
    const policy = ctx.get('sandboxPolicy')
    if (!policy) return process.cwd()
    const root = typeof policy.workspaceRoot === 'function' ? policy.workspaceRoot() : policy.workspaceRoot
    return typeof root === 'string' && root.length > 0 ? root : process.cwd()
  } catch {
    return process.cwd()
  }
}

export function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const tiers = mergeTiers(DEFAULT_TIERS, settings.tiers)
  const trust = normalizeTrust({ ...settings, baseDir: settings.baseDir ?? workspaceRootOf(ctx) })
  const journal = createJournal(ctx, settings.journalSize)
  const pending = new Map()
  const sessionTrust = createSessionTrust(ctx, { journal })
  sessionTrust.bind()
  const sessionRules = createSessionRules(ctx, { journal })
  sessionRules.bind()
  const habits = createHabits(ctx, { journal })
  habits.bind()
  const grader = createAiGrader({ config: settings.ai, journal, habits })
  const deferrals = createDeferrals({ journal })
  const explainer = createExplainer({ config: settings.ai, journal })
  const reports = createReports({ journal })

  /** Where the generated habit skill lives: `<skills root>/better-permit-habits/SKILL.md`. */
  function skillRoot() {
    if (settings.skillDir) return settings.skillDir
    const env = process.env.DSH_HOME
    if (typeof env === 'string' && env.length > 0) return join(env, 'skills')
    try {
      return join(homedir(), '.dsh-home', 'skills')
    } catch {
      return join(trust.base, 'skills')
    }
  }

  function skillFile() {
    return join(skillRoot(), 'better-permit-habits', 'SKILL.md')
  }

  /** Write the habit table out as a loadable skill; returns the path. */
  function writeHabitSkill() {
    const path = skillFile()
    const body = habits.render()
    mkdirSync(join(skillRoot(), 'better-permit-habits'), { recursive: true })
    writeFileSync(path, body, 'utf8')
    journal.record({ at: Date.now(), tier: 'manual', tool: 'habit skill', category: 'skill-write', detail: path })
    return { path, bytes: Buffer.byteLength(body, 'utf8') }
  }

  function sessionIdOf(session) {
    const id = session?.header?.id ?? session?.id
    return typeof id === 'string' ? id : undefined
  }

  /** Configured trust lists plus the folders trusted globally and in this conversation. */
  function trustFor(session) {
    return trustForId(sessionIdOf(session))
  }

  function trustForId(sessionId) {
    const extra = [...sessionTrust.globalList(), ...sessionTrust.list(sessionId)]
    if (extra.length === 0) return trust
    return { ...trust, paths: [...trust.paths, ...extra] }
  }

  /** How dangerous the pending operation looks (lib/risk.js). */
  function riskOf(tool, args) {
    try {
      return classify({ tool, args }, { base: trust.base, shellTools: trust.shellTools })
    } catch (error) {
      journal.warn(`could not grade the operation: ${error?.message ?? error}`)
      return { key: 'unknown', label: labelOf('unknown'), reasons: ['the grader failed'], signature: '' }
    }
  }

  const messages = {
    expired: 'the recorded call snapshot expired before approval was requested',
    unreadable: 'this call carries no readable arguments, so the action is unverifiable',
  }

  function presetOf(session) {
    if (!session) return undefined
    try {
      const value = ctx.permissionPresets.current(session)
      return typeof value === 'string' ? value : undefined
    } catch (error) {
      journal.warn(`could not read the session preset: ${error?.message ?? error}`)
      return undefined
    }
  }

  function parentTierOf(session) {
    let current = session
    for (let depth = 0; depth < 16 && current; depth += 1) {
      const parentId = current?.header?.parentSession
      if (!parentId) return undefined
      try {
        current = ctx.get('sessions')?.get(parentId)
      } catch {
        return undefined
      }
      if (!current) return undefined
      const tier = presetOf(current)
      if (tier && tiers[tier]) return tier
    }
    return undefined
  }

  function effectiveTier(session) {
    const own = presetOf(session)
    if (!settings.inheritParentTier) return own
    if (own !== undefined && own !== settings.defaultTier) return own
    const inherited = parentTierOf(session)
    if (inherited) return inherited
    return own
  }

  function remember(exec) {
    const callId = exec?.callId
    if (!callId) return
    pending.set(callId, {
      tool: exec.name,
      args: snapshotArguments(exec.arguments),
      sessionId: sessionIdOf(exec.agent?.session),
      at: Date.now(),
    })
    if (pending.size <= 200) return
    const cutoff = Date.now() - 10 * 60 * 1000
    for (const [id, entry] of pending) if (entry.at < cutoff) pending.delete(id)
    while (pending.size > 200) pending.delete(pending.keys().next().value)
  }

  ctx.on(
    'tools/pre-execute',
    async (exec, next) => {
      try {
        remember(exec)
      } catch (error) {
        journal.warn(`could not record a call snapshot: ${error?.message ?? error}`)
      }
      // A paused approval is announced on the agent's very next call, so the
      // model re-plans inside the same turn instead of retrying blindly.
      try {
        const notice = deferrals.take(sessionIdOf(exec.agent?.session))
        if (notice) return { kind: 'deny', reason: guidanceFor(notice) }
      } catch (error) {
        journal.warn(`could not deliver a deferral notice: ${error?.message ?? error}`)
      }
      return next()
    },
    true,
  )

  /** Ask the reviewer model about one pending call. Never throws. */
  async function reviewWith(decision, request) {
    if (!grader.configured()) return { verdict: 'ask', reason: '评审模型未配置（缺 baseUrl / model / API key）', configured: false }
    const rules = decision?.tier ? tiers[decision.tier] : undefined
    try {
      return await grader.review({
        tool: request?.toolName,
        args: decision?.snapshot?.args,
        risk: decision?.risk,
        tier: decision?.tier,
        rules,
      })
    } catch (error) {
      return { verdict: 'ask', reason: `评审模型出错：${error?.message ?? error}`, configured: true }
    }
  }

  /**
   * Hand the request to the normal approver — but stop waiting after `holdMs`.
   * A timeout settles the request as "not now" and queues a deferral notice for
   * the agent's next call; a dialog the user opens later still has the snapshot.
   */
  async function handOver(request, next, decision) {
    const sessionId = decision?.sessionId ?? decision?.snapshot?.sessionId
    const human = Promise.resolve().then(() => next())
    human.catch(() => {})
    if (!(settings.holdMs > 0)) {
      try {
        return await human
      } finally {
        if (request?.callId) pending.delete(request.callId)
      }
    }
    const started = Date.now()
    let timer
    // Keep the timer referenced: a pending dialog is exactly what we are
    // waiting on, and an unreferenced timer would let the host fall asleep.
    const timeout = new Promise((done) => {
      timer = setTimeout(() => done(TIMEOUT), settings.holdMs)
    })
    human.finally(() => {
      if (request?.callId) pending.delete(request.callId)
    })
    const outcome = await Promise.race([human, timeout])
    clearTimeout(timer)
    if (outcome !== TIMEOUT) return outcome
    let advice
    if (settings.holdAdvice) {
      const review = await reviewWith(decision, request)
      if (review?.verdict === 'allow') advice = `评审模型认为这次操作可以安全执行：${review.reason ?? ''}`.trim()
      else if (review?.reason) advice = review.reason
    }
    deferrals.defer(sessionId, {
      tool: request?.toolName,
      risk: decision?.risk?.key,
      reason: decision?.verdict?.detail ?? 'the tier did not cover it',
      advice,
      waitedMs: Date.now() - started,
      tier: decision?.tier,
    })
    return 'rejected'
  }

  /** A readable row label for the report: the command signature when there is one. */
  function entryLabel(decision, request) {
    const signature = decision?.risk?.signature
    if (typeof signature === 'string' && signature.length > 0) return signature
    const tool = request?.toolName ?? 'tool'
    const args = decision?.snapshot?.args
    const action = args !== null && typeof args === 'object' && typeof args.action === 'string' ? args.action : ''
    return action ? `${tool} ${action}` : tool
  }

  /** Remember one auto-answered approval so the turn can report it. */
  function noteAuto(sessionId, decision, request, source) {
    try {
      reports.note(sessionId, {
        tool: request?.toolName,
        signature: entryLabel(decision, request),
        risk: decision?.risk?.key,
        source,
        tier: decision?.tier,
        at: Date.now(),
      })
    } catch (error) {
      journal.warn(`could not record an auto-approval: ${error?.message ?? error}`)
    }
  }

  ctx.on(
    'approval/request',
    async (request, next) => {
      let decision
      try {
        const session = request?.agent?.session
        const sessionId = sessionIdOf(session)
        const tier = effectiveTier(session)
        const rules = tier ? tiers[tier] : undefined
        const snapshot = request?.callId ? pending.get(request.callId) : undefined
        const risk = riskOf(request?.toolName, snapshot?.args)
        if (rules) {
          const allowRule = sessionRules.match(sessionId, risk?.signature)
          const verdict = decideApproval({ request, snapshot, tier, rules, trust: trustFor(session), settings, risk, allowRule })
          decision = { sessionId, tier, verdict, hasSnapshot: snapshot !== undefined, risk, allowRule, snapshot }
        } else if (risk?.signature) {
          decision = { sessionId, tier, risk, snapshot }
        }
      } catch (error) {
        journal.warn(`approval evaluation failed: ${error?.message ?? error}`)
      }

      // The tier asked the reviewer model: its "allow" runs the call, anything
      // else (including "no answer") falls through to the human.
      if (decision?.verdict?.ai) {
        const review = await reviewWith(decision, request)
        if (review?.verdict === 'allow') {
          journal.record({
            at: Date.now(),
            tier: decision.tier,
            tool: request.toolName,
            category: 'ai/allow',
            risk: decision.risk?.key,
            detail: `${review.reason || 'the reviewer allowed it'} · ${Math.round((review.confidence ?? 0) * 100)}% · ${review.ms ?? 0}ms`,
          })
          habits.observe({ signature: decision.risk?.signature, tool: request.toolName, risk: decision.risk?.key, decision: 'allow', source: 'ai' })
          noteAuto(decision.sessionId, decision, request, 'ai')
          if (request?.callId) pending.delete(request.callId)
          return 'allowed-once'
        }
        journal.record({
          at: Date.now(),
          tier: decision.tier,
          tool: request.toolName,
          category: 'ai/ask',
          risk: decision.risk?.key,
          detail: review?.reason || 'the reviewer declined to answer',
        })
        return handOver(request, next, decision)
      }

      if (decision?.verdict?.allow) {
        const { tier, verdict, hasSnapshot, risk } = decision
        journal.record({
          at: Date.now(),
          tier,
          tool: request.toolName,
          category: verdict.category,
          risk: risk?.key,
          detail: verdict.detail || (hasSnapshot ? 'recorded call' : messages.unreadable),
        })
        habits.observe({ signature: risk?.signature, tool: request.toolName, risk: risk?.key, decision: 'allow', source: decision.allowRule ? 'rule' : 'tier' })
        noteAuto(decision.sessionId, decision, request, decision.allowRule ? 'rule' : 'tier')
        if (request?.callId) pending.delete(request.callId)
        return 'allowed-once'
      }
      // Not covered by the tier: hand over to the normal approver. The call
      // snapshot stays available while the dialog is open, so the prompt can
      // offer to trust the target folder or to allow this command class for
      // the rest of the conversation.
      return handOver(request, next, decision)
    },
    true,
  )

  /**
   * Close one turn with a report of everything this plugin approved silently.
   * The text is appended as a developer message, so it shows up in the chat as
   * an injected note and stays in the transcript as an audit line.
   */
  ctx.on('agent/turn-stopping', async (payload) => {
    let entries = []
    let sessionId
    try {
      const session = payload?.agent?.session
      sessionId = sessionIdOf(session)
      entries = reports.drain(sessionId)
      if (entries.length === 0) return
      const body = renderReport(entries, { risk: (key) => labelOf(key) })
      if (!body) return
      const turn = typeof payload?.turn === 'number' ? payload.turn : 0
      const step = lastStepOf(session, turn)
      const message = {
        id: randomUUID(),
        role: 'developer',
        content: [{ type: 'text', text: body }],
        source: { kind: 'better-permit-report' },
      }
      session.append('developer/message', { turn, step, message }, { surfaceOp: 'append' })
      reports.remember(sessionId, { at: Date.now(), turn, count: entries.length, text: body })
    } catch (error) {
      if (entries.length > 0) {
        // A transcript the host refuses to extend still deserves an audit line.
        journal.record({ at: Date.now(), tier: 'report', category: 'report-failed', detail: `${entries.length} 次自动放行 · ${error?.message ?? error}` })
      }
    }
  })

  /** The step number the turn ended on, for the appended report event. */
  function lastStepOf(session, turn) {
    try {
      const events = session?.ownEvents?.() ?? []
      let step = 1
      for (const event of events) {
        if (event?.type === 'step/start' && event.data?.turn === turn) step = event.data.step
      }
      return step
    } catch {
      return 1
    }
  }

  /** The tier a session runs under, read from the preset it currently holds. */
  function tierForSessionId(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return undefined
    try {
      const session = ctx.get('sessions')?.get(sessionId)
      return session ? effectiveTier(session) : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Everything the approval prompt needs about one pending call: what it is,
   * how dangerous it looks, and whether the active tier would have allowed it.
   * Computing "covered" here (rather than trusting the client) keeps the
   * explanation honest after a reload.
   */
  function detailOf(snapshot, command, cwd) {
    const tool = typeof snapshot?.tool === 'string' ? snapshot.tool : undefined
    if (!snapshot) return { tool, command, cwd }
    const risk = riskOf(tool, snapshot.args)
    const sessionId = typeof snapshot.sessionId === 'string' ? snapshot.sessionId : ''
    const tierKey = tierForSessionId(sessionId)
    const rules = tierKey ? tiers[tierKey] : undefined
    const rule = sessionRules.match(sessionId, risk?.signature)
    let covered = false
    let aiAsked = false
    if (rules) {
      const verdict = decideApproval({
        request: { toolName: tool },
        snapshot,
        tier: tierKey,
        rules,
        trust: trustForId(sessionId),
        settings,
        risk,
        allowRule: rule,
      })
      covered = verdict.allow === true
      aiAsked = verdict.ai === true
    }
    return {
      tool,
      command,
      cwd,
      risk: risk ? { key: risk.key, label: risk.label, hint: RISK_HINTS[risk.key] ?? '', reasons: risk.reasons ?? [] } : undefined,
      signature: risk?.signature || undefined,
      tier: rules
        ? {
            key: tierKey,
            label: rules.label,
            maxRisk: rules.maxRisk,
            maxRiskLabel: rules.maxRisk === 'off' ? '不自动放行' : labelOf(rules.maxRisk),
            alwaysAsk: rules.alwaysAsk.map((key) => labelOf(key)),
            ai: rules.ai,
          }
        : undefined,
      ai: rules?.ai
        ? { requested: aiAsked, configured: grader.configured(), model: settings.ai.model, minConfidence: settings.ai.minConfidence }
        : undefined,
      rule: rule?.pattern ?? null,
      covered,
    }
  }

  /** Explanations are asked once per call id and reused while the dialog is open. */
  const explained = new Map()

  /**
   * Explain one pending call for the dialog: the reviewer model's sentence when
   * it is configured, a deterministic account otherwise.
   */
  async function explainOf(detail, snapshot, callId) {
    if (!snapshot || !callId) return undefined
    const cached = explained.get(callId)
    if (cached) return cached
    try {
      const answer = await explainer.explain({
        tool: detail?.tool,
        args: snapshot.args,
        risk: detail?.risk
          ? { key: detail.risk.key, label: detail.risk.label, hint: detail.risk.hint, reasons: detail.risk.reasons }
          : undefined,
        tier: detail?.tier?.key,
        rules: detail?.tier,
      })
      explained.set(callId, answer)
      while (explained.size > 32) explained.delete(explained.keys().next().value)
      return answer
    } catch (error) {
      journal.warn(`could not explain a pending call: ${error?.message ?? error}`)
      return undefined
    }
  }

  function renderStatus(agent) {
    const tier = effectiveTier(agent?.session)
    const rules = tier ? tiers[tier] : undefined
    const lines = []
    if (!rules) {
      lines.push(`当前档位：${tier ?? '未知'}（不在本插件的自动放行表内，全部审批都会询问）`)
    } else {
      lines.push(`当前档位：${tier} · ${rules.label}`)
      if (rules.description) lines.push(rules.description)
      lines.push(
        `插件：列出 ${yes(rules.plugin.read)} · 启停 ${yes(rules.plugin.toggle)} · 安装 ${gateText(rules.plugin.install)} · 移除 ${yes(rules.plugin.remove)} · 版本豁免 ${yes(rules.plugin.exemption)}`,
      )
      lines.push(
        `沙箱提权：工作区内 ${gateText(rules.escalate['workspace-write'])} · 完全访问 ${gateText(rules.escalate['danger-full-access'])}`,
      )
      const ceiling = rules.maxRisk === 'off' ? '不自动放行任何命令' : `自动放行到「${labelOf(rules.maxRisk)}」`
      lines.push(`命令风险上限：${ceiling}`)
      if (rules.alwaysAsk.length > 0) lines.push(`始终询问：${rules.alwaysAsk.map((key) => labelOf(key)).join('、')}`)
      lines.push(`其它审批：${rules.otherAsks ? '自动放行' : '询问'}`)
      if (rules.ai) {
        const status = grader.status()
        lines.push(
          status.configured
            ? `评审模型：${status.model}（${status.baseUrl}，置信度门槛 ${status.minConfidence}）`
            : '评审模型：未配置（把 baseUrl / model / apiKeyEnv 填进插件配置，“AI 判定”档位会退回人工审批）',
        )
      }
    }
    lines.push(
      settings.holdMs > 0
        ? `审批等待上限：${Math.round(settings.holdMs / 1000)} 秒（超时后暂缓该操作，并在下一步告知模型）`
        : '审批等待上限：不限制（一直等你回答）',
    )
    const habitRows = habits.list()
    lines.push(
      habitRows.length === 0
        ? '审批习惯：（暂无记录）'
        : `审批习惯：${habitRows.length} 条；习惯 skill 位于 ${skillFile()}${existsSync(skillFile()) ? '' : '（尚未生成，用 POST /better-permit/approval/habits/skill 生成）'}`,
    )
    const own = sessionRules.list(sessionIdOf(agent?.session))
    lines.push(own.length === 0 ? '本对话放行规则：（暂无）' : `本对话放行规则：${own.map((entry) => entry.pattern).join(' · ')}`)
    lines.push(describeTrust(trust))
    const global = sessionTrust.globalList()
    lines.push(global.length === 0 ? '全局受信文件夹：（暂无）' : `全局受信文件夹 ${global.join(', ')}`)
    const scoped = sessionTrust.list(sessionIdOf(agent?.session))
    lines.push(scoped.length === 0 ? '本对话受信文件夹：（暂无）' : `本对话受信文件夹 ${scoped.join(', ')}`)
    const recent = journal.list()
    lines.push(recent.length === 0 ? '自动放行记录：（暂无）' : '自动放行记录：')
    for (const entry of recent.slice(0, 8)) {
      lines.push(`  · ${new Date(entry.at).toLocaleTimeString()} ${entry.tool} ${entry.category} · ${entry.detail}`)
    }
    return lines.join('\n')
  }

  function renderTrust(sessionId) {
    const paths = sessionTrust.list(sessionId)
    if (paths.length === 0) {
      return [
        '本对话还没有受信文件夹。',
        '把某个文件夹设为本对话受信后，受信档位里针对它的沙箱提权与文件写入会自动放行。',
        '用法：/trust add <文件夹> · /trust remove <文件夹> · /trust clear',
      ].join('\n')
    }
    return ['本对话受信文件夹：', ...paths.map((entry) => `  · ${entry}`), '用法：/trust add <文件夹> · /trust remove <文件夹> · /trust clear'].join('\n')
  }

  function runTrustCommand(agent, rawInput) {
    const sessionId = sessionIdOf(agent?.session)
    const text = typeof rawInput === 'string' ? rawInput.trim() : ''
    if (!text) return renderTrust(sessionId)
    const parts = text.split(/\s+/).filter(Boolean)
    const verb = (parts[0] ?? '').toLowerCase()
    const rest = parts.slice(1).join(' ').trim()
    if (verb === 'clear' || verb === 'reset') {
      sessionTrust.clear(sessionId)
      return `已清空本对话受信文件夹。\n${renderTrust(sessionId)}`
    }
    if (verb === 'remove' || verb === 'rm' || verb === 'delete') {
      if (!rest) return '用法：/trust remove <文件夹>'
      const folder = toAbsolute(trust.base, rest)
      sessionTrust.remove(sessionId, folder)
      journal.record({ at: Date.now(), tier: 'manual', tool: '/trust', category: 'untrust', detail: folder })
      return `已从本对话受信文件夹移除 ${folder}。\n${renderTrust(sessionId)}`
    }
    const target = verb === 'add' ? rest : text
    if (!target) return '用法：/trust add <文件夹>'
    const folder = toAbsolute(trust.base, target)
    sessionTrust.add(sessionId, [folder])
    journal.record({ at: Date.now(), tier: 'manual', tool: '/trust', category: 'trust', detail: folder })
    return `已把 ${folder} 加入本对话受信文件夹（仅本对话生效）。\n${renderTrust(sessionId)}`
  }

  function renderRules(sessionId) {
    const rules = sessionRules.list(sessionId)
    if (rules.length === 0) {
      return [
        '本对话还没有放行规则。',
        '规则是一条命令的固定前缀（例如「git status」「npm install」），命中后在本对话里不再询问，',
        '但只对本对话生效，换对话就从零开始，也不会改变档位的沙箱模式。',
        '用法：/allow <命令前缀> · /allow remove <命令前缀> · /allow clear',
      ].join('\n')
    }
    return [
      '本对话放行规则：',
      ...rules.map((entry) => `  · ${entry.pattern}`),
      '用法：/allow <命令前缀> · /allow remove <命令前缀> · /allow clear',
    ].join('\n')
  }

  function runAllowCommand(agent, rawInput) {
    const sessionId = sessionIdOf(agent?.session)
    const text = typeof rawInput === 'string' ? rawInput.trim() : ''
    if (!text) return renderRules(sessionId)
    const parts = text.split(/\s+/).filter(Boolean)
    const verb = (parts[0] ?? '').toLowerCase()
    const rest = parts.slice(1).join(' ').trim()
    if (verb === 'clear' || verb === 'reset') {
      sessionRules.clear(sessionId)
      journal.record({ at: Date.now(), tier: 'manual', tool: '/allow', category: 'allow-clear', detail: sessionId })
      return `已清空本对话放行规则。\n${renderRules(sessionId)}`
    }
    if (verb === 'remove' || verb === 'rm' || verb === 'delete') {
      if (!rest) return '用法：/allow remove <命令前缀>'
      sessionRules.remove(sessionId, rest.replace(/\s+/g, ' '))
      journal.record({ at: Date.now(), tier: 'manual', tool: '/allow', category: 'allow-remove', detail: rest })
      return `已移除本对话放行规则「${rest}」。\n${renderRules(sessionId)}`
    }
    const pattern = (verb === 'add' ? rest : text).replace(/\s+/g, ' ').trim()
    if (!pattern) return '用法：/allow <命令前缀>'
    sessionRules.add(sessionId, pattern, 'command')
    journal.record({ at: Date.now(), tier: 'manual', tool: '/allow', category: 'allow-add', detail: pattern })
    return `已在本对话放行「${pattern}」（仅本对话生效）。\n${renderRules(sessionId)}`
  }

  if (settings.command) {
    ctx.inject(['commands'], (scope) => {
      try {
        scope.commands.register({
          definitionId: 'better-permit',
          name: 'tiers',
          description: 'Show the permission-tier rules and the recent automatic approvals',
          handler: ({ agent }) => ({ kind: 'success', text: renderStatus(agent) }),
        })
      } catch (error) {
        journal.warn(`could not register the /tiers command: ${error?.message ?? error}`)
      }
      try {
        scope.commands.register({
          definitionId: 'better-permit-trust',
          name: 'trust',
          description: 'Trust a folder inside this conversation (add | remove | clear)',
          input: { hint: '[add|remove|clear] <folder>' },
          handler: ({ agent, rawInput }) => ({ kind: 'success', text: runTrustCommand(agent, rawInput) }),
        })
      } catch (error) {
        journal.warn(`could not register the /trust command: ${error?.message ?? error}`)
      }
      try {
        scope.commands.register({
          definitionId: 'better-permit-allow',
          name: 'allow',
          description: 'Always allow a command class inside this conversation (add | remove | clear)',
          input: { hint: '<command prefix>' },
          handler: ({ agent, rawInput }) => ({ kind: 'success', text: runAllowCommand(agent, rawInput) }),
        })
      } catch (error) {
        journal.warn(`could not register the /allow command: ${error?.message ?? error}`)
      }
    })
  }

  // Small loopback API behind the approval prompt: it reports which folder an
  // approval is about and records the user's per-conversation trust choice.
  const API_PREFIX = '/better-permit/approval'

  function sendJson(res, status, body) {
    try {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    } catch {
      try {
        res.end()
      } catch {
        /* the socket may already be gone */
      }
    }
  }

  function isLoopback(address) {
    if (typeof address !== 'string') return false
    return address === '::1' || address === '::ffff:127.0.0.1' || address === '127.0.0.1' || address.startsWith('127.')
  }

  function readBody(req, limit = 64 * 1024) {
    return new Promise((done, fail) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          fail(new Error('request body is too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => done(chunks.length === 0 ? '' : Buffer.concat(chunks).toString('utf8')))
      req.on('error', fail)
    })
  }

  function foldersOf(snapshot) {
    return snapshot ? targetFolders(snapshot.args, trust.base) : []
  }

  /** Cross-origin browser requests are refused; same-origin and native callers pass. */
  function sameOrigin(req) {
    const origin = req?.headers?.origin
    if (typeof origin !== 'string' || origin.length === 0) return true
    try {
      return new URL(origin).host === req?.headers?.host
    } catch {
      return false
    }
  }

  /** Everything the settings panel shows in one round trip. */
  function panelData() {
    return {
      base: trust.base,
      global: sessionTrust.globalList(),
      conversations: sessionTrust.conversations(),
      rules: sessionRules.conversations(),
      tiers: orderedTiers(tiers).map((entry) => ({
        key: entry.key,
        label: entry.rules.label,
        description: entry.rules.description,
        maxRisk: entry.rules.maxRisk,
        maxRiskLabel: entry.rules.maxRisk === 'off' ? '不自动放行' : labelOf(entry.rules.maxRisk),
        alwaysAsk: entry.rules.alwaysAsk.map((key) => labelOf(key)),
        plugin: entry.rules.plugin,
        escalate: entry.rules.escalate,
        otherAsks: entry.rules.otherAsks,
        ai: entry.rules.ai,
      })),
      riskHints: RISK_HINTS,
      configured: { paths: trust.paths, commands: trust.commands, packages: trust.packages },
      ai: { ...grader.status(), minConfidence: settings.ai.minConfidence },
      hold: { ms: settings.holdMs, advice: settings.holdAdvice },
      habits: habits.list().slice(0, 20),
      deferrals: deferrals.list(),
      reports: reports.list().slice(0, 10),
      skill: { path: skillFile(), exists: existsSync(skillFile()) },
      recent: journal.list().slice(0, 10),
    }
  }

  /** A folder typed in the panel: absolute against the workspace, and required to exist. */
  function folderArgument(value) {
    if (typeof value !== 'string' || value.trim().length === 0) return { error: 'missing folder' }
    const absolute = toAbsolute(trust.base, value.trim())
    try {
      if (!statSync(absolute).isDirectory()) return { error: 'not a folder' }
    } catch {
      return { error: 'folder does not exist' }
    }
    return { folder: absolute }
  }

  function mutateTrust(scope, sessionId, folder, kind) {
    if (scope === 'global') {
      if (kind === 'clear') sessionTrust.clearGlobal()
      else if (kind === 'trust') sessionTrust.addGlobal([folder])
      else sessionTrust.removeGlobal(folder)
    } else {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return 'missing sessionId'
      if (kind === 'clear') sessionTrust.clear(sessionId)
      else if (kind === 'trust') sessionTrust.add(sessionId, [folder])
      else sessionTrust.remove(sessionId, folder)
    }
    journal.record({
      at: Date.now(),
      tier: 'manual',
      tool: 'settings panel',
      category: kind === 'trust' ? 'trust' : kind === 'clear' ? 'clear' : 'untrust',
      detail: `${scope === 'global' ? '所有对话' : sessionId}${folder ? ` · ${folder}` : ''}`,
    })
    return undefined
  }

  async function readJson(req) {
    const raw = await readBody(req)
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return undefined
    }
  }

  async function handlePanel(req, res, route) {
    if (req.method === 'GET' && route === '/panel') return sendJson(res, 200, panelData())
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin request refused' })
    const body = await readJson(req)
    if (body === undefined) return sendJson(res, 400, { error: 'invalid JSON' })
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (route === '/panel/rule-remove' || route === '/panel/rule-clear') {
      if (!sessionId) return sendJson(res, 400, { error: 'missing sessionId' })
      const pattern = typeof body.pattern === 'string' ? body.pattern.trim() : ''
      if (route === '/panel/rule-clear') sessionRules.clear(sessionId)
      else if (pattern) sessionRules.remove(sessionId, pattern)
      else return sendJson(res, 400, { error: 'missing pattern' })
      journal.record({
        at: Date.now(),
        tier: 'manual',
        tool: 'settings panel',
        category: route === '/panel/rule-clear' ? 'allow-clear' : 'allow-remove',
        detail: `${sessionId}${pattern ? ` · ${pattern}` : ''}`,
      })
      return sendJson(res, 200, panelData())
    }
    const kind = route === '/panel/trust' ? 'trust' : route === '/panel/untrust' ? 'untrust' : route === '/panel/clear' ? 'clear' : undefined
    if (!kind) return sendJson(res, 404, { error: 'not found' })
    const scope = body.scope === 'global' ? 'global' : 'session'
    let folder
    if (kind !== 'clear') {
      const argument = folderArgument(body.folder)
      if (argument.error) return sendJson(res, 400, { error: argument.error })
      folder = argument.folder
    }
    const problem = mutateTrust(scope, sessionId, folder, kind)
    if (problem) return sendJson(res, 400, { error: problem })
    return sendJson(res, 200, panelData())
  }

  async function handleApi(req, res) {
    if (!isLoopback(req?.socket?.remoteAddress)) return sendJson(res, 403, { error: 'loopback only' })
    const url = new URL(typeof req.url === 'string' ? req.url : '/', 'http://127.0.0.1')
    const route = url.pathname.slice(API_PREFIX.length) || '/'
    if (route === '/panel' || route.startsWith('/panel/')) return handlePanel(req, res, route)
    if (req.method === 'GET' && route === '/ai') return sendJson(res, 200, { ...grader.status(), aiTiers: orderedTiers(tiers).filter((entry) => entry.rules.ai).map((entry) => entry.key) })
    if (req.method === 'POST' && route === '/ai/test') {
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin request refused' })
      const result = await grader.test()
      journal.record({
        at: Date.now(),
        tier: 'manual',
        tool: 'reviewer probe',
        category: 'ai-test',
        detail: result.ok ? `ok in ${result.ms ?? 0}ms` : String(result.error ?? 'failed'),
      })
      return sendJson(res, result.ok ? 200 : 502, result)
    }
    if (req.method === 'GET' && route === '/habits') {
      const path = skillFile()
      return sendJson(res, 200, { habits: habits.list(), skill: { path, exists: existsSync(path) } })
    }
    if (req.method === 'POST' && route === '/habits/skill') {
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin request refused' })
      try {
        const written = writeHabitSkill()
        return sendJson(res, 200, { ...written, exists: true })
      } catch (error) {
        return sendJson(res, 500, { error: String(error?.message ?? error) })
      }
    }
    if (req.method === 'GET' && route === '/deferrals') return sendJson(res, 200, { deferrals: deferrals.list() })
    if (req.method === 'GET' && route === '/detail') {
      const callId = url.searchParams.get('callId') ?? ''
      const snapshot = callId ? pending.get(callId) : undefined
      const args = snapshot?.args
      const command = typeof args?.command === 'string' ? args.command : typeof args?.cmd === 'string' ? args.cmd : undefined
      const cwd = typeof args?.cwd === 'string' ? args.cwd : typeof args?.workdir === 'string' ? args.workdir : undefined
      const detail = detailOf(snapshot, command, cwd)
      const explain = await explainOf(detail, snapshot, callId)
      return sendJson(res, 200, { ...detail, explain, folders: foldersOf(snapshot) })
    }
    if (req.method === 'GET' && route === '/rules') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      return sendJson(res, 200, { rules: sessionRules.list(sessionId) })
    }
    if (req.method === 'POST' && route === '/allow') {
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin request refused' })
      const body = await readJson(req)
      if (body === undefined) return sendJson(res, 400, { error: 'invalid JSON' })
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      if (!sessionId) return sendJson(res, 400, { error: 'missing sessionId' })
      // Like /trust, the pattern comes from the Host's own record of the pending
      // call: a rule can only be created for an operation that asked.
      const snapshot = typeof body.callId === 'string' ? pending.get(body.callId) : undefined
      if (!snapshot) return sendJson(res, 409, { error: 'no pending approval for this call', rules: sessionRules.list(sessionId) })
      const risk = riskOf(snapshot.tool, snapshot.args)
      if (!risk?.signature) {
        return sendJson(res, 409, { error: 'this call carries no recognisable command to allow', rules: sessionRules.list(sessionId) })
      }
      const rules = sessionRules.add(sessionId, risk.signature, 'command')
      journal.record({ at: Date.now(), tier: 'manual', tool: 'approval prompt', category: 'allow-add', detail: risk.signature })
      return sendJson(res, 200, { rules, pattern: risk.signature })
    }
    if (req.method === 'GET' && route === '/candidates') {
      const callId = url.searchParams.get('callId') ?? ''
      return sendJson(res, 200, { folders: foldersOf(callId ? pending.get(callId) : undefined) })
    }
    if (req.method === 'POST' && route === '/trust') {
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin request refused' })
      const raw = await readBody(req)
      let body
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        return sendJson(res, 400, { error: 'invalid JSON' })
      }
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      if (!sessionId) return sendJson(res, 400, { error: 'missing sessionId' })
      // The folder comes from the Host's own snapshot of the pending call, never
      // from the request body: only an operation that is actually asking for
      // approval can widen the conversation's trusted folders.
      const callId = typeof body?.callId === 'string' ? body.callId : ''
      const folders = foldersOf(callId ? pending.get(callId) : undefined)
      if (folders.length === 0) {
        return sendJson(res, 409, { error: 'no pending approval for this call', folders: sessionTrust.list(sessionId) })
      }
      const absolute = folders.map((entry) => toAbsolute(trust.base, entry.trim()))
      if (absolute.length === 0) return sendJson(res, 200, { folders: sessionTrust.list(sessionId) })
      const paths = sessionTrust.add(sessionId, absolute)
      journal.record({ at: Date.now(), tier: 'manual', tool: 'approval prompt', category: 'trust', detail: absolute.join(', ') })
      return sendJson(res, 200, { folders: paths })
    }
    if (req.method === 'GET' && route === '/trust') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      return sendJson(res, 200, { folders: sessionTrust.list(sessionId) })
    }
    return sendJson(res, 404, { error: 'not found' })
  }

  ctx.inject(['webServer'], (scope) => {
    try {
      const dispose = scope.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (req, res) => {
          handleApi(req, res).catch((error) => {
            journal.warn(`trust API failed: ${error?.message ?? error}`)
            sendJson(res, 500, { error: 'internal error' })
          })
        },
      })
      // The route outlives a plain call, so hang its disposer on the fiber: a
      // reload then releases the path instead of tripping the duplicate check.
      if (typeof dispose === 'function' && typeof scope.effect === 'function') {
        scope.effect(() => dispose, 'better-permit: approval API route')
      }
    } catch (error) {
      journal.warn(`could not serve the trust API: ${error?.message ?? error}`)
    }
  })

  if (settings.promptContext) {
    ctx.inject(['systemPrompt'], (scope) => {
      try {
        const prompt = scope.systemPrompt
        let order = 1000
        try {
          const resolved = prompt.getContextOrder?.('APPROVAL_POLICY')
          if (typeof resolved === 'number' && Number.isFinite(resolved)) order = resolved + 1
        } catch {
          /* fall back to the numeric order above */
        }
        prompt.context({
          name: 'better-permit',
          order,
          text: [
            'Some approval requests may be auto-approved by the active permission tier without asking the user:',
            'plugin listing/toggling/installing, and on the wider tiers operations graded at or below the tier\'s risk',
            'ceiling (read / write / destructive), plus commands the user allowed for this conversation.',
            'On the "AI 判定" tier an operation above that ceiling may instead be judged by the user\'s own reviewer model;',
            'its approval runs the call, its doubt or refusal still reaches the user.',
            'An approval dialog that does appear means the tier refused that operation on purpose — report it to the',
            'user instead of retrying the same call with different arguments.',
            settings.holdMs > 0
              ? `If an approval stays unanswered for ${Math.round(settings.holdMs / 1000)} seconds the operation is paused: your next tool call is refused once with a notice saying so. When that happens do not retry the same call — continue with the steps that do not depend on it, or propose an alternative, and mention that the step is waiting for the user.`
              : '',
            existsSync(skillFile())
              ? `Requests this machine has already settled are collected in the skill "better-permit-habits" (${skillFile()}); consult it before planning a risky step.`
              : '',
          ]            .filter((line) => line.length > 0)
            .join(' '),
        })
      } catch (error) {
        journal.warn(`could not register the prompt context: ${error?.message ?? error}`)
      }
    })
  }
}

function yes(value) {
  return value ? '自动放行' : '询问'
}
