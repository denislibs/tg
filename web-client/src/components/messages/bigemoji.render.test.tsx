// bigemoji.render.test.tsx — проверяем маппинг count→px (1:1 tweb bubbles.ts:319-328)
import { describe, it, expect } from 'vitest'
import { BIG_EMOJI_SIZES } from './MessageContent'

describe('BIG_EMOJI_SIZES (1:1 tweb)', () => {
  it('шкала 96..36', () => {
    expect(BIG_EMOJI_SIZES).toEqual([0, 96, 90, 84, 72, 60, 48, 36])
  })
})
