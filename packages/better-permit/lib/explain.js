/**
 * Plain-language explanations for a pending approval.
 *
 * The dialog already shows the command, the working folder and the risk badge,
 * so an explanation must add judgement instead of repeating them: what the step
 * is for, what could go wrong, and why the active tier refused to answer it on
 * its own. With a reviewer model configured the sentence comes from that model;
 * otherwise it is composed from the risk grade — never from the command text.
 */

const SYSTEM_PROMPT = [
  '你是审批弹窗里的解释员。用户已经看到命令和风险等级，不要复述命令、不要引用代码、不要提规则表。',
  '用一句中文（不超过 40 字）说明：这步打算达成什么目的，最坏会失去什么。',
  '语气像同事提醒，不要客套，不要编号，不要 Markdown，不要引号，不要结尾句号之外的多余标点。',
  '如果从命令里看不出用途，就直接说按较高风险对待，并指出该盯住哪里。',
].join('\n')

/**
 * How serious a risk grade is, for the badge the dialog shows.
 * @param key - a risk key from the grader.
 * @returns `'safe'`, `'caution'` or `'danger'`.
 */
export function levelOf(key) {
  if (key === 'read') return 'safe'
  if (key === 'write') return 'caution'
  return 'danger'
}

/**
 * One analytical sentence per risk grade: consequence first, no command echo.
 * @param key - a risk key from the grader.
 * @returns the sentence describing what could be lost.
 */
export function analysisOf(key) {
  switch (key) {
    case 'read':
      return '只是读取信息，不会改动或删除任何东西。'
    case 'write':
      return '会在工作区内产生改动，可能覆盖同名文件；一般可以重来。'
    case 'destructive':
      return '会删除或覆盖已有内容，删掉的东西通常无法恢复。'
    case 'system':
      return '会改动系统层面的配置或系统目录，出错可能影响整台机器。'
    case 'outside':
      return '会动到工作区之外的文件，没有沙箱兜底。'
    case 'publish':
      return '会把内容发到外部（推送或上传），发出去就收不回。'
    default:
      return '从命令本身看不出用途，按较高风险对待，建议先确认它要动什么。'
  }
}

/**
 * Build the deterministic explanation: what could go wrong, then why it asks.
 * @param input - risk grade, active tier rules and the refusal detail.
 * @returns a short Chinese account that never repeats the command.
 */
export function localExplanation(input) {
  const risk = input?.risk
  const tier = input?.rules
  const lines = [analysisOf(risk?.key)]
  if (tier?.label) {
    const ceiling = tier.maxRiskLabel ?? tier.maxRisk
    lines.push(
      ceiling && ceiling !== '不自动放行'
        ? `当前档位「${tier.label}」只自动放行到「${ceiling}」这一档，所以来问你。`
        : `当前档位「${tier.label}」不放行这一类操作，所以来问你。`,
    )
  } else if (input?.detail) {
    lines.push('当前档位没有覆盖这一步，所以来问你。')
  }
  return lines.join('')
}

/** Keep a model answer to one short line. */
function clip(text, limit) {
  const value = typeof text === 'string' ? text.replace(/[\s]+/g, ' ').trim() : ''
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
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
        max_tokens: 120,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              `工具：${input?.tool ?? 'unknown'}`,
              `命令：${clip(input?.args?.command ?? '', 300) || '(不是 shell 命令)'}`,
              `工作目录：${input?.args?.cwd ?? input?.args?.workdir ?? '(默认)'}`,
              `风险等级：${input?.risk?.label ?? input?.risk?.key ?? 'unknown'}`,
              `该类风险的含义：${analysisOf(input?.risk?.key)}`,
              `档位：${input?.rules?.label ?? input?.tier ?? 'unknown'}，自动放行上限 ${input?.rules?.maxRiskLabel ?? '未知'}`,
            ].join('\n'),
          },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) return { sentence: '', reason: `HTTP ${response.status}` }
    const payload = await response.json()
    const raw = payload?.choices?.[0]?.message?.content
    const sentence = clip(typeof raw === 'string' ? raw : '', 120)
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
     * @returns `{ sentence, local, source, level, risk }`; `source` says who wrote `sentence`.
     */
    async explain(input) {
      const local = localExplanation(input)
      const level = levelOf(input?.risk?.key)
      const risk = input?.risk
        ? { key: input.risk.key, label: input.risk.label, hint: input.risk.hint }
        : undefined
      if (!configured()) return { sentence: local, local, source: 'local', level, risk }
      const answer = await askForSentence(config, input)
      if (!answer.sentence) {
        journal?.record?.({ at: Date.now(), tier: input?.tier, tool: input?.tool, category: 'explain', detail: `模型没有给出解释：${answer.reason}` })
        return { sentence: local, local, source: 'local', level, risk }
      }
      return { sentence: answer.sentence, local, source: 'model', level, risk }
    },
  }
}
