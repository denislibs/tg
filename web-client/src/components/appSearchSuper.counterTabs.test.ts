// Вкладки shared media появляются и исчезают вместе со счётчиком — B9 в
// `docs/tweb/delta/security-and-bugs.md`, порт tweb ca1416807.
//
// Было: вкладку, которой нечего показать, `loadFirstTime` прячет классом
// `hide`, и снять его потом не мог никто — `setCounter` видимость не трогал, а
// живой апдейт (`sharedMediaHistories.ts`) скрытую вкладку пропускал целиком:
// у незагруженной вкладки нет списка, в который вставлять. Первая фотография в
// чате без медиа не открывала вкладку «Медиа» до переоткрытия профиля.
//
// Зависимости настоящие: живой `Scrollable`, живая полоса вкладок со слайдером,
// живые `renderNewMessage`/`deleteDeletedMessages`. Бэкенд — фейк с
// изменяемым набором сообщений: ответы счётчиков и страниц берутся из него.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import type { SearchHistoryOptions } from '@core/managers/messagesManager'
import { getWireFilter, type MessagesWireFilter } from '@core/messages/inputMessagesFilter'
import { deleteDeletedMessages, getHistoryStorage, renderNewMessage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { makeMessage } from '@core/messages/testMessage'
import { saveMessageMedia } from '@core/media/messageMedia'
import type { MyMessage } from '@core/models'
import type { LangPackKey } from '@lib/langPack'

const PEER: PeerId = 1

const photo = (id: number): MyMessage => makeMessage({
  id, peerId: PEER, fromId: PEER,
  media: saveMessageMedia({ _: 'messageMediaPhoto', photo: { _: 'photo', id, sizes: [] } }),
})

const link = (id: number): MyMessage => makeMessage({
  id, peerId: PEER, fromId: PEER, date: 1_700_000_000,
  text: 'https://example.com/' + id,
  entities: [{ _: 'messageEntityUrl', offset: 0, length: 20 + String(id).length }],
})

function makeMediaTabs(): SearchSuperMediaTab[] {
  return [
    { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
    { type: 'links', inputFilter: 'inputMessagesFilterUrl', name: 'SharedLinksTab2' as LangPackKey },
  ]
}

function build(initial: Partial<Record<MessagesWireFilter, MyMessage[]>>) {
  // «сервер»: списки по фильтру, newest-first; тест правит их по ходу
  const server: Partial<Record<MessagesWireFilter, MyMessage[]>> = { ...initial }
  const calls = { searchHistory: [] as MessagesWireFilter[], searchCounters: [] as string[][] }
  const managers = {
    messages: {
      searchHistory: async ({ inputFilter, offsetId = 0, limit = 30 }: SearchHistoryOptions) => {
        const filter = getWireFilter(inputFilter._)!
        calls.searchHistory.push(filter)
        const src = server[filter] ?? []
        const from = offsetId ? src.filter((m) => m.id < offsetId) : src
        return { messages: from.slice(0, limit), count: src.length }
      },
      searchCounters: async (_peerId: number, filters: string[]) => {
        calls.searchCounters.push(filters)
        return filters.map((filter) => ({ filter, count: server[filter as MessagesWireFilter]?.length ?? 0 }))
      },
    },
  } as unknown as SearchSuperManagers

  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  // `hideEmptyTabs` по умолчанию включён — это и есть режим правой колонки
  const searchSuper = new AppSearchSuper({ mediaTabs: makeMediaTabs(), scrollable, managers })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
  return { searchSuper, server, calls }
}

const settle = async () => {
  for(let i = 0; i < 4; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const menuTab = (s: AppSearchSuper, type: 'media' | 'links') => s.mediaTabsMap.get(type)!.menuTab!
const isHidden = (s: AppSearchSuper, type: 'media' | 'links') => menuTab(s, type).classList.contains('hide')

beforeEach(() => resetSharedMediaHistories())
afterEach(() => document.body.replaceChildren())

describe('shared media: вкладка появляется со счётчиком (tweb ca1416807)', () => {
  it('первая фотография в чате без медиа открывает скрытую вкладку «Медиа»', async () => {
    const { searchSuper } = build({ links: [link(1)] })
    await searchSuper.load(true)
    await settle()
    expect(isHidden(searchSuper, 'media')).toBe(true)
    expect(menuTab(searchSuper, 'links').classList.contains('active')).toBe(true)

    renderNewMessage(searchSuper, photo(2))
    await settle()

    expect(searchSuper.counters.media).toBe(1)
    expect(isHidden(searchSuper, 'media')).toBe(false)
    // выбранная вкладка остаётся той же — уводить пользователя незачем
    expect(menuTab(searchSuper, 'links').classList.contains('active')).toBe(true)
    // ряд больше не одиночный
    expect(searchSuper.navScrollableContainer.classList.contains('is-single')).toBe(false)
  })

  it('в пустом профиле появившаяся вкладка выбирается и грузится', async () => {
    const { searchSuper, server, calls } = build({})
    await searchSuper.load(true)
    await settle()
    expect(searchSuper.container.classList.contains('hide')).toBe(true)

    server.media = [photo(5)]
    renderNewMessage(searchSuper, photo(5))
    await settle()

    expect(searchSuper.container.classList.contains('hide')).toBe(false)
    expect(isHidden(searchSuper, 'media')).toBe(false)
    expect(menuTab(searchSuper, 'media').classList.contains('active')).toBe(true)
    expect(calls.searchHistory).toContain('media')
    const tiles = searchSuper.tabs.inputMessagesFilterPhotoVideo!.querySelectorAll('[data-mid]')
    expect(Array.from(tiles).map((el) => +(el as HTMLElement).dataset.mid!)).toEqual([5])
  })

  it('удаление в незагруженной вкладке перечитывает её счётчик с сервера — и прячет её на нуле', async () => {
    const { searchSuper, server, calls } = build({ links: [link(1)] })
    await searchSuper.load(true)
    await settle()
    renderNewMessage(searchSuper, photo(2))
    await settle()
    expect(isHidden(searchSuper, 'media')).toBe(false)

    // вкладку «Медиа» так и не открывали: списка у неё нет, узла — тоже
    expect(searchSuper.historyStorage.inputMessagesFilterPhotoVideo).toBeUndefined()
    server.media = []
    calls.searchCounters.length = 0
    deleteDeletedMessages(searchSuper, PEER, [2])
    await settle()

    // один батч; «Ссылки» в нём тоже — узла mid 2 в её DOM нет (`:318-335` оригинала)
    expect(calls.searchCounters).toHaveLength(1)
    expect(calls.searchCounters[0]).toContain('media')
    expect(searchSuper.counters.media).toBe(0)
    expect(isHidden(searchSuper, 'media')).toBe(true)
  })

  it('обнулившаяся активная вкладка прячется и уступает первой видимой', async () => {
    const { searchSuper, server } = build({ media: [photo(1)], links: [link(2)] })
    await searchSuper.load(true)
    await settle()
    expect(menuTab(searchSuper, 'media').classList.contains('active')).toBe(true)

    server.media = []
    deleteDeletedMessages(searchSuper, PEER, [1])
    await settle()

    expect(searchSuper.counters.media).toBe(0)
    expect(isHidden(searchSuper, 'media')).toBe(true)
    expect(menuTab(searchSuper, 'media').classList.contains('active')).toBe(false)
    expect(menuTab(searchSuper, 'links').classList.contains('active')).toBe(true)
  })
})
