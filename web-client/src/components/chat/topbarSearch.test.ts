// Поиск по чату (порт tweb `components/chat/topbarSearch.tsx`) через класс `Chat`:
// `initSearch` монтирует поиск в шапку (tweb `chat.ts:746-834`), запрос уходит
// `messages.searchHistory`, строки найденного — строки чатлиста, клик ведёт ленту к
// сообщению (`setMessageId({lastMsgId})`), Esc и смена пира закрывают поиск, фильтр
// отправителя берёт участников `groups.channelParticipants(…, q)`.
// Шапка, остров композера и правая колонка — дублёры, как в `chat.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { makeMessage } from '@core/messages/testMessage'
import { useSettingsStore } from '@/settings'
import type { Managers } from '@/client/bootstrap'
import type { AppImManager } from '@lib/appImManager'
import type { Chat as MTChat, UserReal } from '@core/peers/peer'
import type { MyMessage } from '@core/models'
import type { ChatType } from './chatType'
import Chat from './chat'

vi.mock('./topbar', () => ({
  default: class {
    public container = document.createElement('div')
    public constructUtils = vi.fn()
    public setFloating = vi.fn()
    public constructPeerHelpers = vi.fn()
    public construct = vi.fn()
    public finishPeerChange = vi.fn(async() => () => {})
    public cleanup = vi.fn()
    public destroy = vi.fn()
  },
}))

vi.mock('./input', () => ({
  default: class {
    public chatInput = document.createElement('div')
    public messageInput = document.createElement('div')
    public construct = vi.fn()
    public constructPeerHelpers = vi.fn()
    public finishPeerChange = vi.fn(async() => () => {})
    public cleanup = vi.fn()
    public clearHelper = vi.fn()
    public destroy = vi.fn()
  },
}))

vi.mock('@components/sidebarRight', () => ({
  default: {
    createSharedMediaTab: () => ({ setPeer: vi.fn(), fillProfileElements: vi.fn(async() => {}), loadSidebarMedia: vi.fn(), destroy: vi.fn() }),
    replaceSharedMediaTab: vi.fn(),
    toggleSidebar: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('@stores/fullPeers.solid', () => ({ useFullPeer: () => () => undefined }))

const ME = 1
const FRIEND = 2
const BOB = 3
const GROUP = -100

class FakeAppImManager extends EventListenerBase<{
  chat_changing: (details: { from: Chat, to: Chat }) => void
  peer_changed: (chat: Chat) => void
  peer_changing: (chat: Chat) => void
  tab_changing: (tabId: number) => void
}> {
  public chats: Chat[] = []
  public appChatBackground = { setBackground: vi.fn(() => Promise.resolve()) }
  public setInnerPeer = vi.fn()
  public setPeer = vi.fn()
  public getChatSavedPosition = vi.fn(() => undefined)

  get chat() {
    return this.chats[this.chats.length - 1]
  }

  public isSamePeer(a: { peerId: PeerId, threadId?: number, type?: ChatType }, b: { peerId: PeerId, threadId?: number, type?: ChatType }) {
    return a.peerId === b.peerId && a.threadId === b.threadId &&
      (typeof(a.type) !== typeof(b.type) || a.type === b.type)
  }
}

function managersWith(found: MyMessage[]) {
  return {
    messages: {
      getHistory: vi.fn(async() => ({ messages: [], count: 0, reachedTop: true, reachedBottom: true })),
      getAround: vi.fn(async() => ({ messages: [], reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async() => null),
      searchHistory: vi.fn(async() => ({ messages: found, count: found.length })),
    },
    groups: {
      channelParticipants: vi.fn(async() => ({
        _: 'channels.channelParticipants',
        count: 1,
        participants: [{ _: 'channelParticipant', user_id: BOB, date: 0 }],
        users: [],
        chats: [],
      })),
    },
    peers: { fillMirror: vi.fn(async() => {}) },
    dialogs: {
      getReadMaxSeqIfUnread: vi.fn(async() => 0),
      getHistoryMaxSeq: vi.fn(async() => 0),
      getDialogReadState: vi.fn(async() => undefined),
    },
    realtime: { markRead: vi.fn(async() => ({ ok: true })), subscribeChannel: vi.fn(async() => ({})), unsubscribeChannel: vi.fn(async() => ({})) },
  }
}

let chat: Chat | undefined

async function openChat(peerId: PeerId, found: MyMessage[] = []) {
  const im = new FakeAppImManager()
  const managers = managersWith(found)
  const c = chat = new Chat(im as unknown as AppImManager, managers as unknown as Managers, true)
  im.chats.push(c)
  document.body.append(c.container)
  const result = await c.setPeer({ peerId })
  await result?.promise
  return { c, managers }
}

const searchInput = (c: Chat) => c.topbar.container.querySelector<HTMLInputElement>('.topbar-search-input')

async function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  // debounce поля (`InputSearch`, 300 мс) и рендер строк
  await vi.advanceTimersByTimeAsync(350)
  await vi.waitFor(() => {})
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // happy-dom без Web Animations: появление/скрытие поиска (`animateElements`, tweb chat.ts:750)
  HTMLElement.prototype.animate = function() {
    return { finished: Promise.resolve() } as unknown as Animation
  }
  resetPeerMirror()
  resetMessagesMirror()
  rootScope.myId = ME
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: FRIEND, first_name: 'Друг', pFlags: {} } as UserReal,
    { _: 'user', id: BOB, first_name: 'Боб', pFlags: {} } as UserReal,
    { _: 'channel', id: 100, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true },
      default_banned_rights: { _: 'chatBannedRights', until_date: 0, pFlags: {} } } as unknown as MTChat,
  ] }])
})

afterEach(() => {
  chat?.destroy()
  chat = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('поиск по чату (tweb topbarSearch.tsx)', () => {
  it('initSearch монтирует поле в шапку; запрос → строки найденного → клик ведёт ленту к сообщению', async() => {
    const found = [
      makeMessage({ id: 42, peerId: FRIEND, fromId: FRIEND, text: 'привет мир', date: 1_700_000_000 }),
      makeMessage({ id: 17, peerId: FRIEND, fromId: FRIEND, text: 'мир дружба', date: 1_699_000_000 }),
    ]
    const { c, managers } = await openChat(FRIEND, found)
    const setMessageId = vi.spyOn(c, 'setMessageId')

    c.initSearch()
    const input = searchInput(c)
    expect(input).toBeTruthy()
    expect(c.topbar.container.querySelector('.topbar-search-container')).toBeTruthy()

    input!.dispatchEvent(new FocusEvent('focusin'))
    await type(input!, 'мир')

    expect(managers.messages.searchHistory).toHaveBeenCalledWith(expect.objectContaining({
      peerId: FRIEND,
      query: 'мир',
      offsetId: 0,
      inputFilter: { _: 'inputMessagesFilterEmpty' },
    }))

    const rows = await vi.waitFor(() => {
      const list = c.topbar.container.querySelectorAll<HTMLElement>('.topbar-search-left-chatlist .chatlist-chat')
      expect(list).toHaveLength(2)
      return list
    })

    rows[1].click()
    await vi.waitFor(() => expect(setMessageId).toHaveBeenCalledWith({ lastMsgId: 17 }))
    expect(rows[1].classList.contains('active')).toBe(true)
  })

  it('пустая выдача — «Нет результатов» с запросом', async() => {
    const { c } = await openChat(FRIEND, [])
    c.initSearch()
    const input = searchInput(c)!
    input.dispatchEvent(new FocusEvent('focusin'))
    await type(input, 'нет такого')

    await vi.waitFor(() => {
      expect(c.topbar.container.querySelector('.topbar-search-left-results-empty')).toBeTruthy()
    })
  })

  it('Esc: первый снимает фокус с заполненного поля, второй закрывает поиск (tweb :458-468)', async() => {
    const { c } = await openChat(FRIEND)
    c.initSearch({ query: 'мир' })
    const input = searchInput(c)!
    expect(input.value).toBe('мир')
    // `placeCaretAtEnd` (tweb :423) ставит фокус в поле
    expect(document.activeElement).toBe(input)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.activeElement).not.toBe(input)
    expect(c.topbar.container.querySelector('.topbar-search-container')).toBeTruthy()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(c.searchSignal?.()).toBeUndefined()
    await vi.waitFor(() => expect(c.topbar.container.querySelector('.topbar-search-container')).toBeNull())
  })

  it('смена пира гасит поиск (tweb chat.ts:871-879)', async() => {
    const { c } = await openChat(FRIEND)
    c.initSearch()
    expect(c.searchSignal?.()).toBeTruthy()

    const result = await c.setPeer({ peerId: GROUP })
    await result?.promise

    expect(c.searchSignal?.()).toBeUndefined()
    await vi.waitFor(() => expect(c.topbar.container.querySelector('.topbar-search-container')).toBeNull())
  })

  it('в группе фильтр отправителя: список участников по `q` → выбор → поиск с `fromPeerId`', async() => {
    const { c, managers } = await openChat(GROUP, [])
    c.initSearch()
    const filterButton = c.topbar.container.querySelector<HTMLElement>('.topbar-search-right-filter-button')
    expect(filterButton).toBeTruthy()

    const input = searchInput(c)!
    input.dispatchEvent(new FocusEvent('focusin'))
    filterButton!.click()
    await vi.advanceTimersByTimeAsync(0)

    await type(input, 'бо')
    expect(managers.groups.channelParticipants).toHaveBeenLastCalledWith(GROUP, 0, 30, 'бо')

    const sender = await vi.waitFor(() => {
      const row = c.topbar.container.querySelector<HTMLElement>('.topbar-search-left-sender')
      expect(row).toBeTruthy()
      return row!
    })
    sender.click()

    await vi.waitFor(() => expect(managers.messages.searchHistory).toHaveBeenLastCalledWith(expect.objectContaining({
      peerId: GROUP,
      fromPeerId: BOB,
      query: '',
    })))
  })

  it('без группы кнопки фильтра отправителя нет (tweb chat.ts:794 `canFilterSender`)', async() => {
    const { c } = await openChat(FRIEND)
    c.initSearch()
    expect(c.topbar.container.querySelector('.topbar-search-right-filter-button')).toBeNull()
  })
})
