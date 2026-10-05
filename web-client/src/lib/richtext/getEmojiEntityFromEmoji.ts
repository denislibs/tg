// Порт tweb `src/lib/richTextProcessor/getEmojiEntityFromEmoji.ts` (812502980) 1:1.
import type { MessageEntity } from '@layer'
import { toCodePoints } from '@vendor/emoji'

export default function getEmojiEntityFromEmoji(emoji: string): MessageEntity.messageEntityEmoji {
  return {
    _: 'messageEntityEmoji',
    offset: 0,
    length: emoji.length,
    unicode: toCodePoints(emoji).join('-').replace(/-?fe0f/g, ''),
  }
}
