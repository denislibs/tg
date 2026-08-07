import { describe, it, expect } from 'vitest'
import { emojiOnlyCount } from './RichText'

describe('emojiOnlyCount — только эмодзи → их число, любое количество (1:1 tweb bubbles.ts:7373)', () => {
  it('1 эмодзи → 1', () => expect(emojiOnlyCount('😀')).toBe(1))
  it('7 эмодзи → 7', () => expect(emojiOnlyCount('😀😃😄😁😆😅😂')).toBe(7))
  // tweb: закомментированное `&& emojiEntities.length <= 3` в bubbles.ts:7373 — верхнего
  // лимита в детекте нет, big-emoji срабатывает при любом количестве. Math.min(7, count)
  // (bubbles.ts:319) — это кламп РАЗМЕРА глифа при рендере, не порог здесь.
  it('8 эмодзи (сверх старого лимита) → 8, всё ещё big', () =>
    expect(emojiOnlyCount('😀😃😄😁😆😅😂🤣')).toBe(8))
  it('ZWJ-семья считается одним', () => expect(emojiOnlyCount('👨‍👩‍👧')).toBe(1))
  it('эмодзи + текст → 0', () => expect(emojiOnlyCount('😀 hi')).toBe(0))
  it('пустая строка → 0', () => expect(emojiOnlyCount('')).toBe(0))

  // 2 обычных эмодзи подряд → 2 (без привязки к custom-emoji: отдельной ветки для
  // custom_emoji entities в emojiOnlyCount нет и не нужно — см. отчёт по task-3).
  it('2 эмодзи подряд → 2', () => expect(emojiOnlyCount('😎😎')).toBe(2))
})
