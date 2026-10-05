// Порт tweb `src/lib/richTextProcessor/wrapSingleEmoji.ts` (812502980) 1:1.
import getEmojiEntityFromEmoji from './getEmojiEntityFromEmoji'
import wrapRichText from './wrapRichText'

export default function wrapSingleEmoji(emoji: string) {
  return wrapRichText(emoji, {
    entities: [getEmojiEntityFromEmoji(emoji)],
  })
}
