// Пины ЛЕВОЙ КОЛОНКИ в классе `AppSearchSuper` — задача 8 плана глобального
// поиска: группы (`searchGroups`, `searchGroupMedia`), рендер найденного
// сообщения строкой чатлиста (`processEmptyFilter`, tweb `appSearchSuper.ts:826-871`),
// курсор глобальной выдачи `nextRate` (`:2288`, `:2310-2321`, `:2718`) и
// `hideEmptyTabs: false` (`:2383-2385`, `:2770-2778`).
//
// Класс собирается так, как его собирает левая колонка оригинала
// (`sidebarLeft/index.ts:1128-1170`): `searchGroups`, `hideEmptyTabs: false`,
// `showSender: true`, контекст `setQuery({peerId: 0, folderId: 0, query})`
// (`:1192`, `:1368`). Группы в узел вкладки кладёт `loadChats` (`:1289-1292`);
// его собственные пины — `appSearchSuper.loadChats.test.ts`, здесь книга,
// `/search` и диалоги пусты.
//
// Фейковый бэкенд — шов `messages.searchHistory` (задача 6) с поведением
// настоящих ручек: глобальная выдача листается курсором `nextRate` (номер
// последнего отданного; на последней странице курсора нет), поиск в чате — по
// `offsetId`, курсора не несёт. Пины — на узлы в DOM и на то, ушёл ли запрос.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import { createSearchGroup, type SearchGroup } from '@components/searchGroup.solid'
import { resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { makeMessage } from '@core/messages/testMessage'
import { saveMessageMedia } from '@core/media/messageMedia'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { SearchHistoryOptions } from '@core/managers/messagesManager'
import type { MyMessage } from '@core/models'
import { getMiddleware } from '@helpers/middleware'
import type { LangPackKey } from '@lib/langPack'

const ALICE: PeerId = 7
const BOB: PeerId = 8

/** Текст с совпадением; номера сквозные — глобальная выдача упорядочена по ним. */
const text = (id: number, peerId: PeerId = ALICE): MyMessage => makeMessage({
  id, peerId, fromId: peerId, text: `кот №${id}`, createdAt: '2026-01-05T12:00:00Z',
})

const photo = (id: number): MyMessage => makeMessage({
  id, peerId: ALICE, fromId: ALICE, text: `кот ${id}`,
  media: saveMessageMedia({ _: 'messageMediaPhoto', photo: { _: 'photo', id, sizes: [] } }),
})

function fakeBackend(all: MyMessage[]) {
  const calls: SearchHistoryOptions[] = []
  const managers = {
    messages: {
      searchHistory: async (ctx: SearchHistoryOptions) => {
        calls.push(ctx)
        const limit = ctx.limit ?? 20
        const global = !(ctx.peerId && !ctx.nextRate && ctx.folderId === undefined)
        const from = global
          ? (ctx.nextRate ? all.filter((m) => m.id < ctx.nextRate!) : all)
          : all.filter((m) => m.peerId === ctx.peerId && (!ctx.offsetId || m.id < ctx.offsetId))
        const got = from.slice(0, limit)
        const more = from.length > got.length
        return {
          messages: got,
          count: all.length,
          nextRate: global && more ? got[got.length - 1].id : undefined,
        }
      },
      searchCounters: async () => { throw new Error('hideEmptyTabs: false — счётчики не спрашиваются') },
    },
    peers: { fillMirror: async () => {} },
    presence: { get: async () => [] },
    // группы контактов (`loadChats`) — пусто
    contacts: { getContactsPeerIds: async () => [] },
    channels: { search: async () => ({ _: 'contacts.found', my_results: [], results: [], chats: [], users: [] }) },
    dialogs: { getDialogs: async () => ({ dialogs: [], count: 0, isEnd: true }) },
  } as unknown as SearchSuperManagers
  return { managers, calls }
}

const TABS = (): SearchSuperMediaTab[] => [
  { type: 'chats', inputFilter: 'inputMessagesFilterEmpty', name: 'FilterChats' as LangPackKey },
  { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
]

let groupsMiddleware = getMiddleware()

function build(managers: SearchSuperManagers, { createPlaceholder }: { createPlaceholder?: () => HTMLElement } = {}) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)

  // пять групп, как у владельца (`sidebarLeft/index.ts:1095-1103`); здесь
  // проверяется только `messages`
  const group = (name: string | false, type: string, className?: string) => createSearchGroup({
    name: name as LangPackKey | false, type, className, middleware: groupsMiddleware.get(),
  })
  const messages = group('SearchMessages', 'messages')
  messages.createPlaceholder = createPlaceholder

  const searchSuper = new AppSearchSuper({
    mediaTabs: TABS(),
    scrollable,
    managers,
    searchGroups: {
      contacts: group('SearchAllChatsShort', 'contacts'),
      globalContacts: group('GlobalSearch', 'globalContacts'),
      messages,
      people: group(false, 'contacts', 'search-group-people'),
      recent: group('Recent', 'contacts', 'search-group-recent'),
    },
    hideEmptyTabs: false,
    showSender: true,
  })
  scrollable.container.append(searchSuper.container)
  return { searchSuper, messages }
}

/** Дать отработать отложенной предзагрузке (`tweb:2329-2348` — `setTimeout(…, 0)`). */
const settle = async () => {
  for(let i = 0; i < 4; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const rows = (group: SearchGroup) => Array.from(group.list.children) as HTMLElement[]

beforeEach(() => {
  resetSharedMediaHistories()
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} },
    { _: 'user', id: BOB, first_name: 'Боб', pFlags: {} },
  ] }])
  groupsMiddleware = getMiddleware()
})
afterEach(() => {
  groupsMiddleware.destroy()
  document.body.replaceChildren()
})

describe('AppSearchSuper: вкладка chats — сообщения строками группы «Messages»', () => {
  it('найденное рисуется строкой чатлиста в searchGroups.messages с подсветкой; группа показана', async () => {
    const { managers } = fakeBackend([text(3, ALICE), text(2, BOB)])
    const { searchSuper, messages } = build(managers)
    searchSuper.setQuery({ peerId: 0, folderId: 0, query: 'кот' })

    await searchSuper.load(true)
    await settle()

    // строки — `a.chatlist-chat` пира сообщения, с номером найденного (прыжок)
    const list = rows(messages)
    expect(list.map((el) => [+el.dataset.peerId!, +el.dataset.mid!])).toEqual([[ALICE, 3], [BOB, 2]])
    expect(list.every((el) => el.tagName === 'A' && el.classList.contains('chatlist-chat-bigger'))).toBe(true)
    // превью с подсветкой запроса (`highlightWord: searchContext.query`, :860)
    expect(list[0].querySelector('.row-subtitle i.text-highlight')?.textContent).toBe('кот')
    // группа видна, а в сам узел вкладки строки не легли
    expect(messages.container.classList.contains('hide')).toBe(false)
    expect(searchSuper.tabs.inputMessagesFilterEmpty!.querySelectorAll(':scope > .search-super-item')).toHaveLength(0)
    // `afterPerforming(1)` для пустого фильтра (:1253): «ничего не найдено» нет
    expect(searchSuper.container.querySelector('.content-empty')).toBeNull()
  })

  it('пустая выдача с createPlaceholder — группа показана с заглушкой; без него — скрыта', async () => {
    const placeholder = document.createElement('div')
    placeholder.className = 'empty-placeholder-probe'
    const withPlaceholder = build(fakeBackend([]).managers, { createPlaceholder: () => placeholder })
    withPlaceholder.searchSuper.setQuery({ peerId: 0, folderId: 0, query: 'кот' })
    await withPlaceholder.searchSuper.load(true)
    await settle()

    expect(withPlaceholder.messages.container.classList.contains('hide')).toBe(false)
    expect(withPlaceholder.messages.container.querySelector('.empty-placeholder-probe')).toBe(placeholder)

    const bare = build(fakeBackend([]).managers)
    bare.searchSuper.setQuery({ peerId: 0, folderId: 0, query: 'кот' })
    await bare.searchSuper.load(true)
    await settle()

    expect(bare.messages.container.classList.contains('hide')).toBe(true)
  })

  it('пустой запрос без пира и дат в сеть не ходит и закрывает вкладку (:2236-2239)', async () => {
    const { managers, calls } = fakeBackend([text(1)])
    const { searchSuper, messages } = build(managers)
    searchSuper.setQuery({ peerId: 0, folderId: 0, query: '  ' })

    await searchSuper.load(true)
    await settle()
    await searchSuper.load(true)
    await settle()

    expect(calls.filter((c) => c.inputFilter._ === 'inputMessagesFilterEmpty')).toHaveLength(0)
    expect(rows(messages)).toHaveLength(0)
  })

  it('чип пира без текста — история чата по offsetId, в строках только этот пир', async () => {
    const { managers, calls } = fakeBackend([text(3, ALICE), text(2, BOB), text(1, ALICE)])
    const { searchSuper, messages } = build(managers)
    searchSuper.setQuery({ peerId: ALICE, query: '' })

    await searchSuper.load(true)
    await settle()

    expect(calls[0].peerId).toBe(ALICE)
    expect(rows(messages).map((el) => +el.dataset.mid!)).toEqual([3, 1])
  })
})

describe('AppSearchSuper: курсор глобальной выдачи nextRate', () => {
  const feed = (n: number) => Array.from({ length: n }, (_, i) => text(n - i, i % 2 ? BOB : ALICE))

  it('вторая страница уходит с nextRate первого ответа — без дублей и дыр', async () => {
    const all = feed(120)
    const { managers, calls } = fakeBackend(all)
    const { searchSuper, messages } = build(managers)
    searchSuper.setQuery({ peerId: 0, folderId: 0, query: 'кот' })

    await searchSuper.load(true)
    await settle()
    // порция из кэша: в нём уже лежит предзагруженная вторая страница
    await searchSuper.load(true)
    await settle()

    const chats = calls.filter((c) => c.inputFilter._ === 'inputMessagesFilterEmpty')
    expect(chats[0].nextRate).toBe(0)
    expect(chats.length).toBeGreaterThan(1)
    const firstPageLast = all[chats[0].limit! - 1].id
    expect(chats[1].nextRate).toBe(firstPageLast)

    const drawn = rows(messages).map((el) => +el.dataset.mid!)
    expect(drawn.length).toBeGreaterThan(chats[0].limit!)
    expect(drawn).toEqual(all.map((m) => m.id).slice(0, drawn.length))
  })

  it('ответ без nextRate при folderId закрывает вкладку, даже полной страницей', async () => {
    const all = feed(200)
    const calls: SearchHistoryOptions[] = []
    const managers = {
      ...fakeBackend(all).managers,
      messages: {
        // полная страница, но сервер сказал «дальше ничего» — курсора нет
        searchHistory: async (ctx: SearchHistoryOptions) => {
          calls.push(ctx)
          return { messages: all.slice(0, ctx.limit), count: all.length }
        },
        searchCounters: async () => [],
      },
    } as unknown as SearchSuperManagers
    const { searchSuper } = build(managers)
    searchSuper.setQuery({ peerId: 0, folderId: 0, query: 'кот' })

    await searchSuper.load(true)
    await settle()
    await searchSuper.load(true)
    await settle()

    expect(calls.filter((c) => c.inputFilter._ === 'inputMessagesFilterEmpty')).toHaveLength(1)
  })

  it('setQuery (cleanup) обнуляет курсор: новый запрос — снова с начала', async () => {
    const { managers, calls } = fakeBackend(feed(120))
    const { searchSuper } = build(managers)
    searchSuper.setQuery({ peerId: 0, folderId: 0, query: 'кот' })
    await searchSuper.load(true)
    await settle()

    const before = calls.length
    searchSuper.cleanupHTML()
    searchSuper.setQuery({ peerId: 0, folderId: 0, query: 'кошка' })
    await searchSuper.load(true)
    await settle()

    const fresh = calls.slice(before).filter((c) => c.inputFilter._ === 'inputMessagesFilterEmpty')
    expect(fresh[0].query).toBe('кошка')
    expect(fresh[0].nextRate).toBe(0)
  })
})

describe('AppSearchSuper: вкладка media с запросом — строки группы, а не плитки', () => {
  it('рисует сообщения в searchGroupMedia внутри вкладки; cleanupHTML её чистит', async () => {
    const { managers } = fakeBackend([photo(2), photo(1)])
    const { searchSuper } = build(managers)
    searchSuper.setQuery({ peerId: 0, folderId: 0, query: 'кот' })
    searchSuper.selectTab(1, false)

    await searchSuper.load(true)
    await settle()

    const content = searchSuper.mediaTabsMap.get('media')!.contentTab!
    const group = content.querySelector<HTMLElement>(':scope > .search-group.search-group-messages')!
    expect(group).not.toBeNull()
    expect(group.classList.contains('hide')).toBe(false)
    expect(Array.from(group.querySelectorAll<HTMLElement>('a.chatlist-chat')).map((el) => +el.dataset.mid!)).toEqual([2, 1])
    // сетка плиток пуста — медиа с запросом у оригинала не плитки (:1106-1110)
    expect(searchSuper.tabs.inputMessagesFilterPhotoVideo!.childElementCount).toBe(0)

    searchSuper.cleanupHTML()
    expect(group.classList.contains('hide')).toBe(true)
    expect(group.querySelectorAll('a.chatlist-chat')).toHaveLength(0)
  })
})

describe('AppSearchSuper: hideEmptyTabs: false (левая колонка)', () => {
  it('ни запроса счётчиков, ни hide у вкладок, ни search-empty у родителя', async () => {
    const { managers } = fakeBackend([text(1)])
    const { searchSuper } = build(managers)
    searchSuper.cleanupHTML()
    searchSuper.setQuery({ peerId: 0, folderId: 0, query: 'кот' })

    // `searchCounters` фейка бросает — `load` его не зовёт
    await searchSuper.load(true)
    await settle()

    expect(searchSuper.container.classList.contains('hide')).toBe(false)
    expect(searchSuper.container.parentElement!.classList.contains('search-empty')).toBe(false)
    expect(searchSuper.mediaTabs.every((tab) => !tab.menuTab!.classList.contains('hide'))).toBe(true)
  })
})
