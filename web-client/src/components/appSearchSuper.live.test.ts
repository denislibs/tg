// Пины ЖИВЫХ АПДЕЙТОВ вкладок shared media (`components/sharedMediaHistories.ts`,
// порт tweb `src/components/sidebarRight/tabs/sharedMedia.tsx:209-345`).
//
// Это пин ПРОТИВ нашей прежней недоделки: React-панель на любое изменение длины
// окна сносила кэш всех фильтров целиком (`userInfo/SharedMedia.tsx:177-183`) —
// открытая вкладка перезагружалась с нуля, а прокрутка уезжала. Оригинал
// вставляет ОДИН узел сверху и увеличивает счётчик на единицу, не трогая
// загруженные страницы.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab, type SearchSuperMediaType } from '@components/appSearchSuper'
import {
  deleteDeletedMessages,
  getHistoryStorage,
  renderNewMessage,
  resetSharedMediaHistories,
  subscribeSharedMediaLiveUpdates,
} from '@components/sharedMediaHistories'
import ListenerSetter from '@helpers/listenerSetter'
import rootScope from '@lib/rootScope'
import { makeMessage } from '@core/messages/testMessage'
import { saveMessageMedia } from '@core/media/messageMedia'
import type { MyMessage } from '@core/models'
import type { LangPackKey } from '@lib/langPack'

const PEER: PeerId = 1

const photo = (id: number): MyMessage => makeMessage({
  id, peerId: PEER, fromId: PEER,
  media: saveMessageMedia({ _: 'messageMediaPhoto', photo: { _: 'photo', id, sizes: [] } }),
})

const text = (id: number): MyMessage => makeMessage({ id, peerId: PEER, fromId: PEER, text: 'просто текст' })

function makeMediaTabs(): SearchSuperMediaTab[] {
  return [
    { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
    { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
  ]
}

function build(all: MyMessage[]) {
  const counters: [SearchSuperMediaType, number][] = []
  const managers = {
    messages: {
      mediaHistory: async (_peerId: number, filter: string, offsetId = 0, limit = 30) => {
        const src = filter === 'media' ? all : []
        const from = offsetId ? src.filter((m) => m.id < offsetId) : src
        return { messages: from.slice(0, limit), count: src.length }
      },
      searchCounters: async (_peerId: number, filters: string[]) =>
        filters.map((filter) => ({ filter, count: 0 })),
    },
  } as unknown as SearchSuperManagers

  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const searchSuper = new AppSearchSuper({
    mediaTabs: makeMediaTabs(),
    scrollable,
    managers,
    onLengthChange: (type, length) => counters.push([type, length]),
  })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
  return { searchSuper, counters }
}

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const mids = (searchSuper: AppSearchSuper) =>
  Array.from(searchSuper.tabs.inputMessagesFilterPhotoVideo!.children)
    .map((el) => +(el as HTMLElement).dataset.mid!)

beforeEach(() => resetSharedMediaHistories())
afterEach(() => document.body.replaceChildren())

describe('shared media: новое сообщение', () => {
  it('подходящее по типу встаёт ОДНИМ узлом сверху, страницы остаются на месте', async () => {
    const { searchSuper, counters } = build([photo(3), photo(2), photo(1)])
    await searchSuper.load(true)
    await settle()
    expect(mids(searchSuper)).toEqual([3, 2, 1])
    const countBefore = searchSuper.counters.media

    renderNewMessage(searchSuper, photo(4))
    await settle()

    expect(mids(searchSuper)).toEqual([4, 3, 2, 1])
    expect(searchSuper.counters.media).toBe(countBefore! + 1)
    expect(counters[counters.length - 1]).toEqual(['media', countBefore! + 1])
  })

  it('сообщение чужого типа не трогает вкладку вовсе', async () => {
    const { searchSuper } = build([photo(3), photo(2), photo(1)])
    await searchSuper.load(true)
    await settle()
    const countBefore = searchSuper.counters.media

    renderNewMessage(searchSuper, text(4))
    await settle()

    expect(mids(searchSuper)).toEqual([3, 2, 1])
    expect(searchSuper.counters.media).toBe(countBefore)
  })

  it('кэш фильтра переживает апдейт: перерисовка идёт без сети и с новым узлом', async () => {
    const { searchSuper } = build([photo(3), photo(2), photo(1)])
    await searchSuper.load(true)
    await settle()
    renderNewMessage(searchSuper, photo(4))
    await settle()

    // тот же пир: разметку обнулили, кэш — нет
    searchSuper.cleanup()
    searchSuper.cleanupHTML()
    searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
    await searchSuper.load(true)
    await settle()

    expect(mids(searchSuper)).toEqual([4, 3, 2, 1])
  })
})

// Проводка апдейтов: у оригинала подписки живут в обвязке правой колонки
// (`sharedMedia.tsx:596-602`), у нас обвязка приезжает задачей 13, поэтому сама
// подписка вынесена в модуль. Пин на неё нужен: без него потеря события
// ничего не роняет — вкладки просто перестают обновляться.
describe('shared media: подписка на события окна', () => {
  it('`history_append` доводит сообщение до вкладки, ключ окна даёт пира', async () => {
    const { searchSuper } = build([photo(3), photo(2), photo(1)])
    const listenerSetter = new ListenerSetter()
    subscribeSharedMediaLiveUpdates(searchSuper, listenerSetter)
    await searchSuper.load(true)
    await settle()

    rootScope.dispatchEventSingle('history_append', { storageKey: String(PEER), message: photo(4) })
    await settle()
    expect(mids(searchSuper)).toEqual([4, 3, 2, 1])

    // чужое окно вкладку не трогает
    rootScope.dispatchEventSingle('history_append', { storageKey: '999', message: photo(5) })
    await settle()
    expect(mids(searchSuper)).toEqual([4, 3, 2, 1])

    rootScope.dispatchEventSingle('history_delete', { peerId: PEER, msgs: new Set([3]) })
    await settle()
    expect(mids(searchSuper)).toEqual([4, 2, 1])

    listenerSetter.removeAll()
  })
})

describe('shared media: удаление сообщения', () => {
  it('снимает узел и уменьшает счётчик на единицу', async () => {
    const { searchSuper, counters } = build([photo(3), photo(2), photo(1)])
    await searchSuper.load(true)
    await settle()
    const countBefore = searchSuper.counters.media

    deleteDeletedMessages(searchSuper, PEER, [2])
    await settle()

    expect(mids(searchSuper)).toEqual([3, 1])
    expect(searchSuper.counters.media).toBe(countBefore! - 1)
    expect(counters[counters.length - 1]).toEqual(['media', countBefore! - 1])
  })

  // Главный пин удаления: узел ушёл из СЕРЕДИНЫ уже отрисованного, а в кэше
  // остался неотрисованный хвост. Отметку «сколько из кэша отрисовано» надо
  // подвинуть вместе с ним (`tweb:300-302`), иначе следующая порция начнётся на
  // элемент дальше — и один пропадёт из списка молча.
  it('удаление не сдвигает окно кэша: следующая порция без дубля и без пропуска', async () => {
    const all = Array.from({ length: 60 }, (_, i) => photo(60 - i))
    const { searchSuper } = build(all)
    await searchSuper.load(true)
    await settle()

    const drawn = mids(searchSuper)
    // отрисовано меньше, чем лежит в кэше, — иначе пин ни о чём
    expect(drawn.length).toBeGreaterThan(1)
    expect(drawn.length).toBeLessThan(all.length)

    const victim = drawn[1]
    deleteDeletedMessages(searchSuper, PEER, [victim])
    await settle()

    // следующая порция — из кэша
    await searchSuper.load(true)
    await settle()

    const after = mids(searchSuper)
    const expected = all.map((m) => m.id).filter((id) => id !== victim)
    expect(after).toEqual(Array.from(new Set(after)))
    expect(after).toEqual(expected.slice(0, after.length))
    expect(after.length).toBeGreaterThan(drawn.length)
  })

  it('удалённое сообщение уходит и из кэша — после возврата к пиру его нет', async () => {
    const { searchSuper } = build([photo(3), photo(2), photo(1)])
    await searchSuper.load(true)
    await settle()

    deleteDeletedMessages(searchSuper, PEER, [2])
    await settle()

    searchSuper.cleanup()
    searchSuper.cleanupHTML()
    searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
    await searchSuper.load(true)
    await settle()

    expect(mids(searchSuper)).toEqual([3, 1])
  })
})
