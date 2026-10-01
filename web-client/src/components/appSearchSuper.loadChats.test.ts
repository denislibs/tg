// Пины группы контактов вкладки `chats` левой колонки — задача 9 плана
// глобального поиска: `loadChats` (tweb `appSearchSuper.ts:1285-1523`) и его
// триггер в `loadType` (`:2229-2240`).
//
// Класс собирается так, как его собирает левая колонка оригинала
// (`sidebarLeft/index.ts:1095-1170`): пять групп (`people` — задача 14, но
// группа у владельца есть и остаётся скрытой), `hideEmptyTabs: false`,
// контекст `setQuery({peerId: 0, folderId: 0, query})` (`:1192`, `:1368`).
//
// Фейковый бэкенд ведёт себя как настоящие ручки: локальная книга уважает
// `limit` (`contactsManager.getContactsPeerIds`), `/search` отдаёт ССЫЛКИ на
// пиры в `my_results`/`results` (конструктор `contacts.found`), диалоги — из
// зеркала без сети. Пины — на строки в DOM и на то, ушёл ли запрос.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import { createSearchGroup, type SearchGroup } from '@components/searchGroup.solid'
import type { DialogListElement } from '@lib/appDialogsManager'
import { resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { getOutputPeer } from '@core/peers/peerId'
import type { SearchHistoryOptions } from '@core/managers/messagesManager'
import type { ContactsFound } from '@core/managers/channelsManager'
import type { Dialog } from '@core/models'
import { getMiddleware } from '@helpers/middleware'
import type { LangPackKey } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import { useAppStateStore } from '@stores/appState'
import { formatUserPhone } from '@core/format/phone'
import { cachedChat } from '@core/peerCache'
import { getChatMembersString } from '@components/wrappers/getChatMembersString'
import { useI18nStore } from '@/i18n'

const ME: PeerId = 1
const ALICE: PeerId = 7
const BOB: PeerId = 8
const CAROL: PeerId = 9
const DAVE: PeerId = 10
const EVE: PeerId = 11
const NEWS: PeerId = -50
const GROUP: PeerId = -60

type Backend = {
  /** сколько первых запросов выдачи сообщений падает сетью */
  historyFails?: number
  contacts?: PeerId[]
  dialogs?: PeerId[]
  myResults?: PeerId[]
  results?: PeerId[]
}

function fakeBackend(backend: Backend = {}) {
  const calls = {
    history: [] as SearchHistoryOptions[],
    contacts: [] as unknown[][],
    search: [] as { q: string, limit?: number }[],
    dialogs: [] as unknown[],
  }
  const managers = {
    messages: {
      searchHistory: async(ctx: SearchHistoryOptions) => {
        calls.history.push(ctx)
        if(calls.history.length <= (backend.historyFails ?? 0)) throw new Error('offline')
        return { messages: [], count: 0 }
      },
      searchCounters: async() => { throw new Error('hideEmptyTabs: false — счётчики не спрашиваются') },
    },
    peers: { fillMirror: async() => {} },
    presence: { get: async() => [] },
    contacts: {
      // `getContactsPeerIds` (:467-481): `limit` режет выдачу книги
      getContactsPeerIds: async(query?: string, includeSaved?: boolean, sortBy?: string, limit?: number) => {
        calls.contacts.push([query, includeSaved, sortBy, limit])
        const all = backend.contacts ?? []
        return limit ? all.slice(0, limit) : all
      },
    },
    channels: {
      search: async(q: string, limit?: number): Promise<ContactsFound> => {
        calls.search.push({ q, limit })
        return {
          _: 'contacts.found',
          my_results: (backend.myResults ?? []).map(getOutputPeer),
          results: (backend.results ?? []).slice(0, limit).map(getOutputPeer),
          chats: [],
          users: [],
        }
      },
    },
    dialogs: {
      getDialogs: async(options: { query?: string, limit?: number }) => {
        calls.dialogs.push(options)
        const peerIds = (backend.dialogs ?? []).slice(0, options.limit)
        return { dialogs: peerIds.map((peerId) => ({ peerId }) as Dialog), count: peerIds.length, isEnd: true }
      },
    },
  } as unknown as SearchSuperManagers
  return { managers, calls }
}

const TABS = (): SearchSuperMediaTab[] => [
  { type: 'chats', inputFilter: 'inputMessagesFilterEmpty', name: 'FilterChats' as LangPackKey },
  { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
]

let groupsMiddleware = getMiddleware()

type Groups = { [k in 'contacts' | 'globalContacts' | 'messages' | 'people' | 'recent']: SearchGroup }

function build(managers: SearchSuperManagers) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)

  // пять групп владельца (`sidebarLeft/index.ts:1095-1103`)
  const group = (name: string | false, type: string, className?: string) => createSearchGroup({
    name: name as LangPackKey | false, type, className, managers, middleware: groupsMiddleware.get(),
  })
  const groups: Groups = {
    contacts: group('SearchAllChatsShort', 'contacts'),
    globalContacts: group('GlobalSearch', 'globalContacts'),
    messages: group('SearchMessages', 'messages'),
    people: group(false, 'contacts', 'search-group-people'),
    recent: group('Recent', 'contacts', 'search-group-recent'),
  }

  const searchSuper = new AppSearchSuper({
    mediaTabs: TABS(),
    scrollable,
    managers,
    searchGroups: groups,
    hideEmptyTabs: false,
    showSender: true,
  })
  scrollable.container.append(searchSuper.container)
  return { searchSuper, groups }
}

const settle = async() => {
  for(let i = 0; i < 6; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const rows = (group: SearchGroup) => Array.from(group.list.children) as DialogListElement[]
const peerIds = (group: SearchGroup) => rows(group).map((el) => +el.dataset.peerId!)
const subtitle = (group: SearchGroup, peerId: PeerId) =>
  rows(group).find((el) => +el.dataset.peerId! === peerId)!.dialogElement!.dom.lastMessageSpan.textContent
/** «N subscribers» / «N members» — тем же ядром, что и строка (`getChatMembersString`) */
const members = (peerId: PeerId) => getChatMembersString(cachedChat(peerId), useI18nStore.getState().tArgs)
const hidden = (group: SearchGroup) => group.container.classList.contains('hide')
const showMore = (group: SearchGroup) => group.nameEl.querySelector('.sidebar-left-section-name-right')

async function search(searchSuper: AppSearchSuper, query: string, peerId: PeerId = 0) {
  searchSuper.cleanupHTML()
  searchSuper.setQuery({ peerId, folderId: peerId ? undefined : 0, query })
  await searchSuper.load(true)
  await settle()
}

let prevMyId: PeerId
beforeEach(() => {
  resetSharedMediaHistories()
  resetPeerMirror()
  prevMyId = rootScope.myId
  rootScope.myId = ME
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ME, first_name: 'Я', pFlags: { self: true } },
    { _: 'user', id: ALICE, first_name: 'Алиса', username: 'alice', pFlags: {} },
    { _: 'user', id: BOB, first_name: 'Боб', phone: '79261234567', pFlags: {} },
    { _: 'user', id: CAROL, first_name: 'Кэрол', username: 'carol', pFlags: {} },
    { _: 'user', id: DAVE, first_name: 'Дэйв', username: 'dave', pFlags: {} },
    { _: 'user', id: EVE, first_name: 'Ева', username: 'eve', pFlags: {} },
    { _: 'channel', id: 50, title: 'Новости', username: 'news', participants_count: 1200, pFlags: { broadcast: true } },
    { _: 'channel', id: 60, title: 'Чат', participants_count: 5, pFlags: { megagroup: true } },
  ] as never }])
  useAppStateStore.setState({ recentSearch: [] })
  groupsMiddleware = getMiddleware()
})
afterEach(() => {
  groupsMiddleware.destroy()
  rootScope.myId = prevMyId
  useAppStateStore.setState({ recentSearch: [] })
  document.body.replaceChildren()
})

describe('loadChats с запросом: группы Chats и Global search (:1295-1449)', () => {
  it('три источника дают строки без дублей: книга, диалоги и my_results — в Chats, results — в Global search', async() => {
    const { managers } = fakeBackend({
      contacts: [ALICE],
      dialogs: [ALICE, GROUP],
      // `contacts.search` отдаёт повторы в my_results (комментарий :1089)
      myResults: [BOB, BOB, ALICE],
      results: [ALICE, NEWS, CAROL],
    })
    const { searchSuper, groups } = build(managers)
    await search(searchSuper, 'а')

    // пир рисуется ОДИН раз на всю выдачу (`renderedPeerIds`, :1329-1336)
    expect([...peerIds(groups.contacts)].sort((a, b) => a - b)).toEqual([GROUP, ALICE, BOB])
    // `results` — только то, чего ещё нет в Chats; `my_results` сюда не попадает
    expect(peerIds(groups.globalContacts)).toEqual([NEWS, CAROL])
    // строка — `a.chatlist-chat-abitbigger` (`avatarSize: 'abitbigger'`, :1340)
    expect(rows(groups.contacts).every((el) => el.tagName === 'A' && el.classList.contains('chatlist-chat-abitbigger'))).toBe(true)
    expect(hidden(groups.contacts)).toBe(false)
    expect(hidden(groups.globalContacts)).toBe(false)
  })

  it('группы ложатся в узел вкладки chats в порядке владельца (:1289-1292)', async() => {
    const { searchSuper, groups } = build(fakeBackend().managers)
    await search(searchSuper, 'а')

    const tab = searchSuper.tabs.inputMessagesFilterEmpty!
    expect(Array.from(tab.children)).toEqual([
      groups.contacts.container, groups.globalContacts.container, groups.messages.container,
      groups.people.container, groups.recent.container,
    ])
  })

  it('книга просится с лимитом 10: из 15 контактов в Chats — 10 строк (:1365)', async() => {
    const many = Array.from({ length: 15 }, (_, i) => 100 + i)
    applyPeerOps([{ op: 'upsert', peers: many.map((id) => ({ _: 'user', id, first_name: 'К' + id, pFlags: {} })) as never }])
    const { searchSuper, groups } = build(fakeBackend({ contacts: many }).managers)
    await search(searchSuper, 'к')

    expect(peerIds(groups.contacts)).toEqual(many.slice(0, 10))
  })

  it('подпись строки: «chat with yourself» / @username / телефон / @username и участники (:1297-1327)', async() => {
    const { managers } = fakeBackend({ contacts: [ME, ALICE, BOB], results: [NEWS, GROUP] })
    const { searchSuper, groups } = build(managers)
    await search(searchSuper, 'а')

    expect(subtitle(groups.contacts, ME)).toBe('chat with yourself')
    expect(subtitle(groups.contacts, ALICE)).toBe('@alice')
    expect(subtitle(groups.contacts, BOB)).toBe(formatUserPhone('79261234567'))
    expect(subtitle(groups.globalContacts, NEWS)).toBe('@news, ' + members(NEWS))
    // у чата без username в перечислении только участники
    expect(subtitle(groups.globalContacts, GROUP)).toBe(members(GROUP))
  })

  it('Global search: при >3 строках — is-short и «show more», при ≤3 — без кнопки (:1430-1438)', async() => {
    const four = fakeBackend({ results: [ALICE, BOB, CAROL, DAVE] })
    const big = build(four.managers)
    await search(big.searchSuper, 'а')

    expect(big.groups.globalContacts.container.classList.contains('is-short')).toBe(true)
    expect(showMore(big.groups.globalContacts)?.textContent).toBe('show more')

    const three = build(fakeBackend({ results: [ALICE, BOB, CAROL] }).managers)
    await search(three.searchSuper, 'а')

    expect(peerIds(three.groups.globalContacts)).toEqual([ALICE, BOB, CAROL])
    expect(showMore(three.groups.globalContacts)).toBeNull()
  })

  it('«show more» пересчитывается на каждый запрос: >3 → ≤3 снимает кнопку, снова >3 — возвращает', async() => {
    const backend: Backend = { results: [ALICE, BOB, CAROL, DAVE, EVE] }
    const { searchSuper, groups } = build(fakeBackend(backend).managers)
    await search(searchSuper, 'а')
    expect(showMore(groups.globalContacts)).not.toBeNull()

    backend.results = [ALICE]
    await search(searchSuper, 'ал')
    expect(showMore(groups.globalContacts)).toBeNull()

    backend.results = [ALICE, BOB, CAROL, DAVE]
    await search(searchSuper, 'а')
    expect(peerIds(groups.globalContacts)).toEqual([ALICE, BOB, CAROL, DAVE])
    expect(showMore(groups.globalContacts)?.textContent).toBe('show more')
  })

  it('пустая группа скрыта (`toggle()` без строк, :1353)', async() => {
    const { searchSuper, groups } = build(fakeBackend({ contacts: [ALICE] }).managers)
    await search(searchSuper, 'а')

    expect(hidden(groups.contacts)).toBe(false)
    expect(hidden(groups.globalContacts)).toBe(true)
    expect(rows(groups.globalContacts)).toHaveLength(0)
  })

  it('новый запрос снимает строки прошлого (группы `clear()` в начале, :1289-1291)', async() => {
    const backend: Backend = { contacts: [ALICE, BOB] }
    const { searchSuper, groups } = build(fakeBackend(backend).managers)
    await search(searchSuper, 'а')
    expect(peerIds(groups.contacts)).toEqual([ALICE, BOB])

    backend.contacts = [CAROL]
    await search(searchSuper, 'к')
    expect(peerIds(groups.contacts)).toEqual([CAROL])
  })

  it('группы рисуются один раз на запрос: повторный заход в пустую выдачу их не перезапрашивает (`loadedChats`)', async() => {
    // первая страница сообщений не приехала (сеть) — выдача пуста и не дочитана,
    // следующий `load` снова заходит в ветку `!history.length` (:2231)
    const { managers, calls } = fakeBackend({ contacts: [ALICE], historyFails: 1 })
    const { searchSuper, groups } = build(managers)
    await search(searchSuper, 'а')
    await searchSuper.load(true)
    await settle()

    expect(calls.history).toHaveLength(2)
    expect(peerIds(groups.contacts)).toEqual([ALICE])
    expect(calls.search).toHaveLength(1)
    expect(calls.contacts).toHaveLength(1)
    expect(calls.dialogs).toHaveLength(1)
  })

  it('выбран чип пира — групп контактов нет и никто не спрошен (ветка «иначе», :1522)', async() => {
    const { managers, calls } = fakeBackend({ contacts: [ALICE] })
    const { searchSuper, groups } = build(managers)
    useAppStateStore.setState({ recentSearch: ['' + ALICE] })
    await search(searchSuper, 'а', ALICE)

    expect(calls.contacts).toHaveLength(0)
    expect(calls.search).toHaveLength(0)
    expect(rows(groups.contacts)).toHaveLength(0)
    expect(rows(groups.recent)).toHaveLength(0)
    expect(hidden(groups.recent)).toBe(true)
  })
})

describe('loadChats без запроса: группа Recent (:1450-1501)', () => {
  it('строки — из recentSearch в его порядке, с подписью; сети нет ни одной', async() => {
    const { managers, calls } = fakeBackend({ contacts: [ALICE] })
    const { searchSuper, groups } = build(managers)
    useAppStateStore.setState({ recentSearch: ['' + NEWS, '' + ALICE, '' + GROUP] })
    await search(searchSuper, '')

    expect(peerIds(groups.recent)).toEqual([NEWS, ALICE, GROUP])
    expect(hidden(groups.recent)).toBe(false)
    expect(subtitle(groups.recent, NEWS)).toBe(members(NEWS))
    expect(subtitle(groups.recent, GROUP)).toBe(members(GROUP))
    // статус пользователя (`getUserStatusString`) — у Алисы статуса нет
    expect(subtitle(groups.recent, ALICE)).toBe('last seen a long time ago')

    // пустой запрос: ни контактов, ни `/search`, ни выдачи сообщений (:2236-2239)
    expect(calls.contacts).toHaveLength(0)
    expect(calls.search).toHaveLength(0)
    expect(calls.dialogs).toHaveLength(0)
    expect(calls.history).toHaveLength(0)
    // группы с запросом пусты и скрыты
    expect(hidden(groups.contacts)).toBe(true)
    expect(hidden(groups.globalContacts)).toBe(true)
  })

  it('пустой recentSearch прячет группу', async() => {
    const { searchSuper, groups } = build(fakeBackend().managers)
    await search(searchSuper, '')

    expect(rows(groups.recent)).toHaveLength(0)
    expect(hidden(groups.recent)).toBe(true)
  })

  it('смена recentSearch перерисовывает группу без перезапроса; строка оставшегося пира — тот же узел', async() => {
    const { managers, calls } = fakeBackend()
    const { searchSuper, groups } = build(managers)
    useAppStateStore.setState({ recentSearch: ['' + ALICE, '' + BOB] })
    await search(searchSuper, '')
    const aliceRow = rows(groups.recent)[0]

    useAppStateStore.setState({ recentSearch: ['' + CAROL, '' + ALICE] })
    await settle()

    expect(peerIds(groups.recent)).toEqual([CAROL, ALICE])
    // `For` переиспользует строку пира, оставшегося в списке
    expect(rows(groups.recent)[1]).toBe(aliceRow)

    // «Clear» у владельца (`clearRecentSearch`) — группа прячется
    useAppStateStore.setState({ recentSearch: [] })
    await settle()
    expect(rows(groups.recent)).toHaveLength(0)
    expect(hidden(groups.recent)).toBe(true)

    expect(calls.history).toHaveLength(0)
    expect(calls.contacts).toHaveLength(0)
  })

  it('повторная загрузка вкладки с пустым запросом в сеть не ходит: loaded[chats] уже стоит', async() => {
    const { managers, calls } = fakeBackend()
    const { searchSuper } = build(managers)
    await search(searchSuper, '')
    await searchSuper.load(true)
    await settle()

    expect(calls.history).toHaveLength(0)
    expect(calls.search).toHaveLength(0)
  })

  it('после нового запроса недавние больше не слушаются: подписка снята вместе с middleware', async() => {
    const { searchSuper, groups } = build(fakeBackend().managers)
    useAppStateStore.setState({ recentSearch: ['' + ALICE] })
    await search(searchSuper, '')
    expect(peerIds(groups.recent)).toEqual([ALICE])

    await search(searchSuper, 'а')
    useAppStateStore.setState({ recentSearch: ['' + BOB] })
    await settle()

    expect(rows(groups.recent)).toHaveLength(0)
    expect(hidden(groups.recent)).toBe(true)
  })
})
