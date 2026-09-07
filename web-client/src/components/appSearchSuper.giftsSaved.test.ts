// Пины вкладок «Подарки» и «Чаты» (savedDialogs) в `AppSearchSuper` — порт
// tweb `src/components/appSearchSuper.ts:2130-2179` (`loadGifts`), `:2579-2610`
// (`setPinnedGifts`), `:1890-1941` (`loadSavedDialogs`), `:2362-2365`
// (ветка подарков в `canLoadMediaTab`); задача 12 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`.
//
// Предмет — ФАКТ: что оказалось в узлах вкладки, в ряду вкладок, в счётчиках
// и сколько запросов ушло. Сами Solid-вкладки покрыты своими файлами
// (`stargifts/profileList.solid.test.tsx`, `sidebarRight/savedDialogsTab.solid.test.tsx`);
// здесь — шов между ними и классом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { makeMessage } from '@core/messages/testMessage'
import type { SavedStarGift } from '@core/managers/starsManager'
import type { SavedDialog } from '@core/managers/chatsManager'
import type { LangPackKey } from '@lib/langPack'
import { useChatsStore } from '@stores/chatsStore'
import gridStyles from '@components/stargifts/stargiftsGrid.module.scss'

// `usePeer` строки «Чатов» объявляет пробел зеркала через `startClient()`;
// фабрика в happy-dom подняла бы воркер — гасим.
vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { peers: { fillMirror: async () => {} } } }),
}))

const PEER: PeerId = 1

const gift = (i: number): SavedStarGift => ({
  _: 'savedStarGift',
  date: 1786968000 + i,
  saved_id: i + 1,
  gift: { _: 'starGift', id: 10 + i, emoji: String.fromCodePoint(0x1f380 + i), stars: 50, convert_stars: 25 },
})
const gifts = (n: number) => Array.from({ length: n }, (_, i) => gift(i))

const dialog = (i: number): SavedDialog => ({
  peerId: i + 1,
  lastMessage: makeMessage({ id: i + 1, peerId: i + 1, fromId: i + 1, date: 1786968000, text: 'msg-' + i }),
})
const dialogs = (n: number) => Array.from({ length: n }, (_, i) => dialog(i))

function fakeBackend(opts: { gifts?: SavedStarGift[]; dialogs?: SavedDialog[] } = {}) {
  const calls = { gifts: 0, dialogs: 0, media: 0 }
  const managers = {
    messages: {
      mediaHistory: async () => { calls.media++; return { messages: [], count: 0 } },
      searchCounters: async (_peerId: number, filters: string[]) => filters.map((filter) => ({ filter, count: 0 })),
    },
    peers: { fillMirror: async () => {} },
    stars: { profileGifts: async () => { calls.gifts++; return opts.gifts ?? [] } },
    chats: { savedDialogs: async () => { calls.dialogs++; return opts.dialogs ?? [] } },
    presence: { get: async () => [] },
  } as unknown as SearchSuperManagers
  return { managers, calls }
}

const TABS: Record<'gifts' | 'savedDialogs' | 'media', SearchSuperMediaTab> = {
  gifts: { type: 'gifts', name: 'SharedMedia.Gifts' as LangPackKey },
  savedDialogs: { type: 'savedDialogs', name: 'FilterChats' as LangPackKey },
  media: { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
}

function build(managers: SearchSuperManagers, order: (keyof typeof TABS)[], onLengthChange?: AppSearchSuper['onLengthChange']) {
  const scrollableEl = document.createElement('div')
  scrollableEl.getBoundingClientRect = () =>
    ({ width: 360, height: 720, top: 0, left: 0, right: 360, bottom: 720, x: 0, y: 0, toJSON() {} }) as DOMRect
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const mediaTabs = order.map((k) => ({ ...TABS[k] }))
  const searchSuper = new AppSearchSuper({ mediaTabs, scrollable, managers, onLengthChange })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
  return { searchSuper, scrollable }
}

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const giftItems = (s: AppSearchSuper) =>
  s.mediaTabsMap.get('gifts')!.itemsTab!.querySelectorAll(`.${gridStyles.gridItem}`)
const pinned = (s: AppSearchSuper) =>
  s.mediaTabsMap.get('gifts')!.menuTabName!.querySelector('.search-super-pinned-gifts')

beforeEach(() => {
  resetSharedMediaHistories()
  useChatsStore.setState({ meId: 7, dialogs: [] })
})
afterEach(() => document.body.replaceChildren())

describe('AppSearchSuper: вкладка «Подарки» (loadGifts, tweb:2130-2179)', () => {
  it('load(true) на активной вкладке подарков монтирует витрину в itemsTab и ставит счётчик', async () => {
    const onLengthChange = vi.fn()
    const { managers, calls } = fakeBackend({ gifts: gifts(4) })
    const { searchSuper } = build(managers, ['gifts', 'media'], onLengthChange)

    await searchSuper.load(true)
    await settle()

    expect(calls.gifts).toBe(1)
    expect(giftItems(searchSuper)).toHaveLength(4)
    expect(searchSuper.counters.gifts).toBe(4)
    expect(onLengthChange).toHaveBeenCalledWith('gifts', 4)
    expect(searchSuper.mediaTabsMap.get('gifts')!.menuTab!.classList.contains('hide')).toBe(false)
  })

  it('витрина загружена — повторный load в сеть не идёт (ветка gifts в canLoadMediaTab, tweb:2363-2365)', async () => {
    const { managers, calls } = fakeBackend({ gifts: gifts(2) })
    const { searchSuper } = build(managers, ['gifts', 'media'])

    await searchSuper.load(true)
    await settle()
    // Дочитанная витрина выпадает из `toLoad` ещё в `load()` — грузить нечего,
    // и `load` возвращает `undefined` (`tweb:2557`), а не обещание. Пин
    // СИНХРОННЫЙ намеренно: гвард `loaded` внутри самого `loadGifts`
    // (`:2174`) сеть закрывает и без ветки в `canLoadMediaTab`, поэтому счётчик
    // запросов её отсутствия не видит.
    expect(searchSuper.load(true)).toBeUndefined()
    await settle()

    expect(calls.gifts).toBe(1)
    expect(giftItems(searchSuper)).toHaveLength(2)
  })

  it('ноль подарков: строка ряда прячется, а витрина, бывшая активной, уступает первой видимой вкладке (tweb:2143-2153)', async () => {
    const { managers } = fakeBackend({ gifts: [] })
    const { searchSuper } = build(managers, ['gifts', 'media'])
    searchSuper.selectTab(0, false)

    await searchSuper.load(true)
    await settle()

    const giftsTab = searchSuper.mediaTabsMap.get('gifts')!
    expect(searchSuper.counters.gifts).toBe(0)
    expect(giftsTab.menuTab!.classList.contains('hide')).toBe(true)
    expect(giftsTab.menuTab!.classList.contains('active')).toBe(false)
    expect(searchSuper.mediaTab.type).toBe('media')
    // одна видимая вкладка → ряд `is-single`, градиент спрятан (tweb:2523-2525)
    expect(searchSuper.navScrollableContainer.classList.contains('is-single')).toBe(true)
    expect(searchSuper.menuGradient.classList.contains('hide')).toBe(true)
    expect(searchSuper.container.classList.contains('hide')).toBe(false)
  })

  it('setPinnedGifts: первые три подарка рисуются в узле имени вкладки (tweb:2579-2610)', async () => {
    const { managers } = fakeBackend({ gifts: gifts(5) })
    const { searchSuper } = build(managers, ['gifts', 'media'])

    await searchSuper.load(true)
    await settle()

    const name = searchSuper.mediaTabsMap.get('gifts')!.menuTabName!
    expect(name.classList.contains('search-super-pinned-gifts-wrap')).toBe(true)
    const wrap = pinned(searchSuper)!
    expect(wrap).not.toBe(null)
    expect(wrap.children).toHaveLength(3)
    expect(Array.from(wrap.children).map((c) => c.textContent)).toEqual(
      gifts(3).map((g) => g.gift.emoji),
    )
  })

  it('setPinnedGifts([]) снимает узел закреплённых; повторный вызов ПОДМЕНЯЕТ детей, а не копит', async () => {
    const { managers } = fakeBackend({ gifts: gifts(1) })
    const { searchSuper } = build(managers, ['gifts', 'media'])
    await searchSuper.load(true)
    await settle()
    expect(pinned(searchSuper)!.children).toHaveLength(1)

    searchSuper.setPinnedGifts(gifts(2))
    await settle()
    expect(pinned(searchSuper)!.children).toHaveLength(2)

    searchSuper.setPinnedGifts([])
    await settle()
    expect(pinned(searchSuper)).toBe(null)
  })

  it('смена пира (setQuery) сбрасывает витрину: новый load грузит заново, старых плиток нет', async () => {
    const { managers, calls } = fakeBackend({ gifts: gifts(3) })
    const { searchSuper } = build(managers, ['gifts', 'media'])
    await searchSuper.load(true)
    await settle()

    searchSuper.setQuery({ peerId: 2, historyStorage: getHistoryStorage(2) })
    searchSuper.cleanupHTML()
    expect(giftItems(searchSuper)).toHaveLength(0)

    await searchSuper.load(true)
    await settle()

    expect(calls.gifts).toBe(2)
    expect(giftItems(searchSuper)).toHaveLength(3)
  })
})

describe('AppSearchSuper: вкладка «Чаты» (loadSavedDialogs, tweb:1890-1941)', () => {
  it('load(true) монтирует ul.chatlist в карточку секции, открывает её и ставит счётчик', async () => {
    const onLengthChange = vi.fn()
    const { managers, calls } = fakeBackend({ dialogs: dialogs(3) })
    const { searchSuper } = build(managers, ['savedDialogs', 'media'], onLengthChange)

    await searchSuper.load(true)
    await settle()

    const tab = searchSuper.mediaTabsMap.get('savedDialogs')!
    expect(calls.dialogs).toBe(1)
    const ul = tab.itemsTab!.querySelector('ul.chatlist')!
    expect(ul).not.toBe(null)
    expect(ul.querySelectorAll('.chatlist-chat')).toHaveLength(3)
    // `afterPerforming(1, mediaTab)` (tweb:1932) — карточка секции раскрыта
    expect(tab.hideOn!.classList.contains('hide')).toBe(false)
    expect(searchSuper.counters.savedDialogs).toBe(3)
    expect(onLengthChange).toHaveBeenCalledWith('savedDialogs', 3)
  })

  it('список живёт один на пира: повторный load не ходит в сеть и не плодит ul', async () => {
    const { managers, calls } = fakeBackend({ dialogs: dialogs(2) })
    const { searchSuper } = build(managers, ['savedDialogs', 'media'])

    await searchSuper.load(true)
    await settle()
    await searchSuper.load(true)
    await settle()

    expect(calls.dialogs).toBe(1)
    expect(searchSuper.mediaTabsMap.get('savedDialogs')!.itemsTab!.querySelectorAll('ul')).toHaveLength(1)
  })

  it('окно списка слушает скролл ОБЩЕГО скроллера панели (tweb:1897, :1904)', async () => {
    const { managers } = fakeBackend({ dialogs: dialogs(2) })
    const { searchSuper, scrollable } = build(managers, ['savedDialogs', 'media'])
    const addSpy = vi.spyOn(scrollable.container, 'addEventListener')

    await searchSuper.load(true)
    await settle()

    expect(addSpy.mock.calls.some((c) => c[0] === 'scroll')).toBe(true)
  })

  it('смена пира сносит список по middleware; новый load строит его заново', async () => {
    const { managers, calls } = fakeBackend({ dialogs: dialogs(2) })
    const { searchSuper, scrollable } = build(managers, ['savedDialogs', 'media'])
    const removeSpy = vi.spyOn(scrollable.container, 'removeEventListener')
    await searchSuper.load(true)
    await settle()

    searchSuper.setQuery({ peerId: 2, historyStorage: getHistoryStorage(2) })
    searchSuper.cleanupHTML()

    expect(removeSpy.mock.calls.some((c) => c[0] === 'scroll')).toBe(true)
    expect(searchSuper.mediaTabsMap.get('savedDialogs')!.itemsTab!.querySelector('ul')).toBe(null)

    await searchSuper.load(true)
    await settle()
    expect(calls.dialogs).toBe(2)
    expect(searchSuper.mediaTabsMap.get('savedDialogs')!.itemsTab!.querySelector('ul')).not.toBe(null)
  })

  it('destroy() не оставляет ни узлов вкладок, ни слушателя скролла на общем скроллере', async () => {
    const { managers } = fakeBackend({ dialogs: dialogs(2), gifts: gifts(2) })
    const { searchSuper, scrollable } = build(managers, ['savedDialogs', 'gifts'])
    const removeSpy = vi.spyOn(scrollable.container, 'removeEventListener')
    await searchSuper.load(true)
    await searchSuper.load()
    await settle()
    expect(document.querySelector('ul.chatlist')).not.toBe(null)
    expect(document.querySelector(`.${gridStyles.gridItem}`)).not.toBe(null)

    searchSuper.destroy()

    expect(document.querySelector('.search-super')).toBe(null)
    expect(document.querySelector('ul.chatlist')).toBe(null)
    expect(removeSpy.mock.calls.some((c) => c[0] === 'scroll')).toBe(true)
  })
})
