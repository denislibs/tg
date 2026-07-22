// Нормализация эмодзи (FE0F) и кэш анимированных эмодзи: набор animated_emoji
// грузится один раз, лукап работает и с вариационным селектором, и без.
import { describe, it, expect, vi } from 'vitest'

const setBySlug = vi.fn(async (slug: string) => ({
  set: { id: 1, slug, title: 'Animated Emoji', kind: 'emoji' as const, count: 2 },
  stickers: [
    { id: 1, setId: 1, mediaId: 42, emoji: '❤️' }, // с FE0F — в кэше должен лежать без него
    { id: 2, setId: 1, mediaId: 43, emoji: '😂' },
  ],
}))

vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { stickers: { setBySlug } } }),
}))

import { normalizeEmoji, buildEmojiMap, getAnimatedEmoji, peekAnimatedEmoji } from './animatedEmoji'

describe('normalizeEmoji', () => {
  it('срезает вариационный селектор FE0F и пробелы', () => {
    expect(normalizeEmoji('❤️')).toBe('❤')
    expect(normalizeEmoji('❤')).toBe('❤')
    expect(normalizeEmoji(' 👍 ')).toBe('👍')
  })
})

describe('buildEmojiMap', () => {
  it('ключи нормализованы — лукап совпадает для ❤️ и ❤', () => {
    const map = buildEmojiMap([{ emoji: '❤️', mediaId: 42 }])
    expect(map.get(normalizeEmoji('❤️'))).toBe(42)
    expect(map.get(normalizeEmoji('❤'))).toBe(42)
    expect(map.get('❤️')).toBeUndefined() // сырой ключ с FE0F в кэше не живёт
  })

  it('дубль эмодзи не перетирает первый mediaId', () => {
    const map = buildEmojiMap([{ emoji: '🔥', mediaId: 1 }, { emoji: '🔥', mediaId: 2 }])
    expect(map.get('🔥')).toBe(1)
  })
})

describe('getAnimatedEmoji / peekAnimatedEmoji', () => {
  it('находит mediaId независимо от FE0F, набор грузится один раз', async () => {
    expect(await getAnimatedEmoji('❤')).toEqual({ mediaId: 42 })
    expect(await getAnimatedEmoji('❤️')).toEqual({ mediaId: 42 })
    expect(await getAnimatedEmoji('😂')).toEqual({ mediaId: 43 })
    expect(await getAnimatedEmoji('🍕')).toBeNull()
    expect(setBySlug).toHaveBeenCalledTimes(1)
    expect(setBySlug).toHaveBeenCalledWith('animated_emoji')
  })

  it('sync-кэш после загрузки отдаёт то же самое', () => {
    expect(peekAnimatedEmoji('❤️')).toEqual({ mediaId: 42 })
    expect(peekAnimatedEmoji('🍕')).toBeNull()
  })
})
