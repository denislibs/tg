// Пины вкладки «Участники» `AppSearchSuper` (`loadMembers`, порт tweb
// `src/components/appSearchSuper.ts:1525-1758`).
//
// Предмет — ФАКТ: сколько запросов ушло за участниками и с какими границами
// (LOAD_COUNT 50 → 200, `:1719`), сколько строк стоит в `ul.chatlist`, снимается
// ли ушедший участник по событию, куда уходит навигация по клику и что лежит в
// контекстном меню. «Менеджер позван с такими аргументами» здесь не пин —
// только вместе с узлами в DOM.
//
// Фейковый бэкенд — ручка `GET /chats/{id}/members?offset&limit`
// (`group_handler.go::ListMembers`): страница строго по `offset`/`limit`,
// карточки участников едут вектором `users` того же контейнера. Воркерный
// владелец карточек (`peersManager.saveApiPeers`) публикует их в зеркало ДО
// того, как ответ ручки доедет до вызывающего — здесь это делает сам фейк.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab, type SearchSuperMediaType } from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { ChannelParticipantWire, ChannelsChannelParticipants } from '@core/managers/groupsManager'
import type { MessagesChatFull, UserReal } from '@core/peers/peer'
import contextMenuController from '@helpers/contextMenuController'
import rootScope from '@lib/rootScope'
import { RT } from '@core/realtime/events'
import type { LangPackKey } from '@lib/langPack'

const CHAT_ID = 100
const PEER: PeerId = -CHAT_ID

const userCard = (id: number): UserReal => ({
  _: 'user', id, first_name: 'U' + id, pFlags: {},
  // онлайн убывает с id — порядок сортировки предсказуем: 1, 2, 3, …
  status: { _: 'userStatusOffline', was_online: 2_000_000 - id },
})

function fakeBackend(n: number) {
  const calls: { peerId: number; offset: number; limit: number; got: number }[] = []
  let ids = Array.from({ length: n }, (_, i) => i + 1)
  const participant = (id: number): ChannelParticipantWire =>
    id === 1 ?
      { _: 'channelParticipantCreator', user_id: id, admin_rights: { _: 'chatAdminRights' } } :
      { _: 'channelParticipant', user_id: id, date: id }

  const managers = {
    messages: {
      mediaHistory: async () => ({ messages: [], count: 0 }),
      searchCounters: async (_peerId: number, filters: string[]) => filters.map((filter) => ({ filter, count: 0 })),
    },
    peers: {
      fillMirror: async (peerIds: number[]) => {
        applyPeerOps([{ op: 'upsert', peers: peerIds.map(userCard) }])
      },
    },
    groups: {
      channelParticipants: async (peerId: number, offset: number, limit: number): Promise<ChannelsChannelParticipants> => {
        const page = ids.slice(offset, offset + limit)
        calls.push({ peerId, offset, limit, got: page.length })
        const users = page.map(userCard)
        applyPeerOps([{ op: 'upsert', peers: users }])
        return { _: 'channels.channelParticipants', count: ids.length, participants: page.map(participant), chats: [], users }
      },
      addMember: vi.fn(async () => {}),
      removeMember: vi.fn(async () => {}),
      unban: vi.fn(async () => {}),
    },
  } as unknown as SearchSuperManagers

  return {
    managers,
    calls,
    remove(id: number) { ids = ids.filter((x) => x !== id) },
    add(id: number) { ids = [...ids, id] },
  }
}

function makeMediaTabs(): SearchSuperMediaTab[] {
  return [
    { type: 'members', name: 'Members' as LangPackKey },
    { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
  ]
}

function build(managers: SearchSuperManagers) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const counters: [SearchSuperMediaType, number][] = []
  const openPeer = vi.fn()
  const openUserPermissions = vi.fn()
  const searchSuper = new AppSearchSuper({
    mediaTabs: makeMediaTabs(),
    scrollable,
    managers,
    onLengthChange: (type, length) => counters.push([type, length]),
    openPeer,
    openUserPermissions,
  })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
  return { searchSuper, counters, openPeer, openUserPermissions }
}

/** Пачка `SortedList` стартует через `pause(0)`, снятие строки — через `fastRaf`. */
const settle = async () => {
  for(let i = 0; i < 6; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
}

const list = (searchSuper: AppSearchSuper) =>
  searchSuper.mediaTabsMap.get('members')!.itemsTab!.querySelector<HTMLUListElement>('ul.chatlist')

const rows = (searchSuper: AppSearchSuper) =>
  Array.from(list(searchSuper)?.querySelectorAll<HTMLElement>('a.chatlist-chat') ?? [])

const rowIds = (searchSuper: AppSearchSuper) => rows(searchSuper).map((el) => +el.dataset.peerId!)

/** Снимок `updateChannelFullSnapshot` — как шлёт бэкенд (`publishChatUpdate`):
 *  списка участников в нём нет, есть только их число. */
const chatUpdate = (participantsCount: number) => {
  rootScope.dispatchEvent(RT.chatUpdate, {
    _: 'updateChannelFullSnapshot',
    peer: { _: 'peerChannel', channel_id: CHAT_ID },
    chat_full: {
      _: 'messages.chatFull',
      full_chat: { _: 'channelFull', id: CHAT_ID, participants_count: participantsCount },
      chats: [], users: [],
    } as unknown as MessagesChatFull,
  })
}

beforeEach(() => {
  resetSharedMediaHistories()
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [{
    _: 'channel', id: CHAT_ID, title: 'Группа', date: 0, photo: { _: 'chatPhotoEmpty' },
    pFlags: { megagroup: true, creator: true },
  }] }])
})
afterEach(() => {
  contextMenuController.close()
  document.body.replaceChildren()
})

describe('AppSearchSuper: участники — пагинация', () => {
  it('первая партия 50, следующие по 200; строки в ul.chatlist растут вместе с ними', async () => {
    const backend = fakeBackend(260)
    const { searchSuper, counters } = build(backend.managers)

    await searchSuper.load(true)
    await settle()
    expect(backend.calls.map((c) => [c.peerId, c.offset, c.limit])).toEqual([[PEER, 0, 50]])
    expect(rows(searchSuper).length).toBe(50)
    // счётчик вкладки — общее число участников с ручки (`:1736`)
    expect(counters[counters.length - 1]).toEqual(['members', 260])
    // список сидит внутри карточки секции, и она открыта (`afterPerforming(1)`)
    expect(list(searchSuper)!.parentElement).toBe(searchSuper.mediaTabsMap.get('members')!.itemsTab)
    expect(searchSuper.mediaTabsMap.get('members')!.hideOn!.classList.contains('hide')).toBe(false)

    await searchSuper.load(true)
    await settle()
    expect(backend.calls.map((c) => [c.offset, c.limit])).toEqual([[0, 50], [50, 200]])
    expect(rows(searchSuper).length).toBe(250)

    await searchSuper.load(true)
    await settle()
    expect(backend.calls.map((c) => [c.offset, c.limit])).toEqual([[0, 50], [50, 200], [250, 200]])
    expect(rows(searchSuper).length).toBe(260)

    // короткая страница закрыла вкладку — сети больше нет
    await searchSuper.load(true)
    await settle()
    expect(backend.calls.length).toBe(3)
    expect(rows(searchSuper).length).toBe(260)
  })

  it('список создаётся ОДИН раз: вторая страница встаёт в тот же ul', async () => {
    const backend = fakeBackend(60)
    const { searchSuper } = build(backend.managers)
    await searchSuper.load(true)
    await settle()
    const first = list(searchSuper)
    await searchSuper.load(true)
    await settle()
    expect(list(searchSuper)).toBe(first)
    expect(searchSuper.mediaTabsMap.get('members')!.itemsTab!.querySelectorAll('ul.chatlist').length).toBe(1)
    expect(rows(searchSuper).length).toBe(60)
  })

  it('смена пира (`setQuery`) сбрасывает список: следующая загрузка снова с 50', async () => {
    const backend = fakeBackend(60)
    const { searchSuper } = build(backend.managers)
    await searchSuper.load(true)
    await settle()
    searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
    searchSuper.cleanupHTML()
    await searchSuper.load(true)
    await settle()
    expect(backend.calls.map((c) => [c.offset, c.limit])).toEqual([[0, 50], [0, 50]])
    expect(rows(searchSuper).length).toBe(50)
  })

  it('строки отсортированы по статусу: кто был онлайн позже — выше', async () => {
    const backend = fakeBackend(5)
    const { searchSuper } = build(backend.managers)
    await searchSuper.load(true)
    await settle()
    expect(rowIds(searchSuper)).toEqual([1, 2, 3, 4, 5])
    // создатель — с рангом правым слотом заголовка
    expect(rows(searchSuper)[0].querySelector('.row-title-right')!.textContent).toBe('owner')
    expect(rows(searchSuper)[1].querySelector('.row-title-right')!.textContent).toBe('')
  })
})

describe('AppSearchSuper: участники — живые обновления', () => {
  it('ушедший участник снимается по chat_update, счётчик уменьшается', async () => {
    const backend = fakeBackend(5)
    const { searchSuper, counters } = build(backend.managers)
    await searchSuper.load(true)
    await settle()
    expect(rowIds(searchSuper)).toEqual([1, 2, 3, 4, 5])

    backend.remove(3)
    chatUpdate(4)
    await settle()
    expect(rowIds(searchSuper)).toEqual([1, 2, 4, 5])
    expect(counters[counters.length - 1]).toEqual(['members', 4])
  })

  it('новый участник появляется по chat_update, счётчик растёт', async () => {
    const backend = fakeBackend(3)
    const { searchSuper, counters } = build(backend.managers)
    await searchSuper.load(true)
    await settle()

    backend.add(9)
    chatUpdate(4)
    await settle()
    expect(rowIds(searchSuper)).toEqual([1, 2, 3, 9])
    expect(counters[counters.length - 1]).toEqual(['members', 4])
  })

  it('окно не дочитано: перечитывается только оно, хвост приедет следующей страницей', async () => {
    const backend = fakeBackend(60)
    const { searchSuper, counters } = build(backend.managers)
    await searchSuper.load(true)
    await settle()
    expect(rows(searchSuper).length).toBe(50)

    backend.add(61)
    chatUpdate(61)
    await settle()
    expect(backend.calls[backend.calls.length - 1]).toMatchObject({ offset: 0, limit: 50 })
    expect(rows(searchSuper).length).toBe(50)
    expect(counters[counters.length - 1]).toEqual(['members', 61])

    await searchSuper.load(true)
    await settle()
    expect(backend.calls[backend.calls.length - 1]).toMatchObject({ offset: 50, limit: 200 })
    expect(rows(searchSuper).length).toBe(61)
  })

  it('chat_update чужого чата список не трогает', async () => {
    const backend = fakeBackend(3)
    const { searchSuper } = build(backend.managers)
    await searchSuper.load(true)
    await settle()
    const before = backend.calls.length
    rootScope.dispatchEvent(RT.chatUpdate, {
      _: 'updateChannelFullSnapshot',
      peer: { _: 'peerChannel', channel_id: CHAT_ID + 1 },
      chat_full: {} as MessagesChatFull,
    })
    await settle()
    expect(backend.calls.length).toBe(before)
    expect(rowIds(searchSuper)).toEqual([1, 2, 3])
  })

  it('после cleanup подписка снята: событие не ходит в сеть', async () => {
    const backend = fakeBackend(3)
    const { searchSuper } = build(backend.managers)
    await searchSuper.load(true)
    await settle()
    searchSuper.cleanup()
    const before = backend.calls.length
    chatUpdate(3)
    await settle()
    expect(backend.calls.length).toBe(before)
  })
})

describe('AppSearchSuper: участники — клик и контекстное меню', () => {
  it('клик по строке открывает профиль участника; клик по аватару с историями — нет', async () => {
    const backend = fakeBackend(3)
    const { searchSuper, openPeer } = build(backend.managers)
    await searchSuper.load(true)
    await settle()

    const row = rows(searchSuper)[1]
    row.querySelector('.row-title')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(openPeer).toHaveBeenCalledTimes(1)
    expect(openPeer).toHaveBeenCalledWith(2)

    const avatar = rows(searchSuper)[2].querySelector<HTMLElement>('.dialog-avatar')!
    avatar.classList.add('has-stories')
    avatar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(openPeer).toHaveBeenCalledTimes(1)
  })

  it('правый клик даёт меню участника; пункты без прав скрыты, а не задизейблены', async () => {
    const backend = fakeBackend(3)
    const { searchSuper, openUserPermissions } = build(backend.managers)
    await searchSuper.load(true)
    await settle()

    rows(searchSuper)[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
    const menu = document.querySelector<HTMLElement>('.btn-menu.contextmenu.active')!
    expect(menu).not.toBeNull()
    const texts = Array.from(menu.querySelectorAll('.btn-menu-item-text')).map((el) => el.textContent)
    expect(texts).toEqual(['Send Message', 'Promote to admin', 'Restrict user', 'Remove from group'])
    expect(menu.querySelectorAll('.btn-menu-item.is-disabled, .btn-menu-item[disabled]').length).toBe(0)
    expect(rows(searchSuper)[1].classList.contains('menu-open')).toBe(true)

    const promote = Array.from(menu.querySelectorAll<HTMLElement>('.btn-menu-item'))
      .find((el) => el.querySelector('.btn-menu-item-text')!.textContent === 'Promote to admin')!
    promote.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(openUserPermissions).toHaveBeenCalledWith({ _: 'channelParticipant', user_id: 2, date: 2 }, true)
  })

  it('у наблюдателя без прав в меню только «Send Message»', async () => {
    applyPeerOps([{ op: 'upsert', peers: [{
      _: 'channel', id: CHAT_ID, title: 'Группа', date: 0, photo: { _: 'chatPhotoEmpty' }, pFlags: { megagroup: true },
    }] }])
    const backend = fakeBackend(3)
    const { searchSuper } = build(backend.managers)
    await searchSuper.load(true)
    await settle()

    rows(searchSuper)[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
    const menu = document.querySelector<HTMLElement>('.btn-menu.contextmenu.active')!
    expect(Array.from(menu.querySelectorAll('.btn-menu-item-text')).map((el) => el.textContent)).toEqual(['Send Message'])
  })
})
