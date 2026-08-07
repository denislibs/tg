// bigemoji.render.test.tsx — проверяем маппинг count→px (1:1 tweb bubbles.ts:319-328)
// и кламп индекса шкалы (tweb bubbles.ts:7373 Math.min(BIG_EMOJI_SIZES_LENGTH, …)):
// emojiOnlyCount (Task 3) больше не ограничен сверху, поэтому count может прийти >7.
import { describe, it, expect } from 'vitest'
import { BIG_EMOJI_SIZES, bigEmojiGlyphSize } from './MessageContent'

describe('BIG_EMOJI_SIZES (1:1 tweb)', () => {
  it('шкала 96..36', () => {
    expect(BIG_EMOJI_SIZES).toEqual([0, 96, 90, 84, 72, 60, 48, 36])
  })
})

describe('bigEmojiGlyphSize — кламп индекса при count > 7', () => {
  it('count=1 → 96', () => expect(bigEmojiGlyphSize(1)).toBe(96))
  it('count=7 → 36 (последний индекс шкалы)', () => expect(bigEmojiGlyphSize(7)).toBe(36))
  it('count=8 → 36, не выходит за границы массива', () => expect(bigEmojiGlyphSize(8)).toBe(36))
  it('count=100 → 36', () => expect(bigEmojiGlyphSize(100)).toBe(36))
})
