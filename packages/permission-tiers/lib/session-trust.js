/**
 * Folders the user trusted: per conversation (from the approval prompt or the
 * `/trust` command) and globally (from the settings panel). Memory holds the
 * decision state; the `kv` storage form, when mounted, keeps both across a
 * harness restart.
 *
 * The two scopes share one storage table: a conversation key is its session
 * id, and the global list lives under `GLOBAL_KEY` (no real session id can
 * collide with it because every id the harness mints is a uuid).
 */
const GLOBAL_KEY = '\u0000global'

export function createSessionTrust(ctx, options = {}) {
  const journal = options.journal
  const store = new Map()
  const stamps = new Map()
  let unit

  function warn(message) {
    journal?.warn?.(message)
  }

  function write(key) {
    if (!unit) return
    const paths = [...(store.get(key) ?? [])]
    const at = stamps.get(key) ?? Date.now()
    const action = paths.length === 0
      ? unit.deleteRecord('sessions', key)
      : unit.putRecord('sessions', key, { paths, at })
    Promise.resolve(action).catch((error) => warn(`could not persist trusted folders: ${error?.message ?? error}`))
  }

  function put(key, folders) {
    const set = store.get(key) ?? new Set()
    for (const folder of folders) if (typeof folder === 'string' && folder) set.add(folder)
    if (set.size === 0) {
      store.delete(key)
      stamps.delete(key)
    } else {
      store.set(key, set)
      stamps.set(key, Date.now())
    }
    write(key)
    return [...(store.get(key) ?? [])]
  }

  function take(key, folder) {
    const set = store.get(key)
    if (set) {
      for (const entry of [...set]) if (entry === folder) set.delete(entry)
      if (set.size === 0) {
        store.delete(key)
        stamps.delete(key)
      } else {
        stamps.set(key, Date.now())
      }
    }
    write(key)
    return [...(store.get(key) ?? [])]
  }

  function drop(key) {
    store.delete(key)
    stamps.delete(key)
    write(key)
    return []
  }

  function listOf(key) {
    if (!key) return []
    return [...(store.get(String(key)) ?? [])]
  }

  function load(records) {
    for (const [key, record] of Object.entries(records ?? {})) {
      const paths = Array.isArray(record?.paths) ? record.paths.filter((entry) => typeof entry === 'string' && entry) : []
      if (paths.length === 0) continue
      store.set(key, new Set(paths))
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
        return kv.open({ name: 'permission-tier-trust', version: 1, tables: ['sessions'], hasGlobal: false, layout: 'per-record' })
      })
      .then((opened) => {
        if (!opened) return
        unit = opened
        return opened.loadAll().then((loaded) => load(loaded?.tables?.sessions))
      })
      .catch((error) => warn(`trusted-folder storage is unavailable, keeping them for this run only: ${error?.message ?? error}`))
  }

  return {
    bind,
    list: listOf,
    add(sessionId, folders) {
      if (!sessionId) return []
      return put(String(sessionId), folders)
    },
    remove(sessionId, folder) {
      return take(String(sessionId), folder)
    },
    clear(sessionId) {
      return drop(String(sessionId))
    },
    /** Folders trusted in every conversation. */
    globalList() {
      return listOf(GLOBAL_KEY)
    },
    addGlobal(folders) {
      return put(GLOBAL_KEY, folders)
    },
    removeGlobal(folder) {
      return take(GLOBAL_KEY, folder)
    },
    clearGlobal() {
      return drop(GLOBAL_KEY)
    },
    /** Every conversation that has trusted folders, most recently changed first. */
    conversations() {
      const out = []
      for (const [key, set] of store) {
        if (key === GLOBAL_KEY) continue
        out.push({ id: key, folders: [...set], at: stamps.get(key) ?? 0 })
      }
      return out.sort((left, right) => right.at - left.at)
    },
  }
}
