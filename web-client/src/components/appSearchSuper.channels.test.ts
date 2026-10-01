// Пины вкладки `channels` левой колонки — задача 9 плана глобального поиска:
// `loadChannels` (tweb `appSearchSuper.ts:1971-2022`) и `renderPeerDialogs`
// (`:1943-1969`). Группа «SimilarChannels» (`:2009-2018`) — задача 15 плана
// («Отложено»: глобальных рекомендаций у бэкенда нет), здесь её нет.
//
// С запросом вкладка спрашивает `/search` с лимитом 200 и оставляет только
// вещательные каналы; без запроса — каналы из ЗЕРКАЛА диалогов, без сети.
// Пины — на узлы в DOM и на то, ушёл ли запрос.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import type { DialogListElement } from '@lib/appDialogsManager'
import { resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { applyPeerOps, cachedChat, resetPeerMirror } from '@core/peerCache'
import { getChatMembersString } from '@components/wrappers/getChatMembersString'
import { useI18nStore } from '@/i18n'
import { getOutputPeer } from '@core/peers/peerId'
import type { ContactsFound } from '@core/managers/channelsManager'
import type { Dialog } from '@core/models'
import type { LangPackKey } from '@lib/langPack'
import { useChatsStore } from '@stores/chatsStore'

const ALICE: PeerId = 7
const MEGA: PeerId = -60
/** вещательные каналы -50…-57 */
const channel = (i: number): PeerId => -(50 + i)

function fakeBackend(results: PeerId[] = []) {
  const calls = { search: [] as { q: string, limit?: number }[], history: 0 }
  const managers = {
    messages: {
      searchHistory: async() => {
        ++calls.history
        return { messages: [], count: 0 }
      },
      searchCounters: async() => { throw new Error('hideEmptyTabs: false — счётчики не спрашиваются') },
    },
    peers: { fillMirror: async() => {} },
    presence: { get: async() => [] },
    contacts: { getContactsPeerIds: async() => [] },
    dialogs: { getDialogs: async() => ({ dialogs: [], count: 0, isEnd: true }) },
    channels: {
      search: async(q: string, limit?: number): Promise<ContactsFound> => {
        calls.search.push({ q, limit })
        return { _: 'contacts.found', my_results: [], results: results.map(getOutputPeer), chats: [], users: [] }
      },
    },
  } as unknown as SearchSuperManagers
  return { managers, calls }
}

// вкладка каналов — первая: `load(true)` грузит текущую
const TABS = (): SearchSuperMediaTab[] => [
  { type: 'channels', name: 'ChatList.Filter.Channels' as LangPackKey },
  { type: 'chats', inputFilter: 'inputMessagesFilterEmpty', name: 'FilterChats' as LangPackKey },
]

function build(managers: SearchSuperManagers) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const searchSuper = new AppSearchSuper({
    mediaTabs: TABS(),
    scrollable,
    managers,
    hideEmptyTabs: false,
  })
  scrollable.container.append(searchSuper.container)
  return searchSuper
}

const settle = async() => {
  for(let i = 0; i < 6; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function search(searchSuper: AppSearchSuper, query: string) {
  searchSuper.cleanupHTML()
  searchSuper.setQuery({ peerId: 0, folderId: 0, query })
  await searchSuper.load(true)
  await settle()
}

const channelsTab = (searchSuper: AppSearchSuper) => searchSuper.mediaTabsMap.get('channels')!
const groupsOf = (searchSuper: AppSearchSuper) =>
  Array.from(channelsTab(searchSuper).itemsTab!.querySelectorAll(':scope > .search-group')) as HTMLElement[]
const rowsOf = (group: HTMLElement) => Array.from(group.querySelectorAll('ul.chatlist > a')) as DialogListElement[]
const subtitleOf = (row: DialogListElement) => row.dialogElement!.dom.lastMessageSpan.textContent

const dialog = (peerId: PeerId, folder_id: 0 | 1 = 0) => ({ peerId, folder_id }) as Dialog

beforeEach(() => {
  resetSharedMediaHistories()
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ALICE, first_name: 'Алиса', username: 'alice', pFlags: {} },
    { _: 'channel', id: 60, title: 'Чат', participants_count: 5, pFlags: { megagroup: true } },
    ...Array.from({ length: 8 }, (_, i) => ({
      _: 'channel', id: 50 + i, title: 'Канал ' + i, username: 'ch' + i, participants_count: 1000 + i, pFlags: { broadcast: true },
    })),
  ] as never }])
})
afterEach(() => {
  useChatsStore.setState({ dialogs: [] })
  document.body.replaceChildren()
})

describe('loadChannels с запросом (:1972-1993)', () => {
  it('в группе только вещательные каналы из results; заголовок группы скрыт; /search просится с лимитом 200', async() => {
    const { managers, calls } = fakeBackend([ALICE, channel(0), MEGA, channel(1)])
    const searchSuper = build(managers)
    await search(searchSuper, 'кан')

    expect(calls.search).toEqual([{ q: 'кан', limit: 200 }])
    const groups = groupsOf(searchSuper)
    expect(groups).toHaveLength(1)
    expect(groups[0].classList.contains('search-group-channels')).toBe(true)
    expect(groups[0].classList.contains('hide')).toBe(false)
    // `group.nameEl.style.display = 'none'` (:1975)
    expect((groups[0].querySelector('.sidebar-left-section-name') as HTMLElement).style.display).toBe('none')

    const rows = rowsOf(groups[0])
    expect(rows.map((el) => +el.dataset.peerId!)).toEqual([channel(0), channel(1)])
    // `renderPeerDialogs`: у канала с `participants_count` — число подписчиков (:1959-1960)
    await settle()
    expect(subtitleOf(rows[0])).toBe(getChatMembersString(cachedChat(channel(0)), useI18nStore.getState().tArgs))
    expect(rows.every((el) => el.classList.contains('chatlist-chat-abitbigger'))).toBe(true)
    // выдача сообщений этой вкладке не нужна
    expect(calls.history).toBe(0)
  })

  it('ни одного канала — группы нет, вкладка говорит «ничего не найдено» (:1988-1990)', async() => {
    const searchSuper = build(fakeBackend([ALICE, MEGA]).managers)
    await search(searchSuper, 'а')

    expect(groupsOf(searchSuper)).toHaveLength(0)
    expect(channelsTab(searchSuper).contentTab!.parentElement!.querySelector('.content-empty')?.textContent)
      .toBe('Nothing interesting here yet...')
  })
})

describe('loadChannels без запроса: «Channels you joined» из зеркала диалогов (:1995-2007)', () => {
  it('каналы из диалогов (основная папка, затем архив), без сети; ≤5 — без обрезки и без «show more»', async() => {
    useChatsStore.setState({ dialogs: [dialog(channel(2), 1), dialog(ALICE), dialog(channel(0)), dialog(MEGA), dialog(channel(1))] })
    const { managers, calls } = fakeBackend()
    const searchSuper = build(managers)
    await search(searchSuper, '')

    expect(calls.search).toHaveLength(0)
    expect(calls.history).toBe(0)
    const groups = groupsOf(searchSuper)
    expect(groups).toHaveLength(1)
    expect(groups[0].querySelector('.sidebar-left-section-name')?.textContent).toBe('Channels you joined')
    // `getCachedDialogs` — папки по порядку `REAL_FOLDERS` (dialogs.ts:491-494)
    expect(rowsOf(groups[0]).map((el) => +el.dataset.peerId!)).toEqual([channel(0), channel(1), channel(2)])
    expect(groups[0].classList.contains('is-short-5')).toBe(false)
    expect(groups[0].querySelector('.sidebar-left-section-name-right')).toBeNull()
  })

  it('больше 5 каналов — is-short-5 и «show more» (:2003)', async() => {
    useChatsStore.setState({ dialogs: Array.from({ length: 6 }, (_, i) => dialog(channel(i))) })
    const searchSuper = build(fakeBackend().managers)
    await search(searchSuper, '')

    const [group] = groupsOf(searchSuper)
    expect(rowsOf(group)).toHaveLength(6)
    expect(group.classList.contains('is-short-5')).toBe(true)
    expect(group.querySelector('.sidebar-left-section-name-right')?.textContent).toBe('show more')
  })

  it('каналов нет — группы нет, и «ничего не найдено» тоже нет (`afterPerforming(1)`, :2020)', async() => {
    useChatsStore.setState({ dialogs: [dialog(ALICE), dialog(MEGA)] })
    const searchSuper = build(fakeBackend().managers)
    await search(searchSuper, '')

    expect(groupsOf(searchSuper)).toHaveLength(0)
    expect(searchSuper.container.querySelector('.content-empty')).toBeNull()
  })

  it('вкладка загружена один раз: повторный load ничего не дорисовывает; новый запрос — перерисовывает', async() => {
    useChatsStore.setState({ dialogs: [dialog(channel(0))] })
    const { managers, calls } = fakeBackend([channel(3)])
    const searchSuper = build(managers)
    await search(searchSuper, '')
    await searchSuper.load(true)
    await settle()
    expect(groupsOf(searchSuper)).toHaveLength(1)

    await search(searchSuper, 'к')
    const groups = groupsOf(searchSuper)
    expect(groups).toHaveLength(1)
    expect(rowsOf(groups[0]).map((el) => +el.dataset.peerId!)).toEqual([channel(3)])
    expect(calls.search).toHaveLength(1)
  })
})
