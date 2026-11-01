/**
 * "Always allow this in this conversation" rules — the Trae-style shortcut.
 *
 * A rule keys on a stable signature of the operation (`git status`, `dir`,
 * `npm install` …) and only ever applies to the conversation it was granted
 * in. The approval prompt adds one when the user clicks the always-allow
 * button; `/allow` and the settings panel manage the list.
 *
 * Rules are *additional* to the tier: they let one operation class through
 * without asking even on a tier that would otherwise ask. They never widen the
 * sandbox mode and never disable the always-confirmed plugin actions.
 */
const TABLE = 'rules'

export function createSessionRules(ctx, options = {}) {
  const journal = options.journal
  const store = new Map()
  const stamps = new Map()
  let unit

  function warn(message) {
    journal?.warn?.(message)
  }

  function write(sessionId) {
    if (!unit) return
    const rules = [...(store.get(sessionId) ?? [])]
    const at = stamps.get(sessionId) ?? Date.now()
    const action = rules.length === 0
      ? unit.deleteRecord(TABLE, sessionId)
      : unit.putRecord(TABLE, sessionId, { rules, at })
    Promise.resolve(action).catch((error) => warn(`could not persist conversation rules: ${error?.message ?? error}`))
  }

  function listOf(sessionId) {
    if (!sessionId) return []
    return [...(store.get(String(sessionId)) ?? [])]
  }

  function addRule(sessionId, pattern, kind = 'command') {
    if (!sessionId) return []
    const key = String(sessionId)
    const text = typeof pattern === 'string' ? pattern.replace(/\s+/g, ' ').trim() : ''
    if (!text) return listOf(key)
    const rules = store.get(key) ?? []
    if (!rules.some((entry) => entry.pattern === text && entry.kind === kind)) {
      rules.push({ pattern: text, kind, at: Date.now() })
      rules.sort((left, right) => left.at - right.at)
      store.set(key, rules)
      stamps.set(key, Date.now())
      write(key)
    }
    return [...rules]
  }

  function removeRule(sessionId, pattern) {
    if (!sessionId) return []
    const key = String(sessionId)
    const rules = store.get(key)
    if (!rules) return []
    const kept = rules.filter((entry) => entry.pattern !== pattern)
    if (kept.length === rules.length) return [...rules]
    if (kept.length === 0) {
      store.delete(key)
      stamps.delete(key)
    } else {
      store.set(key, kept)
      stamps.set(key, Date.now())
    }
    write(key)
    return [...(store.get(key) ?? [])]
  }

  function clearRules(sessionId) {
    if (!sessionId) return []
    const key = String(sessionId)
    store.delete(key)
    stamps.delete(key)
    write(key)
    return []
  }

  /** The rule matching this signature, or undefined. */
  function match(sessionId, signature) {
    if (!sessionId || typeof signature !== 'string' || !signature) return undefined
    const wanted = signature.toLowerCase()
    return listOf(sessionId).find((entry) => entry.kind === 'command' && entry.pattern.toLowerCase() === wanted)
  }

  function load(records) {
    for (const [key, record] of Object.entries(records ?? {})) {
      const raw = Array.isArray(record?.rules) ? record.rules : []
      const rules = raw
        .filter((entry) => entry && typeof entry.pattern === 'string' && entry.pattern)
        .map((entry) => ({
          pattern: entry.pattern,
          kind: typeof entry.kind === 'string' ? entry.kind : 'command',
          at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : 0,
        }))
      if (rules.length === 0) continue
      store.set(key, rules.sort((left, right) => left.at - right.at))
      const at = Number(record?.at)
      if (Number.isFinite(at)) stamps.set(key, at)
    }
  }

  function bind() {
    return Promise.resolve()
      .then(() => {
        const storage = ctx.get('storage')
        const kv = storage && typeof storage.form === 'function' ? storage.form('kv') : undefined
        if (!kv || typeof kv.open !== 'function') return undefined
        return kv.open({ name: 'permission-tier-rules', version: 1, tables: [TABLE], hasGlobal: false, layout: 'per-record' })
      })
      .then((opened) => {
        if (!opened) return
        unit = opened
        return opened.loadAll().then((loaded) => load(loaded?.tables?.[TABLE]))
      })
      .catch((error) => warn(`conversation-rule storage is unavailable, keeping them for this run only: ${error?.message ?? error}`))
  }

  return {
    bind,
    list: listOf,
    add: addRule,
    remove: removeRule,
    clear: clearRules,
    match,
    /** Every conversation that has rules, most recently changed first. */
    conversations() {
      const out = []
      for (const [key, rules] of store) out.push({ id: key, rules: [...rules], at: stamps.get(key) ?? 0 })
      return out.sort((left, right) => right.at - left.at)
    },
  }
}
