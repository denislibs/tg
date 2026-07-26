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
import type { EntityType, MessageEntity } from './models'
import { safeUrl } from './safeUrl'

// CSS classes the composer markup uses (see styles/index.scss). Kept here so serialize()
// and apply() agree on what a span of each type looks like.
const CLS: Record<string, EntityType> = {
  'md-code': 'code',
  'md-spoiler': 'spoiler',
  'md-quote': 'blockquote',
}

interface Active { type: EntityType; url?: string; language?: string; user_id?: number; document_id?: number; ce?: number }

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
  if (tag === 'B' || tag === 'STRONG' || fw === 'bold' || (parseInt(fw, 10) >= 600)) out.push({ type: 'bold' })
  if (tag === 'I' || tag === 'EM' || st.fontStyle === 'italic') out.push({ type: 'italic' })
  if (tag === 'U' || tag === 'INS' || td.includes('underline')) out.push({ type: 'underline' })
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || td.includes('line-through')) out.push({ type: 'strikethrough' })
  if (el.classList.contains('md-pre') || tag === 'PRE') {
    out.push({ type: 'pre', language: el.dataset.language || el.getAttribute('data-language') || undefined })
  } else if (tag === 'CODE' || st.fontFamily.includes('monospace')) {
    out.push({ type: 'code' })
  }
  if (tag === 'BLOCKQUOTE') out.push({ type: 'blockquote' })
  if (el.classList.contains('md-custom-emoji') && el.dataset.docId) {
    // inline custom emoji (tweb messageEntityCustomEmoji): the element's text is the
    // fallback glyph; data-doc-id carries the sticker-document (media) id. A fresh
    // nonce keeps each element a distinct entity even when repeated back-to-back.
    out.push({ type: 'custom_emoji', document_id: Number(el.dataset.docId) || undefined, ce: ++ceSeq })
  }
  if (tag === 'A' && el.dataset.mentionId) {
    // custom mention юзера без username (tweb A.follow / messageEntityMentionName)
    out.push({ type: 'text_mention', user_id: Number(el.dataset.mentionId) || undefined })
  } else if (tag === 'A') {
    out.push({ type: 'text_link', url: (el as HTMLAnchorElement).getAttribute('href') || undefined })
  }
  for (const cls of el.classList) {
    const t = CLS[cls]
    if (t && !out.some((a) => a.type === t)) out.push({ type: t })
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
  const open = new Map<string, { type: EntityType; url?: string; language?: string; user_id?: number; document_id?: number; start: number }>()
  const keyOf = (a: Active) => `${a.type}|${a.url ?? ''}|${a.language ?? ''}|${a.user_id ?? ''}|${a.document_id ?? ''}|${a.ce ?? ''}`
  const close = (k: string, end: number) => {
    const s = open.get(k)
    if (s && end > s.start) entities.push({ type: s.type, offset: s.start, length: end - s.start, url: s.url, language: s.language, user_id: s.user_id, document_id: s.document_id })
    open.delete(k)
  }
  let text = ''
  let offset = 0
  for (const run of runs) {
    const keys = new Set(run.active.map(keyOf))
    for (const k of [...open.keys()]) if (!keys.has(k)) close(k, offset)
    for (const a of run.active) { const k = keyOf(a); if (!open.has(k)) open.set(k, { type: a.type, url: a.url, language: a.language, user_id: a.user_id, document_id: a.document_id, start: offset }) }
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
    const start = Math.max(0, e.offset - lead)
    const end = Math.min(len, e.offset + e.length - lead)
    if (end > start) adj.push({ ...e, offset: start, length: end - start })
  }
  // sort by offset so the renderer/backend see a stable order
  adj.sort((a, b) => a.offset - b.offset || b.length - a.length)
  return { text: trimmed, entities: adj }
}

// --- applying formatting to the live selection ------------------------------

const NATIVE: Partial<Record<EntityType, string>> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'strikeThrough',
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

const matcherFor = (type: EntityType) => (el: HTMLElement): boolean => {
  switch (type) {
    case 'code': return el.tagName === 'CODE' || el.classList.contains('md-code')
    case 'spoiler': return el.classList.contains('md-spoiler')
    case 'blockquote': return el.tagName === 'BLOCKQUOTE' || el.classList.contains('md-quote')
    case 'text_link': return el.tagName === 'A'
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
export function apply(root: HTMLElement, type: EntityType, url?: string) {
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
    if (type === 'text_link' && url) { (wrapperEl as HTMLAnchorElement).href = safeUrl(url) || ''; return }
    unwrap(wrapperEl)
    return
  }

  wrapRange(range, () => {
    if (type === 'text_link') {
      const a = document.createElement('a')
      a.href = safeUrl(url) || ''
      a.className = 'md-link'
      return a
    }
    const span = document.createElement('span')
    if (type === 'code') span.className = 'md-code'
    else if (type === 'spoiler') span.className = 'md-spoiler'
    else if (type === 'blockquote') span.className = 'md-quote'
    return span
  })
}

/** Which formats are active at the current selection (drives the toolbar highlight). */
export function activeTypes(root: HTMLElement): Set<EntityType> {
  const out = new Set<EntityType>()
  for (const [t, cmd] of Object.entries(NATIVE)) {
    try { if (document.queryCommandState(cmd!)) out.add(t as EntityType) } catch { /* noop */ }
  }
  const range = selectionRoot(root)
  if (range) {
    for (const t of ['code', 'spoiler', 'blockquote', 'text_link'] as EntityType[]) {
      if (ancestor(range.commonAncestorContainer, root, matcherFor(t))) out.add(t)
    }
  }
  return out
}

// --- entities → DOM (for editing an existing formatted message) -------------

interface Seg { text: string; types: EntityType[]; url?: string; language?: string; userId?: number; documentId?: number }

// Split text into non-overlapping segments at every entity boundary.
function segmentize(text: string, entities: MessageEntity[]): Seg[] {
  const bounds = new Set<number>([0, text.length])
  for (const e of entities) {
    bounds.add(Math.max(0, e.offset))
    bounds.add(Math.min(text.length, e.offset + e.length))
  }
  const cuts = [...bounds].filter((b) => b >= 0 && b <= text.length).sort((a, b) => a - b)
  const segs: Seg[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i]
    const en = cuts[i + 1]
    if (en <= s) continue
    const types: EntityType[] = []
    let url: string | undefined
    let language: string | undefined
    let userId: number | undefined
    let documentId: number | undefined
    for (const e of entities) {
      if (e.offset <= s && e.offset + e.length >= en) {
        types.push(e.type)
        if (e.type === 'text_link') url = e.url
        if (e.type === 'pre') language = e.language
        if (e.type === 'text_mention') userId = e.user_id
        if (e.type === 'custom_emoji') documentId = e.document_id
      }
    }
    segs.push({ text: text.slice(s, en), types, url, language, userId, documentId })
  }
  return segs
}

function elementFor(type: EntityType, url?: string, language?: string, userId?: number, documentId?: number): HTMLElement {
  switch (type) {
    case 'custom_emoji': {
      // Atomic inline unit (tweb custom-emoji placeholder): contenteditable=false so
      // the glyph can't be edited apart from its document; serialize() reads it back
      // via class + data-doc-id. The glyph itself is appended as the element's text.
      const span = document.createElement('span')
      span.className = 'md-custom-emoji'
      span.contentEditable = 'false'
      if (documentId != null) span.dataset.docId = String(documentId)
      return span
    }
    case 'text_mention': {
      const a = document.createElement('a')
      a.className = 'md-mention'
      if (userId != null) a.dataset.mentionId = String(userId)
      return a
    }
    case 'bold': return document.createElement('b')
    case 'italic': return document.createElement('i')
    case 'underline': return document.createElement('u')
    case 'strikethrough': return document.createElement('s')
    case 'spoiler': { const s = document.createElement('span'); s.className = 'md-spoiler'; return s }
    case 'blockquote': { const s = document.createElement('span'); s.className = 'md-quote'; return s }
    case 'pre': { const s = document.createElement('span'); s.className = 'md-pre'; if (language) s.dataset.language = language; return s }
    case 'text_link': { const a = document.createElement('a'); a.className = 'md-link'; a.setAttribute('href', safeUrl(url) || ''); return a }
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

const INLINE_DELIMS: Record<string, EntityType> = { '**': 'bold', '__': 'italic', '~~': 'strikethrough', '||': 'spoiler' }

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
        const language = nlMatch ? nlMatch[1] : ''
        let code = language ? raw.slice(language.length) : raw
        const startNL = code[0] === '\n' ? 1 : 0
        const endNL = code.endsWith('\n') ? 1 : 0
        code = code.slice(startNL, code.length - endNL)
        drop(i, 3 + language.length + startNL) // opening ``` + language + leading \n
        const offset = text.length
        keep(i + 3 + language.length + startNL, code)
        drop(close - endNL, endNL + 3) // trailing \n + closing ```
        entities.push({ type: 'pre', offset, length: code.length, language: language || undefined })
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
          entities.push({ type: dType, offset, length: inner.length })
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
          entities.push({ type: 'code', offset, length: inner.length })
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
        entities.push({ type: 'text_link', offset, length: linkText.length, url: m[2] })
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
    const o = map[Math.min(e.offset, n)]
    const end = map[Math.min(e.offset + e.length, n)]
    if (end > o) entities.push({ ...e, offset: o, length: end - o })
  }
  entities.sort((a, b) => a.offset - b.offset)
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
      .filter((e) => e.offset < end && e.offset + e.length > i)
      .map((e) => {
        const s = Math.max(e.offset, i)
        const en = Math.min(e.offset + e.length, end)
        return { ...e, offset: s - i, length: en - s }
      })
    parts.push({ text: text.slice(i, end), entities: chunkEntities })
    i = end
  }
  return parts
}

