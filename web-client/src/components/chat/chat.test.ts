// Класс `Chat` (порт tweb `components/chat/chat.ts`, шаг К-3): жизненный цикл смены
// пира (`setPeer` → `init` один раз → `onChangePeer` → `finishPeerChange`), флаги и
// права по виду пира и снос (`destroy`). Лента, меню и выделение — настоящие
// (`ChatBubbles`/`ChatContextMenu`/`ChatSelection` на фейковых менеджерах), шапка и
// строка ввода — дублёры (их предмет — `topbar.test.ts`, тесты `input.ts`),
// стек колонки — дублёр `AppImManager` с его `isSamePeer` и событиями.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { makeMessage } from '@core/messages/testMessage'
import { useSettingsStore } from '@/settings'
import animationIntersector from '@components/animationIntersector'
import type { Managers } from '@/client/bootstrap'
import type { AppImManager } from '@lib/appImManager'
import type { Chat as MTChat, UserReal } from '@core/peers/peer'
import type { MyMessage } from '@core/models'
import { ChatType } from './chatType'
import Chat from './chat'

const parts = vi.hoisted(() => ({
  topbars: [] as Array<Record<string, ReturnType<typeof vi.fn>> & { container: HTMLElement }>,
  inputs: [] as Array<Record<string, ReturnType<typeof vi.fn>> & { chatInput: HTMLElement }>,
  tabs: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
  replaceSharedMediaTab: vi.fn(),
  toggleSidebar: vi.fn(() => Promise.resolve()),
}))

vi.mock('./topbar', () => ({
  default: class {
    public container = document.createElement('div')
    public constructUtils = vi.fn()
    public constructPeerHelpers = vi.fn()
    public construct = vi.fn()
    public finishPeerChange = vi.fn(async() => () => {})
    public cleanup = vi.fn()
    public destroy = vi.fn()
    constructor() {
      parts.topbars.push(this as never)
    }
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
    constructor() {
      parts.inputs.push(this as never)
    }
  },
}))

vi.mock('@components/sidebarRight', () => ({
  default: {
    createSharedMediaTab: () => {
      const tab = { setPeer: vi.fn(), fillProfileElements: vi.fn(async() => {}), loadSidebarMedia: vi.fn(), destroy: vi.fn() }
      parts.tabs.push(tab)
      return tab
    },
    replaceSharedMediaTab: parts.replaceSharedMediaTab,
    toggleSidebar: parts.toggleSidebar,
  },
}))

// фон и полная карточка — свои предметы (`chatBackground.solid.tsx`, `fullPeers.solid.ts`)
vi.mock('@stores/fullPeers.solid', () => ({ useFullPeer: () => () => undefined }))

const ME = 1
const FRIEND = 2
const GROUP = -100
const CHANNEL = -200

/** Дублёр стека колонки: события, `isSamePeer` (tweb `:3809-3816`) и фон. */
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

  public listenerCount() {
    return Object.values(this.listeners).reduce((acc, set) => acc + (set?.size ?? 0), 0)
  }
}

function managersWith(messages: MyMessage[] = []) {
  return {
    messages: {
      getHistory: vi.fn(async() => ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })),
      getAround: vi.fn(async() => ({ messages, reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async() => null),
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

let im: FakeAppImManager
let chat: Chat | undefined

function newChat(managers = managersWith()) {
  im = new FakeAppImManager()
  chat = new Chat(im as unknown as AppImManager, managers as unknown as Managers, true)
  im.chats.push(chat)
  document.body.append(chat.container)
  return chat
}

async function open(c: Chat, options: Parameters<Chat['setPeer']>[0]) {
  const result = await c.setPeer(options)
  await result?.promise
}

beforeEach(() => {
  resetPeerMirror()
  resetMessagesMirror()
  rootScope.myId = ME
  parts.topbars.length = parts.inputs.length = parts.tabs.length = 0
  parts.replaceSharedMediaTab.mockClear()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: FRIEND, first_name: 'Друг', pFlags: {} } as UserReal,
    { _: 'channel', id: 100, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true },
      default_banned_rights: { _: 'chatBannedRights', until_date: 0, pFlags: {} } } as unknown as MTChat,
    { _: 'channel', id: 200, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true } } as unknown as MTChat,
  ] }])
})

afterEach(() => {
  chat?.destroy()
  chat = undefined
  document.body.replaceChildren()
})

describe('Chat.setPeer (tweb chat.ts:1035-1156)', () => {
  it('первый пир — `init` один раз, `peer_changing` один раз, затем `peer_changed`', async() => {
    const c = newChat()
    const changing = vi.fn()
    const changed = vi.fn()
    im.addEventListener('peer_changing', changing)
    im.addEventListener('peer_changed', changed)

    expect(c.inited).toBeUndefined()
    await open(c, { peerId: FRIEND })

    expect(c.inited).toBe(true)
    expect(parts.topbars).toHaveLength(1)
    expect(parts.inputs).toHaveLength(1)
    expect(changing).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith(c)
    // DOM инстанса — порядок tweb `:648`: шапка, лента, вьюпорт, композер
    expect(Array.from(c.container.children)).toEqual([
      parts.topbars[0].container, c.bubbles.container, c.bubblesViewport, parts.inputs[0].chatInput,
    ])
    expect(c.container.dataset.type).toBe(ChatType.Chat)
    expect(parts.topbars[0].finishPeerChange).toHaveBeenCalledTimes(1)
    expect(parts.inputs[0].finishPeerChange).toHaveBeenCalledTimes(1)
  })

  it('смена пира на том же инстансе — новый `peer_changing`, `init` не повторяется, вкладка №0 своя на пир', async() => {
    const c = newChat()
    await open(c, { peerId: FRIEND })
    const changing = vi.fn()
    im.addEventListener('peer_changing', changing)

    await open(c, { peerId: GROUP })

    expect(parts.topbars).toHaveLength(1)
    expect(changing).toHaveBeenCalledTimes(1)
    expect(c.peerId).toBe(GROUP)
    expect(parts.tabs).toHaveLength(2)
    expect(parts.tabs[1].setPeer).toHaveBeenCalledWith(GROUP, undefined)
    expect(parts.replaceSharedMediaTab).toHaveBeenLastCalledWith(parts.tabs[1])
    // прошлая вкладка снята (tweb :1243)
    expect(parts.tabs[0].destroy).toHaveBeenCalled()
  })

  it('тот же пир, пока смена в полёте, — повтор гасится (tweb :1084-1090)', async() => {
    const c = newChat()
    const first = c.setPeer({ peerId: FRIEND })
    expect(c.setPeer({ peerId: FRIEND })).toBeUndefined()
    await (await first)?.promise
  })

  it('пустой пир снимает инстанс: `inited` гаснет, `peer_changed` с пустым пиром', async() => {
    const c = newChat()
    await open(c, { peerId: FRIEND })
    const changed = vi.fn()
    im.addEventListener('peer_changed', changed)

    void c.setPeer({ peerId: 0 })
    await Promise.resolve()
    await Promise.resolve()

    expect(c.inited).toBeUndefined()
    expect(c.peerId).toBe(0)
    expect(changed).toHaveBeenCalledWith(c)
    expect(parts.replaceSharedMediaTab).toHaveBeenLastCalledWith()
  })
})

describe('Chat.onChangePeer — вид чата, флаги и права (tweb chat.ts:893-1012, :1342)', () => {
  it('личка', async() => {
    const c = newChat()
    await open(c, { peerId: FRIEND })
    expect(c.type).toBe(ChatType.Chat)
    expect([c.isLikeGroup, c.isAnyGroup, c.isMegagroup, c.isBroadcast, c.isChannel]).toEqual([false, false, false, false, false])
    expect(await c.canSend()).toBe(true)
  })

  it('«Избранное» — `isLikeGroup` (tweb `_isLikeGroup` :1309)', async() => {
    const c = newChat()
    await open(c, { peerId: ME })
    expect(c.isLikeGroup).toBe(true)
  })

  it('мегагруппа — группа «как группа», писать по `default_banned_rights`', async() => {
    const c = newChat()
    await open(c, { peerId: GROUP })
    expect([c.isLikeGroup, c.isAnyGroup, c.isMegagroup, c.isBroadcast, c.isChannel]).toEqual([true, true, true, false, true])
    expect(await c.canSend()).toBe(true)
  })

  it('канал — `isBroadcast`, подписчику писать нельзя, канал подписан на время окна', async() => {
    const managers = managersWith()
    const c = newChat(managers)
    await open(c, { peerId: CHANNEL })
    expect([c.isLikeGroup, c.isBroadcast, c.isChannel]).toEqual([false, true, true])
    expect(await c.canSend()).toBe(false)
    expect(managers.realtime.subscribeChannel).toHaveBeenCalledWith({ peerId: CHANNEL })
  })

  it('тред комментариев (не форум) — `ChatType.Discussion`, ключ окна с тредом', async() => {
    const c = newChat()
    await open(c, { peerId: GROUP, threadId: 7 })
    expect(c.type).toBe(ChatType.Discussion)
    expect(c.messagesStorageKey).toBe(`${GROUP}:7`)
    expect(c.container.dataset.type).toBe(ChatType.Discussion)
  })

  it('карточки пира нет в зеркале — сначала объявлен пробел (`peers.fillMirror`)', async() => {
    const managers = managersWith()
    const c = newChat(managers)
    await open(c, { peerId: 999 })
    expect(managers.peers.fillMirror).toHaveBeenCalledWith([999])
  })
})

describe('Chat.destroy (tweb chat.ts:843-869)', () => {
  it('снимает подкомпоненты, контейнер и подписки на стек колонки', async() => {
    const managers = managersWith([makeMessage({ peerId: FRIEND, id: 1, fromId: FRIEND, text: 'привет', createdAt: '2026-10-01T10:00:00Z' })])
    const c = newChat(managers)
    await open(c, { peerId: FRIEND })
    expect(im.listenerCount()).toBeGreaterThan(0)
    const toggleGroup = vi.spyOn(animationIntersector, 'toggleIntersectionGroup')

    c.destroy()
    chat = undefined

    expect(c.container.isConnected).toBe(false)
    expect(parts.topbars[0].destroy).toHaveBeenCalled()
    expect(parts.inputs[0].destroy).toHaveBeenCalled()
    expect(parts.tabs[0].destroy).toHaveBeenCalled()
    expect(im.listenerCount()).toBe(0)
    im.dispatchEvent('tab_changing', 1)
    expect(toggleGroup).not.toHaveBeenCalled()
  })
})
