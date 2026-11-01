/**
 * What the user has got used to: one row per operation class (the same
 * `signature` the risk grader prints), counting how often it was allowed
 * automatically and how often it was refused.
 *
 * Two consumers read this table:
 *  - the reviewer model, which gets the top rows as context (`summary`);
 *  - a generated skill file (`render` / `writeSkill`) so the agent itself can
 *    look up "how does this user decide" before it plans a risky step.
 *
 * Memory is authoritative; the `kv` storage form keeps it across restarts.
 */

const TABLE = 'habits'

export function createHabits(ctx, options = {}) {
  const journal = options.journal
  const limit = Number.isFinite(options.limit) ? options.limit : 300
  const rows = new Map()
  let unit

  function warn(message) {
    journal?.warn?.(message)
  }

  function keyOf(signature, tool) {
    if (typeof signature === 'string' && signature.trim().length > 0) return signature.trim()
    if (typeof tool === 'string' && tool) return `tool:${tool}`
    return undefined
  }

  function persist(key) {
    if (!unit) return
    const row = rows.get(key)
    const action = row ? unit.putRecord(TABLE, key, row) : unit.deleteRecord(TABLE, key)
    Promise.resolve(action).catch((error) => warn(`could not persist a habit row: ${error?.message ?? error}`))
  }

  function prune() {
    if (rows.size <= limit) return
    const ordered = [...rows.entries()].sort((left, right) => (left[1].last ?? 0) - (right[1].last ?? 0))
    for (const [key] of ordered.slice(0, rows.size - limit)) {
      rows.delete(key)
      persist(key)
    }
  }

  /** Record one decision. `decision` is 'allow' or 'block'. */
  function observe({ signature, tool, risk, decision, source }) {
    const key = keyOf(signature, tool)
    if (!key) return undefined
    const now = Date.now()
    const row = rows.get(key) ?? { signature: key, tool: tool ?? '', risk: risk ?? 'unknown', allow: 0, block: 0, first: now, last: now, source: source ?? 'ai' }
    if (decision === 'allow') row.allow += 1
    else row.block += 1
    row.last = now
    if (typeof tool === 'string' && tool) row.tool = tool
    if (typeof risk === 'string' && risk) row.risk = risk
    if (source) row.source = source
    rows.set(key, row)
    persist(key)
    prune()
    return row
  }

  function list() {
    return [...rows.values()].sort((left, right) => (right.last ?? 0) - (left.last ?? 0))
  }

  function summary(count = 15) {
    const ordered = [...rows.values()].sort((left, right) => right.allow + right.block - (left.allow + left.block))
    return ordered.slice(0, count)
  }

  function clear() {
    for (const key of [...rows.keys()]) {
      rows.delete(key)
      persist(key)
    }
  }

  function render() {
    const entries = list()
    const allowed = entries.filter((entry) => entry.allow > 0 && entry.allow >= entry.block).slice(0, 25)
    const refused = entries.filter((entry) => entry.block > 0).slice(0, 25)
    const lines = [
      '---',
      'name: better-permit-habits',
      'description: 这台机器上已经形成的审批习惯——哪些命令可以直接执行、哪些必须先问人。计划有风险的操作前先查这里，避免重复询问用户已经表态过的事。',
      '---',
      '',
      '# better-permit 审批习惯',
      '',
      `> 由 better-permit 插件自动维护，最近更新 ${new Date().toISOString()}。`,
      '> 每次自动放行、每次用户拒绝都会累加到下表；表格之外的操作按常规审批处理。',
      '',
      '## 可以直接执行',
      '',
    ]
    if (allowed.length === 0) lines.push('（还没有记录）')
    for (const entry of allowed) lines.push(`- \`${entry.signature}\` — 放行 ${entry.allow} 次 / 拒绝 ${entry.block} 次，最近 ${new Date(entry.last).toISOString().slice(0, 10)}，风险 ${entry.risk}`)
    lines.push('', '## 必须先问人', '')
    if (refused.length === 0) lines.push('（还没有记录）')
    for (const entry of refused) lines.push(`- \`${entry.signature}\` — 被拒绝 ${entry.block} 次 / 放行 ${entry.allow} 次，最近 ${new Date(entry.last).toISOString().slice(0, 10)}，风险 ${entry.risk}`)
    lines.push(
      '',
      '## 判断原则',
      '',
      '1. 上表「必须先问人」里出现过的命令类别，不要自作主张执行，先说明理由并请用户确认。',
      '2. 上表「可以直接执行」里出现过的，可以按同样方式继续执行；参数明显不同或涉及系统目录时仍需确认。',
      '3. 表里没有的：只读操作可以直接做；会删除、覆盖、改动系统、对外发布的操作先问。',
      '',
    )
    return lines.join('\n')
  }

  function bind() {
    return Promise.resolve()
      .then(() => {
        const storage = ctx.get('storage')
        const kv = storage && typeof storage.form === 'function' ? storage.form('kv') : undefined
        if (!kv || typeof kv.open !== 'function') return undefined
        return kv.open({ name: 'better-permit-habits', version: 1, tables: [TABLE], hasGlobal: false, layout: 'per-record' })
      })
      .then((opened) => {
        if (!opened) return
        unit = opened
        return opened.loadAll().then((loaded) => {
          for (const [key, record] of Object.entries(loaded?.tables?.[TABLE] ?? {})) {
            if (!record || typeof record !== 'object') continue
            rows.set(key, {
              signature: typeof record.signature === 'string' ? record.signature : key,
              tool: typeof record.tool === 'string' ? record.tool : '',
              risk: typeof record.risk === 'string' ? record.risk : 'unknown',
              allow: Number(record.allow) || 0,
              block: Number(record.block) || 0,
              first: Number(record.first) || 0,
              last: Number(record.last) || 0,
              source: typeof record.source === 'string' ? record.source : 'ai',
            })
          }
        })
      })
      .catch((error) => warn(`habit storage is unavailable, keeping them for this run only: ${error?.message ?? error}`))
  }

  return { bind, observe, list, summary, clear, render }
}
