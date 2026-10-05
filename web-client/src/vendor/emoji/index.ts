// Порт tweb `src/vendor/emoji/index.ts` (812502980). `encodeEmoji`/`toCodePoints` у нас уже
// живут в `lib/richtext/emoji.ts` (тот же код оригинала) — здесь реэкспорт, а не копия.
export { encodeEmoji, toCodePoints } from '@lib/richtext/emoji'

export const EMOJI_TONE_MODIFIERS = ['🏻', '🏼', '🏽', '🏾', '🏿'] as const
const emojiToneRegExp = /🏻|🏼|🏽|🏾|🏿/g
const singleEmojiToneRegExp = /🏻|🏼|🏽|🏾|🏿/

export function getEmojiToneIndexes(input: string) {
  return (input.match(emojiToneRegExp) || [])
  .map((tone) => EMOJI_TONE_MODIFIERS.indexOf(tone as typeof EMOJI_TONE_MODIFIERS[number]) + 1)
}

export function getEmojiToneIndex(input: string) {
  const match = input.match(singleEmojiToneRegExp)
  return match ? EMOJI_TONE_MODIFIERS.indexOf(match[0] as typeof EMOJI_TONE_MODIFIERS[number]) + 1 : 0
}

export function removeEmojiTone(input: string) {
  return input.replace(emojiToneRegExp, '')
}

export function emojiFromCodePoints(codePoints: string) {
  return codePoints.split('-').reduce((prev, curr) => prev + String.fromCodePoint(parseInt(curr, 16)), '')
}
