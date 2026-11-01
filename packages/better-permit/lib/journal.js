/**
 * In-memory record of automatic approvals: the last few entries are shown by
 * the /tiers command and every entry is also written to the plugin logger.
 */
export function createJournal(ctx, limit = 40) {
  const entries = []
  const size = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 40

  function write(level, message) {
    try {
      const logger = typeof ctx.logger === 'function' ? ctx.logger('better-permit') : ctx.logger
      if (logger && typeof logger[level] === 'function') logger[level](message)
    } catch {
      /* logging must never break an approval */
    }
  }

  return {
    record(entry) {
      entries.unshift(entry)
      if (entries.length > size) entries.length = size
      write('info', `auto-approved ${entry.tool} [${entry.category}] on tier ${entry.tier}: ${entry.detail}`)
    },
    warn(message) {
      write('warn', message)
    },
    list() {
      return entries.slice()
    },
  }
}
