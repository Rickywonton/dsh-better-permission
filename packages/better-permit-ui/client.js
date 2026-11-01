/**
 * Client half of the permission-tier plugin.
 *
 * Two contributions:
 *  - `conversation.approval.detail`: the shipped detail area only shows the shell
 *    command under review; this one shows the same command plus one action —
 *    trust the folder the pending operation targets for the rest of the
 *    conversation, then allow this call.
 *  - `settings.section`: one page that lists and edits every trusted folder, the
 *    global list and each conversation's list, with a trust overview.
 */
const API = '/better-permit/approval'

window.__ModuleLoader__.load({
  id: 'better-permit-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/better-permit/approval'
    const NS = 'better-permit'


    const zh = {
      nav: '权限与信任',
      title: '权限与信任',
      intro:
        '受信文件夹只放宽「工作区内」沙箱提权：对受信文件夹内的普通命令和文件改动，受信档位会自动放行；它不会让插件获得完全访问权限。卸载插件、版本豁免和安装脚本在任何档位下都会询问。',
      tierTitle: '档位与自动放行范围',
      tierHint: '从窄到宽排列。「自动放行上限」是本档位愿意自己批准的风险上限，超过它就一定问你；「始终询问」列出即使在上限内也不放行的风险。',
      riskTitle: '风险分级',
      riskHint: '按指令内容判断，越靠下越危险；识别不出的命令按最危险处理。',
      currentTier: '当前档位',
      rulesTitle: '本对话放行规则',
      rulesHint: '在审批弹窗里点「本对话总是允许」会加一条规则；只对该对话生效，换对话就从零开始，也不会改变档位。',
      noRules: '这个对话还没有放行规则。',
      loading: '正在加载…',
      ruleRemove: '移除',
      ruleClear: '清空',
      globalTitle: '所有对话通用',
      globalHint: '这里的文件夹对所有对话生效，保存在 Harness 的本地存储里。',
      sessionTitle: '单个对话',
      sessionHint: '只对这个对话生效，等价于在审批弹窗里点「信任此文件夹」。',
      overviewTitle: '各对话的受信文件夹',
      overviewHint: '逐个移除，或切到「单个对话」里添加。',
      configuredTitle: '配置里的信任清单',
      configuredHint: '来自插件的 profile 配置（cordis.patch.yml）；要改这些条目请编辑配置后重载插件。',
      recentTitle: '最近自动放行',
      recentHint: '受信档位直接放行的审批请求；空表示尚未放行过。',
      empty: '暂无受信文件夹',
      emptyRecent: '暂无记录',
      add: '添加',
      browse: '浏览…',
      remove: '移除',
      clear: '清空',
      placeholder: '文件夹的绝对路径，例如 D:\\projects\\demo',
      pickSession: '选择对话',
      base: '工作区根目录',
      failed: '操作失败：',
      added: '已添加',
      noSessions: '还没有对话。',
      commandsLabel: '受信命令',
      packagesLabel: '受信包',
      pathsLabel: '受信路径',
      none: '（未配置）',
      removeConfirm: '移除后，这个文件夹里的操作在受信档位下会重新询问。',
      riskPrefix: '风险',
      ceiling: '自动放行上限',
      alwaysAskLabel: '始终询问',
      allowCommand: '本对话总是允许这条命令',
      allowBusy: '正在记录…',
      allowDone: '已加进本对话放行规则',
      ruleExists: '这条命令已在本对话放行',
      covered: '本档位本应自动放行',
      pluginScope: '插件',
      escalateScope: '提权',
      otherAsksScope: '其它',
      aiTitle: '评审模型',
      aiHint: '「AI 判定」档位会先把命令交给这个模型看一眼；模型只给建议，最终仍由档位规则决定。',
      aiMissing: '还没有配置评审模型。请在插件配置里填 ai.baseUrl、ai.model，以及 ai.apiKey 或 ai.apiKeyEnv；缺这些时「AI 判定」档位会退回逐个询问你。',
      aiModel: '模型',
      aiBase: '接口地址',
      aiKey: '密钥来源',
      aiTimeout: '超时',
      aiThreshold: '置信度下限',
      aiLastCall: '上次探测',
      aiOk: '成功',
      aiFailed: '失败',
      aiTest: '测试连接',
      aiTesting: '正在测试…',
      aiTestOk: '连接正常',
      aiTestEmpty: '没有拿到结果',
      keyConfig: '配置文件',
      keyEnv: '环境变量',
      holdTitle: '审批等待',
      holdHint: '超时后这一次操作会暂缓，模型会被告知改走其它步骤；这个值来自插件配置里的 holdMs。',
      holdLimited: '超过 %s 秒未回答即暂缓该操作，并让模型改走其它步骤',
      holdForever: '不限时，会一直等你回答',
      habitsTitle: '审批习惯',
      habitsHint: '按签名统计你过去允许或拦下的操作；生成 skill 后，模型会先读它再决定怎么请求批准。',
      habitsEmpty: '（暂无记录）',
      habitsSig: '签名',
      habitsAllowCount: '允许',
      habitsBlockCount: '拦下',
      habitsRisk: '风险',
      habitsLast: '最近',
      skillLine: 'skill 文件',
      skillExists: '已生成',
      skillMissing: '未生成',
      skillGenerate: '生成 / 更新 skill',
      skillBusy: '正在生成…',
      skillDone: '已写入',
      aiBadge: 'AI 判定',
      aiDetailAsk: '本档位会先问评审模型 %s（置信度 ≥ %s）再决定是否打扰你',
  explainAi: '评审模型的解释',
  explainLocal: '这一步在做什么',
  reportsTitle: '每轮自动放行报告',
  reportsCount: '共 %s 次自动放行',
  reportsHint: 'AI 判定档位下，每轮对话结束时会把这一轮自动放行的审批汇总成一条报告写进对话；这里保留最近几条。',
  noReports: '这一轮还没有自动放行记录。',
      aiDetailDirect: '评审模型未配置：本档位会直接问你',
    }

    const en = {
      nav: 'Permissions',
      title: 'Permissions',
      intro:
        'Trusted folders only widen the "workspace" sandbox escalation: plain commands and file changes inside them are auto-approved on the trusted tiers. They never grant full access. Removing a plugin, version exemptions, and install scripts always ask.',
      tierTitle: 'Tiers and what they approve',
      tierHint: 'Narrow to wide. "Ceiling" is the most dangerous operation the tier approves on its own; anything above it always asks. "Always asks" lists levels it refuses even below the ceiling.',
      riskTitle: 'Risk levels',
      riskHint: 'Graded from the command itself. Anything unrecognisable is treated as the most dangerous.',
      currentTier: 'Current tier',
      rulesTitle: 'Rules for this conversation',
      rulesHint: '"Always allow" in the approval prompt adds one. It only applies to that conversation, and never changes the tier.',
      noRules: 'No rules in this conversation yet.',
      loading: 'Loading…',
      ruleRemove: 'Remove',
      ruleClear: 'Clear',
      globalTitle: 'All conversations',
      globalHint: 'These folders apply to every conversation and live in the Harness local store.',
      sessionTitle: 'One conversation',
      sessionHint: 'Applies to this conversation only — the same as the approval prompt button.',
      overviewTitle: 'Per-conversation folders',
      overviewHint: 'Remove entries here, or add them in the section above.',
      configuredTitle: 'Configured trust lists',
      configuredHint: 'From the plugin profile config (cordis.patch.yml); edit the config and reload the plugin to change them.',
      recentTitle: 'Recent auto-approvals',
      recentHint: 'Approval requests the active tier answered itself. Empty means none yet.',
      empty: 'No trusted folders yet',
      emptyRecent: 'No entries yet',
      add: 'Add',
      browse: 'Browse…',
      remove: 'Remove',
      clear: 'Clear',
      placeholder: 'Absolute folder path, e.g. D:\\projects\\demo',
      pickSession: 'Conversation',
      base: 'Workspace root',
      failed: 'Failed: ',
      added: 'Added',
      noSessions: 'No conversations yet.',
      commandsLabel: 'Trusted commands',
      packagesLabel: 'Trusted packages',
      pathsLabel: 'Trusted paths',
      none: '（none）',
      removeConfirm: 'After removal, operations inside this folder ask again on the trusted tiers.',
      riskPrefix: 'risk',
      ceiling: 'Ceiling',
      alwaysAskLabel: 'always asks',
      allowCommand: 'Always allow this command here',
      allowBusy: 'Recording…',
      allowDone: 'Added to this conversation',
      ruleExists: 'This command is already allowed here',
      covered: 'This tier approves it on its own',
      pluginScope: 'plugins',
      escalateScope: 'escalation',
      otherAsksScope: 'other',
      aiTitle: 'Review model',
      aiHint: 'The "AI verdict" tier asks this model to look at a command first; the model only advises, and the tier rules still decide.',
      aiMissing: 'No review model yet. Set ai.baseUrl and ai.model in the plugin config, plus ai.apiKey or ai.apiKeyEnv; without them the "AI verdict" tier falls back to asking you one by one.',
      aiModel: 'Model',
      aiBase: 'Endpoint',
      aiKey: 'Key source',
      aiTimeout: 'Timeout',
      aiThreshold: 'Confidence floor',
      aiLastCall: 'Last probe',
      aiOk: 'ok',
      aiFailed: 'failed',
      aiTest: 'Test connection',
      aiTesting: 'Testing…',
      aiTestOk: 'Connected',
      aiTestEmpty: 'No result',
      keyConfig: 'config file',
      keyEnv: 'env',
      holdTitle: 'Approval wait',
      holdHint: 'When the wait runs out the operation is deferred and the model is told to take another path; the value comes from holdMs in the plugin config.',
      holdLimited: 'Not answered within %s s: hold the operation back and let the model take another step',
      holdForever: 'No timeout — it waits for your answer',
      habitsTitle: 'Approval habits',
      habitsHint: 'What you allowed or blocked per signature; once the skill is generated the model reads it before asking.',
      habitsEmpty: '(no entries yet)',
      habitsSig: 'Signature',
      habitsAllowCount: 'allowed',
      habitsBlockCount: 'blocked',
      habitsRisk: 'risk',
      habitsLast: 'last',
      skillLine: 'skill file',
      skillExists: 'generated',
      skillMissing: 'missing',
      skillGenerate: 'Generate / update skill',
      skillBusy: 'Generating…',
      skillDone: 'Written',
      aiBadge: 'AI verdict',
      aiDetailAsk: 'This tier asks the review model %s first (confidence ≥ %s) before deciding whether to bother you',
  explainAi: 'Review model explanation',
  explainLocal: 'What this step does',
  reportsTitle: 'Per-turn auto-approval report',
  reportsCount: '%s auto-approved',
  reportsHint: 'On the AI tier, each turn ends by appending one report of the approvals it answered for you; the latest ones stay here.',
  noReports: 'Nothing has been auto-approved in this turn yet.',
      aiDetailDirect: 'Review model not configured: this tier asks you directly',
    }

    const T = { zh, en }

    const panel = { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '760px', color: 'var(--dsw-alias-label-primary)' }
    const titleStyle = { margin: 0, fontSize: '18px', fontWeight: 600, lineHeight: '26px' }
    const introStyle = { margin: 0, fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' }
    const card = {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '12px 14px',
      borderRadius: '10px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
    }
    const cardTitle = { margin: 0, fontSize: '14px', fontWeight: 600, lineHeight: '22px' }
    const hintStyle = { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }
    const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12px', lineHeight: '18px' }
    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 8px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-base)',
    }
    const pathStyle = Object.assign({}, mono, { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
    const buttonStyle = {
      appearance: 'none',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      borderRadius: '8px',
      padding: '4px 10px',
      fontSize: '12px',
      lineHeight: '18px',
      cursor: 'pointer',
      flex: '0 0 auto',
    }
    const primaryButton = Object.assign({}, buttonStyle, { background: 'var(--dsw-alias-brand-primary)', borderColor: 'var(--dsw-alias-brand-primary)', color: '#fff' })
    const disabledButton = { opacity: 0.55, cursor: 'default' }
    const quietButton = {
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      borderRadius: '6px',
      padding: '3px 8px',
      fontSize: '11px',
      lineHeight: '16px',
      cursor: 'pointer',
      flex: '0 0 auto',
    }
    const inputStyle = {
      flex: '1 1 auto',
      minWidth: 0,
      padding: '5px 8px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '12px',
      lineHeight: '18px',
      outline: 'none',
    }
    const selectStyle = Object.assign({}, inputStyle, { flex: '0 1 280px' })
    const errorStyle = { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' }
    const emptyStyle = { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }
    const infoStyle = Object.assign({}, mono, {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      color: 'var(--dsw-alias-label-secondary)',
    })
    const badgeStyle = {
      display: 'inline-block',
      padding: '0 6px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '11px',
      lineHeight: '16px',
      flex: '0 0 auto',
    }
    const habitHeadStyle = {
      display: 'flex',
      gap: '6px',
      alignItems: 'baseline',
      padding: '0 8px',
      fontSize: '11px',
      lineHeight: '16px',
      color: 'var(--dsw-alias-label-tertiary)',
    }
    const habitSignStyle = Object.assign({}, mono, {
      flex: '1 1 auto',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      color: 'var(--dsw-alias-label-primary)',
    })
    const habitCountStyle = {
      flex: '0 0 auto',
      minWidth: '48px',
      textAlign: 'right',
      fontSize: '11px',
      lineHeight: '16px',
      color: 'var(--dsw-alias-label-secondary)',
    }

    function Section(props) {
      return h(
        'section',
        { style: card },
        h('h3', { style: cardTitle }, props.title),
        props.hint ? h('p', { style: hintStyle }, props.hint) : null,
        props.children,
      )
    }

    function FolderList(props) {
      if (props.folders.length === 0) return h('p', { style: emptyStyle }, props.empty)
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        props.folders.map((folder) =>
          h(
            'div',
            { key: folder, style: rowStyle },
            h('span', { style: pathStyle, title: folder }, folder),
            h(
              'button',
              {
                type: 'button',
                style: props.busy ? Object.assign({}, buttonStyle, disabledButton) : buttonStyle,
                disabled: props.busy,
                title: props.removeHint,
                onClick: () => props.onRemove(folder),
              },
              props.removeLabel,
            ),
          ),
        ),
      )
    }

    function ApprovalDetail(props) {
      const t = (key) => (zh[key] !== undefined ? zh[key] : key)
      const callId = props.callId
      const sessionId = props.sessionId
      const statusMap = typeof props.useSessionStatus === 'function' ? props.useSessionStatus(selectAll) : undefined
      const [detail, setDetail] = React.useState(null)
      const [state, setState] = React.useState('idle')
      const [ruleState, setRuleState] = React.useState('idle')
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        if (!callId) return undefined
        let alive = true
        fetch(`${API}/detail?sessionId=${encodeURIComponent(sessionId ?? '')}&callId=${encodeURIComponent(callId)}`)
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => {
            if (alive && data) setDetail(data)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [callId, sessionId])

      if (!detail) return null
      const folders = Array.isArray(detail.folders) ? detail.folders : []
      const command = typeof detail.command === 'string' && detail.command.trim() ? detail.command : null
      if (!command && folders.length === 0) return null

      const folder = folders[0]
      const label =
        state === 'done'
          ? `已信任本对话：${folder}`
          : state === 'busy'
            ? '正在设置…'
            : folder
              ? '信任此文件夹并允许本次（仅本对话）'
              : '信任此文件夹（仅本对话）'

      async function trust() {
        setState('busy')
        setError('')
        try {
          const response = await fetch(`${API}/trust`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, callId }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setState('done')
          const pending = pendingApprovalOf(statusMap, sessionId)
          if (pending && pending.answerable !== false && typeof pending.answer === 'function') {
            await pending.answer('allowed-once')
          } else {
            setError('已设为受信文件夹，请点「允许」执行本次操作。')
          }
        } catch (cause) {
          setState('idle')
          setError(`设置失败：${cause && cause.message ? cause.message : String(cause)}`)
        }
      }

      async function alwaysAllow() {
        setRuleState('busy')
        setError('')
        try {
          const response = await fetch(`${API}/allow`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, callId }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`)
          setDetail(Object.assign({}, detail, { rule: (payload && payload.pattern) || detail.signature }))
          setRuleState('done')
          const pending = pendingApprovalOf(statusMap, sessionId)
          if (pending && pending.answerable !== false && typeof pending.answer === 'function') {
            await pending.answer('allowed-once')
          } else {
            setError('已记入本对话放行规则，请点「允许」执行本次操作。')
          }
        } catch (cause) {
          setRuleState('idle')
          setError(`记录失败：${cause && cause.message ? cause.message : String(cause)}`)
        }
      }

      const commandStyle = Object.assign({}, mono, {
        margin: 0,
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: '180px',
        overflow: 'auto',
      })

      const risk = detail.risk
      const riskLine = risk
        ? `${t('riskPrefix')}：${risk.label}${risk.hint ? ` · ${risk.hint}` : ''}`
        : ''
      const explain = detail.explain && typeof detail.explain === 'object' ? detail.explain : null
      const explainLine = explain && typeof explain.sentence === 'string' && explain.sentence.length > 0
        ? `${explain.source === 'model' ? t('explainAi') : t('explainLocal')}：${explain.sentence}`
        : ''
      const tierLine = detail.tier && !detail.covered && detail.tier.key
        ? `档位「${detail.tier.label}」${t('ceiling')}：${detail.tier.maxRiskLabel}${detail.tier.alwaysAsk.length ? ` · ${t('alwaysAskLabel')} ${detail.tier.alwaysAsk.join('、')}` : ''}`
        : detail.covered
          ? t('covered')
          : ''
      const canAllow = typeof detail.signature === 'string' && detail.signature.length > 0 && !detail.rule
      const ai = detail.ai && typeof detail.ai === 'object' ? detail.ai : null
      const aiLine = ai ? (ai.configured ? format(t('aiDetailAsk'), [ai.model, ai.minConfidence]) : t('aiDetailDirect')) : ''

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '2px 0 4px' } },
        command
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              h('span', { style: { fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)' } }, [detail.tool, detail.cwd].filter(Boolean).join('  ·  ')),
              h('pre', { style: commandStyle }, command),
            )
          : null,
        riskLine
          ? h('span', { style: { fontSize: '11px', lineHeight: '15px', color: riskColor(risk && risk.key) } }, riskLine)
          : null,
        explainLine
          ? h(
              'div',
              {
                style: {
                  fontSize: '12px',
                  lineHeight: '18px',
                  padding: '7px 9px',
                  borderRadius: '8px',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  color: 'var(--dsw-alias-label-primary)',
                },
              },
              explainLine,
            )
          : null,
        tierLine
          ? h('span', { style: { fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-label-tertiary)' } }, tierLine)
          : null,
        aiLine
          ? h('span', { style: { fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)' } }, aiLine)
          : null,
        canAllow
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, buttonStyle, { alignSelf: 'flex-start' }, ruleState === 'idle' ? null : disabledButton),
                  disabled: ruleState !== 'idle',
                  onClick: (event) => {
                    try {
                      event.preventDefault()
                      event.stopPropagation()
                    } catch {
                      /* synthetic or missing event */
                    }
                    if (ruleState === 'idle') alwaysAllow()
                  },
                },
                ruleState === 'busy' ? t('allowBusy') : ruleState === 'done' ? t('allowDone') : `${t('allowCommand')}「${detail.signature}」`,
              ),
              h('span', { style: { fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)' } }, '只在这个对话里生效；再点「允许」即执行本次。'),
            )
          : detail.rule
            ? h('span', { style: { fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-state-success-primary)' } }, `${t('ruleExists')}：${detail.rule}`)
            : null,
        folder
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              h(
                'button',
                {
                  type: 'button',
                  style: Object.assign({}, primaryButton, { alignSelf: 'flex-start', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, state === 'idle' ? null : disabledButton),
                  disabled: state !== 'idle',
                  title: folders.join('\n'),
                  onClick: (event) => {
                    try {
                      event.preventDefault()
                      event.stopPropagation()
                    } catch {
                      /* synthetic or missing event */
                    }
                    if (state === 'idle') trust()
                  },
                },
                label,
              ),
              h('span', { style: { fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)' } }, `之后对 ${folder} 内的提权会自动放行；其它文件夹照旧询问。`),
            )
          : null,
        error ? h('span', { style: { fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-state-error-primary)' } }, error) : null,
      )
    }

    const RISK_LABELS = {
      read: '只读',
      write: '写入',
      destructive: '删除 / 覆盖',
      system: '系统层',
      outside: '工作区外',
      publish: '对外发布',
      unknown: '无法识别',
    }

    function riskLabel(key) {
      return RISK_LABELS[key] ? RISK_LABELS[key] : String(key)
    }

    function riskColor(key) {
      if (key === 'read') return 'var(--dsw-alias-state-success-primary)'
      if (key === 'write') return 'var(--dsw-alias-label-secondary)'
      if (key === 'destructive' || key === 'outside') return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-state-error-primary)'
    }

    function pendingApprovalOf(map, sessionId) {
      if (!map || typeof map.get !== 'function' || !sessionId) return undefined
      const status = map.get(sessionId)
      const interaction = status && status.pendingInteraction
      return interaction && interaction.kind === 'approval' ? interaction : undefined
    }

    // Snapshot hooks in this UI take a selector, not an optional one: passing
    // nothing makes them call `undefined(snapshot)` and throw.
    const selectAll = (value) => value

    // `%s` placeholders keep the review-model sentence one dictionary entry per
    // language, so zh/en never drift apart.
    function format(template, values) {
      let index = 0
      return String(template === undefined ? '' : template).replace(/%s/g, () => {
        const value = values[index]
        index += 1
        return value === undefined || value === null ? '' : String(value)
      })
    }

    function keySourceLabel(t, ai) {
      const source = ai && typeof ai.keySource === 'string' ? ai.keySource : 'none'
      if (source === 'config') return t('keyConfig')
      if (source.indexOf('env:') === 0) return `${t('keyEnv')} ${source.slice(4)}`
      return t('none')
    }

    function shortDate(value) {
      const stamp = typeof value === 'number' ? value : Number(value)
      if (!stamp || !isFinite(stamp)) return '—'
      const date = new Date(stamp)
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${date.getFullYear()}-${month}-${day}`
    }

    function loadPanel() {
      return fetch(`${API}/panel`).then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)),
      )
    }

    // The review-model card: either the live configuration plus a probe button,
    // or the one hint that says which config keys are missing. No button in the
    // second case, because a probe cannot succeed without them.
    function aiCard(t, ai, probe, onTest) {
      const config = ai && typeof ai === 'object' ? ai : {}
      if (config.configured !== true) {
        return h(Section, { title: t('aiTitle'), hint: t('aiHint') }, h('p', { style: hintStyle }, t('aiMissing')))
      }
      const last = config.lastCall && typeof config.lastCall.at === 'number' && config.lastCall.at > 0 ? config.lastCall : null
      const lines = [
        `${t('aiModel')}: ${config.model}`,
        `${t('aiBase')}: ${config.baseUrl}`,
        `${t('aiKey')}: ${keySourceLabel(t, config)}`,
        `${t('aiTimeout')}: ${config.timeoutMs} ms  ·  ${t('aiThreshold')}: ${config.minConfidence}`,
      ]
      if (last) {
        lines.push(
          `${t('aiLastCall')}: ${last.ok ? t('aiOk') : t('aiFailed')}${typeof last.ms === 'number' ? ` · ${last.ms} ms` : ''}${last.reason ? ` · ${last.reason}` : ''}`,
        )
      }
      const probeLine =
        probe.status === 'ok'
          ? `${t('aiTestOk')}${probe.ms ? ` · ${probe.ms} ms` : ''}`
          : probe.status === 'error'
            ? probe.error
            : ''
      return h(
        Section,
        { title: t('aiTitle'), hint: t('aiHint') },
        h(
          'div',
          { style: infoStyle },
          lines.map((line) => h('span', { key: line }, line)),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              style: probe.status === 'busy' ? Object.assign({}, buttonStyle, disabledButton) : buttonStyle,
              disabled: probe.status === 'busy',
              onClick: () => {
                if (probe.status !== 'busy') onTest()
              },
            },
            probe.status === 'busy' ? t('aiTesting') : t('aiTest'),
          ),
          probeLine ? h('span', { style: probe.status === 'error' ? errorStyle : hintStyle }, probeLine) : null,
        ),
      )
    }

    // How long an approval may stay unanswered. `holdMs: 0` means "forever".
    function holdCard(t, hold) {
      const ms = hold && typeof hold.ms === 'number' && hold.ms > 0 ? hold.ms : 0
      const waitSeconds = ms % 1000 === 0 ? ms / 1000 : Math.round(ms / 100) / 10
      const line = ms > 0 ? format(t('holdLimited'), [waitSeconds]) : t('holdForever')
      return h(
        Section,
        { title: t('holdTitle'), hint: t('holdHint') },
        h(
          'p',
          {
            style: {
              margin: 0,
              fontSize: '13px',
              lineHeight: '20px',
              color: ms > 0 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)',
            },
          },
          line,
        ),
      )
    }

    // The reports this plugin appended to the transcript at the end of a turn.
    function reportsCard(t, reports) {
      const rows = Array.isArray(reports) ? reports : []
      return h(
        Section,
        { title: t('reportsTitle'), hint: t('reportsHint') },
        rows.length === 0
          ? h('p', { style: emptyStyle }, t('noReports'))
          : h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              rows.map((report, index) =>
                h(
                  'div',
                  {
                    key: `report-${index}`,
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      padding: '7px 9px',
                      borderRadius: '8px',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      background: 'var(--dsw-alias-bg-layer-1)',
                    },
                  },
                  h(
                    'span',
                    { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                    `${report.turn ? `#${report.turn} · ` : ''}${shortDate(report.at)} · ${format(t('reportsCount'), [report.count])}`,
                  ),
                  h(
                    'span',
                    { style: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap' } },
                    typeof report.text === 'string' ? report.text : '',
                  ),
                ),
              ),
            ),
      )
    }

    // What the user has allowed or blocked so far, plus the generated skill file
    // the model reads before it asks for approval.
    function habitsCard(t, habits, skill, skillState, onGenerate) {
      const rows = Array.isArray(habits) ? habits : []
      const info = skill && typeof skill === 'object' ? skill : { path: '', exists: false }
      const table =
        rows.length === 0
          ? h('p', { style: emptyStyle }, t('habitsEmpty'))
          : h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
              h(
                'div',
                { style: habitHeadStyle },
                h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, t('habitsSig')),
                h('span', { style: habitCountStyle }, t('habitsAllowCount')),
                h('span', { style: habitCountStyle }, t('habitsBlockCount')),
                h('span', { style: habitCountStyle }, t('habitsRisk')),
                h('span', { style: habitCountStyle }, t('habitsLast')),
              ),
              rows.map((entry, index) =>
                h(
                  'div',
                  { key: `${entry.signature}-${index}`, style: Object.assign({}, rowStyle, { gap: '6px', padding: '4px 8px' }) },
                  h('span', { style: habitSignStyle, title: entry.signature }, entry.signature),
                  h('span', { style: habitCountStyle }, String(entry.allow)),
                  h('span', { style: habitCountStyle }, String(entry.block)),
                  h('span', { style: Object.assign({}, habitCountStyle, { color: riskColor(entry.risk) }) }, riskLabel(entry.risk)),
                  h('span', { style: habitCountStyle }, shortDate(entry.last)),
                ),
              ),
            )
      const skillLine = `${t('skillLine')}: ${info.path || t('none')} · ${info.exists ? t('skillExists') : t('skillMissing')}`
      const skillNote =
        skillState.status === 'done'
          ? `${t('skillDone')}: ${skillState.path}${skillState.bytes ? ` · ${skillState.bytes} B` : ''}`
          : skillState.status === 'error'
            ? skillState.error
            : ''
      return h(
        Section,
        { title: t('habitsTitle'), hint: t('habitsHint') },
        table,
        h('span', { style: Object.assign({}, mono, { color: 'var(--dsw-alias-label-secondary)' }) }, skillLine),
        h(
          'div',
          { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              style: skillState.status === 'busy' ? Object.assign({}, buttonStyle, disabledButton) : buttonStyle,
              disabled: skillState.status === 'busy',
              onClick: () => {
                if (skillState.status !== 'busy') onGenerate()
              },
            },
            skillState.status === 'busy' ? t('skillBusy') : t('skillGenerate'),
          ),
          skillNote ? h('span', { style: skillState.status === 'error' ? errorStyle : hintStyle }, skillNote) : null,
        ),
      )
    }

    function TrustedFoldersPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => (T.zh[key] !== undefined ? T.zh[key] : key)
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [globalDraft, setGlobalDraft] = React.useState('')
      const [sessionDraft, setSessionDraft] = React.useState('')
      const [selected, setSelected] = React.useState('')
      const [probe, setProbe] = React.useState({ status: 'idle', ms: 0, error: '' })
      const [skillState, setSkillState] = React.useState({ status: 'idle', path: '', bytes: 0, error: '' })

      const list = typeof props.useSessions === 'function' ? props.useSessions(selectAll) : undefined
      const conversations = React.useMemo(() => {
        const ids = list && Array.isArray(list.ids) ? list.ids : []
        const byId = (list && list.byId) || {}
        return ids.map((id) => ({ id, label: (byId[id] && byId[id].displayTitle) || String(id) }))
      }, [list])

      React.useEffect(() => {
        let alive = true
        loadPanel()
          .then((payload) => {
            if (alive) setData(payload)
          })
          .catch((cause) => {
            if (alive) setError(String((cause && cause.message) || cause))
          })
        return () => {
          alive = false
        }
      }, [])

      async function reload() {
        try {
          const payload = await loadPanel()
          setData(payload)
          return payload
        } catch (cause) {
          setError(String((cause && cause.message) || cause))
          return null
        }
      }

      async function testAi() {
        setProbe({ status: 'busy', ms: 0, error: '' })
        try {
          const response = await fetch(`${API}/ai/test`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`)
          if (payload && payload.ok) {
            setProbe({ status: 'ok', ms: typeof payload.ms === 'number' ? payload.ms : 0, error: '' })
          } else {
            setProbe({ status: 'error', ms: 0, error: (payload && payload.error) || t('aiTestEmpty') })
          }
        } catch (cause) {
          setProbe({ status: 'error', ms: 0, error: String((cause && cause.message) || cause) })
        }
      }

      async function generateSkill() {
        setSkillState({ status: 'busy', path: '', bytes: 0, error: '' })
        try {
          const response = await fetch(`${API}/habits/skill`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
          const payload = await response.json().catch(() => null)
          if (payload && payload.error) {
            setSkillState({ status: 'error', path: '', bytes: 0, error: String(payload.error) })
            return
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setSkillState({
            status: 'done',
            path: payload && typeof payload.path === 'string' ? payload.path : '',
            bytes: payload && typeof payload.bytes === 'number' ? payload.bytes : 0,
            error: '',
          })
          await reload()
        } catch (cause) {
          setSkillState({ status: 'error', path: '', bytes: 0, error: String((cause && cause.message) || cause) })
        }
      }

      React.useEffect(() => {
        if (selected || conversations.length === 0) return
        setSelected(String(conversations[0].id))
      }, [conversations, selected])

      const labelOf = (id) => {
        const hit = conversations.find((entry) => String(entry.id) === String(id))
        return hit ? hit.label : String(id)
      }
      async function send(path, body) {
        setBusy(true)
        setError('')
        try {
          const response = await fetch(`${API}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`)
          if (payload) setData(payload)
          return true
        } catch (cause) {
          setError(t('failed') + String((cause && cause.message) || cause))
          return false
        } finally {
          setBusy(false)
        }
      }

      async function pick(setDraft) {
        try {
          const picked = typeof props.pick === 'function' ? await props.pick() : null
          if (typeof picked === 'string' && picked) setDraft(picked)
        } catch {
          /* no directory picker in this composition */
        }
      }

      const folders = {
        global: data && Array.isArray(data.global) ? data.global : [],
        conversations: data && Array.isArray(data.conversations) ? data.conversations : [],
        configured: (data && data.configured) || { paths: [], commands: [], packages: [] },
        recent: data && Array.isArray(data.recent) ? data.recent : [],
      }
      const current = folders.conversations.find((entry) => String(entry.id) === String(selected))
      const currentFolders = current && Array.isArray(current.folders) ? current.folders : []

      const tierRows = data && Array.isArray(data.tiers) ? data.tiers : []
      const RISK_ORDER = ['read', 'write', 'destructive', 'system', 'outside', 'publish', 'unknown']
      const riskRows = data && data.riskHints ? RISK_ORDER.filter((key) => typeof data.riskHints[key] === 'string').map((key) => ({ key, hint: data.riskHints[key] })) : []
      const ruleRows = data && Array.isArray(data.rules) ? data.rules : []
      const currentRules = ruleRows.find((entry) => String(entry.id) === String(selected))
      const ruleList = currentRules && Array.isArray(currentRules.rules) ? currentRules.rules : []

      const scopeText = (tier) => {
        const parts = []
        const plugin = tier.plugin || {}
        const on = ['read', 'toggle', 'install', 'remove', 'exemption'].filter((key) => plugin[key] === true || plugin[key] === 'all' || plugin[key] === 'trusted')
        if (on.length > 0) parts.push(`${t('pluginScope')}: ${on.join('/')}`)
        const escalate = tier.escalate || {}
        const wide = ['workspace-write', 'danger-full-access'].filter((key) => escalate[key] === 'all' || escalate[key] === 'trusted')
        if (wide.length > 0) parts.push(`${t('escalateScope')}: ${wide.join('/')}`)
        if (tier.otherAsks) parts.push(t('otherAsksScope'))
        return parts.join(' · ')
      }

      const addRow = (draft, setDraft, onAdd) =>
        h(
          'div',
          { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          h('input', {
            style: inputStyle,
            value: draft,
            placeholder: t('placeholder'),
            spellCheck: false,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter' || busy || !draft.trim()) return
              event.preventDefault()
              onAdd(draft.trim())
            },
          }),
          h(
            'button',
            { type: 'button', style: busy ? Object.assign({}, buttonStyle, disabledButton) : buttonStyle, disabled: busy, onClick: () => pick(setDraft) },
            t('browse'),
          ),
          h(
            'button',
            {
              type: 'button',
              style: busy || !draft.trim() ? Object.assign({}, primaryButton, disabledButton) : primaryButton,
              disabled: busy || !draft.trim(),
              onClick: () => onAdd(draft.trim()),
            },
            t('add'),
          ),
        )

      return h(
        'div',
        { style: panel },
        h('h2', { style: titleStyle }, t('title')),
        h('p', { style: introStyle }, t('intro')),
        h('p', { style: hintStyle }, error ? `请求失败：${error}` : data ? null : t('loading')),
        error ? h('p', { style: errorStyle }, error) : null,

        tierRows.length === 0
          ? null
          : h(
              Section,
              { title: t('tierTitle'), hint: t('tierHint') },
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                tierRows.map((tier) =>
                  h(
                    'div',
                    { key: tier.key, style: Object.assign({}, rowStyle, { flexDirection: 'column', alignItems: 'stretch', gap: '2px' }) },
                    h(
                      'div',
                      { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' } },
                      h('span', { style: { fontSize: '13px', lineHeight: '19px', fontWeight: 600 } }, tier.label),
                      h('span', { style: Object.assign({}, mono, { color: 'var(--dsw-alias-label-tertiary)' }) }, tier.key),
                      tier.ai === true ? h('span', { style: badgeStyle }, t('aiBadge')) : null,
                      h(
                        'span',
                        { style: { marginLeft: 'auto', fontSize: '11px', lineHeight: '15px', color: riskColor(tier.maxRisk) } },
                        `${t('ceiling')}：${tier.maxRiskLabel}`,
                      ),
                    ),
                    tier.description ? h('span', { style: hintStyle }, tier.description) : null,
                    h(
                      'span',
                      { style: Object.assign({}, mono, { color: 'var(--dsw-alias-label-tertiary)' }) },
                      [scopeText(tier), tier.alwaysAsk.length ? `${t('alwaysAskLabel')}: ${tier.alwaysAsk.join('/')}` : ''].filter(Boolean).join('  ·  '),
                    ),
                  ),
                ),
              ),
            ),

        data ? aiCard(t, data.ai, probe, testAi) : null,
        data ? holdCard(t, data.hold) : null,
        data ? habitsCard(t, data.habits, data.skill, skillState, generateSkill) : null,
        data ? reportsCard(t, data.reports) : null,

        riskRows.length === 0
          ? null
          : h(
              Section,
              { title: t('riskTitle'), hint: t('riskHint') },
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                riskRows.map((entry) =>
                  h(
                    'div',
                    { key: entry.key, style: { display: 'flex', gap: '8px', alignItems: 'baseline' } },
                    h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', flex: '0 0 auto', background: riskColor(entry.key), marginTop: '6px' } }),
                    h('span', { style: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-primary)', minWidth: '72px' } }, riskLabel(entry.key)),
                    h('span', { style: hintStyle }, entry.hint),
                  ),
                ),
              ),
            ),

        h(
          Section,
          { title: t('globalTitle'), hint: t('globalHint') },
          h(FolderList, {
            folders: folders.global,
            empty: t('empty'),
            busy,
            removeLabel: t('remove'),
            removeHint: t('removeConfirm'),
            onRemove: (folder) => send('/panel/untrust', { scope: 'global', folder }),
          }),
          addRow(globalDraft, setGlobalDraft, async (folder) => {
            if (await send('/panel/trust', { scope: 'global', folder })) setGlobalDraft('')
          }),
        ),

        h(
          Section,
          { title: t('sessionTitle'), hint: t('sessionHint') },
          conversations.length === 0
            ? h('p', { style: emptyStyle }, t('noSessions'))
            : h(
                'div',
                { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
                h(
                  'select',
                  {
                    style: selectStyle,
                    value: selected,
                    onChange: (event) => setSelected(event.target.value),
                  },
                  conversations.map((entry) => h('option', { key: String(entry.id), value: String(entry.id) }, entry.label)),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    style: busy || currentFolders.length === 0 ? Object.assign({}, buttonStyle, disabledButton) : buttonStyle,
                    disabled: busy || currentFolders.length === 0,
                    onClick: () => send('/panel/clear', { scope: 'session', sessionId: selected }),
                  },
                  t('clear'),
                ),
              ),
          conversations.length === 0
            ? null
            : h(FolderList, {
                folders: currentFolders,
                empty: t('empty'),
                busy,
                removeLabel: t('remove'),
                removeHint: t('removeConfirm'),
                onRemove: (folder) => send('/panel/untrust', { scope: 'session', sessionId: selected, folder }),
              }),
          conversations.length === 0
            ? null
            : addRow(sessionDraft, setSessionDraft, async (folder) => {
                if (await send('/panel/trust', { scope: 'session', sessionId: selected, folder })) setSessionDraft('')
              }),
        ),

        folders.conversations.length === 0
          ? null
          : h(
              Section,
              { title: t('rulesTitle'), hint: t('rulesHint') },
              ruleRows.length === 0
                ? h('p', { style: emptyStyle }, t('noRules'))
                : h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                    ruleRows.map((entry) =>
                      h(
                        'div',
                        { key: String(entry.id), style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                        h(
                          'div',
                          { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                          h('span', { style: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } }, labelOf(entry.id)),
                          h(
                            'button',
                            {
                              type: 'button',
                              style: Object.assign({}, quietButton, { marginLeft: 'auto' }, busy ? disabledButton : null),
                              disabled: busy,
                              onClick: () => send('/panel/rule-clear', { sessionId: entry.id }),
                            },
                            t('ruleClear'),
                          ),
                        ),
                        h(
                          'div',
                          { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                          entry.rules.map((rule) =>
                            h(
                              'div',
                              { key: rule.pattern, style: Object.assign({}, rowStyle, { borderColor: 'var(--dsw-alias-border-l1)' }) },
                              h('span', { style: Object.assign({}, mono, { flex: 1, color: 'var(--dsw-alias-label-primary)' }) }, rule.pattern),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  style: Object.assign({}, quietButton, busy ? disabledButton : null),
                                  disabled: busy,
                                  onClick: () => send('/panel/rule-remove', { sessionId: entry.id, pattern: rule.pattern }),
                                },
                                t('ruleRemove'),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
            ),

        folders.conversations.length === 0
          ? null
          : h(
              Section,
              { title: t('overviewTitle'), hint: t('overviewHint') },
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                folders.conversations.map((entry) =>
                  h(
                    'div',
                    { key: String(entry.id), style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    h('span', { style: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } }, labelOf(entry.id)),
                    h(FolderList, {
                      folders: entry.folders,
                      empty: t('empty'),
                      busy,
                      removeLabel: t('remove'),
                      removeHint: t('removeConfirm'),
                      onRemove: (folder) => send('/panel/untrust', { scope: 'session', sessionId: entry.id, folder }),
                    }),
                  ),
                ),
              ),
            ),

        h(
          Section,
          { title: t('configuredTitle'), hint: t('configuredHint') },
          h(
            'div',
            { style: Object.assign({}, mono, { display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--dsw-alias-label-secondary)' }) },
            h('span', null, `${t('pathsLabel')}: ${folders.configured.paths.length ? folders.configured.paths.join('  ·  ') : t('none')}`),
            h('span', null, `${t('commandsLabel')}: ${folders.configured.commands.length ? folders.configured.commands.join('  ·  ') : t('none')}`),
            h('span', null, `${t('packagesLabel')}: ${folders.configured.packages.length ? folders.configured.packages.join('  ·  ') : t('none')}`),
            data && data.base ? h('span', null, `${t('base')}: ${data.base}`) : null,
          ),
        ),

        h(
          Section,
          { title: t('recentTitle'), hint: t('recentHint') },
          folders.recent.length === 0
            ? h('p', { style: emptyStyle }, t('emptyRecent'))
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                folders.recent.map((entry, index) =>
                  h(
                    'span',
                    { key: `${entry.at}-${index}`, style: Object.assign({}, mono, { color: 'var(--dsw-alias-label-secondary)' }) },
                    `${new Date(entry.at).toLocaleTimeString()}  ${entry.tier}  ${entry.tool}  ${entry.category}  ${entry.detail || ''}`,
                  ),
                ),
              ),
        ),
      )
    }

    function pickDirectory(ctx) {
      try {
        const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
        if (workspace && typeof workspace.pickDirectory === 'function') return workspace.pickDirectory()
      } catch {
        /* the picker is optional */
      }
      return Promise.resolve(null)
    }

    function apply(ctx) {
      try {
        ctx.effect(
          () =>
            ctx.locale.register(NS, {
              zh,
              en,
            }),
          'better-permit: panel dictionaries',
        )
      } catch {
        /* localization is optional */
      }
      let t = (key) => (zh[key] !== undefined ? zh[key] : key)
      try {
        if (ctx.locale && typeof ctx.locale.bind === 'function') t = ctx.locale.bind(NS)
      } catch {
        /* fall back to the built-in dictionary above */
      }

      try {
        // The shipped chat entry already holds this single slot at priority 0, and
        // the lowest priority renders: a negative one shadows it so the buttons
        // can sit next to the command preview this component draws itself.
        ctx.slots.inject('conversation.approval.detail', () =>
          ctx.slots.register({ name: 'conversation.approval.detail', priority: -1 }, ApprovalDetail),
        )
      } catch {
        /* without the slot the settings page below still works */
      }

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'better-permit',
            order: 50,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({ pick: () => pickDirectory(ctx) }),
          },
          TrustedFoldersPanel,
        ),
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
