/**
 * Risk grading for one pending operation.
 *
 * The tier decides *whether* it may answer automatically; this module says how
 * dangerous the operation itself looks, so a tier can carry a ceiling ("never
 * auto-approve above this") and the approval prompt can show a badge.
 *
 * Levels are ordered and every rule takes the maximum it can prove:
 *
 *   0 read         only reads: listing, showing, querying
 *   1 write        creates or edits things inside the workspace
 *   2 destructive  deletes, overwrites, rewrites history
 *   3 system       system folders, registry, services, permissions, elevation
 *   4 publish      ships data off the machine: push, publish, upload, deploy
 *   -1 unknown     nothing recognisable — treated as the most dangerous
 */

export const RISK_LEVELS = ['read', 'write', 'destructive', 'system', 'publish']

export const RISK_LABELS = {
  read: '只读',
  write: '写入',
  destructive: '删除/覆盖',
  system: '系统层',
  outside: '工作区外',
  publish: '对外发布',
  unknown: '无法识别',
}

export const RISK_HINTS = {
  read: '只查看，不改变任何文件',
  write: '在工作区内创建或修改文件',
  destructive: '删除文件、覆盖内容或重写版本历史',
  system: '系统目录、注册表、服务、权限或提权',
  outside: '写到自己工作区之外的位置',
  publish: '把内容推送到远端：push、publish、上传、部署',
  unknown: '识别不出意图，按最危险处理',
}

/** Severity rank shared by every key, including the aliases above. */
const RANKS = {
  off: -2,
  read: 0,
  write: 1,
  destructive: 2,
  system: 3,
  outside: 3,
  publish: 4,
  unknown: 9,
  all: 9,
}

/** Ordering used for ceilings: `rank('read') = 0 … rank('publish') = 4`. */
export function rankOf(key) {
  const value = RANKS[key]
  return typeof value === 'number' ? value : 9
}

export function labelOf(key) {
  return RISK_LABELS[key] ?? String(key)
}

/**
 * Ceiling names a tier may use, from the narrowest upward. `trusted` is kept
 * out of this ladder on purpose: it is a trust check, not a severity.
 */
export const CEILINGS = ['off', 'read', 'write', 'destructive', 'publish', 'all']

// Commands whose *second* token is the real verb (git status, pnpm install…).
const VERB_HOSTS = new Set([
  'git',
  'pnpm',
  'npm',
  'yarn',
  'npx',
  'docker',
  'podman',
  'kubectl',
  'helm',
  'cargo',
  'rustup',
  'pip',
  'pip3',
  'python',
  'python3',
  'node',
  'deno',
  'bun',
  'go',
  'dotnet',
  'dotnet-tool',
  'gh',
  'pnpx',
  'winget',
  'choco',
  'scoop',
  'apt',
  'apt-get',
  'brew',
  'systemctl',
  'sc',
  'reg',
  'netsh',
  'schtasks',
  'robocopy',
  'xcopy',
  'copy',
  'robocopy.exe',
])

// Tools whose second token is the script/file they run: writing is the floor.
const SCRIPT_RUNNERS = new Set(['node', 'python', 'python3', 'deno', 'bun', 'ruby', 'perl', 'php', 'java', 'dotnet', 'go', 'rustc', 'ts-node', 'tsx'])

const READ_VERBS = new Set([
  'dir',
  'ls',
  'll',
  'cat',
  'type',
  'more',
  'head',
  'tail',
  'less',
  'find',
  'findstr',
  'grep',
  'rg',
  'select-string',
  'where',
  'which',
  'whoami',
  'hostname',
  'date',
  'echo',
  'pwd',
  'tree',
  'stat',
  'file',
  'wc',
  'sort',
  'uniq',
  'diff',
  'du',
  'df',
  'ps',
  'tasklist',
  'netstat',
  'ipconfig',
  'ifconfig',
  'ping',
  'tracert',
  'nslookup',
  'resolve-dnsname',
  'get-childitem',
  'get-content',
  'get-item',
  'get-itemproperty',
  'get-location',
  'get-process',
  'get-service',
  'get-command',
  'get-helper',
  'get-module',
  'get-variable',
  'get-date',
  'get-filehash',
  'get-acl',
  'test-path',
  'resolve-path',
  'split-path',
  'join-path',
  'measure-object',
  'select-object',
  'out-string',
  'format-table',
  'format-list',
  'convertto-json',
  'convertfrom-json',
  'git:status',
  'git:diff',
  'git:log',
  'git:show',
  'git:rev-parse',
  'git:ls-files',
  'git:blame',
  'git:describe',
  'git:shortlog',
  'git:config:get',
  'npm:ls',
  'npm:list',
  'npm:view',
  'npm:outdated',
  'pnpm:ls',
  'pnpm:list',
  'pnpm:why',
  'pnpm:outdated',
  'docker:ps',
  'docker:images',
  'kubectl:get',
  'kubectl:describe',
])

const WRITE_VERBS = new Set([
  'mkdir',
  'md',
  'touch',
  'new-item',
  'ni',
  'set-content',
  'add-content',
  'out-file',
  'tee-object',
  'cp',
  'copy',
  'copy-item',
  'mv',
  'move',
  'move-item',
  'ren',
  'rename',
  'rename-item',
  'sed',
  'awk',
  'patch',
  'git:add',
  'git:commit',
  'git:checkout',
  'git:switch',
  'git:merge',
  'git:rebase',
  'git:stash',
  'git:tag',
  'git:init',
  'git:remote',
  'git:fetch',
  'git:pull',
  'git:clone',
  'git:cherry-pick',
  'npm:install',
  'npm:i',
  'npm:ci',
  'npm:run',
  'npm:update',
  'npm:exec',
  'pnpm:install',
  'pnpm:i',
  'pnpm:add',
  'pnpm:run',
  'pnpm:update',
  'pnpm:exec',
  'pnpm:rebuild',
  'yarn:install',
  'yarn:add',
  'yarn:run',
  'pip:install',
  'pip3:install',
  'cargo:build',
  'cargo:check',
  'cargo:test',
  'go:build',
  'go:test',
  'dotnet:build',
  'dotnet:test',
  'docker:build',
  'docker:run',
  'docker:compose',
  'tsc',
  'vite',
  'webpack',
  'rollup',
  'esbuild',
  'prettier',
  'eslint',
  'make',
  'cmake',
  'gradle',
  'mvn',
  'start-process',
  'invoke-command',
  'invoke-expression',
  'iex',
])

const DESTRUCTIVE_VERBS = new Set([
  'rm',
  'rmdir',
  'rd',
  'del',
  'erase',
  'unlink',
  'remove',
  'remove-item',
  'ri',
  'del',
  'clear-content',
  'clc',
  'truncate',
  'shred',
  'format',
  'diskpart',
  'git:reset',
  'git:clean',
  'git:rm',
  'git:gc',
  'npm:uninstall',
  'npm:un',
  'pnpm:remove',
  'pnpm:rm',
  'pnpm:uninstall',
  'yarn:remove',
  'docker:rm',
  'docker:rmi',
  'docker:prune',
])

const SYSTEM_MARKERS = [
  /[\\/]windows[\\/]/i,
  /[\\/]program files([ (]|$)/i,
  /[\\/]programdata[\\/]/i,
  /%systemroot%/i,
  /%windir%/i,
  /\bsystem32\b/i,
  /\bhklm\b/i,
  /\bhkey_local_machine\b/i,
  /\breg\s+(add|delete|import|load)\b/i,
  /\bsc\s+(create|config|delete|start|stop)\b/i,
  /\bschtasks\s+\/create\b/i,
  /\bnetsh\b/i,
  /\bbcdedit\b/i,
  /\btakeown\b/i,
  /\bicacls\b/i,
  /\bset-executionpolicy\b/i,
  /\bsudo\b/i,
  /\brunas\b/i,
  /\bnet\s+user\b/i,
  /\bnet\s+localgroup\b/i,
  /\bnew-localuser\b/i,
  /\badd-mppreference\b/i,
  /\bset-mppreference\b/i,
  /\b(disable|enable)-windowsoptionalfeature\b/i,
  /\bsetx\b[^\n]*\bpath\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bmount\b/i,
  /\bumount\b/i,
  /\bwsl\b/i,
]

const PUBLISH_MARKERS = [
  /\bgit\s+push\b/i,
  /\bnpm\s+publish\b/i,
  /\bpnpm\s+publish\b/i,
  /\byarn\s+publish\b/i,
  /\bdocker\s+push\b/i,
  /\bgh\s+(release|pr|issue)\s+(create|edit|close)\b/i,
  /\bcargo\s+publish\b/i,
  /\bnuget\s+push\b/i,
  /\btwine\s+upload\b/i,
  /\bcurl\b[^\n]*\s(-T|--upload-file|-d|--data|-F|--form)\b/i,
  /\bwget\b[^\n]*--post-(data|file)\b/i,
  /\binvoke-restmethod\b[^\n]*-method\s+(post|put|patch)\b/i,
  /\binvoke-webrequest\b[^\n]*-method\s+(post|put|patch)\b/i,
  /\bscp\b/i,
  /\brsync\b/i,
  /\bsftp\b/i,
  /\bssh\b/i,
  /\bgh\s+api\b[^\n]*-X\s*(POST|PUT|PATCH|DELETE)\b/i,
  /\bgit\s+remote\s+(add|set-url)\b/i,
  /\bvercel\b[^\n]*\bdeploy\b/i,
  /\bnetlify\s+deploy\b/i,
  /\bfirebase\s+deploy\b/i,
  /\baws\s+s3\s+(cp|sync|mv)\b/i,
  /\bgsutil\s+(cp|rsync)\b/i,
]

/** Split a command line into simple commands (naive on purpose). */
export function splitCommands(command) {
  return String(command)
    .split(/&&|\|\||[;|]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Tokens of one simple command, quotes kept together. */
export function tokensOf(command) {
  const out = []
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g
  let match
  while ((match = pattern.exec(command)) !== null) out.push(match[1] ?? match[2] ?? match[3])
  return out
}

function verbKey(tokens) {
  const first = (tokens[0] ?? '').toLowerCase().replace(/^.*[\\/]/, '')
  if (!first) return ''
  if (VERB_HOSTS.has(first)) {
    const second = (tokens[1] ?? '').toLowerCase()
    if (second && !second.startsWith('-') && !second.startsWith('/')) return `${first}:${second}`
    return first
  }
  return first
}

/**
 * The stable prefix a "always allow in this conversation" rule keys on.
 *
 * Read/write verbs key on the verb (`git status`, `dir`) so ordinary work needs
 * one click. Everything else — deletions, system calls, publishes, unknown
 * commands — keys on the whole simple command, because those must not become a
 * blanket grant for a whole verb family.
 */
export function signatureOf(command) {
  const simple = splitCommands(String(command))[0] ?? ''
  const tokens = tokensOf(simple).filter((token) => !/^\d*[>&]?$/.test(token))
  if (tokens.length === 0) return ''
  const first = tokens[0].toLowerCase().replace(/^.*[\\/]/, '')
  const key = verbKey(tokens)
  const plain = key.includes(':') ? key.split(':')[1] : key
  const narrow = DESTRUCTIVE_VERBS.has(key) || DESTRUCTIVE_VERBS.has(plain) || !(READ_VERBS.has(key) || READ_VERBS.has(plain) || WRITE_VERBS.has(key) || WRITE_VERBS.has(plain))
  if (narrow) return [...tokens.slice(0, 4)].join(' ')
  if (key.includes(':')) return key.replace(':', ' ')
  return first
}

function classifyOne(command) {
  const text = String(command)
  let worst = 'off'
  const reasons = []
  const bump = (next, why) => {
    const better = rankOf(next) > rankOf(worst)
    if (better) worst = next
    if (why) {
      if (better) reasons.unshift(why)
      else reasons.push(why)
    }
  }

  for (const marker of PUBLISH_MARKERS) {
    if (marker.test(text)) bump('publish', 'instruction sends data off this machine')
  }
  for (const marker of SYSTEM_MARKERS) {
    if (marker.test(text)) bump('system', 'instruction touches the system layer')
  }

  let recognised = false
  for (const simple of splitCommands(text)) {
    const tokens = tokensOf(simple)
    if (tokens.length === 0) continue
    const key = verbKey(tokens)
    const plain = key.includes(':') ? key.split(':')[1] : key
    const host = (tokens[0] ?? '').toLowerCase().replace(/^.*[\\/]/, '')
    if (DESTRUCTIVE_VERBS.has(key) || DESTRUCTIVE_VERBS.has(plain)) {
      bump('destructive', `"${key}" deletes or overwrites`)
    } else if (WRITE_VERBS.has(key) || WRITE_VERBS.has(plain)) {
      bump('write', `"${key}" writes`)
    } else if (READ_VERBS.has(key) || READ_VERBS.has(plain)) {
      bump('read', `"${key}" only reads`)
    } else if (key === 'powershell' || key === 'pwsh' || key === 'cmd') {
      bump('write', 'a nested shell hides what runs')
    } else if (VERB_HOSTS.has(host) || SCRIPT_RUNNERS.has(host)) {
      // A known tool with a verb this table does not know: assume it changes
      // state (a script runner, an unknown subcommand), never "only reads".
      bump('write', `"${key}" runs a command this table does not classify`)
    } else if (!recognised && worst !== 'off') {
      // Something stronger already matched (publish/system markers); keep it.
    } else if (!recognised) {
      bump('unknown', `"${key}" is not a recognised verb`)
    }
    recognised = true
  }

  if (worst === 'off') return { key: 'unknown', reasons: ['no recognisable verb'] }
  return { key: worst, reasons: [...new Set(reasons)] }
}

/**
 * Grade one pending operation.
 *
 * `operation` is `{ tool, args }`; `context` carries `{ base, shellTools }` so
 * paths can be resolved and shell tools recognised.
 */
export function classify(operation, context) {
  const tool = operation?.tool
  const args = operation?.args ?? {}
  const shellTools = context?.shellTools
  const isShell = shellTools ? shellTools.has?.(tool) ?? shellTools.includes?.(tool) ?? false : false
  const command = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : undefined

  if (command !== undefined) {
    const result = classifyOne(command)
    return { key: result.key, label: labelOf(result.key), reasons: result.reasons, signature: signatureOf(command) }
  }

  if (isShell) {
    return { key: 'unknown', label: labelOf('unknown'), reasons: ['a shell call without readable command text'], signature: '' }
  }

  const paths = collectPaths(args)
  const base = context?.base
  if (paths.length > 0) {
    const outside = base ? paths.filter((entry) => !isUnder(entry, base)) : []
    if (outside.length > 0) {
      const looksSystem = outside.some((entry) => /[\\/](windows|program files|programdata|system32)([\\/]|$)/i.test(entry))
      return {
        key: looksSystem ? 'system' : 'outside',
        label: labelOf(looksSystem ? 'system' : 'outside'),
        reasons: [`writes outside the workspace: ${outside.slice(0, 2).join(', ')}`],
        signature: '',
      }
    }
    return { key: 'write', label: labelOf('write'), reasons: ['writes inside the workspace'], signature: '' }
  }

  return { key: 'write', label: labelOf('write'), reasons: [`${tool ?? 'this tool'} may change state`], signature: '' }
}

const PATH_KEYS = ['path', 'file_path', 'filePath', 'filepath', 'paths', 'to', 'destination', 'dest', 'directory', 'dir']

function collectPaths(args) {
  const out = []
  for (const key of PATH_KEYS) {
    const value = args?.[key]
    if (typeof value === 'string' && value.trim()) out.push(value.trim())
    else if (Array.isArray(value)) for (const entry of value) if (typeof entry === 'string' && entry.trim()) out.push(entry.trim())
  }
  return out
}

function isUnder(candidate, base) {
  const norm = (value) => String(value).replace(/[\\/]+/g, '\\').toLowerCase()
  const inner = norm(candidate)
  const outer = norm(base).replace(/\\$/, '')
  return inner === outer || inner.startsWith(outer + '\\') || inner.startsWith(outer + '/')
}

/** Does `ceiling` allow this risk level? `off` allows nothing. */
export function withinCeiling(ceiling, key) {
  if (ceiling === 'off') return false
  if (ceiling === 'all') return true
  return rankOf(key) <= rankOf(ceiling)
}

export function describeRisk(risk) {
  if (!risk) return ''
  return `${risk.label ?? labelOf(risk.key)}${risk.reasons?.length ? `（${risk.reasons.slice(0, 2).join('；')}）` : ''}`
}
