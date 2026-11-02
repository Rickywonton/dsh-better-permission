/**
 * The decision function: given one approval request, the tool call snapshot
 * recorded by `tools/pre-execute`, the active tier's rules, the risk grade of
 * the operation and the conversation's own allow-rules, decide whether the
 * request may be answered `allowed-once` automatically.
 *
 * `allow: false` never means "deny" — it means "not ours, pass it down the
 * waterfall so the normal approver (the UI) handles it". The one exception is
 * `ai: true`, which asks the caller to consult the reviewer model first: the
 * model's `allow` becomes `allowed-once`, its doubt or refusal still reaches
 * the user.
 */
import { categoryOf, parseEscalation } from './tiers.js'
import { checkInstallTarget, checkTrust } from './trust.js'
import { withinCeiling } from './risk.js'

function allow(category, detail) {
  return { allow: true, category, detail }
}

function pass(category, reason) {
  return { allow: false, category, detail: reason }
}

/** Hand the call to the reviewer model instead of the user. */
function review(category, reason) {
  return { allow: false, ai: true, category, detail: reason }
}

function hasBuildScripts(args) {
  return Array.isArray(args?.approvedBuilds) && args.approvedBuilds.length > 0
}

function shorten(text, limit = 160) {
  if (typeof text !== 'string') return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat
}

/** Risk grades a positive trust verdict is allowed to clear on any tier. */
const TRUST_COVERS = new Set(['read', 'write', 'outside'])

/**
 * Whether one trust verdict covers an operation of this risk grade.
 * `scope` is `path` (an explicit target inside a trusted folder), `workdir`
 * (a plain command started there), `command` (a trusted prefix) or `package`.
 */
function coveredByTrust(riskKey, verdict) {
  if (TRUST_COVERS.has(riskKey)) return true
  // A delete is covered only when the trusted thing is the path being deleted
  // — a trusted working directory does not vouch for what a delete reaches.
  return riskKey === 'destructive' && verdict.scope === 'path'
}

export function decideApproval({ request, snapshot, tier, rules, trust, settings, risk, allowRule }) {
  const tool = request?.toolName
  const args = snapshot?.args
  const pluginTools = settings.pluginTools

  if (pluginTools.includes(tool)) {
    const category = categoryOf(args)
    if (!category) return pass('plugin/unknown', 'the plugin call arguments were unavailable, so the action is unverifiable')
    if (settings.guardedActions.includes(category) || settings.guardedActions.includes(args.action)) {
      return pass(`plugin/${category}`, 'always confirmed by a human')
    }
    if (category === 'install' && settings.requireBuildApproval && hasBuildScripts(args)) {
      return pass('plugin/install', 'the install would run package install scripts')
    }
    const gate = rules.plugin[category]
    if (gate === true || gate === 'all') return allow(`plugin/${category}`, `plugin ${args.action} ${shorten(describeTarget(args))}`.trim())
    if (gate === 'trusted') {
      const verdict = checkInstallTarget(args?.target, trust)
      if (verdict.ok) return allow(`plugin/${category}`, verdict.detail)
      return pass(`plugin/${category}`, verdict.reason)
    }
    return pass(`plugin/${category}`, 'not covered by this tier')
  }

  // An explicit "always allow this in this conversation" rule beats the tier:
  // the user granted exactly this operation class, by hand, just now.
  if (allowRule) {
    return allow(`allow/${allowRule.pattern}`, `本对话已允许「${allowRule.pattern}」`)
  }

  const riskKey = risk?.key ?? 'unknown'
  if (rules.alwaysAsk.includes(riskKey)) {
    return pass(`risk/${riskKey}`, `the operation looks ${risk?.label ?? riskKey}, which this tier always asks about`)
  }

  // A trusted folder is a statement about that folder, not about one tier's
  // gates, so it is honoured on every tier: a folder the user vouched for
  // never waits for a human — and never spends a reviewer call — on the wider
  // tiers either. Two things it cannot do: beat `alwaysAsk` (checked above),
  // or widen a tier that switched a gate off. A delete only counts when the
  // trusted thing is an explicit path, because "I trust this folder" is not
  // "I trust every delete started from it".
  const mode = parseEscalation(request?.reason)
  const trustedCall = trust ? checkTrust({ tool, args, trust, mode: mode ?? 'workspace-write' }) : { ok: false }
  const trustedHit = trustedCall.ok && coveredByTrust(riskKey, trustedCall)

  // Sandbox escalations are only partly deterministic: the widest one
  // (`danger-full-access`) always needs its gate, while a `workspace-write`
  // widening may be handed to the reviewer when the tier asks for it — the
  // model can clear a delete inside the workspace, never full access.
  if (mode) {
    const gate = rules.escalate[mode]
    if (gate === 'all') {
      if (withinCeiling(rules.maxRisk, riskKey)) return allow(`escalate/${mode}`, shorten(request.reason))
      if (trustedHit) return allow(`trust/${mode}`, trustedCall.detail)
      if (mode === 'workspace-write' && rules.ai) return review(`ai/${riskKey}`, `above this tier's automatic ceiling (${rules.maxRisk}): ${risk?.label ?? riskKey}`)
      return pass(`escalate/${mode}`, `above this tier's automatic ceiling (${rules.maxRisk}): ${risk?.label ?? riskKey}`)
    }
    if (gate === 'trusted') {
      if (!trustedCall.ok) return pass(`escalate/${mode}`, trustedCall.reason ?? 'not covered by the trust lists')
      // The trust check is the security boundary here: a path the user trusted
      // is allowed even though it grades as `outside`, while anything graded
      // destructive/system/publish still stops at the ceiling below unless the
      // path itself is the trusted thing.
      if (trustedHit || withinCeiling(rules.maxRisk, riskKey)) return allow(`escalate/${mode}`, trustedCall.detail)
      return pass(`escalate/${mode}`, `above this tier's automatic ceiling (${rules.maxRisk}): ${risk?.label ?? riskKey}`)
    }
    return pass(`escalate/${mode}`, 'not covered by this tier')
  }

  if (!withinCeiling(rules.maxRisk, riskKey)) {
    if (trustedHit) return allow(`trust/${riskKey}`, trustedCall.detail)
    const reason = `above this tier's automatic ceiling (${rules.maxRisk}): ${risk?.label ?? riskKey}`
    if (rules.ai) return review(`ai/${riskKey}`, reason)
    return pass(`risk/${riskKey}`, reason)
  }
  if (rules.otherAsks) return allow('ask/other', `${tool} ${shorten(request?.reason) || ''}`.trim())
  if (rules.ai) return allow(`ai/${riskKey}`, `${tool} ${risk?.label ?? riskKey} 在上限内`)
  return pass('ask/other', 'not covered by this tier')
}

function describeTarget(args) {
  if (!args) return ''
  const parts = []
  if (typeof args.action === 'string') parts.push(args.action)
  if (typeof args.target === 'string') parts.push(args.target)
  if (typeof args.enabled === 'boolean') parts.push(args.enabled ? 'enable' : 'disable')
  return parts.join(' ')
}
