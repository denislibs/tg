import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EntityType, MessageEntity } from '../core/models'
import { safeUrl } from '../core/safeUrl'
import CodeBlock from './CodeBlock'
import StickerMedia from './StickerMedia'
import MessageSpoilerOverlay from './messages/MessageSpoilerOverlay'
import { revealSpoiler } from '@lib/spoiler/spoilerReveal'
import classNames from '../shared/lib/classNames'
import s from './RichText.module.scss'

// Matches URLs, t.me links, @usernames and #hashtags
const ENTITY_RE = /(https?:\/\/\S+|t\.me\/\S+|@[A-Za-z0-9_]{3,}|#[\p{L}0-9_]+)/gu

/**
 * If `text` is only emoji (with optional ZWJ joins / skin tones), returns their
 * count — any amount, ≥1 — so the message can be rendered as a big emoji;
 * otherwise 0.
 *
 * 1:1 tweb: в живом `bubbles.ts:7373` условие big-emoji — ТОЛЬКО
 * `emojiStrLength === strLength` (сообщение из одних эмодзи), часть
 * `&& emojiEntities.length <= 3` закомментирована в исходнике. То есть big-emoji
 * срабатывает при любом количестве эмодзи; `Math.min(7, count)` (bubbles.ts:319)
 * — это кламп РАЗМЕРА глифа при рендере (BIG_EMOJI_SIZES[7]), а не порог детекта.
 * Клампинг размера — забота рендера (BigEmojiBubble), не этой функции.
 * Custom-emoji (messageEntityCustomEmoji): document_id только подменяет рендер
 * fallback-глифа на стикер — сам глиф остаётся обычным юникод-эмодзи в тексте
 * (см. Composer.tsx insertCustomEmoji), поэтому этот regex уже считает их наравне
 * с обычными эмодзи без отдельной обработки entities.
 */
export function emojiOnlyCount(text: string): number {
  const t = text.replace(/[\s️]/g, '')
  if (!t) return 0
  const re = /\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*[\u{1F3FB}-\u{1F3FF}]?/gu
  const matches = t.match(re)
  if (!matches) return 0
  if (t.replace(re, '').length > 0) return 0 // non-emoji characters present
  return matches.length
}

/**
 * Автолинковка plain-прогона (URL / @mention / #hashtag). Классы и href — из
 * tweb wrapRichText.ts: URL → `a.anchor-url` (601-603), @mention →
 * `a.mention` c t.me-ссылкой (660-663), #hashtag → `a.anchor-hashtag` c
 * `tg://search_hashtag?hashtag=` (627-636). Живой пример всех трёх — дамп поста
 * канала `docs/research/tweb-dom/20-channel-01-post-formatted.json`.
 */
function plainRun(text: string, linkColor: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(ENTITY_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    const raw = m[0]
    const key = `${keyBase}-${idx}`
    let cls = 'anchor-url'
    let href: string | undefined
    if (raw.startsWith('@')) {
      cls = 'mention'
      href = `https://t.me/${raw.slice(1)}`
    } else if (raw.startsWith('#')) {
      cls = 'anchor-hashtag'
      href = `tg://search_hashtag?hashtag=${encodeURIComponent(raw.slice(1))}`
    } else {
      href = safeUrl(raw.startsWith('t.me/') ? `https://${raw}` : raw)
    }
    out.push(
      href ? (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          className={classNames(cls, s.link)}
          style={{ color: linkColor }}
        >
          {raw}
        </a>
      ) : (
        <span key={key} className={classNames(cls, s.link)} style={{ color: linkColor }}>
          {raw}
        </span>
      ),
    )
    last = idx + raw.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Inline animated custom emoji (tweb custom-emoji-element). Renders the sticker
 * document (`documentId` = media id) at ~1.2× the surrounding font size, in place
 * of its fallback glyph. Lazy + visibility-gated for perf: the animated media is
 * only mounted (and thus only plays) while the element is on screen — scrolled
 * out, it unmounts and the cheap glyph fallback shows again. Faithful to tweb's
 * "play only visible" without the shared-canvas renderer (each emoji is its own
 * small lottie/still via StickerMedia).
 */
function CustomEmoji({ documentId, fallback }: { documentId: number; fallback: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [size, setSize] = useState(20)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fs = parseFloat(getComputedStyle(el).fontSize) || 16
    setSize(Math.round(fs * 1.2))
    const io = new IntersectionObserver(
      (entries) => { for (const e of entries) setVisible(e.isIntersecting) },
      { rootMargin: '150px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <span ref={ref} className={s.customEmoji} style={{ width: size, height: size }}>
      {/* fallback glyph — sits underneath until (and if) the media loads/plays */}
      <span className={s.customEmojiGlyph} style={{ fontSize: size }}>{fallback}</span>
      {visible && (
        <span className={s.customEmojiMedia}>
          <StickerMedia mediaId={documentId} width={size} height={size} autoplay loop />
        </span>
      )}
    </span>
  )
}

// Спойлер — разметка 1:1 tweb (wrapRichText.ts:700 `messageEntitySpoiler`):
// внешний `.spoiler` держит заливку, внутренний `.spoiler-text` — сам текст
// с `opacity: 0`. Классы ГЛОБАЛЬНЫЕ: правила живут в `styles/tweb/_spoiler.scss`,
// а не в модуле этого компонента.
//
// Клик: если над сообщением поднялся оверлей частиц — раскрывает он (его
// обработчик висит на элементе сообщения в capture-фазе, tweb делает так же),
// и `revealSpoiler` сам ничего не трогает. Без оверлея работает CSS-путь tweb
// (`is-spoiler-visible` на `.spoilers-container`).
const handleSpoilerClick = (e: React.MouseEvent<HTMLSpanElement>) => {
  if (revealSpoiler(e.currentTarget)) {
    e.stopPropagation()
    e.preventDefault()
  }
}

function Spoiler({ children }: { children: ReactNode }) {
  return (
    <span className="spoiler" onClick={handleSpoilerClick}>
      <span className="spoiler-text">{children}</span>
    </span>
  )
}

interface Seg { text: string; types: Set<EntityType>; url?: string; documentId?: number }

// Split text into non-overlapping segments at every entity boundary, recording
// which entity types (and link url / custom-emoji document) cover each segment.
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
    let documentId: number | undefined
    for (const e of entities) {
      if (e.offset <= s && e.offset + e.length >= en) {
        types.add(e.type)
        if (e.type === 'text_link') url = e.url
        if (e.type === 'custom_emoji') documentId = e.document_id
      }
    }
    segs.push({ text: text.slice(s, en), types, url, documentId })
  }
  return segs
}

/**
 * Оборачивает содержимое семантическими тегами tweb (wrapRichText.ts): bold →
 * `<strong>` (215-221), italic → `<em>` (227-233), underline → `<u>` (253-262),
 * strikethrough → `<del>` (239-248). Раньше здесь были инлайновые
 * `font-weight`/`font-style`/`text-decoration` на `<span>` — визуально похоже,
 * но DOM расходился с дампом поста канала
 * (`docs/research/tweb-dom/20-channel-01-post-formatted.json`), а вес шрифта
 * не брался из темы (--font-weight-bold).
 */
function wrapFormatting(types: Set<EntityType>, content: ReactNode): ReactNode {
  let out = content
  // порядок вложения — как в tweb: сущности применяются по мере обхода списка
  if (types.has('strikethrough')) out = <del>{out}</del>
  if (types.has('underline')) out = <u>{out}</u>
  if (types.has('italic')) out = <em>{out}</em>
  if (types.has('bold')) out = <strong>{out}</strong>
  return out
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
  // Оверлей частиц — ОДИН на весь текст (в tweb он тоже один на `.message`,
  // bubbles.ts:9780 addMessageSpoilerOverlay); идёт последним, чтобы его канва
  // легла поверх слов.
  const overlay = ents.some((e) => e.type === 'spoiler') ? <MessageSpoilerOverlay /> : null
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
    return <>{parts}{overlay}</>
  }
  return <>{renderInline(text, ents, linkColor)}{overlay}</>
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

        // inline custom emoji (tweb messageEntityCustomEmoji): render the sticker
        // document in place of the fallback glyph (seg.text). document_id может
        // отсутствовать после санитайза — тогда остаётся обычный глиф.
        if (seg.types.has('custom_emoji') && seg.documentId != null) {
          return <CustomEmoji key={key} documentId={seg.documentId} fallback={seg.text} />
        }

        // custom mention юзера без username (tweb messageEntityMentionName):
        // акцентный текст, как @mention-автолинк
        // tweb messageEntityMentionName → `a.follow[data-follow]` (wrapRichText.ts:643-650)
        if (seg.types.has('text_mention')) {
          return (
            <span key={key} className="follow" style={{ color: linkColor }}>
              {wrapFormatting(seg.types, seg.text)}
            </span>
          )
        }

        let content: ReactNode = isLink ? (
          // tweb messageEntityTextUrl/Url → `a.anchor-url` (wrapRichText.ts:601-603)
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={classNames('anchor-url', s.anchor)}
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
          // tweb messageEntityCode → `code.code-code` (wrapRichText.ts:268-290)
          content = <code className={classNames('code-code', s.code)}>{content}</code>
        }
        if (seg.types.has('spoiler')) content = <Spoiler>{content}</Spoiler>

        const wrapped = wrapFormatting(seg.types, content)

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
