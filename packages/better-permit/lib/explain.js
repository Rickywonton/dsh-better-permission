/**
 * Plain-language explanations for a pending approval.
 *
 * Every dialog gets a deterministic Chinese account built from the call itself
 * (command, tool, risk grade, why the tier did not cover it). When the user has
 * configured a reviewer model, the same model is asked for one short Chinese
 * sentence about what the operation does and what could go wrong; a model that
 * is slow, unreachable, or chatty is ignored rather than allowed to block the
 * dialog.
 */

const SYSTEM_PROMPT = [
  '你是审批弹窗里的解释员。给你一次即将执行的工具调用及其风险等级。',
  '用一句中文（不超过 60 个字）说明：这步在做什么，最坏会有什么后果。',
  '只输出这一句话，不要编号、不要 Markdown、不要引号、不要复述命令全文。',
].join('\n')

/** Trim text for one-line display without cutting a surrogate pair. */
function clip(text, limit) {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
}

/**
 * Build the deterministic part of the explanation.
 * @param input - tool name, arguments, risk grade, tier rules and verdict.
 * @returns a short Chinese account that never depends on a model.
 */
export function localExplanation(input) {
  const risk = input?.risk
  const tier = input?.tier
  const rules = input?.rules
  const args = input?.args ?? {}
  const command = typeof args?.command === 'string' ? clip(args.command, 140) : ''
  const cwd = typeof args?.cwd === 'string' ? args.cwd : typeof args?.workdir === 'string' ? args.workdir : ''
  const lines = []
  if (command) lines.push(`这一步要执行的命令是「${command}」${cwd ? `，工作目录 ${cwd}` : ''}。`)
  else if (input?.tool && input.tool !== 'pwsh' && input.tool !== 'bash') lines.push(`这一步会调用工具「${input.tool}」${describeArgs(args)}。`)
  if (risk?.hint) lines.push(`风险等级是「${risk.label ?? risk.key}」：${risk.hint}`)
  if (Array.isArray(risk?.reasons) && risk.reasons.length > 0) lines.push(`判断依据：${risk.reasons.slice(0, 3).join('；')}。`)
  if (input?.detail) lines.push(`当前档位没有自动放行它（${input.detail}），所以来问你。`)
  else if (rules?.label) lines.push(`当前档位「${rules.label}」没有覆盖这一步，所以来问你。`)
  return lines.join('')
}

/** Describe a few tool arguments so a non-shell call still reads like a sentence. */
function describeArgs(args) {
  if (args === null || typeof args !== 'object') return ''
  const keys = Object.keys(args).slice(0, 3).map((key) => {
    const value = args[key]
    const shown = typeof value === 'string' ? clip(value, 60) : Array.isArray(value) ? `${value.length} 项` : typeof value
    return `${key}=${shown}`
  })
  return keys.length === 0 ? '' : `（${keys.join('，')}）`
}

/**
 * Ask the reviewer model for one explanatory sentence.
 * @param config - reviewer config (baseUrl, model, apiKey, apiKeyEnv, timeoutMs).
 * @param input - the pending operation.
 * @returns `{ sentence, reason }`; `sentence` is empty when unavailable.
 */
export async function askForSentence(config, input) {
  if (!config?.baseUrl || !config?.model) return { sentence: '', reason: 'not configured' }
  const key = config.apiKey || (config.apiKeyEnv ? process.env[config.apiKeyEnv] : '')
  if (!key) return { sentence: '', reason: 'no api key' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1500, Math.min(config.timeoutMs ?? 8000, 6000)))
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 160,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              `工具：${input?.tool ?? 'unknown'}`,
              `命令：${clip(input?.args?.command ?? '', 300) || '(不是 shell 命令)'}`,
              `工作目录：${input?.args?.cwd ?? input?.args?.workdir ?? '(默认)'}`,
              `风险等级：${input?.risk?.label ?? input?.risk?.key ?? 'unknown'}`,
              `风险说明：${input?.risk?.hint ?? ''}`,
              `判断依据：${(input?.risk?.reasons ?? []).join('；') || '(无)'}`,
              `档位「${input?.rules?.label ?? input?.tier ?? 'unknown'}」没有自动放行它。`,
            ].join('\n'),
          },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) return { sentence: '', reason: `HTTP ${response.status}` }
    const payload = await response.json()
    const raw = payload?.choices?.[0]?.message?.content
    const sentence = clip(typeof raw === 'string' ? raw : '', 160)
    return { sentence, reason: sentence ? 'ok' : 'empty answer' }
  } catch (error) {
    return { sentence: '', reason: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Create the explanation service used by the approval detail endpoint.
 * @param options - reviewer config and a journal for failed probes.
 * @returns `{ configured, explain }`.
 */
export function createExplainer({ config, journal }) {
  const configured = () => Boolean(config?.baseUrl && config?.model)
  return {
    configured,
    /**
     * Explain one pending call in Chinese.
     * @param input - tool, arguments, risk grade, tier rules and verdict detail.
     * @returns `{ sentence, local, source }`; `source` says who wrote `sentence`.
     */
    async explain(input) {
      const local = localExplanation(input)
      if (!configured()) return { sentence: local, local, source: 'local' }
      const answer = await askForSentence(config, input)
      if (!answer.sentence) {
        journal?.record?.({ at: Date.now(), tier: input?.tier, tool: input?.tool, category: 'explain', detail: `模型没有给出解释：${answer.reason}` })
        return { sentence: local, local, source: 'local' }
      }
      return { sentence: answer.sentence, local, source: 'model' }
    },
  }
}
