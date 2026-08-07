import { describe, it, expect } from 'vitest'
import { emojiOnlyCount } from './RichText'

describe('emojiOnlyCount — порог 7 (1:1 tweb)', () => {
  it('1 эмодзи → 1', () => expect(emojiOnlyCount('😀')).toBe(1))
  it('7 эмодзи → 7', () => expect(emojiOnlyCount('😀😃😄😁😆😅😂')).toBe(7))
  it('8 эмодзи → 0 (сверх лимита)', () => expect(emojiOnlyCount('😀😃😄😁😆😅😂🤣')).toBe(0))
  it('ZWJ-семья считается одним', () => expect(emojiOnlyCount('👨‍👩‍👧')).toBe(1))
  it('эмодзи + текст → 0', () => expect(emojiOnlyCount('😀 hi')).toBe(0))
  it('пустая строка → 0', () => expect(emojiOnlyCount('')).toBe(0))

  // Custom-emoji (tweb messageEntityCustomEmoji): в нашей модели MessageEntity
  // несёт document_id (RichText.tsx CustomEmoji), но сам document_id лишь подменяет
  // рендер fallback-глифа на стикер — сам fallback-глиф остаётся обычным юникод-
  // эмодзи внутри m.text (см. Composer.tsx insertCustomEmoji, core/richtext/markdown.ts
  // detect()). emojiOnlyCount во всех консьюмерах (MessageContent/MessageRow/
  // StickersHelper/emojiEffects) вызывается только с m.text, без entities — поэтому
  // сообщение из одних custom-emoji уже 1:1 засчитывается как «только эмодзи» тем же
  // regex-путём, без отдельной обработки entities.
  it('custom-emoji fallback-глифы (2 custom-emoji entities) → 2, как обычные эмодзи', () =>
    expect(emojiOnlyCount('😎😎')).toBe(2))
})
