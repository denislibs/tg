// Модификаторы бабла на классах tweb (bubbles.ts, места `bubble.classList.add`).
// Один источник правды для MessageRow: от этих классов питаются радиусы группы,
// хвост, фон/тень, плавающее время, реакции и отступы в _chatBubble.scss.
//
// Проверено по живому DOM (docs/research/tweb-dom/*.json → scripts/domdiff/expected):
//   текст out   → bubble hide-name is-out can-have-tail is-read is-group-first is-group-last
//   голосовое   → bubble voice-message min-content is-single-document … can-have-tail
//   документ    → bubble document-message is-single-document … can-have-tail
//   аудио       → bubble audio-message min-content is-single-document … can-have-tail
//   стикер      → bubble sticker sticker-animated is-message-empty has-floating-time just-media
//   big-emoji   → bubble emoji-big can-have-big-emoji sticker … just-media
//   фото без подписи → bubble photo has-plain-media-tail is-message-empty has-floating-time
//   кружок      → bubble round has-floating-time is-message-empty just-media (без can-have-tail)
//   альбом      → bubble is-album is-grouped photo
//   опрос       → bubble poll-message
import type { ConvMsg } from '../../data'

export interface BubbleCtx {
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
  /** имя отправителя показывается (групповой чат, входящее, первое в серии) */
  showName: boolean
  isChannel: boolean
  isSelected: boolean
  isHighlighted: boolean
  /** перед этим баблом проходит граница «непрочитанные» (tweb bubbles.ts:11609) */
  isFirstUnread: boolean
  /** число эмодзи в сообщении-из-одних-эмодзи (0 — обычный текст) */
  bigEmojiCount: number
  /** у сообщения есть анимированный стикер/лотти (tweb sticker-animated) */
  animatedSticker: boolean
}

/** Типы, у которых бабл — это само медиа без подложки (tweb isStandaloneMedia). */
const STANDALONE = new Set(['sticker', 'roundVideo', 'geo'])

// Типы, чьё «медиа» живёт ВНУТРИ тела сообщения (tweb mediaRequiresMessageDiv):
// голосовое, аудио, документ, контакт, звонок, опрос/чеклист, подарок, розыгрыш —
// у них messageDiv не удаляется, значит ни is-message-empty, ни плавающего времени.
const MEDIA_IN_MESSAGE_DIV = new Set([
  'voice', 'audio', 'document', 'contact', 'call', 'poll', 'checklist', 'gift', 'giveaway',
])

/** Статус → класс (tweb bubbles.ts:6384 `'is-' + status`). */
function statusClass(m: ConvMsg): string | null {
  switch (m.status) {
    case 'sending': return 'is-sending'
    case 'sent': return 'is-sent'
    case 'read': return 'is-read'
    case 'error': return 'is-error'
    default: return null
  }
}

/** Классы по типу медиа (tweb bubbles.ts:7889,8097-8100,8530,8635-8642,8811,8751,8700). */
function typeClasses(m: ConvMsg): string[] {
  switch (m.type) {
    case 'photo': return ['photo']
    case 'video': return ['video']
    case 'roundVideo': return ['round']
    case 'album': return ['is-album', 'is-grouped', m.albumItems?.some((x) => x.type === 'video') ? 'video' : 'photo']
    case 'sticker': return ['sticker']
    // min-content + is-single-document — из живого DOM: одиночный документ/аудио/
    // голосовое сжимают бабл по контенту (tweb bubbles.ts:8638-8642).
    case 'voice': return ['voice-message', 'min-content', 'is-single-document']
    case 'audio': return ['audio-message', 'min-content', 'is-single-document']
    case 'document': return ['document-message', 'is-single-document']
    case 'poll': return ['poll-message']
    case 'checklist': return ['poll-message']
    case 'contact': return ['contact-message']
    case 'call': return ['call-message']
    case 'gift': return ['gift']
    default: return []
  }
}

/**
 * Есть ли у сообщения медиа-вложение (для решения is-message-empty/just-media).
 * Аплоад считается медиа: у оптимистичного бабла ещё нет mediaId, но есть localUrl.
 */
function hasMedia(m: ConvMsg): boolean {
  return m.mediaId != null || !!m.localUrl || m.type === 'album' || m.type === 'geo' || !!m.paidMedia?.locked
}

export function bubbleClasses(m: ConvMsg, ctx: BubbleCtx): string[] {
  const cls = ['bubble', ctx.out ? 'is-out' : 'is-in']

  if (ctx.firstInGroup) cls.push('is-group-first')
  if (ctx.lastInGroup) cls.push('is-group-last')

  const status = statusClass(m)
  if (status) cls.push(status)

  cls.push(...typeClasses(m))

  // Большое эмодзи (tweb bubbles.ts:7531-7537): бабл ведёт себя как стикер.
  const bigEmoji = ctx.bigEmojiCount > 0
  if (bigEmoji) cls.push('emoji-big', 'can-have-big-emoji', 'sticker')
  if (ctx.animatedSticker && (bigEmoji || m.type === 'sticker')) cls.push('sticker-animated')

  // Пустое тело сообщения: медиа без подписи (tweb bubbles.ts:9261-9264) —
  // messageDiv удаляется, время всплывает пилюлей поверх медиа (9273-9280).
  const isMessageEmpty = bigEmoji || (hasMedia(m) && !m.text && !MEDIA_IN_MESSAGE_DIV.has(m.type))
  if (isMessageEmpty) cls.push('is-message-empty', 'has-floating-time')

  // just-media — медиа БЕЗ подложки бабла (стикер/эмодзи/кружок/гео): tweb
  // снимает у .bubble-content фон и тень.
  const justMedia = isMessageEmpty && (STANDALONE.has(m.type) || bigEmoji)
  if (justMedia) cls.push('just-media')

  // Хвостик — у последнего бабла серии, кроме кружка (tweb bubbles.ts:9708-9710).
  const canHaveTail = ctx.lastInGroup && m.type !== 'roundVideo' && !justMedia
  if (canHaveTail) cls.push('can-have-tail')
  // Хвост поверх самого медиа, без подложки (tweb bubbles.ts:9255-9257).
  if (canHaveTail && isMessageEmpty && (m.type === 'photo' || m.type === 'video')) cls.push('has-plain-media-tail')

  if (m.reply) cls.push('is-reply')
  // Пересланное всегда показывает шапку «Forwarded from» (tweb bubbles.ts:9413,9645).
  if (m.forwardFrom) cls.push('forwarded', 'must-have-name')
  if (!ctx.showName && !m.forwardFrom) cls.push('hide-name')
  if (ctx.isChannel) cls.push('channel-post')
  if (m.replyMarkup?.inline) cls.push('with-reply-markup')

  if (ctx.isFirstUnread) cls.push('is-first-unread')
  if (ctx.isHighlighted) cls.push('is-highlighted')
  if (ctx.isSelected) cls.push('is-selected')

  return cls
}
