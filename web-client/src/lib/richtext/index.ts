// Публичный вход ванильного rich-text (замена React-`components/RichText.tsx`).
//
// Полный конвейер tweb: `wrapMessageEntities` (fixEmoji + parseEntities +
// mergeEntities) → `wrapRichText`. Без первого шага однопроходный рендер не
// увидит ни автолинков, ни @упоминаний, ни #хэштегов, ни переводов строк —
// сервер их не присылает, их находит клиент.
//
// Возвращается `DocumentFragment` — вставлять в бабл как есть.
export { default as wrapRichText, MAX_ENTITIES, type WrapRichTextOptions } from './wrapRichText'
export { default as parseEntities, wrapMessageEntities, MARKDOWN_REG_EXP } from './parseEntities'
export { default as wrapEmojiText } from './wrapEmojiText'
export {
  mergeEntities, sortEntities, findConflictingEntity, isEntityIntersecting, fixEmoji,
  combineSameEntities, MARKDOWN_ENTITIES,
} from './entities'
export { emojiOnlyCount, encodeEmoji, isSafeEmojiUnicode, EMOJI_CDN_BASE } from './emoji'
export { ANCHOR_ACTION_ATTRIBUTE, safeWrapUrl, wrapUrl, type AnchorAction } from './url'
export { MAX_HIGHLIGHT_LENGTH, getCodeLanguage } from './highlightCode'

import type { MessageEntity } from '@layer'
import wrapRichText, { type WrapRichTextOptions } from './wrapRichText'
import { wrapMessageEntities } from './parseEntities'

/**
 * Текст сообщения → `DocumentFragment` с разметкой tweb.
 *
 * `entities` — то, что пришло с сервера (их не мутируем, см. wrapMessageEntities).
 */
export function wrapMessageText(
  text: string,
  entities?: MessageEntity[],
  options: WrapRichTextOptions = {},
): DocumentFragment {
  const { message, totalEntities } = wrapMessageEntities(text, entities)
  return wrapRichText(message, { ...options, entities: totalEntities })
}
