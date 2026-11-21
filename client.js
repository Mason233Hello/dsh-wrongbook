/**
 * Wrong-question notebook — Client half.
 *
 * Two screens inside one `main` panel: a full-width directory grouped by
 * subject and tag, and a question page (problem on the left, metadata,
 * review and AI recommendations on the right).  Both are rendered through the
 * ordinary Slot system so the plugin looks and behaves like a host page.
 *
 * Markdown + LaTeX rendering reuses the host's own `MarkdownText` primitive
 * (the static module the web shell already seeds): that is the only way to
 * inherit the shipped GFM, KaTeX and styled-code-block presentation instead of
 * shipping a second, divergent renderer.
 *
 * @module @local/dsh-wrongbook/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-wrongbook',
  factory(require) {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const MarkdownText = primitives.MarkdownText

    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'wrongbook'
    const PANEL_ID = 'wrongbook'
    const CHANNEL = '/x-wrongbook'
    const MEMORY_KEY = 'dsh.wrongbook.ui.v1'

    /** Error codes the Host raises; each maps to localized copy. */
    const KNOWN_ERRORS = new Set([
      'invalid-call',
      'not-found',
      'already-generated',
      'generating',
      'llm-unavailable',
      'model-unavailable',
      'model-failed',
      'model-truncated',
      'empty-output',
      'parse-failed',
      'aborted',
      'unknown-method',
      'failed',
      'transport',
      'no-connection',
    ])

    /* ------------------------------------------------------------------ *
     * Locale
     * ------------------------------------------------------------------ */

    const zh = {
      'panel.label': '错题本',
      title: '错题本',
      subtitle: '{count} 道错题 · {tags} 个考点',
      add: '添加错题',
      'search.placeholder': '搜索题目、标签或错因',
      'search.label': '搜索错题',
      'search.empty': '没有匹配的错题',
      'rail.subject': '科目',
      'rail.tags': '标签',
      'rail.all': '全部',
      'rail.allTags': '全部标签',
      'rail.noTags': '暂无标签',
      'list.empty': '还没有错题',
      'list.emptyHint': '把做错的题记下来：科目、考点、题目、答案和错因。复习时先自己重做，再点开答案。',
      'list.noMatchHint': '换个关键词，或切换左侧的科目与标签。',
      'row.review': '复习',
      'row.lastReviewed': '上次复习：{time}',
      'row.tagsEmpty': '未标注考点',
      'question.back': '返回目录',
      'question.edit': '编辑',
      'question.answer': '答案',
      'question.reason': '错因',
      'answer.reveal': '点击显示答案',
      'answer.hint': '先独立重做一遍，再核对答案',
      'answer.hide': '收起答案',
      'answer.empty': '未填写答案',
      'info.title': '基本信息',
      'info.subject': '科目',
      'info.tags': '标签',
      'info.created': '添加时间',
      'info.lastReviewed': '上次复习',
      'info.reviewCount': '复习次数',
      'info.markReviewed': '标记为已复习',
      'info.reviewed': '已记录本次复习',
      'info.never': '从未复习',
      'info.times': '{count} 次',
      'ai.title': '好题推荐',
      'ai.subtitle': '依据题目与错因，生成 2-3 道同考点、略难的变式题',
      'ai.api': '调用 API',
      'ai.model': '模型',
      'ai.effort': '思考强度',
      'ai.effortDefault': '默认',
      'ai.effortNone': '该模型未声明推理等级',
      'ai.generate': '生成推荐题目',
      'ai.generating': '正在生成…',
      'ai.resolving': '正在读取模型信息…',
      'ai.generatedAt': '生成于 {time}',
      'ai.once': '每道题只能生成一次，结果会永久保存在这道题下。',
      'ai.openHint': '点击查看题目与详细解答',
      'ai.retry': '重试',
      'ai.noModel': '当前没有可用的模型路由，请先在设置中选择模型。',
      'rec.title': '推荐题目',
      'rec.index': '第 {index} / {total} 题',
      'rec.question': '题目',
      'rec.answer': '答案',
      'rec.prev': '上一题',
      'rec.next': '下一题',
      'rec.close': '关闭',
      'editor.addTitle': '添加错题',
      'editor.editTitle': '编辑错题',
      'editor.subject': '科目',
      'editor.subjectPlaceholder': '例如：数学',
      'editor.tags': '标签（考点）',
      'editor.tagsPlaceholder': '用逗号分隔，例如：函数, 导数',
      'editor.title': '题目名称',
      'editor.titlePlaceholder': '一句话概括这道题',
      'editor.question': '题目',
      'editor.answer': '答案',
      'editor.reason': '错因',
      'editor.mdHint': '支持 Markdown 与 LaTeX：$...$ 行内公式，$$...$$ 独立公式',
      'editor.edit': '编辑',
      'editor.preview': '预览',
      'editor.previewEmpty': '还没有内容',
      'editor.cancel': '取消',
      'editor.save': '保存',
      'editor.saving': '保存中…',
      'editor.delete': '删除错题',
      'editor.deleteConfirm': '确认删除？',
      'editor.required': '请填写科目、题目名称和题目',
      'editor.bold': '加粗',
      'editor.italic': '斜体',
      'editor.mathInline': '行内公式',
      'editor.mathBlock': '独立公式',
      'toast.saved': '已添加错题',
      'toast.updated': '已保存修改',
      'toast.reviewed': '已记录本次复习',
      'toast.deleted': '已删除错题',
      'error.title': '错题本加载失败',
      'error.retry': '重新加载',
      'error.no-connection': '与 Harness 的连接尚未建立',
      'error.transport': '与 Harness 的通信失败',
      'error.not-found': '这道错题已不存在',
      'error.already-generated': '这道题已经生成过推荐题目',
      'error.generating': '推荐题目正在生成，请稍候',
      'error.llm-unavailable': '当前没有挂载模型服务',
      'error.model-unavailable': '当前模型不可用，请检查模型设置',
      'error.model-failed': '模型调用失败',
      'error.model-truncated': '模型输出被截断：可把思考强度调低后重试',
      'error.empty-output': '模型没有返回内容，请重试',
      'error.parse-failed': '模型输出无法解析，请重试',
      'error.aborted': '已取消生成',
      'error.invalid-call': '请检查填写内容',
      'error.unknown-method': '未知请求',
      'error.failed': '操作失败',
      'md.copy': '复制',
      'md.copied': '已复制',
      'md.code': '代码',
      'md.wrap': '自动换行',
      'md.unwrap': '取消换行',
      'md.footnotes': '脚注',
      'time.justNow': '刚刚',
      'time.minutesAgo': '{count} 分钟前',
      'time.hoursAgo': '{count} 小时前',
      'time.daysAgo': '{count} 天前',
      'time.never': '从未复习',
    }

    const en = {
      'panel.label': 'Wrong answers',
      title: 'Wrong answers',
      subtitle: '{count} questions · {tags} topics',
      add: 'Add question',
      'search.placeholder': 'Search title, tag, or reason',
      'search.label': 'Search wrong answers',
      'search.empty': 'No matching questions',
      'rail.subject': 'Subject',
      'rail.tags': 'Tags',
      'rail.all': 'All',
      'rail.allTags': 'All tags',
      'rail.noTags': 'No tags yet',
      'list.empty': 'No wrong answers yet',
      'list.emptyHint': 'Record each missed problem: subject, topic, statement, answer and why it went wrong. Redo it first, then reveal the answer.',
      'list.noMatchHint': 'Try another keyword, or switch subject and tag on the left.',
      'row.review': 'Review',
      'row.lastReviewed': 'Last review: {time}',
      'row.tagsEmpty': 'No topic tagged',
      'question.back': 'Back to list',
      'question.edit': 'Edit',
      'question.answer': 'Answer',
      'question.reason': 'Why it went wrong',
      'answer.reveal': 'Click to reveal the answer',
      'answer.hint': 'Redo it on your own first, then check',
      'answer.hide': 'Hide answer',
      'answer.empty': 'No answer recorded',
      'info.title': 'Details',
      'info.subject': 'Subject',
      'info.tags': 'Tags',
      'info.created': 'Added',
      'info.lastReviewed': 'Last review',
      'info.reviewCount': 'Reviews',
      'info.markReviewed': 'Mark as reviewed',
      'info.reviewed': 'Review recorded',
      'info.never': 'Never reviewed',
      'info.times': '{count}×',
      'ai.title': 'Similar problems',
      'ai.subtitle': 'Generate 2-3 harder variants from the problem and the error',
      'ai.api': 'API request',
      'ai.model': 'Model',
      'ai.effort': 'Reasoning effort',
      'ai.effortDefault': 'Default',
      'ai.effortNone': 'This model declares no reasoning levels',
      'ai.generate': 'Generate similar problems',
      'ai.generating': 'Generating…',
      'ai.resolving': 'Reading model information…',
      'ai.generatedAt': 'Generated {time}',
      'ai.once': 'Each question can generate once; the result is stored with the question.',
      'ai.openHint': 'Click to open the problem and its full answer',
      'ai.retry': 'Retry',
      'ai.noModel': 'No usable model route. Pick a model in Settings first.',
      'rec.title': 'Suggested problem',
      'rec.index': '{index} of {total}',
      'rec.question': 'Problem',
      'rec.answer': 'Answer',
      'rec.prev': 'Previous',
      'rec.next': 'Next',
      'rec.close': 'Close',
      'editor.addTitle': 'Add wrong answer',
      'editor.editTitle': 'Edit wrong answer',
      'editor.subject': 'Subject',
      'editor.subjectPlaceholder': 'e.g. Mathematics',
      'editor.tags': 'Tags (topics)',
      'editor.tagsPlaceholder': 'Comma separated, e.g. functions, derivatives',
      'editor.title': 'Question name',
      'editor.titlePlaceholder': 'One line that identifies the problem',
      'editor.question': 'Problem',
      'editor.answer': 'Answer',
      'editor.reason': 'Why it went wrong',
      'editor.mdHint': 'Markdown and LaTeX supported: $...$ inline, $$...$$ block',
      'editor.edit': 'Write',
      'editor.preview': 'Preview',
      'editor.previewEmpty': 'Nothing here yet',
      'editor.cancel': 'Cancel',
      'editor.save': 'Save',
      'editor.saving': 'Saving…',
      'editor.delete': 'Delete',
      'editor.deleteConfirm': 'Delete this question?',
      'editor.required': 'Subject, question name and problem are required',
      'editor.bold': 'Bold',
      'editor.italic': 'Italic',
      'editor.mathInline': 'Inline math',
      'editor.mathBlock': 'Block math',
      'toast.saved': 'Question added',
      'toast.updated': 'Changes saved',
      'toast.reviewed': 'Review recorded',
      'toast.deleted': 'Question deleted',
      'error.title': 'Could not open the notebook',
      'error.retry': 'Reload',
      'error.no-connection': 'The Harness connection is not ready yet',
      'error.transport': 'Could not reach Harness',
      'error.not-found': 'This question no longer exists',
      'error.already-generated': 'Suggestions were already generated for this question',
      'error.generating': 'Suggestions are being generated, please wait',
      'error.llm-unavailable': 'No model service is mounted',
      'error.model-unavailable': 'The current model is unavailable; check model settings',
      'error.model-failed': 'The model call failed',
      'error.model-truncated': 'The model output was truncated; lower the reasoning effort and retry',
      'error.empty-output': 'The model returned nothing; please retry',
      'error.parse-failed': 'The model output could not be parsed; please retry',
      'error.aborted': 'Generation cancelled',
      'error.invalid-call': 'Check the submitted fields',
      'error.unknown-method': 'Unknown request',
      'error.failed': 'The operation failed',
      'md.copy': 'Copy',
      'md.copied': 'Copied',
      'md.code': 'Code',
      'md.wrap': 'Wrap lines',
      'md.unwrap': 'Unwrap lines',
      'md.footnotes': 'Footnotes',
      'time.justNow': 'just now',
      'time.minutesAgo': '{count} min ago',
      'time.hoursAgo': '{count} h ago',
      'time.daysAgo': '{count} d ago',
      'time.never': 'never',
    }

    /* ------------------------------------------------------------------ *
     * Small utilities
     * ------------------------------------------------------------------ */

    function cx(...values) {
      return values.filter(Boolean).join(' ')
    }

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    /** Absolute `YYYY-MM-DD HH:mm` stamp. */
    function formatStamp(timestamp) {
      const date = new Date(timestamp)
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    /** Human-readable last-review time: relative within a week, then absolute. */
    function formatWhen(timestamp, t) {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return t('time.never')
      const elapsed = Date.now() - timestamp
      if (elapsed < 60_000) return t('time.justNow')
      if (elapsed < 3_600_000) return t('time.minutesAgo', { count: Math.floor(elapsed / 60_000) })
      if (elapsed < 86_400_000) return t('time.hoursAgo', { count: Math.floor(elapsed / 3_600_000) })
      if (elapsed < 7 * 86_400_000) return t('time.daysAgo', { count: Math.floor(elapsed / 86_400_000) })
      return formatStamp(timestamp)
    }

    /** Parse a comma-separated tag input the way the Host stores it. */
    function parseTags(text) {
      const seen = new Set()
      const tags = []
      for (const piece of String(text).split(/[,，、;；]/)) {
        const tag = piece.trim().replace(/\s+/g, ' ')
        if (tag === '' || seen.has(tag)) continue
        seen.add(tag)
        tags.push(tag)
        if (tags.length >= 8) break
      }
      return tags
    }

    /** The error surface the UI shows: localized known codes, else the raw message. */
    function errorText(error, t) {
      const code = error?.code
      if (typeof code === 'string' && KNOWN_ERRORS.has(code)) return t(`error.${code}`)
      return error instanceof Error && error.message !== '' ? error.message : t('error.failed')
    }

    class ApiError extends Error {
      constructor(code, message) {
        super(message)
        this.name = 'ApiError'
        this.code = code
      }
    }

    /** Browser → Host RPC over the private `connection` channel. */
    function createApi(ctx) {
      const call = async (method, payload, signal) => {
        const connection = ctx.get('connection')
        if (connection === undefined) throw new ApiError('no-connection', 'the connection service is not mounted')
        let result
        try {
          result = await connection.rpc.call(CHANNEL, method, payload ?? null, signal)
        } catch (error) {
          throw new ApiError('transport', error instanceof Error ? error.message : String(error))
        }
        if (result?.ok !== true) {
          throw new ApiError(result?.error?.code ?? 'failed', result?.error?.message ?? 'request failed')
        }
        return result.value
      }
      return {
        hello: (signal) => call('hello', null, signal),
        save: (payload, signal) => call('save', payload, signal),
        review: (payload, signal) => call('review', payload, signal),
        remove: (payload, signal) => call('remove', payload, signal),
        recommend: (payload, signal) => call('recommend', payload, signal),
        model: (signal) => call('model', null, signal),
      }
    }

    /* ------------------------------------------------------------------ *
     * Icons (inline, currentColor — no Client package imports)
     * ------------------------------------------------------------------ */

    function Icon({ size = 16, path, viewBox = '0 0 24 24', fill = 'none', extra = {} }) {
      return h(
        'svg',
        {
          viewBox,
          width: size,
          height: size,
          fill,
          stroke: fill === 'none' ? 'currentColor' : 'none',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
          ...extra,
        },
        path,
      )
    }

    const paths = {
      book: [
        h('path', { key: 'a', d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z' }),
        h('path', { key: 'b', d: 'M4 18.5A2.5 2.5 0 0 1 6.5 16H19v3.5H6.5A2.5 2.5 0 0 0 4 22' }),
        h('path', { key: 'c', d: 'M8 7.5h7M8 11h5' }),
      ],
      plus: [h('path', { key: 'a', d: 'M12 5v14M5 12h14' })],
      search: [h('circle', { key: 'a', cx: 11, cy: 11, r: 6.5 }), h('path', { key: 'b', d: 'M16 16l4.5 4.5' })],
      close: [h('path', { key: 'a', d: 'M6 6l12 12M18 6L6 18' })],
      arrowLeft: [h('path', { key: 'a', d: 'M15 5l-7 7 7 7' })],
      edit: [h('path', { key: 'a', d: 'M4 20h4.5L19 9.5 14.5 5 4 15.5z' }), h('path', { key: 'b', d: 'M13 6.5L17.5 11' })],
      sparkle: [
        h('path', { key: 'a', d: 'M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15.4l-1.6-4.6L6 9.2l4.4-1.6z' }),
        h('path', { key: 'b', d: 'M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z' }),
      ],
      chevronLeft: [h('path', { key: 'a', d: 'M14.5 5.5L8 12l6.5 6.5' })],
      chevronRight: [h('path', { key: 'a', d: 'M9.5 5.5L16 12l-6.5 6.5' })],
      warning: [h('path', { key: 'a', d: 'M12 3.5l9 16H3z' }), h('path', { key: 'b', d: 'M12 9.5v4.5M12 17.2v.1' })],
      clock: [h('circle', { key: 'a', cx: 12, cy: 12, r: 8 }), h('path', { key: 'b', d: 'M12 7.5V12l3 2' })],
    }

    function SidebarIcon({ size = 18 }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block' },
      }, paths.book)
    }

    function Spinner() {
      return h('span', { className: 'wqb-spin', 'aria-hidden': true })
    }

    /* ------------------------------------------------------------------ *
     * Atoms
     * ------------------------------------------------------------------ */

    function Button({ variant = 'ghost', size = 'md', icon, children, className, type = 'button', ...rest }) {
      return h(
        'button',
        {
          type,
          className: cx('wqb-btn', `wqb-btn--${variant}`, size === 'sm' && 'wqb-btn--sm', className),
          ...rest,
        },
        icon !== undefined ? h('span', { className: 'wqb-btnIcon' }, icon) : null,
        children !== undefined ? h('span', { className: 'wqb-btnLabel' }, children) : null,
      )
    }

    function Chip({ children, tone }) {
      return h('span', { className: cx('wqb-chip', tone === 'subject' && 'wqb-chip--subject') }, children)
    }

    function Markdown({ text, labels, empty }) {
      const value = typeof text === 'string' ? text : ''
      if (value.trim() === '') {
        return h('p', { className: 'wqb-mdEmpty' }, empty ?? '')
      }
      /* `MarkdownText` is a `React.memo` component: its runtime type is an
         object, not a function, so a `typeof === 'function'` guard would send
         every field to the plain-text fallback. Fall back only when the shell
         genuinely did not seed the primitive. */
      if (MarkdownText === undefined || MarkdownText === null) {
        return h('pre', { className: 'wqb-mdFallback' }, value)
      }
      return h('div', { className: 'wqb-md' }, h(MarkdownText, { text: value, labels }))
    }

    function RailItem({ active, label, count, onClick }) {
      return h(
        'button',
        {
          type: 'button',
          className: cx('wqb-railItem', active && 'is-active'),
          'aria-pressed': active,
          onClick,
        },
        h('span', { className: 'wqb-railLabel' }, label),
        h('span', { className: 'wqb-railCount' }, String(count)),
      )
    }

    /**
     * Centered dialog rendered inside the plugin root (never `document.body`).
     * Owns focus entry, the Tab trap, Escape, backdrop close and focus restore.
     */
    function Dialog({ onClose, labelledBy, className, children, extraKeyDown }) {
      const ref = useRef(null)
      const closeRef = useRef(onClose)
      closeRef.current = onClose
      const keyRef = useRef(extraKeyDown)
      keyRef.current = extraKeyDown

      useEffect(() => {
        const previous = typeof document !== 'undefined' ? document.activeElement : null
        const node = ref.current
        const focusable = () => {
          if (node === null) return []
          return Array.from(
            node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
          ).filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null)
        }
        const list = focusable()
        const target = list.find((element) => element.dataset.autofocus === 'true') ?? list[0] ?? node
        target?.focus?.({ preventScroll: true })

        const onKeyDown = (event) => {
          if (keyRef.current?.(event) === true) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeRef.current()
            return
          }
          if (event.key !== 'Tab') return
          const items = focusable()
          if (items.length === 0) return
          const first = items[0]
          const last = items[items.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          previous?.focus?.({ preventScroll: true })
        }
      }, [])

      return h(
        'div',
        {
          className: 'wqb-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          {
            ref,
            className: cx('wqb-dialog', className),
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': labelledBy,
            tabIndex: -1,
          },
          children,
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Directory
     * ------------------------------------------------------------------ */

    function Directory({ items, subject, tag, query, onSubject, onTag, onQuery, onOpen, onAdd, t }) {
      const subjects = useMemo(() => {
        const counts = new Map()
        for (const item of items) counts.set(item.subject, (counts.get(item.subject) ?? 0) + 1)
        return [...counts.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
      }, [items])

      const activeSubject = subject !== 'all' && subjects.some((entry) => entry.name === subject) ? subject : 'all'

      const scoped = useMemo(
        () => (activeSubject === 'all' ? items : items.filter((item) => item.subject === activeSubject)),
        [items, activeSubject],
      )

      const tags = useMemo(() => {
        const counts = new Map()
        for (const item of scoped) for (const name of item.tags) counts.set(name, (counts.get(name) ?? 0) + 1)
        return [...counts.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-Hans-CN'))
      }, [scoped])

      const activeTag = tag !== 'all' && tags.some((entry) => entry.name === tag) ? tag : 'all'

      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return scoped.filter((item) => {
          if (activeTag !== 'all' && !item.tags.includes(activeTag)) return false
          if (needle === '') return true
          const haystack = [item.title, item.subject, item.tags.join(' '), item.question, item.reason].join('\n').toLowerCase()
          return haystack.includes(needle)
        })
      }, [scoped, activeTag, query])

      return h(
        'div',
        { className: 'wqb-dir' },
        h(
          'header',
          { className: 'wqb-head' },
          h(
            'div',
            { className: 'wqb-headMain' },
            h('h1', { className: 'wqb-pageTitle' }, t('title')),
            h('p', { className: 'wqb-sub' }, t('subtitle', { count: items.length, tags: tags.length })),
          ),
          h(
            'div',
            { className: 'wqb-headTools' },
            h(
              'label',
              { className: 'wqb-search' },
              h(Icon, { size: 14, path: paths.search }),
              h('input', {
                type: 'search',
                value: query,
                placeholder: t('search.placeholder'),
                'aria-label': t('search.label'),
                onChange: (event) => onQuery(event.target.value),
              }),
            ),
            h(Button, {
              variant: 'primary',
              size: 'sm',
              icon: h(Icon, { size: 13, path: paths.plus }),
              onClick: onAdd,
            }, t('add')),
          ),
        ),
        h(
          'div',
          { className: 'wqb-body' },
          h(
            'nav',
            { className: 'wqb-rail', 'aria-label': t('rail.subject') },
            h('div', { className: 'wqb-railTitle' }, t('rail.subject')),
            h(RailItem, {
              active: activeSubject === 'all',
              label: t('rail.all'),
              count: items.length,
              onClick: () => {
                onSubject('all')
                onTag('all')
              },
            }),
            subjects.map((entry) =>
              h(RailItem, {
                key: entry.name,
                active: activeSubject === entry.name,
                label: entry.name,
                count: entry.count,
                onClick: () => {
                  onSubject(entry.name)
                  onTag('all')
                },
              }),
            ),
            h('div', { className: 'wqb-railDivider' }),
            h('div', { className: 'wqb-railTitle' }, activeSubject === 'all' ? t('rail.tags') : `${t('rail.tags')} · ${activeSubject}`),
            tags.length === 0
              ? h('p', { className: 'wqb-railEmpty' }, t('rail.noTags'))
              : [
                  h(RailItem, {
                    key: '__all_tags',
                    active: activeTag === 'all',
                    label: t('rail.allTags'),
                    count: scoped.length,
                    onClick: () => onTag('all'),
                  }),
                  ...tags.map((entry) =>
                    h(RailItem, {
                      key: entry.name,
                      active: activeTag === entry.name,
                      label: entry.name,
                      count: entry.count,
                      onClick: () => onTag(entry.name),
                    }),
                  ),
                ],
          ),
          h(
            'main',
            { className: 'wqb-content' },
            filtered.length === 0
              ? items.length === 0
                ? h(
                    'div',
                    { className: 'wqb-empty' },
                    h('div', { className: 'wqb-emptyGlyph' }, h(Icon, { size: 22, path: paths.book })),
                    h('h2', { className: 'wqb-emptyTitle' }, t('list.empty')),
                    h('p', { className: 'wqb-emptyHint' }, t('list.emptyHint')),
                    h(Button, {
                      variant: 'primary',
                      icon: h(Icon, { size: 14, path: paths.plus }),
                      onClick: onAdd,
                    }, t('add')),
                  )
                : h(
                    'div',
                    { className: 'wqb-empty' },
                    h('div', { className: 'wqb-emptyGlyph' }, h(Icon, { size: 22, path: paths.search })),
                    h('h2', { className: 'wqb-emptyTitle' }, t('search.empty')),
                    h('p', { className: 'wqb-emptyHint' }, t('list.noMatchHint')),
                  )
              : h(
                  'ul',
                  { className: 'wqb-rows', 'aria-label': t('title') },
                  filtered.map((item) =>
                    h(
                      'li',
                      { key: item.id, className: 'wqb-row' },
                      h(
                        'div',
                        { className: 'wqb-rowMain' },
                        h(
                          'div',
                          { className: 'wqb-rowTop' },
                          h('h2', { className: 'wqb-rowTitle', title: item.title }, item.title),
                        ),
                        h(
                          'div',
                          { className: 'wqb-rowMeta' },
                          h(Chip, { tone: 'subject' }, item.subject),
                          item.tags.length === 0
                            ? h(Chip, null, t('row.tagsEmpty'))
                            : item.tags.map((name) => h(Chip, { key: name }, name)),
                          h('span', { className: 'wqb-dotSep', 'aria-hidden': true }),
                          h(
                            'span',
                            {
                              className: 'wqb-when',
                              title:
                                typeof item.lastReviewedAt === 'number'
                                  ? formatStamp(item.lastReviewedAt)
                                  : t('info.never'),
                            },
                            t('row.lastReviewed', { time: formatWhen(item.lastReviewedAt, t) }),
                          ),
                        ),
                      ),
                      h(Button, {
                        variant: 'outline',
                        size: 'sm',
                        className: 'wqb-review',
                        onClick: () => onOpen(item.id),
                      }, t('row.review')),
                    ),
                  ),
                ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Question page
     * ------------------------------------------------------------------ */

    function QuestionView({ item, model, modelPending, api, labels, t, onBack, onEdit, onReviewed, onUpdated }) {
      const [revealed, setRevealed] = useState(false)
      const [marking, setMarking] = useState(false)
      const [marked, setMarked] = useState(false)
      const [generating, setGenerating] = useState(false)
      const [genError, setGenError] = useState(null)
      const [effort, setEffort] = useState('')
      const [recIndex, setRecIndex] = useState(null)
      const scrollRef = useRef(null)
      const abortRef = useRef(null)
      const mountedRef = useRef(true)

      const modelEfforts = Array.isArray(model?.efforts) ? model.efforts : []
      const modelKey =
        model === null
          ? ''
          : `${model.provider}\u0000${model.model}\u0000${String(model.available)}\u0000${modelEfforts
              .map((entry) => entry.id)
              .join(',')}`
      const modelReady = model !== null && model.available === true
      const modelFailed = model !== null && model.available === false
      const modelResolving = !modelReady && !modelFailed

      useEffect(() => {
        setRevealed(false)
        setMarked(false)
        setMarking(false)
        setGenError(null)
        setRecIndex(null)
      }, [item.id])

      useEffect(() => {
        scrollRef.current?.scrollTo?.({ top: 0 })
      }, [item.id])

      useEffect(() => {
        mountedRef.current = true
        return () => {
          mountedRef.current = false
          abortRef.current?.abort()
        }
      }, [])

      useEffect(() => {
        const preferred = [model?.selectedEffort, model?.defaultEffort, modelEfforts[0]?.id].find(
          (id) => typeof id === 'string' && id !== '' && modelEfforts.some((entry) => entry.id === id),
        )
        setEffort(preferred ?? '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [modelKey])

      const markReviewed = useCallback(async () => {
        if (marked || marking) return
        setMarking(true)
        const ok = await onReviewed(item.id)
        if (!mountedRef.current) return
        setMarking(false)
        if (ok) setMarked(true)
      }, [marked, marking, onReviewed, item.id])

      const reveal = useCallback(() => {
        setRevealed(true)
        void markReviewed()
      }, [markReviewed])

      const generate = useCallback(async () => {
        if (generating || !modelReady || item.recommendation !== undefined) return
        const controller = new AbortController()
        abortRef.current = controller
        setGenerating(true)
        setGenError(null)
        try {
          const result = await api.recommend({ id: item.id, effort: effort === '' ? undefined : effort }, controller.signal)
          if (mountedRef.current) onUpdated(result.item)
        } catch (error) {
          if (mountedRef.current && controller.signal.aborted !== true) setGenError(errorText(error, t))
        } finally {
          if (mountedRef.current) setGenerating(false)
          abortRef.current = null
        }
      }, [api, effort, generating, item.id, item.recommendation, modelReady, onUpdated, t])

      const recommendation = item.recommendation
      const effortName =
        recommendation?.reasoningEffort === undefined
          ? t('ai.effortDefault')
          : effortLabel(modelEfforts, recommendation.reasoningEffort, t('ai.effortDefault'))

      return h(
        'div',
        {
          className: 'wqb-question',
          onKeyDown: (event) => {
            /* A dialog consumes Escape in the capture phase and stops it here. */
            if (event.key !== 'Escape' || event.defaultPrevented) return
            event.preventDefault()
            onBack()
          },
        },
        h(
          'header',
          { className: 'wqb-qhead' },
          h(
            'button',
            { type: 'button', className: 'wqb-back', onClick: onBack },
            h(Icon, { size: 15, path: paths.arrowLeft }),
            h('span', null, t('question.back')),
          ),
          h(
            'div',
            { className: 'wqb-qheadMeta' },
            h(Chip, { tone: 'subject' }, item.subject),
            item.tags.map((name) => h(Chip, { key: name }, name)),
          ),
          h(Button, {
            variant: 'outline',
            size: 'sm',
            icon: h(Icon, { size: 13, path: paths.edit }),
            onClick: () => onEdit(item),
          }, t('question.edit')),
        ),
        h(
          'div',
          { className: 'wqb-qscroll', ref: scrollRef },
          h(
            'div',
            { className: 'wqb-qgrid' },
            h(
              'main',
              { className: 'wqb-qleft' },
              h(
                'section',
                { className: 'wqb-card' },
                h('h1', { className: 'wqb-qtitle' }, item.title),
                h(Markdown, { text: item.question, labels, empty: t('editor.previewEmpty') }),
              ),
              h(
                'section',
                { className: 'wqb-card' },
                h(
                  'div',
                  { className: 'wqb-cardHead' },
                  h('h2', { className: 'wqb-cardTitle' }, t('question.answer')),
                  revealed
                    ? h(Button, { size: 'sm', onClick: () => setRevealed(false) }, t('answer.hide'))
                    : null,
                ),
                revealed
                  ? h(Markdown, { text: item.answer, labels, empty: t('answer.empty') })
                  : h(
                      'button',
                      { type: 'button', className: 'wqb-curtain', onClick: reveal },
                      h('span', { className: 'wqb-curtainMark' }, '?'),
                      h('span', { className: 'wqb-curtainLabel' }, t('answer.reveal')),
                      h('span', { className: 'wqb-curtainHint' }, t('answer.hint')),
                    ),
              ),
              item.reason.trim() !== ''
                ? h(
                    'section',
                    { className: 'wqb-card' },
                    h('div', { className: 'wqb-cardHead' }, h('h2', { className: 'wqb-cardTitle' }, t('question.reason'))),
                    h(Markdown, { text: item.reason, labels }),
                  )
                : null,
            ),
            h(
              'aside',
              { className: 'wqb-qright' },
              h(
                'section',
                { className: 'wqb-card' },
                h('div', { className: 'wqb-cardHead' }, h('h2', { className: 'wqb-cardTitle' }, t('info.title'))),
                h(
                  'dl',
                  { className: 'wqb-infoList' },
                  h('dt', { className: 'wqb-infoKey' }, t('info.subject')),
                  h('dd', { className: 'wqb-infoValue' }, item.subject),
                  h('dt', { className: 'wqb-infoKey' }, t('info.tags')),
                  h(
                    'dd',
                    { className: 'wqb-infoValue' },
                    item.tags.length === 0 ? t('row.tagsEmpty') : item.tags.join('、'),
                  ),
                  h('dt', { className: 'wqb-infoKey' }, t('info.lastReviewed')),
                  h(
                    'dd',
                    { className: 'wqb-infoValue' },
                    typeof item.lastReviewedAt === 'number'
                      ? h('span', { title: formatStamp(item.lastReviewedAt) }, formatWhen(item.lastReviewedAt, t))
                      : t('info.never'),
                  ),
                  h('dt', { className: 'wqb-infoKey' }, t('info.reviewCount')),
                  h('dd', { className: 'wqb-infoValue' }, t('info.times', { count: item.reviewCount ?? 0 })),
                  h('dt', { className: 'wqb-infoKey' }, t('info.created')),
                  h('dd', { className: 'wqb-infoValue' }, formatStamp(item.createdAt)),
                ),
                h(
                  'div',
                  { className: 'wqb-infoAction' },
                  h(Button, {
                    variant: marked ? 'outline' : 'primary',
                    icon: marking ? h(Spinner) : h(Icon, { size: 13, path: paths.clock }),
                    disabled: marked || marking,
                    onClick: markReviewed,
                    className: 'wqb-fullBtn',
                  }, marked ? t('info.reviewed') : t('info.markReviewed')),
                ),
              ),
              h(
                'section',
                { className: 'wqb-card' },
                h(
                  'div',
                  { className: 'wqb-cardHead' },
                  h('h2', { className: 'wqb-cardTitle' }, t('ai.title')),
                ),
                h('p', { className: 'wqb-aiSub' }, t('ai.subtitle')),
                recommendation === undefined
                  ? h(
                      'div',
                      { className: 'wqb-api' },
                      h('div', { className: 'wqb-apiTitle' }, t('ai.api')),
                      h(
                        'div',
                        { className: 'wqb-apiRow' },
                        h('span', { className: 'wqb-apiKey' }, t('ai.model')),
                        h(
                          'span',
                          { className: 'wqb-apiValue', title: model === null ? '' : `${model.provider ?? ''} / ${model.model ?? ''}` },
                          modelReady
                            ? model.name ?? model.model
                            : modelFailed
                              ? t('ai.noModel')
                              : model?.name ?? model?.model ?? '…',
                        ),
                        modelReady || modelResolving
                          ? h('span', { className: 'wqb-apiSub' }, model?.provider ?? '')
                          : null,
                      ),
                      modelFailed
                        ? null
                        : modelResolving
                          ? h(
                              'div',
                              { className: 'wqb-apiRow' },
                              h('span', { className: 'wqb-apiKey' }, t('ai.effort')),
                              h('span', { className: 'wqb-apiValue wqb-apiMuted' }, t('ai.resolving')),
                            )
                          : modelEfforts.length === 0
                            ? h(
                                'div',
                                { className: 'wqb-apiRow' },
                                h('span', { className: 'wqb-apiKey' }, t('ai.effort')),
                                h('span', { className: 'wqb-apiValue wqb-apiMuted' }, t('ai.effortNone')),
                              )
                            : h(
                                'label',
                                { className: 'wqb-apiRow' },
                                h('span', { className: 'wqb-apiKey' }, t('ai.effort')),
                                h(
                                  'select',
                                  {
                                    className: 'wqb-select',
                                    value: effort,
                                    onChange: (event) => setEffort(event.target.value),
                                    'aria-label': t('ai.effort'),
                                  },
                                  h('option', { value: '' }, t('ai.effortDefault')),
                                  modelEfforts.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name)),
                                ),
                              ),
                    )
                  : h(
                      'div',
                      { className: 'wqb-api wqb-api--done' },
                      h('div', { className: 'wqb-apiTitle' }, t('ai.api')),
                      h(
                        'div',
                        { className: 'wqb-apiRow' },
                        h('span', { className: 'wqb-apiKey' }, t('ai.model')),
                        h(
                          'span',
                          { className: 'wqb-apiValue', title: recommendation.model },
                          recommendation.modelName ?? recommendation.model,
                        ),
                        h('span', { className: 'wqb-apiSub' }, recommendation.provider),
                      ),
                      h(
                        'div',
                        { className: 'wqb-apiRow' },
                        h('span', { className: 'wqb-apiKey' }, t('ai.effort')),
                        h('span', { className: 'wqb-apiValue' }, effortName),
                      ),
                      h(
                        'p',
                        { className: 'wqb-apiStamp' },
                        t('ai.generatedAt', { time: formatWhen(recommendation.generatedAt, t) }),
                      ),
                    ),
                recommendation === undefined
                  ? h(
                      React.Fragment,
                      null,
                      genError !== null
                        ? h(
                            'div',
                            { className: 'wqb-errorBox', role: 'alert' },
                            h(Icon, { size: 13, path: paths.warning }),
                            h('span', null, genError),
                          )
                        : null,
                      h(Button, {
                        variant: 'primary',
                        className: 'wqb-generate',
                        disabled: generating || !modelReady,
                        onClick: generate,
                        icon: generating ? h(Spinner) : h(Icon, { size: 14, path: paths.sparkle }),
                      }, generating ? t('ai.generating') : t('ai.generate')),
                      modelFailed
                        ? h('p', { className: 'wqb-hint wqb-hint--warn' }, t('ai.noModel'))
                        : modelResolving
                          ? h('p', { className: 'wqb-hint' }, t('ai.resolving'))
                          : h('p', { className: 'wqb-hint' }, t('ai.once')),
                    )
                  : h(
                      React.Fragment,
                      null,
                      h(
                        'ul',
                        { className: 'wqb-recList' },
                        recommendation.items.map((entry, index) =>
                          h(
                            'li',
                            { key: index },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'wqb-recItem',
                                onClick: () => setRecIndex(index),
                              },
                              h('span', { className: 'wqb-recIndex' }, pad2(index + 1)),
                              h(
                                'span',
                                { className: 'wqb-recItemBody' },
                                h('span', { className: 'wqb-recItemTitle' }, entry.title),
                                h('span', { className: 'wqb-recItemHint' }, t('ai.openHint')),
                              ),
                              entry.difficulty !== undefined ? h(Chip, null, entry.difficulty) : null,
                            ),
                          ),
                        ),
                      ),
                      h('p', { className: 'wqb-hint' }, t('ai.once')),
                    ),
              ),
            ),
          ),
        ),
        recIndex !== null && recommendation !== undefined
          ? h(RecommendationDialog, {
              recommendation,
              index: recIndex,
              labels,
              t,
              onIndex: setRecIndex,
              onClose: () => setRecIndex(null),
            })
          : null,
      )
    }

    /** Effort display name for one id, falling back to the raw id. */
    function effortLabel(efforts, id, fallback) {
      const match = efforts.find((entry) => entry.id === id)
      return match === undefined ? (id === undefined || id === '' ? fallback : id) : match.name
    }

    /* ------------------------------------------------------------------ *
     * Recommendation dialog
     * ------------------------------------------------------------------ */

    function RecommendationDialog({ recommendation, index, labels, t, onIndex, onClose }) {
      const total = recommendation.items.length
      const item = recommendation.items[Math.min(Math.max(index, 0), total - 1)]

      const onKeyDown = useCallback(
        (event) => {
          if (event.key === 'ArrowLeft' && index > 0) {
            event.preventDefault()
            onIndex(index - 1)
            return true
          }
          if (event.key === 'ArrowRight' && index < total - 1) {
            event.preventDefault()
            onIndex(index + 1)
            return true
          }
          return false
        },
        [index, onIndex, total],
      )

      return h(
        Dialog,
        { onClose, labelledBy: 'wqb-rec-title', className: 'wqb-dialog--rec', extraKeyDown: onKeyDown },
        h(
          'div',
          { className: 'wqb-dialogHead' },
          h(
            'div',
            { className: 'wqb-dialogTitleWrap' },
            h('h2', { className: 'wqb-dialogTitle', id: 'wqb-rec-title' }, t('rec.title')),
            h('span', { className: 'wqb-dialogCounter' }, t('rec.index', { index: index + 1, total })),
          ),
          h(
            'button',
            { type: 'button', className: 'wqb-iconBtn', onClick: onClose, 'aria-label': t('rec.close') },
            h(Icon, { size: 16, path: paths.close }),
          ),
        ),
        h(
          'div',
          { className: 'wqb-dialogBody' },
          item.difficulty !== undefined ? h('div', { className: 'wqb-recBadge' }, h(Chip, null, item.difficulty)) : null,
          h('h3', { className: 'wqb-recHeading' }, item.title),
          h('div', { className: 'wqb-cardHead wqb-cardHead--tight' }, h('span', { className: 'wqb-cardTitle' }, t('rec.question'))),
          h(Markdown, { text: item.question, labels }),
          h('div', { className: 'wqb-hr' }),
          h('div', { className: 'wqb-cardHead wqb-cardHead--tight' }, h('span', { className: 'wqb-cardTitle' }, t('rec.answer'))),
          h(Markdown, { text: item.answer, labels }),
        ),
        h(
          'div',
          { className: 'wqb-dialogFoot' },
          h(Button, {
            size: 'sm',
            disabled: index <= 0,
            onClick: () => onIndex(index - 1),
            icon: h(Icon, { size: 13, path: paths.chevronLeft }),
          }, t('rec.prev')),
          h(Button, {
            size: 'sm',
            disabled: index >= total - 1,
            onClick: () => onIndex(index + 1),
          }, t('rec.next')),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Editor
     * ------------------------------------------------------------------ */

    function MarkdownField({ id, label, value, onChange, t, labels, rows, required, placeholder }) {
      const [mode, setMode] = useState('write')
      const textareaRef = useRef(null)

      const surround = (before, after, sample) => {
        const element = textareaRef.current
        if (element === null) return
        const start = element.selectionStart ?? value.length
        const end = element.selectionEnd ?? value.length
        const selected = value.slice(start, end) || sample
        const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`
        onChange(next)
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            element.focus()
            const from = start + before.length
            element.setSelectionRange(from, from + selected.length)
          })
        }
      }

      return h(
        'div',
        { className: 'wqb-field' },
        h(
          'div',
          { className: 'wqb-fieldHead' },
          h(
            'label',
            { htmlFor: id, className: 'wqb-fieldLabel' },
            label,
            required ? h('span', { className: 'wqb-req' }, '*') : null,
          ),
          h(
            'div',
            { className: 'wqb-fieldTools' },
            mode === 'write'
              ? h(
                  'div',
                  { className: 'wqb-mdTools' },
                  h('button', { type: 'button', className: 'wqb-mdTool', onClick: () => surround('**', '**', 'text'), title: t('editor.bold') }, 'B'),
                  h('button', { type: 'button', className: 'wqb-mdTool wqb-mdTool--italic', onClick: () => surround('*', '*', 'text'), title: t('editor.italic') }, 'I'),
                  h('button', { type: 'button', className: 'wqb-mdTool', onClick: () => surround('$', '$', 'x'), title: t('editor.mathInline') }, '∑'),
                  h('button', { type: 'button', className: 'wqb-mdTool', onClick: () => surround('\n$$\n', '\n$$\n', 'x'), title: t('editor.mathBlock') }, '∫'),
                )
              : null,
            h(
              'div',
              { className: 'wqb-fieldTabs', role: 'group' },
              h(
                'button',
                { type: 'button', className: cx('wqb-fieldTab', mode === 'write' && 'is-active'), onClick: () => setMode('write') },
                t('editor.edit'),
              ),
              h(
                'button',
                { type: 'button', className: cx('wqb-fieldTab', mode === 'preview' && 'is-active'), onClick: () => setMode('preview') },
                t('editor.preview'),
              ),
            ),
          ),
        ),
        mode === 'write'
          ? h('textarea', {
              id,
              ref: textareaRef,
              className: 'wqb-textarea',
              value,
              rows: rows ?? 5,
              spellCheck: false,
              placeholder: placeholder ?? '',
              onChange: (event) => onChange(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Tab') return
                event.preventDefault()
                const element = event.currentTarget
                const start = element.selectionStart
                const end = element.selectionEnd
                const next = `${value.slice(0, start)}  ${value.slice(end)}`
                onChange(next)
                if (typeof requestAnimationFrame === 'function') {
                  requestAnimationFrame(() => element.setSelectionRange(start + 2, start + 2))
                }
              },
            })
          : h(
              'div',
              { className: 'wqb-preview' },
              value.trim() === '' ? h('p', { className: 'wqb-hint' }, t('editor.previewEmpty')) : h(Markdown, { text: value, labels }),
            ),
        h('p', { className: 'wqb-fieldHint' }, t('editor.mdHint')),
      )
    }

    function QuestionEditor({ initial, subjects, labels, t, onCancel, onSave, onDelete }) {
      const editing = typeof initial?.id === 'string'
      const [subject, setSubject] = useState(initial?.subject ?? '')
      const [tags, setTags] = useState((initial?.tags ?? []).join(', '))
      const [title, setTitle] = useState(initial?.title ?? '')
      const [question, setQuestion] = useState(initial?.question ?? '')
      const [answer, setAnswer] = useState(initial?.answer ?? '')
      const [reason, setReason] = useState(initial?.reason ?? '')
      const [error, setError] = useState(null)
      const [saving, setSaving] = useState(false)
      const [deleting, setDeleting] = useState(false)
      const [confirmDelete, setConfirmDelete] = useState(false)

      const submit = useCallback(async () => {
        if (saving) return
        if (subject.trim() === '' || title.trim() === '' || question.trim() === '') {
          setError(t('editor.required'))
          return
        }
        setSaving(true)
        setError(null)
        try {
          await onSave({
            ...(editing ? { id: initial.id } : {}),
            subject: subject.trim(),
            tags,
            title: title.trim(),
            question,
            answer,
            reason,
          })
        } catch (failure) {
          setError(errorText(failure, t))
          setSaving(false)
        }
      }, [answer, editing, initial, onSave, question, reason, saving, subject, t, tags, title])

      const remove = useCallback(async () => {
        if (deleting) return
        if (!confirmDelete) {
          setConfirmDelete(true)
          return
        }
        setDeleting(true)
        setError(null)
        try {
          await onDelete(initial.id)
        } catch (failure) {
          setError(errorText(failure, t))
          setDeleting(false)
          setConfirmDelete(false)
        }
      }, [confirmDelete, deleting, initial, onDelete, t])

      const extraKeyDown = useCallback(
        (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
            return true
          }
          return false
        },
        [submit],
      )

      const tagPreview = parseTags(tags)

      return h(
        Dialog,
        { onClose: onCancel, labelledBy: 'wqb-editor-title', className: 'wqb-dialog--editor', extraKeyDown },
        h(
          'div',
          { className: 'wqb-dialogHead' },
          h('h2', { className: 'wqb-dialogTitle', id: 'wqb-editor-title' }, editing ? t('editor.editTitle') : t('editor.addTitle')),
          h(
            'button',
            { type: 'button', className: 'wqb-iconBtn', onClick: onCancel, 'aria-label': t('editor.cancel') },
            h(Icon, { size: 16, path: paths.close }),
          ),
        ),
        h(
          'div',
          { className: 'wqb-dialogBody' },
          h(
            'div',
            { className: 'wqb-form' },
            h(
              'div',
              { className: 'wqb-formRow' },
              h(
                'div',
                { className: 'wqb-field' },
                h('label', { className: 'wqb-fieldLabel', htmlFor: 'wqb-subject' }, t('editor.subject'), h('span', { className: 'wqb-req' }, '*')),
                h('input', {
                  id: 'wqb-subject',
                  className: 'wqb-input',
                  value: subject,
                  list: 'wqb-subject-options',
                  placeholder: t('editor.subjectPlaceholder'),
                  onChange: (event) => setSubject(event.target.value),
                }),
                h(
                  'datalist',
                  { id: 'wqb-subject-options' },
                  subjects.map((name) => h('option', { key: name, value: name })),
                ),
              ),
              h(
                'div',
                { className: 'wqb-field' },
                h('label', { className: 'wqb-fieldLabel', htmlFor: 'wqb-tags' }, t('editor.tags')),
                h('input', {
                  id: 'wqb-tags',
                  className: 'wqb-input',
                  value: tags,
                  placeholder: t('editor.tagsPlaceholder'),
                  onChange: (event) => setTags(event.target.value),
                }),
                tagPreview.length === 0
                  ? null
                  : h(
                      'div',
                      { className: 'wqb-tagPreview' },
                      tagPreview.map((name) => h(Chip, { key: name }, name)),
                    ),
              ),
            ),
            h(
              'div',
              { className: 'wqb-field' },
              h('label', { className: 'wqb-fieldLabel', htmlFor: 'wqb-title' }, t('editor.title'), h('span', { className: 'wqb-req' }, '*')),
              h('input', {
                id: 'wqb-title',
                className: 'wqb-input',
                value: title,
                placeholder: t('editor.titlePlaceholder'),
                onChange: (event) => setTitle(event.target.value),
              }),
            ),
            h(MarkdownField, {
              id: 'wqb-question',
              label: t('editor.question'),
              required: true,
              value: question,
              onChange: setQuestion,
              t,
              labels,
              rows: 7,
            }),
            h(MarkdownField, {
              id: 'wqb-answer',
              label: t('editor.answer'),
              value: answer,
              onChange: setAnswer,
              t,
              labels,
              rows: 7,
            }),
            h(MarkdownField, {
              id: 'wqb-reason',
              label: t('editor.reason'),
              value: reason,
              onChange: setReason,
              t,
              labels,
              rows: 4,
            }),
            error !== null ? h('div', { className: 'wqb-errorBox', role: 'alert' }, h(Icon, { size: 13, path: paths.warning }), h('span', null, error)) : null,
          ),
        ),
        h(
          'div',
          { className: 'wqb-dialogFoot' },
          editing
            ? h(Button, {
                variant: 'danger',
                size: 'sm',
                onClick: remove,
                disabled: deleting,
              }, deleting ? t('editor.saving') : confirmDelete ? t('editor.deleteConfirm') : t('editor.delete'))
            : h('span'),
          h(
            'div',
            { className: 'wqb-dialogFootEnd' },
            h(Button, { size: 'sm', onClick: onCancel }, t('editor.cancel')),
            h(Button, {
              variant: 'primary',
              size: 'sm',
              onClick: submit,
              disabled: saving,
              icon: saving ? h(Spinner) : undefined,
            }, saving ? t('editor.saving') : t('editor.save')),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Page
     * ------------------------------------------------------------------ */

    function readMemory(instanceId) {
      try {
        const raw = window.localStorage.getItem(MEMORY_KEY)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object' || parsed.instanceId !== instanceId) return null
        return parsed
      } catch {
        return null
      }
    }

    function writeMemory(value) {
      try {
        window.localStorage.setItem(MEMORY_KEY, JSON.stringify(value))
      } catch {
        /* storage may be unavailable; UI memory is best-effort */
      }
    }

    function WrongbookPage(props) {
      const { api, t } = props
      const [status, setStatus] = useState('loading')
      const [loadError, setLoadError] = useState(null)
      const [items, setItems] = useState([])
      const [model, setModel] = useState(null)
      const [modelPending, setModelPending] = useState(true)
      const [view, setView] = useState({ name: 'directory' })
      const [subject, setSubject] = useState('all')
      const [tag, setTag] = useState('all')
      const [query, setQuery] = useState('')
      const [editor, setEditor] = useState(null)
      const [toast, setToast] = useState(null)
      const restoredRef = useRef(false)
      const instanceRef = useRef(null)

      const labels = useMemo(
        () => ({
          code: {
            copyLabel: t('md.copy'),
            copiedLabel: t('md.copied'),
            toolbarLabels: {
              codeLabel: t('md.code'),
              wrapLabel: t('md.wrap'),
              unwrapLabel: t('md.unwrap'),
            },
          },
          footnotes: t('md.footnotes'),
        }),
        [t],
      )

      const showToast = useCallback((message) => {
        if (typeof message !== 'string' || message === '') return
        setToast({ id: `${Date.now()}-${Math.random()}`, message })
      }, [])

      useEffect(() => {
        if (toast === null) return
        const timer = setTimeout(() => setToast(null), 2600)
        return () => clearTimeout(timer)
      }, [toast])

      /* Model capability lookup is a separate, bounded request: the notebook
         opens from `hello` alone and the AI card degrades on its own. */
      const loadModel = useCallback(
        async (signal) => {
          setModelPending(true)
          try {
            const result = await api.model(signal)
            if (signal?.aborted === true) return
            setModel(result.model ?? null)
          } catch (error) {
            if (signal?.aborted === true) return
            setModel((current) =>
              current === null
                ? null
                : {
                    ...current,
                    available: false,
                    reason: 'model-unavailable',
                    message: error instanceof Error ? error.message : String(error),
                  },
            )
          } finally {
            if (signal?.aborted !== true) setModelPending(false)
          }
        },
        [api],
      )

      const load = useCallback(
        async (signal) => {
          setStatus('loading')
          setLoadError(null)
          try {
            const value = await api.hello(signal)
            if (signal?.aborted === true) return
            instanceRef.current = value.instanceId
            setItems(Array.isArray(value.items) ? value.items : [])
            setModel(value.model ?? null)
            if (!restoredRef.current) {
              restoredRef.current = true
              const memory = readMemory(value.instanceId)
              if (memory !== null) {
                setSubject(typeof memory.subject === 'string' ? memory.subject : 'all')
                setTag(typeof memory.tag === 'string' ? memory.tag : 'all')
                setQuery(typeof memory.query === 'string' ? memory.query : '')
                const savedView = memory.view
                if (
                  savedView !== null &&
                  typeof savedView === 'object' &&
                  savedView.name === 'question' &&
                  typeof savedView.id === 'string' &&
                  (value.items ?? []).some((item) => item.id === savedView.id)
                ) {
                  setView({ name: 'question', id: savedView.id })
                }
              }
            }
            setStatus('ready')
            void loadModel(signal)
          } catch (error) {
            if (signal?.aborted === true) return
            setLoadError(error)
            setStatus('error')
          }
        },
        [api, loadModel],
      )

      useEffect(() => {
        const controller = new AbortController()
        void load(controller.signal)
        return () => controller.abort()
      }, [load])

      useEffect(() => {
        if (status !== 'ready' || instanceRef.current === null) return
        const timer = setTimeout(() => {
          writeMemory({ instanceId: instanceRef.current, view, subject, tag, query })
        }, 250)
        return () => clearTimeout(timer)
      }, [status, view, subject, tag, query])

      const selected = view.name === 'question' ? items.find((item) => item.id === view.id) : undefined

      useEffect(() => {
        if (status !== 'ready' || view.name !== 'question' || selected !== undefined) return
        setView({ name: 'directory' })
      }, [status, view, selected])

      const openQuestion = useCallback((id) => setView({ name: 'question', id }), [])
      const backToDirectory = useCallback(() => setView({ name: 'directory' }), [])
      const openEditor = useCallback((item) => {
        setEditor(item === undefined ? { mode: 'create', key: `create-${Date.now()}` } : { mode: 'edit', key: `edit-${item.id}`, item })
      }, [])
      const closeEditor = useCallback(() => setEditor(null), [])

      const saveEditor = useCallback(
        async (draft) => {
          const result = await api.save(draft)
          const saved = result.item
          setItems((previous) =>
            previous.some((item) => item.id === saved.id)
              ? previous.map((item) => (item.id === saved.id ? saved : item))
              : [saved, ...previous],
          )
          setEditor(null)
          showToast(draft.id === undefined ? t('toast.saved') : t('toast.updated'))
          return saved
        },
        [api, showToast, t],
      )

      const deleteEditor = useCallback(
        async (id) => {
          await api.remove({ id })
          setItems((previous) => previous.filter((item) => item.id !== id))
          setEditor(null)
          setView({ name: 'directory' })
          showToast(t('toast.deleted'))
        },
        [api, showToast, t],
      )

      const reviewQuestion = useCallback(
        async (id) => {
          try {
            const result = await api.review({ id })
            const reviewed = result.item
            setItems((previous) => previous.map((item) => (item.id === reviewed.id ? reviewed : item)))
            showToast(t('toast.reviewed'))
            return true
          } catch (error) {
            showToast(errorText(error, t))
            return false
          }
        },
        [api, showToast, t],
      )

      const applyUpdated = useCallback((updated) => {
        setItems((previous) => previous.map((item) => (item.id === updated.id ? updated : item)))
      }, [])

      const subjects = useMemo(() => {
        const names = new Set()
        for (const item of items) names.add(item.subject)
        return [...names]
      }, [items])

      if (status === 'loading') {
        return h(
          'div',
          { className: 'wqb-page wqb-page--center' },
          h('style', null, CSS),
          h('div', { className: 'wqb-loading' }, h(Spinner), h('span', null, `${t('title')}…`)),
        )
      }

      if (status === 'error') {
        return h(
          'div',
          { className: 'wqb-page wqb-page--center' },
          h('style', null, CSS),
          h(
            'div',
            { className: 'wqb-empty', role: 'alert' },
            h('div', { className: 'wqb-emptyGlyph' }, h(Icon, { size: 22, path: paths.warning })),
            h('h2', { className: 'wqb-emptyTitle' }, t('error.title')),
            h('p', { className: 'wqb-emptyHint' }, errorText(loadError, t)),
            loadError instanceof Error && loadError.message !== ''
              ? h('p', { className: 'wqb-emptyDetail' }, loadError.message)
              : null,
            h(Button, { variant: 'primary', onClick: () => void load() }, t('error.retry')),
          ),
        )
      }

      return h(
        'div',
        { className: 'wqb-page' },
        h('style', null, CSS),
        view.name === 'question' && selected !== undefined
          ? h(QuestionView, {
              key: selected.id,
              item: selected,
              model,
              modelPending,
              api,
              labels,
              t,
              onBack: backToDirectory,
              onEdit: (item) => openEditor(item),
              onReviewed: reviewQuestion,
              onUpdated: applyUpdated,
            })
          : h(Directory, {
              items,
              subject,
              tag,
              query,
              onSubject: setSubject,
              onTag: setTag,
              onQuery: setQuery,
              onOpen: openQuestion,
              onAdd: () => openEditor(undefined),
              t,
            }),
        editor !== null
          ? h(QuestionEditor, {
              key: editor.key,
              initial: editor.mode === 'edit' ? editor.item : undefined,
              subjects,
              labels,
              t,
              onCancel: closeEditor,
              onSave: saveEditor,
              onDelete: deleteEditor,
            })
          : null,
        toast !== null
          ? h('div', { className: 'wqb-toast', role: 'status' }, toast.message)
          : null,
      )
    }

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    const CSS = `
.wqb-page{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.wqb-page *{box-sizing:border-box}
.wqb-page :is(button,input,textarea,select):focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.wqb-page--center{align-items:center;justify-content:center}
.wqb-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px 20px;padding:24px clamp(20px,3.5vw,40px) 16px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.wqb-headMain{min-width:0}
.wqb-pageTitle{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em;line-height:1.35}
.wqb-sub{margin:3px 0 0;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.wqb-headTools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.wqb-search{display:flex;align-items:center;gap:8px;height:32px;min-width:230px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:text}
.wqb-search:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.wqb-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px}
.wqb-search input::placeholder{color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-secondary));opacity:1}
.wqb-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md,12px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:500;white-space:nowrap;cursor:pointer;transition:background .12s,border-color .12s}
.wqb-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.wqb-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-bg-layer-2))}
.wqb-btn:disabled{opacity:.4;cursor:not-allowed}
.wqb-btnIcon{display:inline-flex;align-items:center;justify-content:center;flex:none}
.wqb-btnLabel{display:inline-block}
.wqb-btn--primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff)}
.wqb-btn--primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
.wqb-btn--outline{border:.5px solid var(--dsw-alias-border-l3);background:transparent}
.wqb-btn--danger{color:var(--dsw-alias-state-error-primary);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,transparent)}
.wqb-btn--danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05))}
.wqb-btn--sm{height:28px;padding:0 10px;font-size:12px;border-radius:var(--dsw-radius-sm,8px)}
.wqb-body{display:flex;flex:1;min-height:0}
.wqb-rail{flex:0 0 220px;display:flex;flex-direction:column;gap:1px;padding:14px 10px 28px;overflow:auto;border-right:.5px solid var(--dsw-alias-border-l1)}
.wqb-railTitle{padding:6px 10px 5px;font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.wqb-railItem{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.wqb-railItem:hover{background:var(--dsw-alias-bg-layer-2)}
.wqb-railItem.is-active{background:var(--dsw-alias-bg-layer-2);font-weight:600}
.wqb-railLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wqb-railCount{flex:none;font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.wqb-railDivider{height:.5px;margin:10px 10px 8px;background:var(--dsw-alias-border-l1)}
.wqb-railEmpty{margin:2px 10px 0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.wqb-content{flex:1;min-width:0;overflow:auto;padding:18px clamp(20px,3.5vw,40px) 48px}
.wqb-rows{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.wqb-row{display:flex;align-items:center;gap:16px;padding:13px 16px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1);transition:border-color .12s}
.wqb-row:hover{border-color:var(--dsw-alias-border-l2)}
.wqb-rowMain{flex:1;min-width:0}
.wqb-rowTop{display:flex;align-items:center;gap:8px;min-width:0}
.wqb-rowTitle{margin:0;font-size:14px;font-weight:600;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wqb-rowMeta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;color:var(--dsw-alias-label-secondary);font-size:12px}
.wqb-chip{display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.wqb-chip--subject{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-label-primary)}
.wqb-when{white-space:nowrap}
.wqb-dotSep{width:2px;height:2px;border-radius:50%;background:var(--dsw-alias-label-secondary);opacity:.55}
.wqb-review{flex:none}
.wqb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:320px;padding:40px 20px;text-align:center;color:var(--dsw-alias-label-secondary)}
.wqb-emptyGlyph{display:grid;place-items:center;width:46px;height:46px;margin-bottom:4px;border-radius:13px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.wqb-emptyTitle{margin:0;font-size:14.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.wqb-emptyHint{margin:0 0 6px;max-width:390px;font-size:12.5px;line-height:1.7}
.wqb-emptyDetail{margin:0 0 8px;max-width:520px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));overflow-wrap:anywhere}
.wqb-dir{display:flex;flex:1;flex-direction:column;min-height:0}
.wqb-question{display:flex;flex:1;flex-direction:column;min-height:0}
.wqb-qhead{display:flex;align-items:center;gap:12px;padding:12px clamp(20px,3.5vw,40px);border-bottom:.5px solid var(--dsw-alias-border-l1)}
.wqb-back{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px 0 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;flex:none}
.wqb-back:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.wqb-qheadMeta{display:flex;flex:1;align-items:center;gap:6px;min-width:0;overflow:hidden}
.wqb-qscroll{flex:1;min-height:0;overflow:auto;padding:20px clamp(20px,3.5vw,40px) 48px;scrollbar-gutter:stable}
.wqb-qgrid{display:grid;grid-template-columns:minmax(0,1fr) 336px;gap:18px;align-items:start;max-width:1280px;margin:0 auto}
.wqb-qleft{display:flex;flex-direction:column;gap:14px;min-width:0}
.wqb-qright{display:flex;flex-direction:column;gap:14px;min-width:0}
.wqb-card{padding:16px 18px;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.wqb-qtitle{margin:0 0 10px;font-size:18px;font-weight:600;line-height:1.45;letter-spacing:-.01em}
.wqb-cardHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.wqb-cardHead--tight{margin:14px 0 6px}
.wqb-cardTitle{margin:0;font-size:11.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.wqb-md{min-width:0;overflow-wrap:anywhere}
.wqb-md>:first-child{margin-top:0}
.wqb-md>:last-child{margin-bottom:0}
.wqb-mdEmpty{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}
.wqb-mdFallback{margin:0;padding:0;background:transparent;color:inherit;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}
.wqb-curtain{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;width:100%;min-height:134px;padding:20px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;transition:border-color .12s,color .12s}
.wqb-curtain:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.wqb-curtainMark{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-size:15px;font-weight:600}
.wqb-curtainLabel{font-size:13.5px;font-weight:500;color:var(--dsw-alias-label-primary)}
.wqb-curtainHint{font-size:12px;color:var(--dsw-alias-label-secondary)}
.wqb-infoList{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 14px;margin:0;font-size:12.5px;align-items:baseline}
.wqb-infoKey{color:var(--dsw-alias-label-secondary);white-space:nowrap}
.wqb-infoValue{margin:0;min-width:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.wqb-infoAction{margin-top:14px}
.wqb-fullBtn{width:100%}
.wqb-aiSub{margin:-2px 0 12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.wqb-api{display:flex;flex-direction:column;gap:6px;padding:10px 12px;margin-bottom:12px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l1)}
.wqb-api--done{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,var(--dsw-alias-bg-base))}
.wqb-apiTitle{margin:0 0 1px;font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.wqb-apiRow{display:flex;align-items:center;gap:8px;font-size:12.5px;min-height:22px}
.wqb-apiKey{flex:0 0 60px;color:var(--dsw-alias-label-secondary)}
.wqb-apiValue{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.wqb-apiMuted{color:var(--dsw-alias-label-secondary);font-weight:400}
.wqb-apiSub{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11.5px}
.wqb-apiStamp{margin:2px 0 0;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.wqb-select{height:26px;max-width:100%;padding:0 6px;border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none;cursor:pointer}
.wqb-generate{width:100%;height:36px}
.wqb-hint{margin:8px 0 0;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.wqb-hint--warn{color:var(--dsw-alias-state-warn-primary)}
.wqb-recList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.wqb-recItem{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;transition:border-color .12s}
.wqb-recItem:hover{border-color:var(--dsw-alias-brand-primary)}
.wqb-recIndex{flex:none;font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.wqb-recItemBody{display:flex;flex:1;flex-direction:column;min-width:0;gap:2px}
.wqb-recItemTitle{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wqb-recItemHint{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.wqb-overlay{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:26px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.3));backdrop-filter:var(--dsw-mask-blur,blur(1.5px))}
.wqb-dialog{display:flex;flex-direction:column;width:min(780px,100%);max-height:100%;min-height:0;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent,0 24px 64px rgba(0,0,0,.28));overflow:hidden;outline:none}
.wqb-dialog--rec{width:min(820px,100%)}
.wqb-dialog--editor{width:min(860px,100%)}
.wqb-dialogHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}
.wqb-dialogTitleWrap{display:flex;align-items:baseline;gap:10px;min-width:0}
.wqb-dialogTitle{margin:0;font-size:15px;font-weight:600}
.wqb-dialogCounter{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.wqb-dialogBody{flex:1;min-height:0;overflow:auto;padding:16px 18px 20px}
.wqb-dialogFoot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 18px;border-top:.5px solid var(--dsw-alias-border-l1);flex:none}
.wqb-dialogFootEnd{display:flex;align-items:center;gap:8px;margin-left:auto}
.wqb-iconBtn{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.wqb-iconBtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.wqb-recBadge{display:flex;margin-bottom:4px}
.wqb-recHeading{margin:0 0 8px;font-size:16px;font-weight:600;line-height:1.5;letter-spacing:-.01em}
.wqb-hr{height:.5px;margin:18px 0;background:var(--dsw-alias-border-l1)}
.wqb-form{display:flex;flex-direction:column;gap:13px}
.wqb-formRow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:13px}
.wqb-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.wqb-fieldHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.wqb-fieldLabel{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary)}
.wqb-req{margin-left:3px;color:var(--dsw-alias-state-error-primary)}
.wqb-fieldTools{display:flex;align-items:center;gap:8px}
.wqb-mdTools{display:inline-flex;align-items:center;gap:1px;padding:2px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}
.wqb-mdTool{width:22px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;font-weight:600;line-height:1;cursor:pointer}
.wqb-mdTool:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.wqb-mdTool--italic{font-style:italic;font-family:Georgia,serif}
.wqb-fieldTabs{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}
.wqb-fieldTab{height:20px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer}
.wqb-fieldTab.is-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.wqb-input{height:32px;min-width:0;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;outline:none}
.wqb-input:focus{border-color:var(--dsw-alias-state-business-primary)}
.wqb-textarea{min-height:96px;resize:vertical;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.7;outline:none;white-space:pre-wrap;tab-size:2}
.wqb-textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.wqb-preview{min-height:96px;padding:10px 12px;border:.5px dashed var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);overflow:auto}
.wqb-fieldHint{margin:0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.wqb-tagPreview{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
.wqb-errorBox{display:flex;align-items:flex-start;gap:7px;padding:8px 10px;margin-bottom:8px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12.5px;line-height:1.55}
.wqb-errorBox svg{flex:none;margin-top:3px}
.wqb-toast{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);z-index:60;max-width:78%;padding:9px 16px;border-radius:999px;background:var(--dsw-alias-toast-bg,var(--dsw-alias-label-primary));color:var(--dsw-alias-toast-label,var(--dsw-alias-bg-base));font-size:12.5px;box-shadow:0 8px 24px rgba(0,0,0,.2);animation:wqb-rise .16s ease-out}
@keyframes wqb-rise{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
.wqb-spin{display:inline-block;width:13px;height:13px;border-radius:50%;border:1.5px solid currentColor;border-top-color:transparent;animation:wqb-spin .7s linear infinite}
@keyframes wqb-spin{to{transform:rotate(360deg)}}
.wqb-loading{display:flex;align-items:center;gap:9px;color:var(--dsw-alias-label-secondary);font-size:13px}
@media (prefers-reduced-motion:reduce){.wqb-toast,.wqb-spin{animation:none}}
@media (max-width:980px){.wqb-qgrid{grid-template-columns:minmax(0,1fr)}.wqb-rail{flex-basis:186px}}
@media (max-width:760px){.wqb-body{flex-direction:column}.wqb-rail{flex:none;max-height:172px;border-right:0;border-bottom:.5px solid var(--dsw-alias-border-l1)}.wqb-formRow{grid-template-columns:minmax(0,1fr)}.wqb-head{align-items:flex-start}.wqb-search{min-width:0;flex:1}}
`

    /* ------------------------------------------------------------------ *
     * Plugin
     * ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'wrongbook: dictionaries')
        const t = ctx.locale.bind(NS)
        const api = createApi(ctx)

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ api }),
            },
            WrongbookPage,
          ),
        )

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 8,
              locale: NS,
              label: () => t('panel.label'),
            },
            SidebarIcon,
          ),
        )
      },
    }
  },
})
