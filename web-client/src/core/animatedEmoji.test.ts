// Нормализация эмодзи (FE0F) и кэш анимированных эмодзи: набор animated_emoji
// грузится один раз, лукап работает и с вариационным селектором, и без.
import { describe, it, expect, vi } from 'vitest'

const getStickerSet = vi.fn(async (input: { shortName: string }) => ({
  set: { id: 1, slug: input.shortName, title: 'Animated Emoji', kind: 'emoji' as const, count: 2 },
  stickers: [
    makeSticker({ id: 42, setId: 1, emoji: '❤️' }), // с FE0F — в кэше должен лежать без него
    makeSticker({ id: 43, setId: 1, emoji: '😂' }),
  ],
}))

vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { stickers: { getStickerSet } } }),
}))

import { normalizeEmoji, buildEmojiMap, getAnimatedEmoji, peekAnimatedEmoji } from './animatedEmoji'
import { makeSticker } from './stickers/testSticker'

/** Стикер-документ с заданным эмодзи и номером файла. */
const doc = (emoji: string, id: number) => makeSticker({ id, emoji })

describe('normalizeEmoji', () => {
  it('срезает вариационный селектор FE0F и пробелы', () => {
    expect(normalizeEmoji('❤️')).toBe('❤')
    expect(normalizeEmoji('❤')).toBe('❤')
    expect(normalizeEmoji(' 👍 ')).toBe('👍')
  })

  // Telegram отдаёт alt-эмодзи то с FE0F, то без — набор из 599 эмодзи не
  // гарантирует, какой вариант лёг в базу, а какой пришлёт сообщение. tweb
  // (cleanEmoji) срезает оба класса вариативности перед сравнением.
  it('другие реальные пары с/без FE0F совпадают после нормализации', () => {
    expect(normalizeEmoji('☺️')).toBe(normalizeEmoji('☺'))
    expect(normalizeEmoji('☺️')).toBe('☺')
  })

  it('FE0F внутри ZWJ-составного эмодзи тоже срезается (❤️‍🔥 — heart on fire)', () => {
    // U+2764 U+FE0F U+200D U+1F525: селектор стоит не в конце строки, а
    // перед ZWJ — глобальный /️/g обязан снять его и там.
    expect(normalizeEmoji('❤️‍🔥')).toBe('❤‍🔥')
  })

  it('срезает модификатор тона кожи — 👍🏽 матчится на ту же запись, что и 👍', () => {
    expect(normalizeEmoji('👍🏽')).toBe('👍')
    expect(normalizeEmoji('👍🏻')).toBe('👍')
    expect(normalizeEmoji('👍🏿')).toBe('👍')
  })
})

describe('buildEmojiMap', () => {
  it('ключи нормализованы — лукап совпадает для ❤️ и ❤', () => {
    const map = buildEmojiMap([doc('❤️', 42)])
    expect(map.get(normalizeEmoji('❤️'))?.id).toBe(42)
    expect(map.get(normalizeEmoji('❤'))?.id).toBe(42)
    expect(map.get('❤️')).toBeUndefined() // сырой ключ с FE0F в кэше не живёт
  })

  it('дубль эмодзи не перетирает первый mediaId', () => {
    const map = buildEmojiMap([doc('🔥', 1), doc('🔥', 2)])
    expect(map.get('🔥')?.id).toBe(1)
  })

  // Набор из 599 эмодзи хранит альты в исходном виде Telegram — с FE0F,
  // без него, с тоном кожи. Лукап обязан нормализовать сторону запроса тем
  // же правилом, каким построен ключ, независимо от того, какой вариант
  // реально лёг в БД.
  it('лукап независим от селектора вариации на других реальных парах', () => {
    const map = buildEmojiMap([doc('☺', 1), doc('😚', 2)])
    expect(map.get(normalizeEmoji('☺️'))?.id).toBe(1) // с FE0F
    expect(map.get(normalizeEmoji('☺'))?.id).toBe(1) // без
    expect(map.get(normalizeEmoji('😚'))?.id).toBe(2)
  })

  it('лукап независим от модификатора тона кожи', () => {
    const map = buildEmojiMap([doc('👍', 5)])
    expect(map.get(normalizeEmoji('👍🏽'))?.id).toBe(5)
    expect(map.get(normalizeEmoji('👍🏻'))?.id).toBe(5)
  })
})

describe('getAnimatedEmoji / peekAnimatedEmoji', () => {
  it('находит mediaId независимо от FE0F, набор грузится один раз', async () => {
    expect((await getAnimatedEmoji('❤'))?.id).toBe(42)
    expect((await getAnimatedEmoji('❤️'))?.id).toBe(42)
    expect((await getAnimatedEmoji('😂'))?.id).toBe(43)
    expect(await getAnimatedEmoji('🍕')).toBeNull()
    expect(getStickerSet).toHaveBeenCalledTimes(1)
    expect(getStickerSet).toHaveBeenCalledWith({ shortName: 'animated_emoji' })
  })

  it('sync-кэш после загрузки отдаёт то же самое', () => {
    expect(peekAnimatedEmoji('❤️')?.id).toBe(42)
    expect(peekAnimatedEmoji('🍕')).toBeNull()
  })
})
