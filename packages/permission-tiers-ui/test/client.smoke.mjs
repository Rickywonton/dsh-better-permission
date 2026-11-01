/**
 * Client bundle smoke test: load `client.js` the way the browser module loader
 * does, run the plugin body against a stub Cordis context, then render the
 * settings panel and the approval detail with a small hooks engine so the
 * sections that need host data actually render.
 *
 * Run with `node test/client.smoke.mjs` (plain node — the sandbox refuses the
 * child processes `node --test` needs).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

let failures = 0
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

// --- minimal hooks engine -------------------------------------------------

const stores = new Map()
let hooks = []
let cursor = 0
let pending = []

function begin(component) {
  let store = stores.get(component)
  if (!store) {
    store = { hooks: [] }
    stores.set(component, store)
  }
  hooks = store.hooks
  cursor = 0
  pending = []
}

function shallowEqual(left, right) {
  if (!left || !right) return left === right
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) }
  },
  useState(initial) {
    const slot = cursor++
    if (!hooks[slot]) hooks[slot] = { value: typeof initial === 'function' ? initial() : initial }
    const entry = hooks[slot]
    const set = (next) => {
      entry.value = typeof next === 'function' ? next(entry.value) : next
    }
    return [entry.value, set]
  },
  useEffect(effect, deps) {
    const slot = cursor++
    if (!hooks[slot]) hooks[slot] = { mounted: false, deps: undefined, cleanup: undefined }
    const entry = hooks[slot]
    if (!entry.mounted || !shallowEqual(entry.deps, deps)) {
      entry.mounted = true
      entry.deps = deps
      pending.push(() => {
        entry.cleanup = effect()
      })
    }
  },
  useMemo(factory, deps) {
    const slot = cursor++
    if (!hooks[slot]) hooks[slot] = { mounted: false, deps: undefined, value: undefined }
    const entry = hooks[slot]
    if (!entry.mounted || !shallowEqual(entry.deps, deps)) {
      entry.mounted = true
      entry.deps = deps
      entry.value = factory()
    }
    return entry.value
  },
  useCallback(callback, deps) {
    const slot = cursor++
    if (!hooks[slot]) hooks[slot] = { mounted: false, deps: undefined, value: undefined }
    const entry = hooks[slot]
    if (!entry.mounted || !shallowEqual(entry.deps, deps)) {
      entry.mounted = true
      entry.deps = deps
      entry.value = callback
    }
    return entry.value
  },
  useRef(value) {
    const slot = cursor++
    if (!hooks[slot]) hooks[slot] = { current: value }
    return hooks[slot]
  },
}

async function render(component, props) {
  let tree
  for (let pass = 0; pass < 5; pass += 1) {
    begin(component)
    tree = component(props)
    const queued = pending
    pending = []
    for (const run of queued) run()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return tree
}

// --- module load ----------------------------------------------------------

let descriptor
const window = {
  __ModuleLoader__: {
    load(loaded) {
      descriptor = loaded
    },
  },
}
const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error(`client bundle required an unexpected module: ${name}`)
}
new Function('window', 'require', source)(window, requireStub)

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node !== 'object') return ''
  if (typeof node.type === 'function') {
    // A plain function component: render its output to see the text it adds.
    const inner = renderSync(node.type, withChildren(node))
    return [textOfProps(node.props), textOf(inner)].join(' ')
  }
  return [textOfProps(node.props), node.children.map(textOf).join(' ')].join(' ')
}

function textOfProps(props) {
  return Object.values(props ?? {})
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map(String)
    .join(' ')
}

function withChildren(node) {
  return Object.assign({}, node.props ?? {}, { children: node.children })
}

function renderSync(component, props) {
  begin(component)
  const tree = component(props)
  const queued = pending
  pending = []
  for (const run of queued) run()
  return tree
}

check('module id', descriptor.id, 'dsh-permission-tiers-ui')
const plugin = descriptor.factory(requireStub)
check('declared services', plugin.inject, ['slots', 'locale'])

const slots = []
const effects = []
const ctx = {
  effect(effect, label) {
    effects.push(label)
    const dispose = effect()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
    getSnapshot: () => ({ active: 'zh', locales: [], revision: 1 }),
  },
  slots: {
    inject(name, callback) {
      callback()
    },
    register(options, component) {
      slots.push({ options, component })
      return () => {}
    },
  },
}
plugin.apply(ctx)

check('two slots are registered', slots.length, 2)
check('the approval detail slot is taken over', slots[0].options.name, 'conversation.approval.detail')
check('the settings section is registered', slots[1].options.name, 'settings.section')
check('the section keeps its own id', slots[1].options.id, 'permission-tiers')
check('the section carries its locale namespace', slots[1].options.locale, 'permission-tiers')
check('the section label resolves through the dictionary', slots[1].options.label(), 'nav')
check('the panel dictionaries are registered once', effects.length, 1)

const injected = slots[1].options.inject()
check('the panel can borrow the directory picker', typeof injected.pick, 'function')

// --- render the panel with host data -------------------------------------

const panelBody = {
  base: 'D:\\ws',
  global: ['D:\\ws\\shared'],
  conversations: [{ id: 'c-one', folders: ['D:\\ws\\proj'], at: 1 }],
  configured: { paths: [], commands: ['npm install'], packages: [] },
  recent: [],
  riskHints: {
    read: '只读取信息',
    write: '会改动文件',
    destructive: '会删除或覆盖已有文件',
    system: '会触碰系统配置',
    outside: '会动工作区外的文件',
    publish: '会把内容发到外部',
    unknown: '规则表认不出这条命令',
  },
  tiers: [
    {
      key: 'workspace-write-safe',
      label: '工作区内 · 只读命令',
      description: '只读命令自动放行',
      maxRisk: 'read',
      maxRiskLabel: '只读',
      alwaysAsk: [],
      plugin: { read: true },
      escalate: { 'workspace-write': 'off', 'danger-full-access': 'off' },
      otherAsks: false,
    },
    {
      key: 'workspace-write-guarded',
      label: '工作区内 · 高危才问',
      description: '写入自动，高危才问',
      maxRisk: 'destructive',
      maxRiskLabel: '删除 / 覆盖',
      alwaysAsk: ['system', 'publish', 'unknown'],
      plugin: { read: true, install: 'trusted' },
      escalate: { 'workspace-write': 'all', 'danger-full-access': 'all' },
      otherAsks: true,
    },
  ],
  rules: [{ id: 'c-one', rules: [{ pattern: 'git status', kind: 'command', at: 1 }], at: 1 }],
}

const fetchCalls = []
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init })
  return { ok: true, status: 200, json: async () => panelBody }
}

const panelTree = await render(slots[1].component, {
  t: (key) => key,
  useSessions: (selector) => selector({
    ids: ['c-one'],
    byId: { 'c-one': { displayTitle: '测试对话' } },
    phase: 'ready',
    projectionsBySession: {},
  }),
  pick: injected.pick,
})

check('the panel renders a tree', typeof panelTree, 'object')
check('the panel renders a heading', panelTree.children[0].type, 'h2')
check('the panel asked the host for its data', fetchCalls.some((call) => String(call.url).endsWith('/panel')), true)

const text = textOf(panelTree)
for (const key of [
  'title',
  'intro',
  'tierTitle',
  'riskTitle',
  'globalTitle',
  'sessionTitle',
  'rulesTitle',
  'configuredTitle',
  'recentTitle',
]) {
  check(`the panel renders ${key}`, text.includes(key), true)
}
check('the tier table lists the lowest tier', text.includes('工作区内 · 只读命令'), true)
check('the tier table lists the guarded tier', text.includes('工作区内 · 高危才问'), true)
check('the tier table spells out the risk ceiling', text.includes('ceiling'), true)
check('the risk legend explains a category', text.includes('只读取信息'), true)
check('the rules card lists a conversation rule', text.includes('git status'), true)
check('the rules card offers removal', text.includes('ruleRemove'), true)
check('the panel shows the configured lists', text.includes('commandsLabel'), true)
check('the global folder is listed', text.includes('D:\\ws\\shared'), true)

// --- approval detail renders the grade and both shortcuts ---------------

const answerCalls = []
const approvalProps = {
  callId: 'call-1',
  sessionId: 'c-one',
  useSessionStatus: (selector) =>
    selector(
      new Map([
        [
          'c-one',
          { pendingInteraction: { kind: 'approval', answerable: true, answer: (outcome) => answerCalls.push(outcome) } },
        ],
      ]),
    ),
}

globalThis.fetch = async (url) => {
  if (String(url).includes('/detail')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tool: 'pwsh',
        command: 'git status',
        cwd: 'D:\\ws',
        folders: ['D:\\ws'],
        risk: { key: 'read', label: '只读', hint: '只读取信息', reasons: [] },
        signature: 'git status',
        tier: { key: 'workspace-write-plugins', label: '工作区内 · 插件免批准', maxRisk: 'read', maxRiskLabel: '只读', alwaysAsk: [] },
        rule: null,
        covered: false,
      }),
    }
  }
  return { ok: true, status: 200, json: async () => ({ pattern: 'git status', rules: [] }) }
}

const detailTree = await render(slots[0].component, approvalProps)
const detailText = textOf(detailTree)
check('the approval detail renders the command', detailText.includes('git status'), true)
check('the approval detail renders the risk grade', detailText.includes('风险'), true)
check('the approval detail renders the risk label', detailText.includes('只读 · 只读取信息'), true)
check('the approval detail explains why the tier asked', detailText.includes('自动放行上限'), true)
check('the approval detail offers a conversation rule', detailText.includes('本对话总是允许这条命令'), true)
check('the approval detail keeps the folder shortcut', detailText.includes('信任此文件夹'), true)

function buttonsOf(node, found = []) {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    node.forEach((child) => buttonsOf(child, found))
    return found
  }
  if (node.type === 'button') found.push(node)
  node.children.forEach((child) => buttonsOf(child, found))
  return found
}

const buttons = buttonsOf(detailTree)
check('the approval detail renders two buttons', buttons.length, 2)
buttons[0].props.onClick({ preventDefault() {}, stopPropagation() {} })
await new Promise((resolve) => setTimeout(resolve, 0))
check('the rule button allows this call once', answerCalls, ['allowed-once'])
buttons[1].props.onClick({ preventDefault() {}, stopPropagation() {} })
await new Promise((resolve) => setTimeout(resolve, 0))
check('the folder button allows this call once', answerCalls, ['allowed-once', 'allowed-once'])

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
