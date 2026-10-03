// Порт tweb `src/lib/richTextProcessor/getEmojiEntityFromEmoji.ts` (812502980) 1:1:
// сущность эмодзи для вставки в поле (`ChatInput.onEmojiSelected`). `unicode` —
// `toCodePoints(...).join('-')` без `fe0f`, как у оригинала.
import type { MessageEntity } from '@layer'
import { toCodePoints } from './emoji'

export default function getEmojiEntityFromEmoji(emoji: string): MessageEntity.messageEntityEmoji {
  return {
    _: 'messageEntityEmoji',
    offset: 0,
    length: emoji.length,
    unicode: toCodePoints(emoji).join('-').replace(/-?fe0f/g, ''),
  }
}
