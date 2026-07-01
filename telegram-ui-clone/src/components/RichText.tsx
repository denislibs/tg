import { useState, type CSSProperties, type ReactNode } from 'react'
import type { EntityType, MessageEntity } from '../core/models'
import { safeUrl } from '../core/safeUrl'
import CodeBlock from './CodeBlock'
import classNames from '../shared/lib/classNames'
import s from './RichText.module.scss'

// Matches URLs, t.me links, @usernames and #hashtags
const ENTITY_RE = /(https?:\/\/\S+|t\.me\/\S+|@[A-Za-z0-9_]{3,}|#[\p{L}0-9_]+)/gu
// Custom (premium) emoji marker: {e:🔥}
const CE_RE = /\{e:([^}]+)\}/g

/**
 * If `text` is only 1–3 emoji (with optional ZWJ joins / skin tones), returns
 * that count so the message can be rendered as a big emoji; otherwise 0.
 */
export function emojiOnlyCount(text: string): number {
  const t = text.replace(/[\s️]/g, '')
  if (!t) return 0
  const re = /\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*[\u{1F3FB}-\u{1F3FF}]?/gu
  const matches = t.match(re)
  if (!matches) return 0
  if (t.replace(re, '').length > 0) return 0 // non-emoji characters present
  return matches.length <= 3 ? matches.length : 0
}

/** Linkifies a plain text segment (no custom-emoji markers). */
function entityNodes(text: string, linkColor: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(ENTITY_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    out.push(
      <span key={`${keyBase}-${idx}`} className={s.link} style={{ color: linkColor }}>
        {m[0]}
      </span>,
    )
    last = idx + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Renders a plain text run with auto-links + inline custom emoji `{e:😎}`. */
function plainRun(text: string, linkColor: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let seg = 0
  for (const m of text.matchAll(CE_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(...entityNodes(text.slice(last, idx), linkColor, `${keyBase}-s${seg++}`))
    out.push(
      <span key={`${keyBase}-ce-${idx}`} className={s.customEmoji}>
        {m[1]}
      </span>,
    )
    last = idx + m[0].length
  }
  if (last < text.length) out.push(...entityNodes(text.slice(last), linkColor, `${keyBase}-s${seg++}`))
  return out
}

// Click-to-reveal spoiler (tweb-style blur until tapped).
function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      onClick={(e) => { e.stopPropagation(); setRevealed(true) }}
      className={classNames(s.spoiler, revealed ? '' : s.spoilerHidden)}
      style={{ cursor: revealed ? 'inherit' : 'pointer' }}
    >
      {children}
    </span>
  )
}

interface Seg { text: string; types: Set<EntityType>; url?: string }

// Split text into non-overlapping segments at every entity boundary, recording
// which entity types (and link url) cover each segment.
function toSegments(text: string, entities: MessageEntity[]): Seg[] {
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
    const types = new Set<EntityType>()
    let url: string | undefined
    for (const e of entities) {
      if (e.offset <= s && e.offset + e.length >= en) {
        types.add(e.type)
        if (e.type === 'text_link') url = e.url
      }
    }
    segs.push({ text: text.slice(s, en), types, url })
  }
  return segs
}

function segStyle(types: Set<EntityType>): CSSProperties {
  const s: CSSProperties = {}
  if (types.has('bold')) s.fontWeight = 600
  if (types.has('italic')) s.fontStyle = 'italic'
  const deco: string[] = []
  if (types.has('underline')) deco.push('underline')
  if (types.has('strikethrough')) deco.push('line-through')
  if (deco.length) s.textDecoration = deco.join(' ')
  return s
}

/**
 * Renders message text. With `entities`, applies bold/italic/underline/strike/
 * code/spoiler/quote/link formatting; plain runs still get auto-linked URLs/
 * @mentions/#hashtags and inline custom emoji `{e:😎}`. `pre` (fenced code)
 * entities are block-level — rendered as a CodeBlock with the text split around
 * them — so the rest of the message stays inline.
 */
export default function RichText({
  text,
  entities,
  linkColor,
}: {
  text: string
  entities?: MessageEntity[]
  linkColor: string
}) {
  if (!entities || entities.length === 0) {
    return <>{plainRun(text, linkColor, 's')}</>
  }
  // Cap entities before the (≈O(n²)) segmenting below so a crafted message with
  // thousands of spans can't freeze the renderer. Backend caps too; this protects
  // the client regardless of source.
  const ents = entities.length > 500 ? entities.slice(0, 500) : entities
  const pres = ents.filter((e) => e.type === 'pre').sort((a, b) => a.offset - b.offset)
  if (pres.length > 0) {
    const parts: ReactNode[] = []
    let cursor = 0
    const pushInline = (start: number, end: number, key: string) => {
      if (end <= start) return
      // re-base the non-pre entities onto this slice
      const sub = ents
        .filter((e) => e.type !== 'pre' && e.offset < end && e.offset + e.length > start)
        .map((e) => {
          const s = Math.max(e.offset, start)
          const en = Math.min(e.offset + e.length, end)
          return { ...e, offset: s - start, length: en - s }
        })
      parts.push(<span key={key}>{renderInline(text.slice(start, end), sub, linkColor)}</span>)
    }
    pres.forEach((p, i) => {
      pushInline(cursor, p.offset, `in${i}`)
      parts.push(<CodeBlock key={`pre${i}`} code={text.slice(p.offset, p.offset + p.length)} language={p.language} />)
      cursor = p.offset + p.length
    })
    pushInline(cursor, text.length, 'inEnd')
    return <>{parts}</>
  }
  return <>{renderInline(text, ents, linkColor)}</>
}

// Inline (non-block) entity rendering: segment the text at entity boundaries and
// wrap each run with the styles of the entities covering it.
function renderInline(text: string, entities: MessageEntity[], linkColor: string): ReactNode {
  if (entities.length === 0) return plainRun(text, linkColor, 's')
  const segs = toSegments(text, entities)
  return (
    <>
      {segs.map((seg, i) => {
        const key = `e${i}`
        const isCode = seg.types.has('code') || seg.types.has('pre')
        const href = seg.types.has('text_link') ? safeUrl(seg.url) : undefined
        const isLink = !!href
        const isQuote = seg.types.has('blockquote')

        let content: ReactNode = isLink ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={s.anchor}
            style={{ color: linkColor }}
          >
            {seg.text}
          </a>
        ) : isCode ? (
          seg.text
        ) : (
          plainRun(seg.text, linkColor, key)
        )

        if (isCode) {
          content = <code className={s.code}>{content}</code>
        }
        if (seg.types.has('spoiler')) content = <Spoiler>{content}</Spoiler>

        const style = segStyle(seg.types)
        const wrapped =
          Object.keys(style).length > 0 ? (
            <span style={style}>{content}</span>
          ) : (
            content
          )

        if (isQuote) {
          return (
            <span key={key} className={s.quote}>
              {wrapped}
            </span>
          )
        }
        return <span key={key}>{wrapped}</span>
      })}
    </>
  )
}
