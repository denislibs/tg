// Смысл перенесён из `components/richtext.bigemoji.test.ts` (React-версия жива и
// не трогается) + кодпоинты, на которых держится безопасность src картинки эмодзи.
import { describe, it, expect } from 'vitest'
import { emojiOnlyCount, encodeEmoji, isSafeEmojiUnicode, toCodePoints } from './emoji'

describe('emojiOnlyCount — только эмодзи → их число, любое количество (1:1 tweb bubbles.ts:7373)', () => {
  it('1 эмодзи → 1', () => expect(emojiOnlyCount('😀')).toBe(1))
  it('7 эмодзи → 7', () => expect(emojiOnlyCount('😀😃😄😁😆😅😂')).toBe(7))
  // tweb: закомментированное `&& emojiEntities.length <= 3` в bubbles.ts:7373 — верхнего
  // лимита в детекте нет. Math.min(7, count) (bubbles.ts:319) — кламп РАЗМЕРА глифа.
  it('8 эмодзи (сверх старого лимита) → 8, всё ещё big', () =>
    expect(emojiOnlyCount('😀😃😄😁😆😅😂🤣')).toBe(8))
  it('ZWJ-семья считается одним', () => expect(emojiOnlyCount('👨‍👩‍👧')).toBe(1))
  it('эмодзи + текст → 0', () => expect(emojiOnlyCount('😀 hi')).toBe(0))
  it('пустая строка → 0', () => expect(emojiOnlyCount('')).toBe(0))
  it('2 эмодзи подряд → 2', () => expect(emojiOnlyCount('😎😎')).toBe(2))
})

describe('кодпоинты эмодзи (порт tweb @vendor/emoji)', () => {
  it('encodeEmoji считает кодпоинты численно и снимает VS16', () => {
    expect(encodeEmoji('😀')).toBe('1f600')
    expect(encodeEmoji('❤️')).toBe('2764')
    expect(toCodePoints('😀')).toEqual(['1f600'])
  })

  it('ZWJ-последовательность сохраняет соединители', () => {
    expect(encodeEmoji('👨‍👩‍👧')).toBe('1f468-200d-1f469-200d-1f467')
  })

  it('isSafeEmojiUnicode пропускает только hex с дефисами', () => {
    expect(isSafeEmojiUnicode('1f600')).toBe(true)
    expect(isSafeEmojiUnicode('1f468-200d-1f469')).toBe(true)
    expect(isSafeEmojiUnicode('../../evil')).toBe(false)
    expect(isSafeEmojiUnicode('1f600/../x')).toBe(false)
    expect(isSafeEmojiUnicode('')).toBe(false)
  })
})
