/**
 * Wrong-question notebook — Host half.
 *
 * Owns the durable store (a single JSON document under the Harness home), the
 * browser RPC channel the Client half talks to, and the one-shot "similar
 * problem" generation through the Harness `llm` service.
 *
 * Every browser call arrives through `ctx.connection.rpc.handle()`: the same
 * Host/Origin fence and browser authentication the shipped `/api` transport
 * uses, with no extra HTTP surface of our own.
 *
 * @module @local/dsh-wrongbook
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Browser RPC channel; `/x-` keeps it clear of the shared `/api` transport. */
const CHANNEL = '/x-wrongbook'

/** Storage document version. */
const DATA_VERSION = 1

/** Maximum accepted input sizes, in characters. */
const LIMITS = Object.freeze({
  subject: 40,
  tag: 30,
  tags: 8,
  title: 160,
  question: 24000,
  answer: 24000,
  reason: 12000,
})

/**
 * Optional hard cap on one recommendation batch.
 *
 * Left undefined by default so the request inherits the same provider/model
 * completion budget an ordinary Session uses: an explicit small cap made
 * reasoning models report `max-tokens` before the JSON closed. The stream is
 * still closed as soon as a complete batch arrives, so the provider budget is
 * a safety net rather than the expected stopping point. Set
 * `DSH_WRONGBOOK_MAX_OUTPUT_TOKENS` to impose a tighter cost cap.
 */
const MAX_OUTPUT_TOKENS_OVERRIDE = positiveInteger(process.env.DSH_WRONGBOOK_MAX_OUTPUT_TOKENS)

/** How long one resolved model route is reused by the browser. */
const MODEL_CACHE_MS = 60_000

/** Upper bound on one request body (question fields are capped well below this). */
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024

/** Upper bound on one adapter capability lookup. */
const MODEL_RESOLVE_TIMEOUT_MS = 10_000

/** One RPC endpoint segment. */
const ENDPOINT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/** System prompt: a science teacher writing harder variants of one wrong problem. */
const SYSTEM_PROMPT = [
  '你是一位资深的理科教师，精通数学、物理、化学、生物。',
  '学生会给你一道做错的题、标准答案和错因分析，你要据此设计 2-3 道同考点、略高难度的变式题，并给出完整、逐步、可核验的解答。',
  '要求：',
  '1. 变式题必须命中同一考点，难度略高于原题，不与原题重复。',
  '2. 题目与解答都要自洽、可计算；能给出数值结果的一定给出数值结果。',
  '3. 全部公式使用 LaTeX：行内用 $...$，独立公式用 $$...$$。',
  '4. 解答要写出关键步骤、所用公式或定理、以及最终答案，不要只给结论。',
  '5. 使用简体中文。',
  '6. 只输出一个 JSON 对象，不要输出任何额外说明。',
].join('\n')

/**
 * Typed failure whose code reaches the browser as an RPC error code.
 */
class WrongbookError extends Error {
  /**
   * @param {string} code - stable machine code the Client maps to localized copy.
   * @param {string} message - English diagnostic for logs.
   */
  constructor(code, message) {
    super(message)
    this.name = 'WrongbookError'
    this.code = code
  }
}

/**
 * Resolve the durable JSON document path.
 *
 * Precedence: an explicit `DSH_WRONGBOOK_FILE`, then `DSH_HOME`, then the home
 * derived from `DSH_PROFILE_DIR` (`<home>/profiles/<name>`), then `~/.dsh`.
 */
function resolveDataFile() {
  const override = process.env.DSH_WRONGBOOK_FILE
  if (typeof override === 'string' && override.trim() !== '') return override.trim()
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home.trim() !== '') return join(home.trim(), 'wrongbook', 'questions.json')
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir.trim() !== '') {
    const profiles = dirname(profileDir.trim())
    if (profiles !== '' && dirname(profiles) !== profiles) {
      return join(dirname(profiles), 'wrongbook', 'questions.json')
    }
  }
  return join(homedir(), '.dsh', 'wrongbook', 'questions.json')
}

/** @param {unknown} value */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse a positive integer from a string, or return undefined.
 * @param {unknown} value - raw value.
 * @returns {number | undefined}
 */
function positiveInteger(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Reject when `operation` does not settle within `ms`.
 * @template T
 * @param {Promise<T>} operation - work to bound.
 * @param {number} ms - deadline in milliseconds.
 * @param {string} label - diagnostic subject.
 * @returns {Promise<T>}
 */
async function withTimeout(operation, ms, label) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms)
    timer.unref?.()
  })
  try {
    return await Promise.race([operation, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Read one request body as UTF-8 text, refusing oversized payloads.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @param {number} limit - maximum accepted bytes.
 * @returns {Promise<string>}
 */
function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > limit) {
        fail(new Error('request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', fail)
  })
}

/** @param {unknown} value */
function stringOf(value) {
  return typeof value === 'string' ? value : undefined
}

/** @param {unknown} value */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Normalize one free-text field.
 * @param {unknown} value - raw input.
 * @param {string} field - field name for the diagnostic.
 * @param {number} max - maximum accepted length.
 * @param {boolean} required - whether an empty value is rejected.
 * @returns {string}
 */
function textField(value, field, max, required) {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return ''
    throw new WrongbookError('invalid-call', `field "${field}" must be a string`)
  }
  const text = value.replace(/\r\n/g, '\n').trim()
  if (required && text === '') throw new WrongbookError('invalid-call', `field "${field}" is required`)
  return text.length > max ? text.slice(0, max) : text
}

/**
 * Split a tag input (`"函数, 导数"`, `"函数，导数"`, or an array) into unique tags.
 * @param {unknown} value - raw input.
 * @returns {string[]}
 */
function tagList(value) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、;；]/) : []
  const seen = new Set()
  const tags = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const tag = entry.trim().replace(/\s+/g, ' ')
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag.length > LIMITS.tag ? tag.slice(0, LIMITS.tag) : tag)
    if (tags.length >= LIMITS.tags) break
  }
  return tags
}

/**
 * Validate one stored recommendation block.
 * @param {unknown} value - stored value.
 * @returns {{provider: string, model: string, modelName?: string, reasoningEffort?: string, generatedAt: number, items: Array<{title: string, difficulty?: string, question: string, answer: string}>} | undefined}
 */
function recommendationOf(value) {
  if (!isObject(value) || !Array.isArray(value.items)) return undefined
  const items = []
  for (const entry of value.items) {
    if (!isObject(entry)) continue
    const question = stringOf(entry.question)?.trim() ?? ''
    const answer = stringOf(entry.answer)?.trim() ?? ''
    if (question === '' || answer === '') continue
    items.push({
      title: stringOf(entry.title)?.trim() || `推荐题目 ${items.length + 1}`,
      ...typeof entry.difficulty === 'string' && entry.difficulty.trim() !== ''
        ? { difficulty: entry.difficulty.trim().slice(0, 20) }
        : {},
      question,
      answer,
    })
    if (items.length >= 4) break
  }
  if (items.length === 0) return undefined
  return {
    provider: stringOf(value.provider) ?? '',
    model: stringOf(value.model) ?? '',
    ...typeof value.modelName === 'string' && value.modelName !== '' ? { modelName: value.modelName } : {},
    ...typeof value.reasoningEffort === 'string' && value.reasoningEffort !== ''
      ? { reasoningEffort: value.reasoningEffort }
      : {},
    generatedAt: numberOrNull(value.generatedAt) ?? 0,
    items,
  }
}

/**
 * Normalize one stored record, or drop it when it carries no usable content.
 * @param {unknown} value - stored value.
 * @returns {Record<string, any> | undefined}
 */
function recordOf(value) {
  if (!isObject(value)) return undefined
  const id = stringOf(value.id)
  const subject = stringOf(value.subject)?.trim() ?? ''
  const title = stringOf(value.title)?.trim() ?? ''
  const question = stringOf(value.question) ?? ''
  if (id === undefined || id === '' || subject === '' || title === '' || question.trim() === '') return undefined
  const recommendation = recommendationOf(value.recommendation)
  return {
    id,
    subject: subject.slice(0, LIMITS.subject),
    tags: tagList(value.tags),
    title: title.slice(0, LIMITS.title),
    question,
    answer: stringOf(value.answer) ?? '',
    reason: stringOf(value.reason) ?? '',
    createdAt: numberOrNull(value.createdAt) ?? Date.now(),
    updatedAt: numberOrNull(value.updatedAt) ?? numberOrNull(value.createdAt) ?? Date.now(),
    lastReviewedAt: numberOrNull(value.lastReviewedAt),
    reviewCount: numberOrNull(value.reviewCount) ?? 0,
    reviewHistory: Array.isArray(value.reviewHistory)
      ? value.reviewHistory.filter((entry) => typeof entry === 'number' && Number.isFinite(entry)).slice(-30)
      : [],
    ...recommendation === undefined ? {} : { recommendation },
  }
}

/**
 * The durable notebook: lazy load, in-memory reads, serialized atomic writes.
 */
function createStore(logger) {
  const file = resolveDataFile()
  /** @type {Array<Record<string, unknown>> | undefined} */
  let items
  /** @type {Promise<Array<Record<string, unknown>>> | undefined} */
  let loading
  let writing = Promise.resolve()

  const warn = (message) => {
    try {
      logger?.warn?.(message)
    } catch {
      /* logging must never fail a request */
    }
  }

  /** Load once; a corrupt document is kept aside instead of blocking the notebook. */
  const load = () => {
    if (items !== undefined) return Promise.resolve(items)
    if (loading !== undefined) return loading
    loading = (async () => {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'))
        const list = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.items) ? parsed.items : []
        items = list.map(recordOf).filter((entry) => entry !== undefined)
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          warn(`[wrongbook] ignoring unreadable store ${file}: ${String(error)}`)
          /* Keep the unreadable document instead of overwriting it on the next save. */
          await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {})
        }
        items = []
      }
      return items
    })()
    return loading
  }

  /** Write the whole document through a temp file + rename. */
  const persist = () => {
    const body = `${JSON.stringify({ version: DATA_VERSION, items }, null, 2)}\n`
    const next = writing.catch(() => {}).then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temporary, body, 'utf8')
      await rename(temporary, file)
    })
    writing = next
    return next
  }

  return {
    file,
    async list() {
      const all = await load()
      return all
        .map((entry) => ({ ...entry }))
        .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    },
    async find(id) {
      const all = await load()
      return all.find((entry) => entry.id === id)
    },
    async create(input) {
      const all = await load()
      const now = Date.now()
      const record = {
        id: randomUUID(),
        ...input,
        tags: [...input.tags],
        createdAt: now,
        updatedAt: now,
        lastReviewedAt: null,
        reviewCount: 0,
        reviewHistory: [],
      }
      all.push(record)
      await persist()
      return { ...record }
    },
    async update(id, input) {
      const record = await this.find(id)
      if (record === undefined) throw new WrongbookError('not-found', `no wrong question with id ${id}`)
      Object.assign(record, input, { tags: [...input.tags], updatedAt: Date.now() })
      await persist()
      return { ...record }
    },
    async review(id) {
      const record = await this.find(id)
      if (record === undefined) throw new WrongbookError('not-found', `no wrong question with id ${id}`)
      const now = Date.now()
      record.lastReviewedAt = now
      record.reviewCount = (record.reviewCount ?? 0) + 1
      record.reviewHistory = [...(record.reviewHistory ?? []), now].slice(-30)
      await persist()
      return { ...record }
    },
    async remove(id) {
      const all = await load()
      const index = all.findIndex((entry) => entry.id === id)
      if (index === -1) return false
      all.splice(index, 1)
      await persist()
      return true
    },
    async storeRecommendation(id, recommendation) {
      const record = await this.find(id)
      if (record === undefined) throw new WrongbookError('not-found', `no wrong question with id ${id}`)
      record.recommendation = recommendation
      await persist()
      return { ...record }
    },
  }
}

/**
 * Trim model output down to the JSON document it was asked for.
 * @param {string} text - raw model text.
 * @returns {unknown}
 */
function extractJson(text) {
  /** @type {string[]} */
  const candidates = []
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi
  let match
  while ((match = fenced.exec(text)) !== null) candidates.push(match[1])
  candidates.push(text)
  for (const candidate of candidates) {
    const direct = tryParse(candidate)
    if (direct !== undefined) return direct
    const trimmed = candidate.trim()
    const start = trimmed.search(/[[{]/)
    if (start === -1) continue
    const end = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'))
    if (end <= start) continue
    const sliced = tryParse(trimmed.slice(start, end + 1))
    if (sliced !== undefined) return sliced
  }
  return undefined
}

/** @param {string} text */
function tryParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Turn one parsed model answer into validated recommendation items.
 * @param {unknown} parsed - parsed JSON value.
 * @returns {Array<{title: string, difficulty?: string, question: string, answer: string}>}
 */
function recommendationItems(parsed) {
  /** @type {unknown[]} */
  let entries = []
  if (Array.isArray(parsed)) entries = parsed
  else if (isObject(parsed)) {
    if (Array.isArray(parsed.items)) entries = parsed.items
    else if (Array.isArray(parsed.questions)) entries = parsed.questions
    else if (Array.isArray(parsed.problems)) entries = parsed.problems
    else entries = [parsed]
  }
  const items = []
  for (const entry of entries) {
    if (!isObject(entry)) continue
    const question = (stringOf(entry.question) ?? stringOf(entry.problem) ?? stringOf(entry.stem) ?? '').trim()
    const answer = (stringOf(entry.answer) ?? stringOf(entry.solution) ?? '').trim()
    if (question === '' || answer === '') continue
    const title = (stringOf(entry.title) ?? stringOf(entry.name) ?? '').trim()
    const difficulty = (stringOf(entry.difficulty) ?? stringOf(entry.level) ?? '').trim()
    items.push({
      title: title === '' ? `推荐题目 ${items.length + 1}` : title.slice(0, 160),
      ...difficulty === '' ? {} : { difficulty: difficulty.slice(0, 20) },
      question: question.slice(0, LIMITS.question),
      answer: answer.slice(0, LIMITS.answer),
    })
    if (items.length >= 3) break
  }
  return items
}

/**
 * Compose the generation prompt for one wrong question.
 * @param {Record<string, any>} record - stored question.
 */
function generationPrompt(record) {
  const tags = Array.isArray(record.tags) && record.tags.length > 0 ? record.tags.join('、') : '（未标注）'
  const clip = (text) => (text.length > 5000 ? `${text.slice(0, 5000)}\n…（已截断）` : text)
  return [
    `【科目】${record.subject}`,
    `【考点】${tags}`,
    `【题目名称】${record.title}`,
    `【题目】\n${clip(record.question)}`,
    `【标准答案】\n${clip(record.answer || '（未填写）')}`,
    `【错因分析】\n${clip(record.reason || '（未填写）')}`,
    '',
    '请生成 2-3 道同考点、难度略高的变式题，并给出详细解答。',
    '只输出如下 JSON 对象（不要用代码块包裹以外的任何文字）：',
    '{"items":[{"title":"题目名称","difficulty":"同类|略高","question":"题干（Markdown + LaTeX）","answer":"完整详细解答（Markdown + LaTeX）"}]}',
  ].join('\n')
}

/** Read the default model route without touching an adapter. */
function basicModelRoute(ctx) {
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
  if (selection === undefined) return { available: null, reason: 'no-default-model' }
  return {
    available: null,
    provider: String(selection.provider),
    model: String(selection.model),
    ...selection.reasoningEffort === undefined
      ? {}
      : { selectedEffort: String(selection.reasoningEffort) },
  }
}

/** Read the default model route and its advertised reasoning efforts. */
function createModelRoute(ctx) {
  /** @type {{at: number, value: any} | undefined} */
  let cache

  const resolve = async (force) => {
    const now = Date.now()
    if (!force && cache !== undefined && now - cache.at < MODEL_CACHE_MS) return cache.value
    const llm = ctx.get('llm')
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    if (selection === undefined) {
      return { available: false, reason: 'no-default-model' }
    }
    const base = {
      provider: String(selection.provider),
      model: String(selection.model),
      ...selection.reasoningEffort === undefined
        ? {}
        : { selectedEffort: String(selection.reasoningEffort) },
    }
    if (llm === undefined) return { ...base, available: false, reason: 'llm-unavailable' }
    try {
      const info = await withTimeout(
        llm.resolveModelInfo(base.provider, base.model),
        MODEL_RESOLVE_TIMEOUT_MS,
        'model capability lookup',
      )
      const efforts = (info.reasoning?.efforts ?? []).map((effort) => ({
        id: String(effort.id),
        name: String(effort.name),
        ...typeof effort.description === 'string' ? { description: effort.description } : {},
      }))
      const value = {
        ...base,
        available: true,
        name: String(info.name ?? base.model),
        efforts,
        ...info.reasoning?.defaultEffort === undefined
          ? {}
          : { defaultEffort: String(info.reasoning.defaultEffort) },
      }
      cache = { at: now, value }
      return value
    } catch (error) {
      return {
        ...base,
        available: false,
        reason: 'model-unavailable',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return { resolve }
}

/**
 * Stream one model answer, stopping as soon as a complete recommendation batch
 * is on the wire.
 *
 * The previous version consumed the stream to its terminal chunk, so a
 * reasoning model that spent its budget thinking reported `max-tokens` even
 * when a perfectly parseable batch had already arrived. Now the loop closes
 * the iterator early once the accumulated text parses into two or more
 * complete items, and a `max-tokens` finish is only an error when the text
 * still cannot produce a batch.
 *
 * @param {any} llm - Harness `llm` service.
 * @param {{provider: string, model: string, reasoningEffort?: string}} route - resolved route.
 * @param {string} prompt - user prompt.
 * @param {AbortSignal} signal - caller cancellation.
 * @returns {Promise<{items: Array<{title: string, difficulty?: string, question: string, answer: string}>, truncated: boolean}>}
 */
async function streamAnswer(llm, route, prompt, signal) {
  const stream = llm.stream({
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    ...MAX_OUTPUT_TOKENS_OVERRIDE === undefined ? {} : { maxTokens: MAX_OUTPUT_TOKENS_OVERRIDE },
    signal,
  })
  let text = ''
  /** @type {any} */
  let finish
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta') {
      text += String(chunk.text ?? '')
      /* Cheap trigger: a batch always ends with `}` (object/array close) or a
         closing fence. Only then pay for JSON extraction. */
      const tail = text.trimEnd()
      if (tail.endsWith('}') || tail.endsWith('```')) {
        const items = recommendationItems(extractJson(text))
        if (items.length >= 2) {
          /* Closing the iterator releases the provider connection early. */
          return { items, truncated: false }
        }
      }
    } else if (chunk?.type === 'finish') finish = chunk.reason
  }
  if (finish?.kind === 'aborted') throw new WrongbookError('aborted', 'model call was aborted')
  if (finish?.kind === 'error') {
    throw new WrongbookError('model-failed', finish.failure?.message ?? 'model call failed')
  }
  if (text.trim() === '') throw new WrongbookError('empty-output', 'model returned no text')
  const items = recommendationItems(extractJson(text))
  if (items.length >= 2) return { items, truncated: finish?.kind === 'max-tokens' }
  if (finish?.kind === 'max-tokens') {
    throw new WrongbookError('model-truncated', 'model output hit the token limit before the JSON was complete')
  }
  throw new WrongbookError('parse-failed', 'model output did not contain 2+ complete recommendations')
}

/**
 * Install the store, the RPC channel, and one-shot recommendation generation.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  const store = createStore(ctx.logger)
  const modelRoute = createModelRoute(ctx)
  const instanceId = randomUUID()
  /** Question ids with a generation currently in flight. */
  const generating = new Set()

  /** Shape one record into the browser payload. */
  const viewOf = (record) => ({
    ...record,
    tags: Array.isArray(record.tags) ? [...record.tags] : [],
    reviewHistory: Array.isArray(record.reviewHistory) ? [...record.reviewHistory] : [],
  })

  /** Dispatch one browser call. */
  const dispatch = async (endpoint, payload, signal) => {
    switch (endpoint) {
      case 'hello': {
        /* Never await model resolution here: the notebook must open even when
           the model service is slow, misconfigured, or offline. */
        const items = await store.list()
        return { instanceId, version: DATA_VERSION, items: items.map(viewOf), model: basicModelRoute(ctx) }
      }
      case 'list': {
        return { items: (await store.list()).map(viewOf) }
      }
      case 'model': {
        return { model: await modelRoute.resolve(true) }
      }
      case 'save': {
        const input = normalizeInput(isObject(payload) ? payload : {})
        const id = stringOf(payload?.id)
        const record = id === undefined || id === ''
          ? await store.create(input)
          : await store.update(id, input)
        return { item: viewOf(record) }
      }
      case 'review': {
        const id = stringOf(payload?.id) ?? ''
        return { item: viewOf(await store.review(id)) }
      }
      case 'remove': {
        const id = stringOf(payload?.id) ?? ''
        const removed = await store.remove(id)
        if (!removed) throw new WrongbookError('not-found', `no wrong question with id ${id}`)
        return { id }
      }
      case 'recommend': {
        const id = stringOf(payload?.id) ?? ''
        const record = await store.find(id)
        if (record === undefined) throw new WrongbookError('not-found', `no wrong question with id ${id}`)
        const existing = recommendationOf(record.recommendation)
        if (existing !== undefined) {
          throw new WrongbookError('already-generated', 'this question already has generated recommendations')
        }
        if (generating.has(id)) throw new WrongbookError('generating', 'recommendations are already being generated')
        const llm = ctx.get('llm')
        if (llm === undefined) throw new WrongbookError('llm-unavailable', 'the llm service is not mounted')
        const route = await modelRoute.resolve(false)
        if (route.available !== true) {
          throw new WrongbookError(
            'model-unavailable',
            route.message ?? `no usable model route (${String(route.reason ?? 'unknown')})`,
          )
        }
        const requested = stringOf(payload?.effort)
        const reasoningEffort = requested !== undefined && requested !== '' ? requested : route.selectedEffort
        generating.add(id)
        try {
          const { items } = await streamAnswer(
            llm,
            { provider: route.provider, model: route.model, reasoningEffort },
            generationPrompt(record),
            signal,
          )
          const updated = await store.storeRecommendation(id, {
            provider: route.provider,
            model: route.model,
            modelName: route.name,
            ...reasoningEffort === undefined ? {} : { reasoningEffort },
            generatedAt: Date.now(),
            items,
          })
          return { item: viewOf(updated) }
        } finally {
          generating.delete(id)
        }
      }
      default:
        throw new WrongbookError('unknown-method', `unknown endpoint ${endpoint}`)
    }
  }

  /*
   * Browser transport: one authenticated prefix route on the Host web server.
   *
   * `ctx.connection.rpc.handle()` is not used here: in this Harness build its
   * registration reads `owner.webServer` through the service's shadow context,
   * which the Cordis inject guard rejects even when this fiber declares both
   * services. The shipped API gateway registers its own route on `webServer`
   * and calls `connection.admit()` for the Host/Origin fence plus browser
   * session authentication — the exact pattern below. The wire format is the
   * generic Connection RPC envelope, so the Client keeps using
   * `connection.rpc.call()` unchanged.
   */
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    const route = {
      kind: 'prefix',
      path: CHANNEL,
      handler: async (req, res) => {
        const admission = webCtx.connection.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection)
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }

        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const endpoint = url.pathname.startsWith(`${CHANNEL}/`)
          ? url.pathname.slice(CHANNEL.length + 1)
          : ''
        if (req.method !== 'POST' || endpoint === '' || !ENDPOINT_PATTERN.test(endpoint)) {
          res.writeHead(404)
          res.end()
          return
        }
        const mediaType = String(req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase()
        if (mediaType !== 'application/json') {
          res.writeHead(415)
          res.end()
          return
        }

        /** @type {any} */
        let envelope
        try {
          envelope = JSON.parse(await readRequestBody(req, MAX_REQUEST_BODY_BYTES))
        } catch {
          res.writeHead(400)
          res.end()
          return
        }
        if (
          !isObject(envelope) ||
          envelope.type !== 'client-request' ||
          typeof envelope.rpcId !== 'string' ||
          typeof envelope.method !== 'string' ||
          envelope.method !== endpoint
        ) {
          res.writeHead(400)
          res.end()
          return
        }

        const controller = new AbortController()
        res.on('close', () => {
          if (!res.writableEnded) controller.abort()
        })

        /** @type {{ok: true, value: unknown} | {ok: false, error: {code: string, message: string, details: object}}} */
        let result
        try {
          const value = await dispatch(endpoint, envelope.payload, controller.signal)
          result = { ok: true, value: value ?? null }
        } catch (error) {
          const code = error instanceof WrongbookError ? error.code : 'failed'
          const message = error instanceof Error ? error.message : String(error)
          result = { ok: false, error: { code, message, details: {} } }
        }

        if (res.writableEnded || res.destroyed) return
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result }))
      },
    }

    webCtx.effect(() => webCtx.webServer.register(route), 'wrongbook: browser rpc route')
  })
}

/**
 * Validate the six-field editor payload into stored fields.
 * @param {Record<string, unknown>} payload - raw browser input.
 */
function normalizeInput(payload) {
  return {
    subject: textField(payload.subject, 'subject', LIMITS.subject, true),
    tags: tagList(payload.tags),
    title: textField(payload.title, 'title', LIMITS.title, true),
    question: textField(payload.question, 'question', LIMITS.question, true),
    answer: textField(payload.answer, 'answer', LIMITS.answer, false),
    reason: textField(payload.reason, 'reason', LIMITS.reason, false),
  }
}
