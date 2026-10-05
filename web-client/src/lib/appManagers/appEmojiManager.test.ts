// Пины `appEmojiManager` (порт tweb `appEmojiManager.ts`, П-6): недавние эмодзи (по умолчанию —
// популярные, свежий — первым, без повторов и тонов кожи, лимит 32, объявление `emoji_recent`),
// тон кожи (`saveEmojiVariant` → ключ State + `emoji_variant`), поиск по ключевым словам вместе со
// своими эмодзи установленных наборов (`prepareAndSearchEmojis({addCustom})`).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyDocument } from '@core/media/messageMedia'

const managers = {
  stickers: {
    mySets: vi.fn(async() => [{ _: 'stickerSet', id: 7, title: 'Мои', short_name: 'mine', count: 1, pFlags: { emojis: true } }]),
    getStickerSet: vi.fn(async() => ({
      set: { _: 'stickerSet', id: 7 },
      stickers: [{ _: 'document', id: 777, mime_type: 'application/x-tgsticker', size: 1, attributes: [], stickerEmojiRaw: '🔥' } as MyDocument],
    })),
  },
  docs: { getDoc: vi.fn(async() => undefined) },
}

vi.mock('@/client/bootstrap', () => ({ startClient: () => ({ managers }) }))

async function load() {
  vi.resetModules()
  const { useAppStateStore } = await import('@stores/appState')
  const { default: rootScope } = await import('@lib/rootScope')
  const { default: appEmojiManager } = await import('./appEmojiManager')
  return { useAppStateStore, rootScope, appEmojiManager }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  managers.stickers.mySets.mockClear()
})

describe('appEmojiManager: недавние', () => {
  it('пусто в State — отдаёт популярные tweb', async() => {
    const { appEmojiManager } = await load()
    const recent = await appEmojiManager.getRecentEmojis('native')
    expect(recent.slice(0, 3)).toEqual(['😂', '😘', '❤️'])
  })

  it('использованный эмодзи встаёт первым без повтора, тон кожи сводится к базовому, объявляется emoji_recent', async() => {
    const { appEmojiManager, useAppStateStore, rootScope } = await load()
    useAppStateStore.setState({ recentEmoji: ['😀', '👍'] })
    const onRecent = vi.fn()
    rootScope.addEventListener('emoji_recent', onRecent)

    appEmojiManager.pushRecentEmoji({ emoji: '👍🏽' })
    await flush()

    expect(useAppStateStore.getState().recentEmoji).toEqual(['👍', '😀'])
    expect(onRecent).toHaveBeenCalledWith({ emoji: { emoji: '👍' }, deleted: false })

    appEmojiManager.deleteRecentEmoji({ emoji: '😀' })
    await flush()
    expect(useAppStateStore.getState().recentEmoji).toEqual(['👍'])
    expect(onRecent).toHaveBeenLastCalledWith({ emoji: { emoji: '😀' }, deleted: true })
  })

  it('свои эмодзи копятся отдельно — по id документа, с лимитом 32', async() => {
    const { appEmojiManager, useAppStateStore } = await load()
    for(let i = 1; i <= 40; ++i) {
      appEmojiManager.pushRecentEmoji({ emoji: '', docId: i })
      await flush()
    }

    const recentCustom = useAppStateStore.getState().recentCustomEmoji
    expect(recentCustom).toHaveLength(32)
    expect(recentCustom[0]).toBe(40)
    expect(useAppStateStore.getState().recentEmoji).toEqual([])
  })
})

describe('appEmojiManager: тон кожи', () => {
  it('saveEmojiVariant пишет тон по базовому эмодзи и объявляет emoji_variant', async() => {
    const { appEmojiManager, useAppStateStore, rootScope } = await load()
    const onVariant = vi.fn()
    rootScope.addEventListener('emoji_variant', onVariant)

    await appEmojiManager.saveEmojiVariant('👍', 3)

    expect(useAppStateStore.getState().emojiVariants).toEqual({ '👍': 3 })
    expect(onVariant).toHaveBeenCalledWith({ baseEmoji: '👍', emoji: '👍🏽', tone: 3 })
  })
})

describe('appEmojiManager: поиск', () => {
  it('по ключевому слову находит эмодзи и свои эмодзи с тем же эмодзи', async() => {
    const { appEmojiManager } = await load()
    const found = await appEmojiManager.prepareAndSearchEmojis({ q: 'огонь', limit: Infinity, minChars: 1, addCustom: true })
    expect(found).toEqual([{ docId: 777, emoji: '🔥' }, { emoji: '🔥' }])
    expect(managers.stickers.mySets).toHaveBeenCalledTimes(1)

    const custom = await appEmojiManager.getCustomEmojiDocument(777)
    expect(custom?.stickerEmojiRaw).toBe('🔥')
  })
})
