/**
 * The decision function: given one approval request, the tool call snapshot
 * recorded by `tools/pre-execute`, the active tier's rules, the risk grade of
 * the operation and the conversation's own allow-rules, decide whether the
 * request may be answered `allowed-once` automatically.
 *
 * `allow: false` never means "deny" — it means "not ours, pass it down the
 * waterfall so the normal approver (the UI) handles it".
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

function hasBuildScripts(args) {
  return Array.isArray(args?.approvedBuilds) && args.approvedBuilds.length > 0
}

function shorten(text, limit = 160) {
  if (typeof text !== 'string') return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat
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

  const mode = parseEscalation(request?.reason)
  if (mode) {
    const gate = rules.escalate[mode]
    if (gate === 'all') {
      if (withinCeiling(rules.maxRisk, riskKey)) return allow(`escalate/${mode}`, shorten(request.reason))
      return pass(`escalate/${mode}`, `above this tier's automatic ceiling (${rules.maxRisk}): ${risk?.label ?? riskKey}`)
    }
    if (gate === 'trusted') {
      const verdict = checkTrust({ tool, args, trust, mode })
      if (!verdict.ok) return pass(`escalate/${mode}`, verdict.reason)
      // The trust check is the security boundary here: a path the user trusted
      // is allowed even though it grades as `outside`, while anything graded
      // destructive/system/publish still stops at the ceiling below.
      if (riskKey === 'outside' || withinCeiling(rules.maxRisk, riskKey)) return allow(`escalate/${mode}`, verdict.detail)
      return pass(`escalate/${mode}`, `above this tier's automatic ceiling (${rules.maxRisk}): ${risk?.label ?? riskKey}`)
    }
    return pass(`escalate/${mode}`, 'not covered by this tier')
  }

  if (!withinCeiling(rules.maxRisk, riskKey)) {
    return pass(`risk/${riskKey}`, `above this tier's automatic ceiling (${rules.maxRisk}): ${risk?.label ?? riskKey}`)
  }
  if (rules.otherAsks) return allow('ask/other', `${tool} ${shorten(request?.reason) || ''}`.trim())
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
