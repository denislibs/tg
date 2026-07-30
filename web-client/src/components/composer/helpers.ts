// composer/helpers.ts
// Чистые хелперы и константы композера, вынесенные из Composer.tsx: лимит длины,
// клавиатурные шорткаты форматирования, выбор эффектов сообщения, TTL секретных
// чатов, санитайзинг вставленного HTML и работа с кареткой.
import { serialize } from '../../core/richtext/markdown'
import type { EntityType, MessageEntity } from '../../core/models'
import type { EmojiEffectKind } from '../../core/effects/emojiEffects'

// Max message length (matches the backend's maxMessageRunes / Telegram's 4096).
export const MAX_LEN = 4096

// Ctrl/Cmd + key → format. text_link is handled by the tooltip (needs a URL).
export const SHORTCUTS: Record<string, EntityType> = {
  KeyB: 'bold', KeyI: 'italic', KeyU: 'underline',
  KeyS: 'strikethrough', KeyM: 'code', KeyP: 'spoiler',
}

// Выбор эффекта сообщения в send-меню: эмодзи → вид canvas-эффекта.
export const EFFECT_CHOICES: { emoji: string; kind: EmojiEffectKind }[] = [
  { emoji: '🎉', kind: 'confetti' },
  { emoji: '🎆', kind: 'fireworks' },
  { emoji: '❤️', kind: 'hearts' },
  { emoji: '👍', kind: 'thumbs' },
  { emoji: '💩', kind: 'poop' },
  { emoji: '🎂', kind: 'cake' },
]

// Таймер самоуничтожения для секретных чатов (tweb ttl options). null — «Выкл».
export const TTL_OPTIONS: { label: string; secs: number | null }[] = [
  { label: 'Off', secs: null },
  { label: '5с', secs: 5 },
  { label: '10с', secs: 10 },
  { label: '30с', secs: 30 },
  { label: '1м', secs: 60 },
  { label: '1ч', secs: 3600 },
  { label: '1д', secs: 86400 },
  { label: '1нед', secs: 604800 },
]
// Короткая подпись выбранного TTL для кнопки-часов.
export const ttlShort = (s: number): string =>
  s < 60 ? `${s}с` : s < 3600 ? `${s / 60}м` : s < 86400 ? `${s / 3600}ч` : s < 604800 ? `${s / 86400}д` : `${s / 604800}нед`

// URL schemes safe to keep on a pasted link (others are dropped — see RichText).
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'tg'])
export function isSafeUrl(u?: string): boolean {
  if (!u) return false
  const m = u.trim().match(/^([a-z][a-z0-9+.-]*):/i)
  return !m || SAFE_SCHEMES.has(m[1].toLowerCase())
}

// Parse pasted HTML into our { text, entities }. Strips script/style/comments,
// then reuses serialize() (which understands b/i/u/s/a/code/pre/blockquote +
// inline styles). Unsafe links are dropped.
export function htmlToRich(html: string): { text: string; entities: MessageEntity[] } {
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const doc = new DOMParser().parseFromString(cleaned, 'text/html')
  const { text, entities } = serialize(doc.body)
  return { text, entities: entities.filter((e) => e.type !== 'text_link' || isSafeUrl(e.url)) }
}

export function placeCaretEnd(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}
