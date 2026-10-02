// Пины вкладки «Подарки» в `AppSearchSuper` — порт tweb
// `src/components/appSearchSuper.ts:2130-2179` (`loadGifts`), `:2579-2610`
// (`setPinnedGifts`), `:2362-2365` (ветка подарков в `canLoadMediaTab`); задача 12
// плана `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`.
// Вкладка «Чаты» (savedDialogs) — `appSearchSuper.savedDialogs.test.ts` (задача 1-7
// волны 7).
//
// Предмет — ФАКТ: что оказалось в узлах вкладки, в ряду вкладок, в счётчиках
// и сколько запросов ушло. Сама Solid-витрина покрыта своим файлом
// (`stargifts/profileList.solid.test.tsx`); здесь — шов между ней и классом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import type { SavedStarGift } from '@core/managers/starsManager'
import type { LangPackKey } from '@lib/langPack'
import { useChatsStore } from '@stores/chatsStore'
import gridStyles from '@components/stargifts/stargiftsGrid.module.scss'

const PEER: PeerId = 1

const gift = (i: number): SavedStarGift => ({
  _: 'savedStarGift',
  date: 1786968000 + i,
  saved_id: i + 1,
  gift: { _: 'starGift', id: 10 + i, emoji: String.fromCodePoint(0x1f380 + i), stars: 50, convert_stars: 25 },
})
const gifts = (n: number) => Array.from({ length: n }, (_, i) => gift(i))

function fakeBackend(opts: { gifts?: SavedStarGift[] } = {}) {
  const calls = { gifts: 0, media: 0 }
  const managers = {
    messages: {
      searchHistory: async () => { calls.media++; return { messages: [], count: 0 } },
      searchCounters: async (_peerId: number, filters: string[]) => filters.map((filter) => ({ filter, count: 0 })),
    },
    peers: { fillMirror: async () => {} },
    stars: { profileGifts: async () => { calls.gifts++; return opts.gifts ?? [] } },
    presence: { get: async () => [] },
  } as unknown as SearchSuperManagers
  return { managers, calls }
}

const TABS: Record<'gifts' | 'media', SearchSuperMediaTab> = {
  gifts: { type: 'gifts', name: 'SharedMedia.Gifts' as LangPackKey },
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
  // Первый показ (`loadFirstTime`, задача 10) выключен: он сам считает подарки
  // запросом `profileGifts` (расхождение 29) и смешал бы счёт сетевых вызовов
  // витрины; какая вкладка выбирается первой — предмет `firstTime.test.ts`.
  const searchSuper = new AppSearchSuper({ mediaTabs, scrollable, managers, onLengthChange, hideEmptyTabs: false })
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
    // и `load` разрешается в `undefined` (`tweb:2557`), а не в результат
    // загрузки (`load` — `async`, как в оригинале `:2531`). Пин на возврат
    // намеренно: гвард `loaded` внутри самого `loadGifts` (`:2174`) сеть
    // закрывает и без ветки в `canLoadMediaTab`, поэтому счётчик запросов её
    // отсутствия не видит.
    expect(await searchSuper.load(true)).toBeUndefined()
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
