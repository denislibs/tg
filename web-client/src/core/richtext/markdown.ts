// src/core/richtext/markdown.ts
// Rich-text plumbing for the contenteditable composer, ported from tweb's
// approach (helpers/dom/getRichElementValue.ts + lib/richTextProcessor/
// parseMarkdown.ts) but trimmed to our entity set. Four jobs:
//   1. serialize() — walk the contenteditable DOM → { text, entities } with
//      UTF-16 offsets (plain JS string indices), the same units the renderer and
//      backend use, so the numbers slice the text identically everywhere.
//   2. apply()     — toggle a format on the current selection (B/I/U/S via native
//      execCommand which splits/merges text nodes reliably; code/spoiler/quote/
//      link via manual range wrap-or-unwrap).
//   3. entitiesToFragment() — rebuild composer markup from { text, entities } so
//      editing an existing message re-loads it formatted.
//   4. parseMarkdown() + splitRich() — разбор сырых маркеров и резка длинного
//      сообщения НА ОТПРАВКЕ; оба — построчные порты оригинала, см. докблоки.
import type { MessageEntity } from '@layer'
import {
  MARKDOWN_ENTITIES, MARKDOWN_REG_EXP, combineSameEntities, findConflictingEntity, mergeEntities,
} from '@lib/richtext'
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
  // Заголовки — жирный: `markdownTags.bold` оригинала перечисляет h1…h6 рядом с
  // `b`/`strong` (tweb getRichElementValue.ts:31-48). Предмет тот же, что у
  // блочных тегов ниже, — вставка куска страницы из браузера.
  if (tag === 'B' || tag === 'STRONG' || /^H[1-6]$/.test(tag) || fw === 'bold' || (parseInt(fw, 10) >= 600)) out.push({ _: 'messageEntityBold' })
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

// Порт tweb `helpers/dom/getRichElementValue.ts:113-129` (`BLOCK_TAGS`) —
// теги, которые в тексте дают перевод строки. Набор берётся целиком: вставка из
// браузера приезжает списками (`UL`/`OL`/`LI`), заголовками (`H1`…`H6`),
// секциями и строками таблицы, и с укороченным набором весь такой фрагмент
// склеивался в ОДНУ строку. `BR` в оригинале лежит в том же наборе — у нас его
// разбирает ветка выше (она же и есть его `pushLine`).
const BLOCK = new Set([
  'DIV',
  'P',
  'BR',
  'LI',
  'SECTION',
  'H6',
  'H5',
  'H4',
  'H3',
  'H2',
  'H1',
  'TR',
  'OL',
  'UL',
  'BLOCKQUOTE',
])

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

/**
 * Порт tweb `lib/richTextProcessor/parseMarkdown.ts` целиком.
 *
 * Разбор идёт на ОТПРАВКЕ (инпут хранит сырые маркеры — правило корневого
 * CLAUDE.md), поэтому любая потеря здесь необратима: сообщение уедет уже без
 * съеденного куска.
 *
 * Три вещи, которые здесь легко потерять и которые и есть смысл этого порта:
 *
 *  1. **Границы выражения.** Маркер работает только на границе слова — за это
 *     отвечают группы 1/5/6/9 `MARKDOWN_REG_EXP`. Поэтому `a**b**c` НЕ
 *     форматируется (и уезжает как есть), а `**b**` — форматируется. Своя
 *     посимвольная развёртка этого правила не знала.
 *  2. **Конфликты с уже готовыми сущностями.** Разметка из тулбара приезжает
 *     аргументом `currentEntities`, и маркер, попавший внутрь `code`/`pre` или
 *     накрывающий чужую сущность, ставиться НЕ должен: это решает
 *     `findConflictingEntity` (`lib/richtext/entities.ts`), а слияние —
 *     `mergeEntities` + `combineSameEntities`. Оригинал при этом СДВИГАЕТ
 *     offset'ы `currentEntities` по ходу разбора (маркеры уходят из текста) —
 *     мы двигаем их в копиях, чтобы не мутировать массив вызывающего.
 *  3. **Гвард пустого результата** (:186-189): если после съедания маркеров от
 *     текста не осталось ничего, кроме пробелов, отдаётся исходный «хвост», а
 *     сущности сбрасываются. Без него `**  **` уехало бы сообщением из двух
 *     пробелов с сущностью-жирным на них.
 *
 * `noTrim` — третий аргумент оригинала (:15): без него результат обрезается по
 * краям вместе со сдвигом сущностей.
 *
 * Единственная непортированная ветка — `isSOH` (метка каретки `\x01`); почему,
 * написано у `MARKDOWN_REG_EXP` (`lib/richtext/parseEntities.ts`).
 */
export function parseMarkdown(
  raw: string,
  currentEntities: MessageEntity[] = [],
  noTrim?: boolean,
): { text: string; entities: MessageEntity[] } {
  const entities: MessageEntity[] = []
  // Оригинал мутирует `currentEntities` (сдвиг offset'ов ниже) — у нас это
  // массив вызывающего (`serialize()` композера), поэтому двигаем копии.
  currentEntities = currentEntities.map((entity) => ({ ...entity }))

  let pushedEntity = false
  const pushEntity = (entity: MessageEntity, adjustOffset = 0, adjustLength = 0) => {
    // * we have to push entity even if it has no length
    // * to match the logic of other apps
    const conflictingEntity = findConflictingEntity(
      currentEntities,
      adjustOffset || adjustLength ?
        { ...entity, length: (entity.length ?? 0) + adjustLength + adjustOffset } :
        entity,
      true,
    )

    return !conflictingEntity ?
      (entities.push(entity), pushedEntity = true) :
      pushedEntity = false
  }

  const newTextParts: string[] = []
  let rawOffset = 0
  let match: RegExpMatchArray | null
  while ((match = raw.match(MARKDOWN_REG_EXP))) {
    const matchWhitespace = match[1] || ''
    const matchIndexAfterWhitespace = (match.index ?? 0) + matchWhitespace.length
    const matchValueAfterWhitespace = match[0].slice(matchWhitespace.length)
    const matchIndex = rawOffset + matchIndexAfterWhitespace
    const possibleNextRawOffset = matchIndex + matchValueAfterWhitespace.length
    const beforeMatch = matchIndexAfterWhitespace > 0 && raw.slice(0, matchIndexAfterWhitespace)
    if (beforeMatch) newTextParts.push(beforeMatch)
    const text = match[3] || match[8] || match[11] || match[13]

    pushedEntity = false
    if (/^`*$/.test(text)) {
      // * the matched "content" is only backticks (e.g. a lone ``` that isn't a real fence): it's
      // * not inline code, so skip entity creation and fall through to the `!pushedEntity` push
      // * below, which emits the run verbatim ONCE. pushing here too duplicated it (` ``` ` on send).
    } else if (match[3]) { // pre
      const languageMatch = match[3].match(/(.*?)\n/)
      // * the first line of a ``` block is treated as a language tag only when it's a single
      // * identifier token (e.g. ```json). otherwise it's code and must NOT be swallowed — this
      // * keeps a leading `{` / `<` / etc. when the opening fence sits on the same line as the
      // * content (```{ ... }), which previously ate the first character(s) of the code.
      let language = languageMatch?.[1] || ''
      if (language && !/^[\w+#.-]{1,32}$/.test(language)) {
        language = ''
      }

      let code = language ? match[3].slice(language.length) : match[3]
      const startIndex = code[0] === '\n' ? 1 : 0
      const endIndex = code[code.length - 1] === '\n' ? -1 : undefined
      code = code.slice(startIndex, endIndex)
      const entity: MessageEntity = {
        _: 'messageEntityPre',
        language,
        offset: matchIndex,
        length: code.length,
      }

      const adjustOffset = match[2].length + (language ? language.length : 0) + (startIndex ? 1 : 0)
      const adjustLength = match[4].length + (endIndex ? 1 : 0)
      if (pushEntity(entity, adjustOffset, adjustLength)) {
        if (startIndex) {
          rawOffset -= 1
        }

        if (endIndex) {
          rawOffset -= 1
        }

        if (language) {
          rawOffset -= language.length
        }

        let whitespace = ''
        const previousPart = newTextParts[newTextParts.length - 1]
        if (previousPart && !/\s/.test(previousPart[previousPart.length - 1])) {
          whitespace = '\n'
        }

        newTextParts.push(whitespace, code, match[5])

        rawOffset -= match[2].length + match[4].length
      }
    } else if (match[7]) { // code|bold|italic|strike|underline|spoiler
      const symbol = match[7]

      const entity = {
        _: MARKDOWN_ENTITIES[symbol],
        offset: matchIndex + match[6].length,
        length: text.length,
      } as MessageEntity

      if (pushEntity(entity, symbol.length, symbol.length)) {
        newTextParts.push(match[6] + text + match[9])

        rawOffset -= symbol.length * 2
      }
    } else if (match[11]) { // custom mention
      const entity: MessageEntity = {
        _: 'messageEntityMentionName',
        user_id: +match[10],
        offset: matchIndex,
        length: text.length,
      }

      if (pushEntity(entity)) {
        newTextParts.push(text)

        rawOffset -= matchValueAfterWhitespace.length - text.length
      }
    } else if (match[12]) { // text url
      const url = match[14]
      const entity: MessageEntity = {
        _: 'messageEntityTextUrl',
        url,
        offset: matchIndex,
        length: text.length,
      }

      const adjustOffset = 1
      const adjustLength = 4 + url.length
      if (pushEntity(entity, adjustOffset, adjustLength)) {
        newTextParts.push(text)

        rawOffset -= match[12].length - text.length
      }
    }

    if (!pushedEntity) {
      newTextParts.push(matchValueAfterWhitespace)
    }

    raw = raw.slice(matchIndexAfterWhitespace + matchValueAfterWhitespace.length)
    rawOffset += matchIndexAfterWhitespace + matchValueAfterWhitespace.length

    const rawOffsetDiff = rawOffset - possibleNextRawOffset
    if (rawOffsetDiff) {
      currentEntities.forEach((entity) => {
        if ((entity.offset ?? 0) >= matchIndex) {
          entity.offset = (entity.offset ?? 0) + rawOffsetDiff
        }
      })
    }
  }

  if (raw) newTextParts.push(raw)
  let newText = newTextParts.join('')
  if (!newText.replace(/\s+/g, '').length) {
    newText = raw
    entities.splice(0, entities.length)
  }

  currentEntities = mergeEntities(currentEntities, entities)
  combineSameEntities(currentEntities)

  let length = newText.length
  if (!noTrim) {
    // trim left
    newText = newText.replace(/^\s*/, '')

    let diff = length - newText.length
    if (diff) {
      currentEntities.forEach((entity) => {
        entity.offset = Math.max(0, (entity.offset ?? 0) - diff)
      })
    }

    // trim right
    newText = newText.replace(/\s*$/, '')
    diff = length - newText.length
    length = newText.length
    if (diff) {
      currentEntities.forEach((entity) => {
        if (((entity.offset ?? 0) + (entity.length ?? 0)) > length) {
          entity.length = length - (entity.offset ?? 0)
        }
      })
    }
  }

  return { text: newText, entities: currentEntities }
}

// --- splitting an over-length message into ≤max chunks (tweb splitStringByLength)

/**
 * Порт tweb `helpers/string/splitStringByLength.ts` 1:1.
 *
 * Режет строку по РАЗДЕЛИТЕЛЮ (пробел), а не по окну фиксированной длины: токен
 * уезжает в кусок целиком вместе со своим хвостовым пробелом (поэтому склейка
 * кусков возвращает исходную строку буква в букву), и только токен, который сам
 * длиннее лимита, рубится жёстко.
 *
 * Живёт здесь, а не в `helpers/string/`: потребитель ровно один — `splitRich`
 * ниже (тот же приём, что у вендорных хелперов в `components/chat/bubbleGroups.ts`).
 */
function splitStringByLength(str: string, maxLength: number): string[] {
  if (str.length <= maxLength) return [str]

  const delimiter = ' '// '\n';
  const out: string[] = []
  let current = ''

  const flush = () => {
    if (current.length) {
      out.push(current)
      current = ''
    }
  }

  // each token keeps its trailing delimiter so the original string is reconstructed losslessly
  let lastIndex = 0
  do {
    let index = str.indexOf(delimiter, lastIndex)
    const isLast = index === -1
    if (isLast) index = str.length
    else index += delimiter.length

    let token = str.slice(lastIndex, index)
    lastIndex = index

    // a single token longer than maxLength must be hard-cut into maxLength-sized pieces
    if (token.length > maxLength) {
      flush()
      while (token.length > maxLength) {
        out.push(token.slice(0, maxLength))
        token = token.slice(maxLength)
      }
    }

    if ((current.length + token.length) > maxLength) {
      flush()
    }

    current += token
  } while (lastIndex < str.length)

  flush()

  return out
}

/**
 * Порт tweb `helpers/sliceMessageEntities.ts` 1:1 — сущности окна `[offset,
 * offset + length)`, пересчитанные в координаты этого окна.
 */
function sliceMessageEntities(entities: MessageEntity[], offset: number, length: number): MessageEntity[] {
  if (!entities?.length) return []
  const result: MessageEntity[] = []
  const end = offset + length
  for (const entity of entities) {
    const entityOffset = entity.offset ?? 0
    const entityEnd = entityOffset + (entity.length ?? 0)
    if (entityEnd <= offset || entityOffset >= end) continue
    const newOffset = Math.max(entityOffset, offset) - offset
    const newLength = Math.min(entityEnd, end) - Math.max(entityOffset, offset)
    if (newLength > 0) {
      result.push({ ...entity, offset: newOffset, length: newLength })
    }
  }
  return result
}

/**
 * Длинное сообщение → несколько сообщений. Порт связки `appMessagesManager
 * .sendText` (tweb appMessagesManager.ts:1329-1343, :1511-1521): текст режет
 * `splitStringByLength`, а сущности каждого куска — `sliceMessageEntities` по
 * НАКОПЛЕННОМУ смещению (сущность на границе становится сущностью в каждом из
 * кусков — длинный блок кода превращается в блок кода на сообщение).
 *
 * Своей эвристики резки здесь больше нет: прежняя брала окно ровно в `max` и
 * искала в нём последний перевод строки/пробел ПРАВЕЕ середины окна
 * (`max * 0.5` — константа, которой в оригинале не существует). На тексте без
 * пробелов правее середины она резала посреди слова там, где оригинал уносит
 * слово в следующее сообщение целиком.
 */
export function splitRich(text: string, entities: MessageEntity[], max: number): { text: string; entities: MessageEntity[] }[] {
  const splitted = splitStringByLength(text, max)
  // Одно сообщение — сущности идут как есть (tweb :1341-1343: резать нечего).
  if (splitted.length === 1) return [{ text, entities }]

  let partOffset = 0
  return splitted.map((part) => {
    const partEntities = entities.length ? sliceMessageEntities(entities, partOffset, part.length) : []
    partOffset += part.length
    return { text: part, entities: partEntities }
  })
}
