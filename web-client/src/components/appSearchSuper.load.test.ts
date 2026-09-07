// Пины ЗАГРУЗКИ вкладок `AppSearchSuper` (`load`/`loadType`/
// `performSearchResult`, порт tweb `src/components/appSearchSuper.ts:2181-2360`,
// `:2531-2577`, `:1096-1283`).
//
// Предмет проверок — ФАКТ, а не форма вызова: сколько запросов ушло в
// менеджеры, с каким курсором и что осталось в DOM. «Менеджер позван с такими
// аргументами» здесь не проверяется нигде — это и есть то, чем прежняя панель
// (`userInfo/SharedMedia.tsx`) выглядела рабочей, будучи неверной.
//
// Фейковый бэкенд — курсорная ручка `/chats/{id}/media`: страница строго ниже
// `offset_id`, newest-first. Ровно так отвечает настоящая
// (`messagesrepo.go::MediaHistory`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { makeMessage } from '@core/messages/testMessage'
import { saveMessageMedia } from '@core/media/messageMedia'
import type { MyMessage } from '@core/models'
import type { LangPackKey } from '@lib/langPack'

const PEER: PeerId = 1

/** Фотография — то, что попадает во вкладку `media` (`inputMessagesFilterPhotoVideo`). */
const photo = (id: number): MyMessage => makeMessage({
  id, peerId: PEER, fromId: PEER,
  media: saveMessageMedia({ _: 'messageMediaPhoto', photo: { _: 'photo', id, sizes: [] } }),
})

/** Список newest-first: id по убыванию, как отдаёт `ORDER BY m.seq DESC`. */
const feed = (n: number) => Array.from({ length: n }, (_, i) => photo(n - i))

function fakeBackend(all: MyMessage[]) {
  const calls: { filter: string; offsetId: number; limit: number; got: MyMessage[] }[] = []
  const managers = {
    messages: {
      mediaHistory: async (_peerId: number, filter: string, offsetId = 0, limit = 30) => {
        const from = offsetId ? all.filter((m) => m.id < offsetId) : all
        const got = from.slice(0, limit)
        calls.push({ filter, offsetId, limit, got })
        return { messages: got, count: all.length }
      },
      searchCounters: async (_peerId: number, filters: string[]) =>
        filters.map((filter) => ({ filter, count: all.length })),
    },
  } as unknown as SearchSuperManagers
  return { managers, calls }
}

function makeMediaTabs(): SearchSuperMediaTab[] {
  return [
    { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
    { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
  ]
}

function build(managers: SearchSuperManagers) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const searchSuper = new AppSearchSuper({ mediaTabs: makeMediaTabs(), scrollable, managers })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
  return searchSuper
}

/** Дать отработать отложенной предзагрузке (`tweb:2329-2348` — `setTimeout(…, 0)`). */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const mids = (searchSuper: AppSearchSuper) =>
  Array.from(searchSuper.tabs.inputMessagesFilterPhotoVideo!.children)
    .map((el) => +(el as HTMLElement).dataset.mid!)

beforeEach(() => resetSharedMediaHistories())
afterEach(() => document.body.replaceChildren())

describe('AppSearchSuper: пагинация по курсору', () => {
  it('первая страница идёт без курсора, следующая — по номеру ПОСЛЕДНЕГО показанного', async () => {
    const { managers, calls } = fakeBackend(feed(200))
    const searchSuper = build(managers)

    await searchSuper.load(true)
    await settle()

    expect(calls[0].filter).toBe('media')
    expect(calls[0].offsetId).toBe(0)
    // курсор второй страницы — id последнего сообщения первой, а не её длина
    const lastOfFirst = calls[0].got[calls[0].got.length - 1].id
    expect(calls[1].offsetId).toBe(lastOfFirst)
    // и содержимое страниц не пересеклось
    expect(calls[1].got.every((m) => m.id < lastOfFirst)).toBe(true)
  })

  it('страница короче запрошенной закрывает вкладку: следующий load в сеть не идёт', async () => {
    const { managers, calls } = fakeBackend(feed(3))
    const searchSuper = build(managers)

    await searchSuper.load(true)
    await settle()
    const after = calls.length

    await searchSuper.load(true)
    await settle()

    expect(calls.length).toBe(after)
    expect(mids(searchSuper)).toEqual([3, 2, 1])
  })

  // ГЛАВНЫЙ пин пагинации — тот же сценарий, которым курсор проверен на
  // бэкенде: список пополняется СВЕРХУ между запросами страниц. Со смещением
  // вторая страница приезжала бы с дублем последнего элемента первой (а при
  // удалении — с дырой); курсор к этому нечувствителен по построению.
  it('новое сообщение СВЕРХУ между страницами не даёт ни дубля, ни пропуска', async () => {
    const all = feed(60)
    const { managers } = fakeBackend(all)
    const searchSuper = build(managers)

    await searchSuper.load(true)
    // ровно между страницами: первая уже приехала, вторую ещё не просили
    all.unshift(photo(61))
    await settle()

    // порция из кэша: в нём и первая страница, и догруженная вторая
    await searchSuper.load(true)
    await settle()

    const drawn = mids(searchSuper)
    expect(drawn.length).toBeGreaterThan(20)
    expect(drawn).toEqual(Array.from(new Set(drawn)))
    // новое сообщение в кэш этой вкладки не попадало — значит ожидаемый
    // список это исходная лента, без пропусков
    expect(drawn).toEqual(feed(60).map((m) => m.id).slice(0, drawn.length))
  })

  it('параллельные загрузки одного типа дают ОДИН запрос', async () => {
    const { managers, calls } = fakeBackend(feed(3))
    const searchSuper = build(managers)

    await Promise.all([searchSuper.load(true), searchSuper.load(true), searchSuper.load(true)])

    expect(calls.length).toBe(1)
    expect(mids(searchSuper)).toEqual([3, 2, 1])
  })
})

describe('AppSearchSuper: рендер из кэша', () => {
  it('возврат к тому же пиру рисует список БЕЗ единого сетевого вызова', async () => {
    const { managers, calls } = fakeBackend(feed(200))
    const searchSuper = build(managers)

    await searchSuper.load(true)
    await settle()
    const drawn = mids(searchSuper)
    expect(drawn.length).toBeGreaterThan(0)
    const network = calls.length

    // выход из профиля и возврат к ТОМУ ЖЕ пиру: разметка обнуляется,
    // кэш сообщений — нет (он живёт снаружи класса, `sharedMedia.tsx:33-36`)
    searchSuper.cleanup()
    searchSuper.cleanupHTML()
    expect(mids(searchSuper)).toEqual([])

    searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
    await searchSuper.load(true)
    await settle()

    expect(calls.length).toBe(network)
    expect(mids(searchSuper)).toEqual(drawn)
  })

  it('переключение вкладок не перезагружает уже показанную', async () => {
    const { managers, calls } = fakeBackend(feed(3))
    const searchSuper = build(managers)

    await searchSuper.load(true)
    await settle()
    const network = calls.filter((c) => c.filter === 'media').length

    // уход на соседнюю вкладку и возврат: `media` уже показана, и грузить её
    // заново незачем (`tweb:686-689` — грузится только ПУСТАЯ вкладка)
    searchSuper.selectTab(1)
    searchSuper.selectTab(0)
    searchSuper.selectTab(1)
    await settle()

    expect(calls.filter((c) => c.filter === 'media').length).toBe(network)
    // а вот пустая `files` за своим списком сходила — ровно один раз
    expect(calls.filter((c) => c.filter === 'files').length).toBe(1)
    // и узлы `media` на месте, в том же порядке
    expect(mids(searchSuper)).toEqual([3, 2, 1])
  })
})

describe('AppSearchSuper: пустая вкладка', () => {
  it('пустой ответ даёт `.content-empty`, а не пустой список', async () => {
    const { managers } = fakeBackend([])
    const searchSuper = build(managers)

    await searchSuper.load(true)
    await settle()

    const empty = searchSuper.container.querySelector('.content-empty')
    expect(empty).not.toBeNull()
    expect(empty!.className).toBe('position-center text-center content-empty no-select')
  })
})
