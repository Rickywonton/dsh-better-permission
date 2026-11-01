/**
 * Per-turn auto-approval reports.
 *
 * Every approval this plugin answers without asking the user is remembered for
 * that conversation, and when the turn is about to close the batch becomes one
 * short Chinese report appended to the transcript — so a run of auto-approved
 * commands is auditable after the fact instead of invisible.
 *
 * The store is deliberately in memory: a report describes the turn that just
 * ended, and nothing needs it after the process restarts.
 */

const MAX_ENTRIES = 40
const MAX_REPORTS = 24

/** Short Chinese label for who answered the approval. */
function sourceLabel(source) {
  if (source === 'ai') return '评审模型'
  if (source === 'rule') return '本对话规则'
  if (source === 'trusted') return '受信路径'
  return '档位上限'
}

/**
 * Group one turn's auto-approvals into display rows.
 * @param entries - recorded approvals of one turn.
 * @returns `{ rows, count, ai }`.
 */
export function groupEntries(entries) {
  const rows = new Map()
  let ai = 0
  for (const entry of entries) {
    const key = `${entry.signature ?? entry.tool ?? 'unknown'}\u0000${entry.risk ?? ''}`
    const row = rows.get(key)
    if (row === undefined) {
      rows.set(key, { signature: entry.signature ?? entry.tool ?? 'unknown', risk: entry.risk ?? 'unknown', count: 1, source: entry.source ?? 'tier' })
    } else {
      row.count += 1
      if (row.source !== 'ai' && entry.source === 'ai') row.source = 'ai'
    }
    if (entry.source === 'ai') ai += 1
  }
  return { rows: [...rows.values()], count: entries.length, ai }
}

/**
 * Render one turn's report text.
 * @param entries - recorded approvals of one turn.
 * @param labels - `{ risk(key) }` resolver for risk labels.
 * @returns the report text, or an empty string when nothing was auto-approved.
 */
export function renderReport(entries, labels) {
  const { rows, count, ai } = groupEntries(entries)
  if (count === 0) return ''
  const lines = [`本轮自动放行 ${count} 次审批（未打扰你）：`]
  for (const row of rows.slice(0, 8)) {
    const risk = labels?.risk ? labels.risk(row.risk) : row.risk
    lines.push(`· ${row.signature} ×${row.count} — 风险「${risk}」，由${sourceLabel(row.source)}放行`)
  }
  if (rows.length > 8) lines.push(`· 另有 ${rows.length - 8} 类操作`)
  if (ai > 0) lines.push(`其中 ${ai} 次是评审模型判定的。`)
  lines.push('需要回看或收紧，可以打开设置里的「权限与信任」，或用 /tiers 查看当前档位。')
  return lines.join('\n')
}

/**
 * Create the in-memory per-turn report store.
 * @param options - journal for the audit trail and a cap on retained reports.
 * @returns `{ note, drain, peek, list, clear }`.
 */
export function createReports({ journal, limit = MAX_REPORTS } = {}) {
  const open = new Map()
  const done = []
  return {
    /** Remember one auto-approved call for its conversation. */
    note(sessionId, entry) {
      const key = String(sessionId ?? 'unknown')
      const list = open.get(key) ?? []
      list.push({ ...entry, at: entry?.at ?? Date.now() })
      while (list.length > MAX_ENTRIES) list.shift()
      open.set(key, list)
    },
    /** Read and forget the pending batch of one conversation. */
    drain(sessionId) {
      const key = String(sessionId ?? 'unknown')
      const list = open.get(key) ?? []
      open.delete(key)
      return list
    },
    /** Read the pending batch without clearing it. */
    peek(sessionId) {
      return [...(open.get(String(sessionId ?? 'unknown')) ?? [])]
    },
    /** Keep a finished report for the settings panel. */
    remember(sessionId, report) {
      done.unshift({ ...report, sessionId: String(sessionId ?? 'unknown') })
      while (done.length > limit) done.pop()
      journal?.record?.({ at: report.at, tier: report.tier, category: 'report', detail: `${report.count} 次自动放行` })
      return report
    },
    /** Recent reports, newest first. */
    list() {
      return [...done]
    },
    /** Drop everything (used by tests and by a session teardown). */
    clear(sessionId) {
      if (sessionId === undefined) {
        open.clear()
        done.length = 0
        return
      }
      open.delete(String(sessionId))
    },
  }
}
