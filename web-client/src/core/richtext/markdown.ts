// src/core/markdown.ts
// Rich-text plumbing for the contenteditable composer, ported from tweb's
// approach (helpers/dom/markdown.ts + getRichValueWithCaret.ts) but trimmed to
// our entity set. Three jobs:
//   1. serialize() — walk the contenteditable DOM → { text, entities } with
//      UTF-16 offsets (plain JS string indices), the same units the renderer and
//      backend use, so the numbers slice the text identically everywhere.
//   2. apply()     — toggle a format on the current selection (B/I/U/S via native
//      execCommand which splits/merges text nodes reliably; code/spoiler/quote/
//      link via manual range wrap-or-unwrap).
//   3. entitiesToHtml() — rebuild markup HTML from { text, entities } so editing
//      an existing message re-loads it formatted.
import type { MessageEntity } from '@layer'
import { safeUrl } from '../safeUrl'

/**
 * Конструкторы сущностей, которыми оперирует композер: их ставит тулбар/горячие
 * клавиши, их же находит `serialize()` в разметке contenteditable.
 *
 * Приём с `Extract<MessageEntity['_'], …>` — из оригинала: tweb ровно так
 * ограничивает набор в `MarkdownTag['entityName']`
 * (`helpers/dom/getRichElementValue.ts:16-22`).
 */
export type ComposerEntityType = Extract<MessageEntity['_'],
  'messageEntityBold' | 'messageEntityItalic' | 'messageEntityUnderline' | 'messageEntityStrike' |
  'messageEntityCode' | 'messageEntityPre' | 'messageEntitySpoiler' | 'messageEntityBlockquote' |
  'messageEntityTextUrl' | 'messageEntityMentionName' | 'messageEntityCustomEmoji'>

// CSS classes the composer markup uses (see styles/index.scss). Kept here so serialize()
// and apply() agree on what a span of each type looks like.
const CLS: Record<string, ComposerEntityType> = {
  'md-code': 'messageEntityCode',
  'md-spoiler': 'messageEntitySpoiler',
  'md-quote': 'messageEntityBlockquote',
}

interface Active { _: ComposerEntityType; url?: string; language?: string; user_id?: number; document_id?: number; ce?: number }

/**
 * Собрать сущность нужного конструктора. Ветвление по `_`, как в оригинале
 * (tweb `parseMarkdown.ts:80-156`): у каждого конструктора свои обязательные
 * поля — `language` у pre, `url` у textUrl, `user_id`/`document_id` у
 * mentionName/customEmoji, `pFlags` у blockquote (`collapsed` — ключ ЕСТЬ только
 * когда включён).
 */
function buildEntity(a: Active, offset: number, length: number): MessageEntity {
  switch (a._) {
    case 'messageEntityPre': return { _: a._, offset, length, language: a.language ?? '' }
    case 'messageEntityTextUrl': return { _: a._, offset, length, url: a.url ?? '' }
    case 'messageEntityMentionName': return { _: a._, offset, length, user_id: a.user_id ?? 0 }
    case 'messageEntityCustomEmoji': return { _: a._, offset, length, document_id: a.document_id ?? 0 }
    case 'messageEntityBlockquote': return { _: a._, offset, length, pFlags: {} }
    default: return { _: a._, offset, length }
  }
}

// Unique nonce per custom-emoji element so two identical adjacent custom emoji
// (same document_id) never coalesce into one entity — each stays its own span.
let ceSeq = 0

// Which formats does this element contribute? Detects both tag-based markup
// (<b>, <i>, <a>…, produced by execCommand without styleWithCSS) and style-based
// markup (font-weight/font-style/text-decoration, produced with styleWithCSS),
// plus our own class spans for code/spoiler/quote.
function detect(el: HTMLElement): Active[] {
  const out: Active[] = []
  const tag = el.tagName
  const st = el.style
  const fw = st.fontWeight
  const td = `${st.textDecorationLine || st.textDecoration || ''}`
  if (tag === 'B' || tag === 'STRONG' || fw === 'bold' || (parseInt(fw, 10) >= 600)) out.push({ _: 'messageEntityBold' })
  if (tag === 'I' || tag === 'EM' || st.fontStyle === 'italic') out.push({ _: 'messageEntityItalic' })
  if (tag === 'U' || tag === 'INS' || td.includes('underline')) out.push({ _: 'messageEntityUnderline' })
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || td.includes('line-through')) out.push({ _: 'messageEntityStrike' })
  if (el.classList.contains('md-pre') || tag === 'PRE') {
    out.push({ _: 'messageEntityPre', language: el.dataset.language || el.getAttribute('data-language') || undefined })
  } else if (tag === 'CODE' || st.fontFamily.includes('monospace')) {
    out.push({ _: 'messageEntityCode' })
  }
  if (tag === 'BLOCKQUOTE') out.push({ _: 'messageEntityBlockquote' })
  if (el.classList.contains('md-custom-emoji') && el.dataset.docId) {
    // inline custom emoji (tweb messageEntityCustomEmoji): the element's text is the
    // fallback glyph; data-doc-id carries the sticker-document (media) id. A fresh
    // nonce keeps each element a distinct entity even when repeated back-to-back.
    out.push({ _: 'messageEntityCustomEmoji', document_id: Number(el.dataset.docId) || 0, ce: ++ceSeq })
  }
  if (tag === 'A' && el.dataset.mentionId) {
    // custom mention юзера без username (tweb A.follow / messageEntityMentionName)
    out.push({ _: 'messageEntityMentionName', user_id: Number(el.dataset.mentionId) || 0 })
  } else if (tag === 'A') {
    out.push({ _: 'messageEntityTextUrl', url: (el as HTMLAnchorElement).getAttribute('href') || undefined })
  }
  for (const cls of el.classList) {
    const t = CLS[cls]
    if (t && !out.some((a) => a._ === t)) out.push({ _: t })
  }
  return out
}

const BLOCK = new Set(['DIV', 'P', 'BLOCKQUOTE', 'PRE'])

/** Serialize a contenteditable root into message text + entities. */
export function serialize(root: HTMLElement): { text: string; entities: MessageEntity[] } {
  const runs: { text: string; active: Active[] }[] = []

  const walk = (node: Node, active: Active[]) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.nodeValue ?? ''
        if (t) runs.push({ text: t, active })
        return
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return
      const el = child as HTMLElement
      if (el.tagName === 'BR') { runs.push({ text: '\n', active }); return }
      // contenteditable wraps each line after the first in a block element; emit a
      // newline boundary before block content when text already precedes it.
      const isBlock = BLOCK.has(el.tagName)
      if (isBlock && runs.length && !runs[runs.length - 1].text.endsWith('\n')) {
        runs.push({ text: '\n', active })
      }
      walk(el, active.concat(detect(el)))
    })
  }
  walk(root, [])

  // Coalesce contiguous same-type (same url) runs into entities.
  const entities: MessageEntity[] = []
  const open = new Map<string, { active: Active; start: number }>()
  const keyOf = (a: Active) => `${a._}|${a.url ?? ''}|${a.language ?? ''}|${a.user_id ?? ''}|${a.document_id ?? ''}|${a.ce ?? ''}`
  const close = (k: string, end: number) => {
    const s = open.get(k)
    if (s && end > s.start) entities.push(buildEntity(s.active, s.start, end - s.start))
    open.delete(k)
  }
  let text = ''
  let offset = 0
  for (const run of runs) {
    const keys = new Set(run.active.map(keyOf))
    for (const k of [...open.keys()]) if (!keys.has(k)) close(k, offset)
    for (const a of run.active) { const k = keyOf(a); if (!open.has(k)) open.set(k, { active: a, start: offset }) }
    text += run.text
    offset += run.text.length
  }
  for (const k of [...open.keys()]) close(k, offset)

  return trimRich(text, entities)
}

// Trim leading/trailing whitespace and shift/clamp entity offsets to match (so
// "  **hi**  " → "hi" keeps the bold over the right characters).
function trimRich(text: string, entities: MessageEntity[]): { text: string; entities: MessageEntity[] } {
  const lead = text.length - text.trimStart().length
  const trimmed = text.trim()
  const len = trimmed.length
  const adj: MessageEntity[] = []
  for (const e of entities) {
    const start = Math.max(0, (e.offset ?? 0) - lead)
    const end = Math.min(len, (e.offset ?? 0) + (e.length ?? 0) - lead)
    if (end > start) adj.push({ ...e, offset: start, length: end - start })
  }
  // sort by offset so the renderer/backend see a stable order
  adj.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0) || (b.length ?? 0) - (a.length ?? 0))
  return { text: trimmed, entities: adj }
}

// --- applying formatting to the live selection ------------------------------

const NATIVE: Partial<Record<ComposerEntityType, string>> = {
  messageEntityBold: 'bold',
  messageEntityItalic: 'italic',
  messageEntityUnderline: 'underline',
  messageEntityStrike: 'strikeThrough',
}

/** Find the nearest ancestor element matching `pred`, bounded by the editable root. */
function ancestor(node: Node | null, root: HTMLElement, pred: (el: HTMLElement) => boolean): HTMLElement | null {
  let n: Node | null = node
  while (n && n !== root) {
    if (n.nodeType === Node.ELEMENT_NODE && pred(n as HTMLElement)) return n as HTMLElement
    n = n.parentNode
  }
  return null
}

function selectionRoot(root: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const r = sel.getRangeAt(0)
  if (!root.contains(r.commonAncestorContainer)) return null
  return r
}

const matcherFor = (type: ComposerEntityType) => (el: HTMLElement): boolean => {
  switch (type) {
    case 'messageEntityCode': return el.tagName === 'CODE' || el.classList.contains('md-code')
    case 'messageEntitySpoiler': return el.classList.contains('md-spoiler')
    case 'messageEntityBlockquote': return el.tagName === 'BLOCKQUOTE' || el.classList.contains('md-quote')
    case 'messageEntityTextUrl': return el.tagName === 'A'
    default: return false
  }
}

function unwrap(el: HTMLElement) {
  const parent = el.parentNode
  if (!parent) return
  const range = document.createRange()
  range.selectNodeContents(el)
  const frag = range.extractContents()
  // restore selection over the unwrapped content
  const sel = window.getSelection()
  const start = frag.firstChild
  const end = frag.lastChild
  parent.replaceChild(frag, el)
  if (sel && start && end) {
    const r = document.createRange()
    r.setStartBefore(start)
    r.setEndAfter(end)
    sel.removeAllRanges()
    sel.addRange(r)
  }
}

function wrapRange(range: Range, build: () => HTMLElement) {
  const wrapper = build()
  try {
    range.surroundContents(wrapper)
  } catch {
    // surroundContents throws when the range partially selects a node — fall back
    // to extract + wrap + reinsert, which handles any selection.
    const frag = range.extractContents()
    wrapper.appendChild(frag)
    range.insertNode(wrapper)
  }
  const sel = window.getSelection()
  if (sel) {
    const r = document.createRange()
    r.selectNodeContents(wrapper)
    sel.removeAllRanges()
    sel.addRange(r)
  }
}

/**
 * Toggle `type` on the current selection inside `root`. For B/I/U/S we defer to
 * the browser's execCommand (it splits/merges text nodes correctly); for
 * code/spoiler/quote/link we wrap-or-unwrap a class span / anchor ourselves.
 * `url` is required for text_link. Returns focus to the editable.
 */
export function apply(root: HTMLElement, type: ComposerEntityType, url?: string) {
  root.focus()
  const native = NATIVE[type]
  if (native) {
    try { document.execCommand('styleWithCSS', false, 'true') } catch { /* not all engines */ }
    document.execCommand(native)
    return
  }
  const range = selectionRoot(root)
  if (!range || range.collapsed) return

  // already wrapped in this type fully? → unwrap (toggle off)
  const existing =
    ancestor(range.startContainer, root, matcherFor(type)) &&
    ancestor(range.endContainer, root, matcherFor(type))
  const wrapperEl = ancestor(range.commonAncestorContainer, root, matcherFor(type))
  if (existing && wrapperEl) {
    if (type === 'messageEntityTextUrl' && url) { (wrapperEl as HTMLAnchorElement).href = safeUrl(url) || ''; return }
    unwrap(wrapperEl)
    return
  }

  wrapRange(range, () => {
    if (type === 'messageEntityTextUrl') {
      const a = document.createElement('a')
      a.href = safeUrl(url) || ''
      a.className = 'md-link'
      return a
    }
    const span = document.createElement('span')
    if (type === 'messageEntityCode') span.className = 'md-code'
    else if (type === 'messageEntitySpoiler') span.className = 'md-spoiler'
    else if (type === 'messageEntityBlockquote') span.className = 'md-quote'
    return span
  })
}

/** Which formats are active at the current selection (drives the toolbar highlight). */
export function activeTypes(root: HTMLElement): Set<ComposerEntityType> {
  const out = new Set<ComposerEntityType>()
  for (const [t, cmd] of Object.entries(NATIVE)) {
    try { if (document.queryCommandState(cmd!)) out.add(t as ComposerEntityType) } catch { /* noop */ }
  }
  const range = selectionRoot(root)
  if (range) {
    const types: ComposerEntityType[] = [
      'messageEntityCode', 'messageEntitySpoiler', 'messageEntityBlockquote', 'messageEntityTextUrl',
    ]
    for (const t of types) {
      if (ancestor(range.commonAncestorContainer, root, matcherFor(t))) out.add(t)
    }
  }
  return out
}

// --- entities → DOM (for editing an existing formatted message) -------------

interface Seg { text: string; types: MessageEntity['_'][]; url?: string; language?: string; userId?: number; documentId?: number }

// Split text into non-overlapping segments at every entity boundary.
function segmentize(text: string, entities: MessageEntity[]): Seg[] {
  const bounds = new Set<number>([0, text.length])
  for (const e of entities) {
    bounds.add(Math.max(0, e.offset ?? 0))
    bounds.add(Math.min(text.length, (e.offset ?? 0) + (e.length ?? 0)))
  }
  const cuts = [...bounds].filter((b) => b >= 0 && b <= text.length).sort((a, b) => a - b)
  const segs: Seg[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i]
    const en = cuts[i + 1]
    if (en <= s) continue
    const types: MessageEntity['_'][] = []
    let url: string | undefined
    let language: string | undefined
    let userId: number | undefined
    let documentId: number | undefined
    for (const e of entities) {
      if ((e.offset ?? 0) <= s && (e.offset ?? 0) + (e.length ?? 0) >= en) {
        types.push(e._)
        switch (e._) {
          case 'messageEntityTextUrl': url = e.url; break
          case 'messageEntityPre': language = e.language; break
          case 'messageEntityMentionName': userId = Number(e.user_id); break
          case 'messageEntityCustomEmoji': documentId = Number(e.document_id); break
        }
      }
    }
    segs.push({ text: text.slice(s, en), types, url, language, userId, documentId })
  }
  return segs
}

function elementFor(type: MessageEntity['_'], url?: string, language?: string, userId?: number, documentId?: number): HTMLElement {
  switch (type) {
    case 'messageEntityCustomEmoji': {
      // Atomic inline unit (tweb custom-emoji placeholder): contenteditable=false so
      // the glyph can't be edited apart from its document; serialize() reads it back
      // via class + data-doc-id. The glyph itself is appended as the element's text.
      const span = document.createElement('span')
      span.className = 'md-custom-emoji'
      span.contentEditable = 'false'
      if (documentId != null) span.dataset.docId = String(documentId)
      return span
    }
    case 'messageEntityMentionName': {
      const a = document.createElement('a')
      a.className = 'md-mention'
      if (userId != null) a.dataset.mentionId = String(userId)
      return a
    }
    case 'messageEntityBold': return document.createElement('b')
    case 'messageEntityItalic': return document.createElement('i')
    case 'messageEntityUnderline': return document.createElement('u')
    case 'messageEntityStrike': return document.createElement('s')
    case 'messageEntitySpoiler': { const s = document.createElement('span'); s.className = 'md-spoiler'; return s }
    case 'messageEntityBlockquote': { const s = document.createElement('span'); s.className = 'md-quote'; return s }
    case 'messageEntityPre': { const s = document.createElement('span'); s.className = 'md-pre'; if (language) s.dataset.language = language; return s }
    case 'messageEntityTextUrl': { const a = document.createElement('a'); a.className = 'md-link'; a.setAttribute('href', safeUrl(url) || ''); return a }
    default: { const s = document.createElement('span'); s.className = 'md-code'; return s } // code
  }
}

// Append a plain string to a node, turning '\n' into <br> (so multi-line drafts
// round-trip). Uses createTextNode — no HTML parsing, no injection surface.
function appendText(parent: Node, str: string) {
  const parts = str.split('\n')
  parts.forEach((p, i) => {
    if (i > 0) parent.appendChild(document.createElement('br'))
    if (p) parent.appendChild(document.createTextNode(p))
  })
}

/**
 * Build a DocumentFragment for { text, entities } — used to prefill the composer
 * when editing a formatted message. Built entirely from createElement/createTextNode
 * (no innerHTML), so it's inherently injection-safe.
 */
export function entitiesToFragment(text: string, entities?: MessageEntity[]): DocumentFragment {
  const frag = document.createDocumentFragment()
  if (!entities || entities.length === 0) {
    appendText(frag, text)
    return frag
  }
  for (const seg of segmentize(text, entities)) {
    if (seg.types.length === 0) {
      appendText(frag, seg.text)
      continue
    }
    let outer: HTMLElement | null = null
    let inner: HTMLElement | null = null
    for (const ty of seg.types) {
      const el = elementFor(ty, seg.url, seg.language, seg.userId, seg.documentId)
      if (!outer) outer = el
      else inner!.appendChild(el)
      inner = el
    }
    appendText(inner!, seg.text)
    frag.appendChild(outer!)
  }
  return frag
}

// --- parse remaining markdown markers in plain text (tweb parseMarkdown) -------

// Парные маркеры → конструктор сущности. Значения — подмножество таблицы
// оригинала `MARKDOWN_ENTITIES` (tweb `lib/richTextProcessor/index.ts:75-83`,
// у нас `@lib/richtext/entities`): одиночный '`' разбирается ниже отдельной
// веткой, '``'/'_-_' этот однопроходный разбор не понимает вовсе.
const INLINE_DELIMS: Record<string, Extract<ComposerEntityType,
  'messageEntityBold' | 'messageEntityItalic' | 'messageEntityStrike' | 'messageEntitySpoiler'>> = {
  '**': 'messageEntityBold',
  '__': 'messageEntityItalic',
  '~~': 'messageEntityStrike',
  '||': 'messageEntitySpoiler',
}

/**
 * One-pass markdown parse of plain text → { text, entities }, stripping the marker
 * chars. Faithful to tweb's parseMarkdown:
 *   - ```fenced``` → pre. The LANGUAGE is whatever precedes the FIRST newline inside
 *     the fence (tweb: `match[3].match(/(.*?)\n/)`). So ```css⏎body{}⏎``` → lang "css",
 *     code "body{}"; but a single-line ```css body{}``` has no newline → NO language,
 *     code "css body{}". Leading/trailing newline around the code is trimmed.
 *   - `**bold** __italic__ ~~strike~~ ||spoiler|| ` `code` ` [text](url)` → inline.
 * Offsets are over the OUTPUT text. `existing` (entities already present from the
 * toolbar/shortcuts) are remapped through an input→output index map and merged, so
 * removing markers doesn't shift them. Run on SEND (tweb parses markers at send, the
 * input itself stays raw).
 */
export function parseMarkdown(input: string, existing: MessageEntity[] = []): { text: string; entities: MessageEntity[] } {
  let text = ''
  const entities: MessageEntity[] = []
  const n = input.length
  const map = new Int32Array(n + 1) // input index → output index
  let i = 0
  const keep = (from: number, str: string) => {
    for (let k = 0; k < str.length; k++) map[from + k] = text.length + k
    text += str
  }
  const drop = (from: number, len: number) => {
    for (let k = 0; k < len; k++) map[from + k] = text.length
  }

  while (i < n) {
    // fenced code block ```[lang]\n…```
    if (input.startsWith('```', i)) {
      const close = input.indexOf('```', i + 3)
      if (close !== -1) {
        const raw = input.slice(i + 3, close)
        const nlMatch = raw.match(/(.*?)\n/)
        // Первая строка fence считается ЯЗЫКОМ только если это одиночный
        // идентификатор (```json). Иначе это код, и съедать его нельзя —
        // правило tweb `parseMarkdown.ts:66-74` (комментарий там: «previously
        // ate the first character(s) of the code»). Без этой проверки
        // ```{"a":1}``` терял содержимое целиком: язык = `{"a":1}`, код = ''.
        const languageMatch = nlMatch ? nlMatch[1] : ''
        const language = /^[\w+#.-]{1,32}$/.test(languageMatch) ? languageMatch : ''
        let code = language ? raw.slice(language.length) : raw
        const startNL = code[0] === '\n' ? 1 : 0
        const endNL = code.endsWith('\n') ? 1 : 0
        code = code.slice(startNL, code.length - endNL)
        drop(i, 3 + language.length + startNL) // opening ``` + language + leading \n
        const offset = text.length
        keep(i + 3 + language.length + startNL, code)
        drop(close - endNL, endNL + 3) // trailing \n + closing ```
        // `language` в схеме обязателен: «языка нет» — это пустая строка, как и
        // в оригинале (tweb parseMarkdown.ts:80-85 кладёт `language: language`).
        entities.push({ _: 'messageEntityPre', offset, length: code.length, language })
        i = close + 3
        continue
      }
    }
    // paired inline delimiters (**, __, ~~, ||)
    const two = input.slice(i, i + 2)
    const dType = INLINE_DELIMS[two]
    if (dType) {
      const close = input.indexOf(two, i + 2)
      if (close > i + 2) {
        const inner = input.slice(i + 2, close)
        if (!inner.includes('\n')) {
          drop(i, 2)
          const offset = text.length
          keep(i + 2, inner)
          drop(close, 2)
          entities.push({ _: dType, offset, length: inner.length })
          i = close + 2
          continue
        }
      }
    }
    // inline code `…`
    if (input[i] === '`') {
      const close = input.indexOf('`', i + 1)
      if (close > i + 1) {
        const inner = input.slice(i + 1, close)
        if (!inner.includes('\n')) {
          drop(i, 1)
          const offset = text.length
          keep(i + 1, inner)
          drop(close, 1)
          entities.push({ _: 'messageEntityCode', offset, length: inner.length })
          i = close + 1
          continue
        }
      }
    }
    // link [text](url)
    if (input[i] === '[') {
      const m = input.slice(i).match(/^\[([^\]\n]+)\]\(([^)\n]+)\)/)
      if (m) {
        const linkText = m[1]
        drop(i, 1)
        const offset = text.length
        keep(i + 1, linkText)
        drop(i + 1 + linkText.length, m[0].length - 1 - linkText.length)
        entities.push({ _: 'messageEntityTextUrl', offset, length: linkText.length, url: m[2] })
        i += m[0].length
        continue
      }
    }
    map[i] = text.length
    text += input[i]
    i++
  }
  map[n] = text.length

  // remap toolbar/shortcut entities through the index map and merge
  for (const e of existing) {
    const o = map[Math.min(e.offset ?? 0, n)]
    const end = map[Math.min((e.offset ?? 0) + (e.length ?? 0), n)]
    if (end > o) entities.push({ ...e, offset: o, length: end - o })
  }
  entities.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))
  return { text, entities }
}

// --- splitting an over-length message into ≤max chunks (tweb splitStringByLength)

/**
 * Split { text, entities } into chunks no longer than `max` (UTF-16 units, the
 * unit entity offsets use), preferring to break on the last newline/space in each
 * window so words/lines aren't cut mid-way. Entities are clipped + rebased onto
 * each chunk (a span crossing a boundary becomes one span per chunk — e.g. a long
 * code block becomes a code block per message, like Telegram).
 */
export function splitRich(text: string, entities: MessageEntity[], max: number): { text: string; entities: MessageEntity[] }[] {
  if (text.length <= max) return [{ text, entities }]
  const parts: { text: string; entities: MessageEntity[] }[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    let end = Math.min(i + max, n)
    if (end < n) {
      const win = text.slice(i, end)
      const nl = win.lastIndexOf('\n')
      const sp = win.lastIndexOf(' ')
      const cut = nl >= max * 0.5 ? nl + 1 : sp >= max * 0.5 ? sp + 1 : -1
      if (cut > 0) end = i + cut
    }
    const chunkEntities = entities
      .filter((e) => (e.offset ?? 0) < end && (e.offset ?? 0) + (e.length ?? 0) > i)
      .map((e) => {
        const s = Math.max(e.offset ?? 0, i)
        const en = Math.min((e.offset ?? 0) + (e.length ?? 0), end)
        return { ...e, offset: s - i, length: en - s }
      })
    parts.push({ text: text.slice(i, end), entities: chunkEntities })
    i = end
  }
  return parts
}

