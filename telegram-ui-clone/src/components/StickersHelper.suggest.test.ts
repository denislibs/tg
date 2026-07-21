// Гейт стикеров-саджестов: панель показывается только когда текст композера —
// РОВНО один эмодзи (tweb stickersHelper.checkEmoticon по одиночному эмотикону).
import { describe, it, expect, vi } from 'vitest'

// StickersHelper тянет StickerMedia → lottie-web, который при импорте лезет в
// canvas 2d-контекст (нет в happy-dom) — мокаем, здесь тестируется только гейт.
vi.mock('lottie-web', () => ({ default: { loadAnimation: vi.fn() } }))

import { stickerSuggestEmoji } from './StickersHelper'

describe('stickerSuggestEmoji', () => {
  it('одиночный эмодзи (в т.ч. с пробелами по краям) включает саджесты', () => {
    expect(stickerSuggestEmoji('🔥')).toBe('🔥')
    expect(stickerSuggestEmoji('  👍 ')).toBe('👍')
  })

  it('эмодзи с модификатором тона кожи остаётся одиночным', () => {
    expect(stickerSuggestEmoji('👍🏽')).toBe('👍🏽')
  })

  it('текст, текст+эмодзи и несколько эмодзи — не саджест', () => {
    expect(stickerSuggestEmoji('привет')).toBeNull()
    expect(stickerSuggestEmoji('огонь 🔥')).toBeNull()
    expect(stickerSuggestEmoji('🔥🔥')).toBeNull()
  })

  it('пустая строка и длинный ввод отсекаются', () => {
    expect(stickerSuggestEmoji('')).toBeNull()
    expect(stickerSuggestEmoji('   ')).toBeNull()
    expect(stickerSuggestEmoji('a'.repeat(20))).toBeNull()
  })
})
