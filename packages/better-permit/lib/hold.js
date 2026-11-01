/**
 * Approval timeouts.
 *
 * When a request has been waiting for a human longer than `holdMs`, the plugin
 * stops waiting: the request settles as "not now" and a deferral notice is
 * queued for that conversation. The next tool call the agent makes is answered
 * with a `deny` carrying the notice, so the agent learns — in the same turn —
 * that the step was paused, what the reviewer model suggests instead, and that
 * retrying the same call is pointless.
 *
 * The notice is delivered exactly once: a second denial for the same reason
 * would only burn turns.
 */

const MAX_NOTICES = 24

export function guidanceFor(notice) {
  const lines = [
    `上一步「${notice.tool ?? '操作'}」的审批等待超时（${Math.round((notice.waitedMs ?? 0) / 1000)} 秒无回应），已暂缓执行。`,
    '不要用相同参数重试这次调用：用户不在，重试只会再次超时。',
    '继续做不依赖它的步骤；如果后续步骤必须依赖它，先给出替代方案（换目录、换命令、拆成更小的步骤、只读探查），',
    '或说明需要用户确认的具体问题，然后继续其余工作。',
  ]
  if (notice.reason) lines.push(`它被暂缓的原因：${notice.reason}`)
  if (notice.advice) lines.push(`评审模型的建议：${notice.advice}`)
  return lines.join('\n')
}

export function createDeferrals({ journal } = {}) {
  const notices = new Map()

  function warn(message) {
    journal?.warn?.(message)
  }

  function defer(sessionId, notice) {
    const key = typeof sessionId === 'string' && sessionId ? sessionId : '\u0000unknown'
    const entry = { ...notice, at: notice?.at ?? Date.now() }
    notices.set(key, entry)
    while (notices.size > MAX_NOTICES) notices.delete(notices.keys().next().value)
    try {
      journal?.record?.({
        at: entry.at,
        tier: entry.tier ?? 'hold',
        tool: entry.tool ?? 'approval',
        category: 'deferred',
        risk: entry.risk,
        detail: entry.reason ?? 'no answer within the configured wait',
      })
    } catch (error) {
      warn(`could not record a deferral: ${error?.message ?? error}`)
    }
    return entry
  }

  function take(sessionId) {
    const key = typeof sessionId === 'string' && sessionId ? sessionId : '\u0000unknown'
    const entry = notices.get(key)
    if (entry) notices.delete(key)
    return entry
  }

  function peek(sessionId) {
    const key = typeof sessionId === 'string' && sessionId ? sessionId : '\u0000unknown'
    return notices.get(key)
  }

  function list() {
    return [...notices.entries()].map(([sessionId, notice]) => ({ sessionId, ...notice }))
  }

  function clear() {
    notices.clear()
  }

  return { defer, take, peek, list, clear }
}
