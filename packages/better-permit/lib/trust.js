/**
 * Trust checks used by the `trusted` gates.
 *
 * Nothing here decides *whether* a class of operation is auto-approved — that
 * is the tier table's job. This module only answers "is this exact target
 * covered by the user's trust lists?".
 */
import { statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

const WINDOWS = process.platform === 'win32'
const SHELL_METACHARACTERS = [';', '&', '|', '>', '<', '`', '$', '(', ')', '{', '}', '\n', '\r']

export function normalizeTrust(settings) {
  const base = typeof settings.baseDir === 'string' && settings.baseDir ? settings.baseDir : process.cwd()
  return {
    base,
    paths: list(settings.trustedPaths).map((entry) => resolve(base, entry)),
    commands: list(settings.trustedCommands).map(normalizeCommand).filter(Boolean),
    packages: list(settings.trustedPackages),
    shellTools: new Set(list(settings.shellTools)),
  }
}

function list(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0) : []
}

export function normalizeCommand(command) {
  return command.replace(/\s+/g, ' ').trim()
}

function fold(path) {
  return WINDOWS ? path.toLowerCase() : path
}

export function isInside(target, root) {
  const inner = fold(resolve(target))
  const outer = fold(resolve(root))
  if (inner === outer) return true
  return inner.startsWith(outer.endsWith(sep) ? outer : outer + sep)
}

function looksLikePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^[\\/]/.test(value) || /^\.[\\/]/.test(value) || value.includes('\\')
}

function packageNameOf(spec) {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0)
  return at > 0 ? spec.slice(0, at) : spec
}

function matchesPackage(name, pattern) {
  if (pattern === name) return true
  if (pattern.endsWith('/*')) return name.startsWith(pattern.slice(0, -1))
  if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1))
  return false
}

/** First shell metacharacter in the command, or null. */
export function firstMetacharacter(command) {
  for (const character of SHELL_METACHARACTERS) {
    if (command.includes(character)) return character
  }
  return null
}

function matchesPrefix(command, prefix) {
  return command === prefix || command.startsWith(prefix + ' ')
}

const PATH_KEYS = [
  'path',
  'file_path',
  'filePath',
  'filepath',
  'paths',
  'from',
  'to',
  'target',
  'destination',
  'dest',
  'directory',
  'dir',
]

function pathCandidates(args) {
  if (!args || typeof args !== 'object') return []
  const out = []
  for (const key of PATH_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) {
      if (key === 'target' && !looksLikePath(value.trim())) continue
      if (key === 'target' && !value.trim()) continue
      out.push(value.trim())
    } else if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === 'string' && entry.trim()) out.push(entry.trim())
    }
  }
  return out
}

function pathVerdict(candidates, trust) {
  const outside = []
  for (const candidate of candidates) {
    const absolute = resolve(trust.base, candidate)
    if (!trust.paths.some((root) => isInside(absolute, root))) outside.push(candidate)
  }
  if (outside.length > 0) {
    return { ok: false, reason: `outside the trusted paths: ${outside.slice(0, 3).join(', ')}` }
  }
  return { ok: true, scope: 'path', detail: `trusted path ${candidates[0]}` }
}

/**
 * Decide whether one approval target is covered by the trust lists.
 * `mode` is the escalation mode being requested (or the install placeholder).
 */
export function checkTrust({ tool, args, trust, mode }) {
  if (trust.shellTools.has(tool)) {
    const command = typeof args?.command === 'string' ? args.command : typeof args?.cmd === 'string' ? args.cmd : undefined
    if (!command) return { ok: false, reason: 'no command text to verify' }
    const normalized = normalizeCommand(command)
    const meta = firstMetacharacter(normalized)
    if (meta) return { ok: false, reason: `command contains the shell metacharacter ${JSON.stringify(meta)}` }
    const hit = trust.commands.find((prefix) => matchesPrefix(normalized, prefix))
    if (hit) return { ok: true, scope: 'command', detail: `trusted command "${hit}"` }
    // A folder trusted from the approval prompt covers plain commands started
    // there — but only for the narrow workspace escalation: full access still
    // needs an explicitly trusted command.
    if (mode === 'workspace-write') {
      const workdir = [args?.cwd, args?.workdir, args?.workingDirectory].find((entry) => typeof entry === 'string' && entry.trim())
      if (workdir) {
        const absolute = resolve(trust.base, workdir.trim())
        const root = trust.paths.find((path) => isInside(absolute, path))
        if (root) return { ok: true, scope: 'workdir', detail: `command started in the trusted folder ${root}` }
      }
    }
    return { ok: false, reason: 'command does not start with a trusted prefix' }
  }
  const candidates = pathCandidates(args)
  if (candidates.length === 0) {
    return { ok: false, reason: `no path in the ${tool} arguments to verify (${String(mode)})` }
  }
  return pathVerdict(candidates, trust)
}

/** Trust check for a plugin install target: local path or package spec. */
export function checkInstallTarget(target, trust) {
  if (typeof target !== 'string' || !target.trim()) return { ok: false, reason: 'no install target' }
  const text = target.trim()
  if (looksLikePath(text)) {
    const absolute = resolve(trust.base, text)
    if (!trust.paths.some((root) => isInside(absolute, root))) {
      return { ok: false, reason: `${text} is outside the trusted paths` }
    }
    return { ok: true, scope: 'path', detail: `trusted local path ${text}` }
  }
  const name = packageNameOf(text)
  const hit = trust.packages.find((pattern) => matchesPackage(name, pattern))
  if (!hit) return { ok: false, reason: `${name} is not a trusted package` }
  return { ok: true, scope: 'package', detail: `trusted package ${name}` }
}

/**
 * Folders an approval is "about", so the approval prompt can offer to trust
 * one for the rest of the conversation. Paths resolve to their folder; shell
 * work resolves to the working directory (or the workspace root).
 */
export function targetFolders(args, base) {
  const out = []
  const seen = new Set()
  const push = (folder) => {
    if (!folder) return
    const key = fold(folder)
    if (seen.has(key)) return
    seen.add(key)
    out.push(folder)
  }
  if (!args || typeof args !== 'object') return out
  const command = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : undefined
  if (command !== undefined) {
    const workdir = [args.cwd, args.workdir, args.workingDirectory].find((entry) => typeof entry === 'string' && entry.trim())
    push(workdir ? resolve(base, workdir.trim()) : resolve(base))
    return out.slice(0, 4)
  }
  for (const key of PATH_KEYS) {
    const value = args[key]
    const entries = Array.isArray(value) ? value : [value]
    for (const entry of entries) {
      if (typeof entry !== 'string' || !entry.trim()) continue
      if (key === 'target' && !looksLikePath(entry.trim())) continue
      const absolute = resolve(base, entry.trim())
      if (key === 'directory' || key === 'dir') push(absolute)
      else push(isDirectory(absolute) ? absolute : dirname(absolute))
    }
  }
  return out.slice(0, 4)
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Human-readable trust summary for /tiers. */
export function describeTrust(trust) {
  const parts = []
  parts.push(trust.paths.length ? `受信路径 ${trust.paths.join(', ')}` : '受信路径（未配置）')
  parts.push(trust.commands.length ? `受信命令 ${trust.commands.join(' | ')}` : '受信命令（未配置）')
  parts.push(trust.packages.length ? `受信包 ${trust.packages.join(', ')}` : '受信包（未配置）')
  return parts.join('；')
}
