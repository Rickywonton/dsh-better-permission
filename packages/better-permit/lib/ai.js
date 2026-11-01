/**
 * The optional reviewer model.
 *
 * The user supplies their own OpenAI-compatible endpoint (base URL, model,
 * key). It is only consulted by tiers that set `ai: true`, and only for
 * operations the deterministic rules refused — never for sandbox escalations,
 * never for a level listed in `alwaysAsk`.
 *
 * Everything here is fail-closed: a timeout, a non-2xx answer, a broken body or
 * a reply that is not the expected JSON shape all mean "ask the user".
 */

const SYSTEM_PROMPT = [
  'You are a security reviewer inside a coding agent.',
  'You are given one operation the agent wants to run, the risk level a deterministic grader',
  'assigned to it, and the user\'s own record of what they allowed or refused before.',
  'Decide whether the agent may run this operation without asking the user right now.',
  'Be strict: anything that can destroy unrelated data, touch the operating system, publish or',
  'exfiltrate content, spend money, or is impossible to undo must be refused.',
  'Be practical: ordinary work inside the workspace (running tests, editing project files,',
  'installing a dependency the project already lists, inspecting state) may be allowed.',
  'Answer with JSON only, no prose, in this exact shape:',
  '{"verdict":"allow"|"ask","confidence":0.0,"reason":"one short sentence"}',
].join(' ')

function trimArgs(args) {
  if (!args || typeof args !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') out[key] = value.length > 400 ? value.slice(0, 400) + '…' : value
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
    else if (Array.isArray(value)) out[key] = value.slice(0, 10)
    else if (value && typeof value === 'object') out[key] = '[object]'
  }
  return out
}

function joinUrl(baseUrl, path) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '')
  return `${base}${path}`
}

export function createAiGrader({ config, journal, habits }) {
  const settings = config
  let lastCall = { at: 0, ms: 0, ok: false, reason: '' }

  function apiKey() {
    if (typeof settings.apiKey === 'string' && settings.apiKey.length > 0) return settings.apiKey
    const name = typeof settings.apiKeyEnv === 'string' && settings.apiKeyEnv ? settings.apiKeyEnv : ''
    if (!name) return ''
    const value = process.env[name]
    return typeof value === 'string' ? value : ''
  }

  function configured() {
    return typeof settings.baseUrl === 'string' && settings.baseUrl.length > 0 && typeof settings.model === 'string' && settings.model.length > 0 && apiKey().length > 0
  }

  function status() {
    return {
      configured: configured(),
      baseUrl: settings.baseUrl ?? '',
      model: settings.model ?? '',
      keySource: typeof settings.apiKey === 'string' && settings.apiKey ? 'config' : apiKey() ? `env:${settings.apiKeyEnv}` : 'none',
      timeoutMs: settings.timeoutMs,
      minConfidence: settings.minConfidence,
      lastCall,
    }
  }

  function habitLines(limit) {
    try {
      const entries = habits?.summary?.(limit) ?? []
      return entries.map((entry) => ({
        command: entry.signature,
        allowed: entry.allow,
        refused: entry.block,
        last: entry.last ? new Date(entry.last).toISOString().slice(0, 10) : undefined,
      }))
    } catch {
      return []
    }
  }

  function buildPayload({ tool, args, risk, tier, rules }) {
    return {
      tool,
      arguments: trimArgs(args),
      risk: {
        level: risk?.key,
        label: risk?.label,
        reasons: Array.isArray(risk?.reasons) ? risk.reasons.slice(0, 6) : [],
      },
      tier: {
        key: tier,
        label: rules?.label,
        autoAllowCeiling: rules?.maxRisk,
        alwaysAsk: rules?.alwaysAsk ?? [],
      },
      userHabits: habitLines(settings.maxHabits),
      instructions: 'Return JSON only: {"verdict":"allow"|"ask","confidence":<0..1>,"reason":"<short>"}',
    }
  }

  function parseVerdict(text) {
    if (typeof text !== 'string') return undefined
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return undefined
    let parsed
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      return undefined
    }
    const verdict = parsed?.verdict === 'allow' ? 'allow' : parsed?.verdict === 'ask' ? 'ask' : undefined
    if (!verdict) return undefined
    const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : 0
    return { verdict, confidence: Math.max(0, Math.min(1, confidence)), reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : '' }
  }

  async function post(payload) {
    const key = apiKey()
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs)
    try {
      const response = await fetch(joinUrl(settings.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0,
          max_tokens: settings.maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
        signal: controller.signal,
      })
      const text = await response.text()
      const ms = Date.now() - started
      if (!response.ok) {
        lastCall = { at: Date.now(), ms, ok: false, reason: `HTTP ${response.status}` }
        return { ok: false, reason: `HTTP ${response.status}`, text: text.slice(0, 300), ms }
      }
      lastCall = { at: Date.now(), ms, ok: true, reason: '' }
      return { ok: true, text, ms }
    } catch (error) {
      const ms = Date.now() - started
      const reason = error?.name === 'AbortError' ? `timeout after ${settings.timeoutMs}ms` : String(error?.message ?? error)
      lastCall = { at: Date.now(), ms, ok: false, reason }
      return { ok: false, reason, ms }
    } finally {
      clearTimeout(timer)
    }
  }

  function contentOf(body) {
    try {
      const parsed = JSON.parse(body)
      const content = parsed?.choices?.[0]?.message?.content
      return typeof content === 'string' ? content : undefined
    } catch {
      return undefined
    }
  }

  /** Ask the model about one operation. Never throws. */
  async function review({ tool, args, risk, tier, rules }) {
    if (!configured()) return { verdict: 'ask', reason: '评审模型未配置（缺 baseUrl / model / API key）', configured: false, ms: 0 }
    const payload = buildPayload({ tool, args, risk, tier, rules })
    const answer = await post(payload)
    if (!answer.ok) return { verdict: 'ask', reason: `评审模型不可用：${answer.reason}`, configured: true, ms: answer.ms }
    const verdict = parseVerdict(contentOf(answer.text))
    if (!verdict) return { verdict: 'ask', reason: '评审模型没有返回可解析的结论', configured: true, ms: answer.ms }
    if (verdict.verdict === 'allow' && verdict.confidence < settings.minConfidence) {
      return { verdict: 'ask', confidence: verdict.confidence, reason: `模型把握不足（${Math.round(verdict.confidence * 100)}%）：${verdict.reason}`, configured: true, ms: answer.ms }
    }
    return { ...verdict, configured: true, ms: answer.ms, model: settings.model }
  }

  /** One cheap round trip so the settings panel can prove the endpoint works. */
  async function test() {
    if (!configured()) return { ok: false, error: '缺 baseUrl / model / API key' }
    const answer = await post({
      tool: 'probe',
      arguments: { command: 'git status' },
      risk: { level: 'read', label: '只读', reasons: ['probe'] },
      tier: { key: 'probe', label: 'probe', autoAllowCeiling: 'read', alwaysAsk: [] },
      userHabits: [],
      instructions: 'This is a connectivity probe. Return {"verdict":"allow","confidence":1,"reason":"probe"}.',
    })
    if (!answer.ok) return { ok: false, error: answer.reason, ms: answer.ms }
    const verdict = parseVerdict(contentOf(answer.text))
    if (!verdict) return { ok: false, error: 'unparsable reply', ms: answer.ms, raw: String(answer.text ?? '').slice(0, 300) }
    return { ok: true, ms: answer.ms, verdict }
  }

  return { configured, status, review, test }
}
