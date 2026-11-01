/**
 * Tier table and the small pure helpers used to read a plugin action or an
 * escalation out of an approval request.
 *
 * A tier is keyed by the permission-preset name it is bound to. The three
 * built-in presets get no rules here (they keep asking), every tier added by
 * this bundle carries a rule set.
 *
 * Every tier declares four things:
 *  - `plugin`: what it may do with plugin_manager calls;
 *  - `escalate`: whether a sandbox escalation is auto-approved (`off`),
 *    auto-approved after a trust check (`trusted`) or always (`all`);
 *  - `maxRisk` / `alwaysAsk`: how dangerous the *operation itself* may look
 *    before the tier refuses to answer it (see lib/risk.js). `maxRisk` is a
 *    ceiling — an operation graded above it always reaches a human, and
 *    `alwaysAsk` names levels that are refused even when lower-risk siblings
 *    in the same request would pass;
 *  - `ai`: when true, an operation above the ceiling is handed to the
 *    configured reviewer model instead of straight to the user. `alwaysAsk`
 *    still wins over the model, so the levels listed there stay human-only.
 */

/** plugin_manager action -> coarse category the tier table talks about. */
export const PLUGIN_ACTION_CATEGORY = {
  list_plugins: 'read',
  list_bundles: 'read',
  list_version_exemptions: 'read',
  set_plugin: 'toggle',
  set_bundle: 'toggle',
  install_bundle: 'install',
  remove_bundle: 'remove',
  set_version_exemption: 'exemption',
}

/**
 * Risk levels every tier below the widest one still asks about. `outside` is
 * deliberately absent: it is what the trusted tier exists to clear, and every
 * tier whose ceiling stops below it asks anyway.
 */
const HIGH_RISK = ['destructive', 'system', 'publish']

/**
 * `rank` is only used for display; it lets the UI/report order tiers from the
 * most conservative to the widest.
 */
export const DEFAULT_TIERS = {
  'workspace-write-edits': {
    label: '工作区内 · 写入自动',
    description: '在工作区内写入、装依赖、跑构建自动放行；删除/覆盖、系统操作、往外发仍会询问，完全访问提权也仍需确认。',
    rank: 2,
    plugin: { read: true, toggle: true, install: 'all', remove: false, exemption: false },
    escalate: { 'workspace-write': 'all', 'danger-full-access': 'off' },
    otherAsks: false,
    maxRisk: 'write',
    alwaysAsk: HIGH_RISK,
    ai: false,
  },
  'workspace-write-trusted': {
    label: '工作区内 · 受信放行',
    description: '在工作区内写入之上，受信目录内的路径与受信前缀的命令可自动提权；删除、系统操作与外发仍会询问。',
    rank: 3,
    plugin: { read: true, toggle: true, install: 'all', remove: false, exemption: false },
    escalate: { 'workspace-write': 'trusted', 'danger-full-access': 'trusted' },
    otherAsks: false,
    maxRisk: 'write',
    alwaysAsk: HIGH_RISK,
    ai: false,
  },
  'workspace-write-ai': {
    label: '工作区内 · AI 判定',
    description:
      '常规读写由规则放行；超出台阶的危险操作交给你自己配置的评审模型判断，它说安全就直接执行，说不准或说危险才问你。系统层与对外发布始终由你确认。',
    rank: 4,
    plugin: { read: true, toggle: true, install: 'all', remove: false, exemption: false },
    escalate: { 'workspace-write': 'all', 'danger-full-access': 'off' },
    otherAsks: false,
    maxRisk: 'write',
    alwaysAsk: ['system', 'publish'],
    ai: true,
  },
  'workspace-write-guarded': {
    label: '工作区内 · 高危才问',
    description: '读写、装依赖、删除都自动放行；只有系统层操作、对外发布和识别不出的命令才会询问。',
    rank: 5,
    plugin: { read: true, toggle: true, install: 'all', remove: false, exemption: false },
    escalate: { 'workspace-write': 'all', 'danger-full-access': 'all' },
    otherAsks: true,
    maxRisk: 'destructive',
    alwaysAsk: ['system', 'publish', 'unknown'],
    ai: false,
  },
  'workspace-write-autopilot': {
    label: '工作区内 · 自动放行',
    description: '自动批准全部沙箱提权与其它审批请求；移除插件、版本豁免与安装脚本仍需确认。',
    rank: 6,
    plugin: { read: true, toggle: true, install: 'all', remove: false, exemption: false },
    escalate: { 'workspace-write': 'all', 'danger-full-access': 'all' },
    otherAsks: true,
    maxRisk: 'all',
    alwaysAsk: [],
    ai: false,
  },
}

const ESCALATION_RE = /^\s*escalate sandbox to (workspace-write|danger-full-access)\b/

/** The sandbox mode an approval request is escalating to, or null. */
export function parseEscalation(reason) {
  if (typeof reason !== 'string') return null
  const match = ESCALATION_RE.exec(reason)
  return match ? match[1] : null
}

/** Coarse category of a plugin_manager action, or null when unreadable. */
export function categoryOf(args) {
  if (!args || typeof args !== 'object') return null
  const action = args.action
  if (typeof action !== 'string') return null
  return PLUGIN_ACTION_CATEGORY[action] ?? 'unknown'
}

function gate(value) {
  if (value === true) return 'all'
  if (value === false || value === undefined || value === null) return 'off'
  const text = String(value)
  return text === 'all' || text === 'trusted' || text === 'off' ? text : 'off'
}

function allow(value) {
  return value === true || value === 'all' || value === 'trusted'
}

const CEILINGS = new Set(['off', 'read', 'write', 'destructive', 'publish', 'all'])
const RISK_KEYS = new Set(['read', 'write', 'destructive', 'system', 'outside', 'publish', 'unknown'])

function ceiling(value) {
  if (value === true) return 'all'
  if (value === false || value === undefined || value === null) return 'off'
  const text = String(value)
  return CEILINGS.has(text) ? text : 'off'
}

function riskList(value) {
  if (!Array.isArray(value)) return []
  return value.filter((entry) => typeof entry === 'string' && RISK_KEYS.has(entry))
}

export function normalizeRules(key, rules) {
  const plugin = rules?.plugin ?? {}
  const escalate = rules?.escalate ?? {}
  return {
    label: typeof rules?.label === 'string' && rules.label ? rules.label : key,
    description: typeof rules?.description === 'string' ? rules.description : undefined,
    rank: Number.isFinite(rules?.rank) ? rules.rank : 2,
    plugin: {
      read: allow(plugin.read),
      toggle: allow(plugin.toggle),
      install: gate(plugin.install),
      remove: allow(plugin.remove),
      exemption: allow(plugin.exemption),
    },
    escalate: {
      'workspace-write': gate(escalate['workspace-write']),
      'danger-full-access': gate(escalate['danger-full-access']),
    },
    otherAsks: rules?.otherAsks === true,
    maxRisk: ceiling(rules?.maxRisk),
    alwaysAsk: riskList(rules?.alwaysAsk),
    ai: rules?.ai === true,
  }
}

/** Built-in tiers, overridden field-by-field by `config.tiers`. */
export function mergeTiers(base, overrides) {
  const out = {}
  for (const [key, rules] of Object.entries(base)) out[key] = normalizeRules(key, rules)
  if (overrides && typeof overrides === 'object') {
    for (const [key, rules] of Object.entries(overrides)) {
      if (key === 'custom' || key === 'auto') continue
      const merged = { ...(base[key] ?? {}), ...(rules && typeof rules === 'object' ? rules : {}) }
      if (rules && typeof rules === 'object' && rules.plugin) merged.plugin = { ...(base[key]?.plugin ?? {}), ...rules.plugin }
      if (rules && typeof rules === 'object' && rules.escalate) merged.escalate = { ...(base[key]?.escalate ?? {}), ...rules.escalate }
      out[key] = normalizeRules(key, merged)
    }
  }
  return out
}

export function gateText(value) {
  if (value === 'all') return '自动放行'
  if (value === 'trusted') return '仅受信'
  return '询问'
}

/** Ordered tier keys for /tiers and the panel. */
export function orderedTiers(tiers) {
  return Object.entries(tiers)
    .sort((left, right) => (left[1].rank ?? 0) - (right[1].rank ?? 0))
    .map(([key, rules]) => ({ key, rules }))
}
