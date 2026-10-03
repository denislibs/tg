// Лента отложенных (`ChatType.Scheduled`, tweb `appImManager.openScheduled` :3436):
// класс `Chat` с настоящей лентой — свой ключ окна (`${peerId}_scheduled`, tweb
// chat.ts:995-999), набор `messages.getScheduledMessages` без курсора прочтения,
// дата-баблы «Scheduled for …», «отправить сейчас»/удаление — событием
// `scheduled_delete`, новое отложенное — `scheduled_new`, кадры окна истории в
// ленту отложенных не попадают. Шапка, композер и правая колонка — дублёры.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { mirrorWindow, resetMessagesMirror } from '@core/history/messagesMirror'
import { makeMessage } from '@core/messages/testMessage'
import { SEND_WHEN_ONLINE_TIMESTAMP } from '@core/format/dayLabel'
import { useSettingsStore } from '@/settings'
import type { Managers } from '@/client/bootstrap'
import type { AppImManager } from '@lib/appImManager'
import type { UserReal } from '@core/peers/peer'
import type { MyMessage } from '@core/models'
import { ChatType } from './chatType'
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

/** Отложенное: своё (`out`), дата — время отправки (`domain.ScheduledMessage.ToWire`). */
const scheduled = (id: number, date: number): MyMessage => {
  const message = makeMessage({ id, peerId: FRIEND, fromId: ME, text: `потом ${id}`, date, out: true })
  message.pFlags.is_scheduled = true
  return message
}

const today = () => {
  const d = new Date()
  d.setHours(23, 0, 0, 0)
  return d.getTime() / 1000 | 0
}

function managersWith(list: MyMessage[]) {
  return {
    messages: {
      getHistory: vi.fn(async() => ({ messages: [], count: 0, reachedTop: true, reachedBottom: true })),
      getAround: vi.fn(async() => ({ messages: [], reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async() => null),
      getScheduledMessages: vi.fn(async() => list),
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

async function openScheduled(list: MyMessage[]) {
  const im = new FakeAppImManager()
  const managers = managersWith(list)
  const c = chat = new Chat(im as unknown as AppImManager, managers as unknown as Managers, true)
  im.chats.push(c)
  document.body.append(c.container)
  const result = await c.setPeer({ peerId: FRIEND, type: ChatType.Scheduled })
  await result?.promise
  return { c, managers }
}

const bubbleMids = (c: Chat) => Array.from(c.bubbles.chatInner.querySelectorAll<HTMLElement>('.bubble[data-mid]:not(.is-date)'))
  .map((bubble) => +bubble.dataset.mid!)

const dateLabels = (c: Chat) => Array.from(c.bubbles.chatInner.querySelectorAll<HTMLElement>('.bubble.is-date:not(.is-fake) .service-msg'))
  .map((el) => el.textContent)

beforeEach(() => {
  resetPeerMirror()
  resetMessagesMirror()
  rootScope.myId = ME
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: FRIEND, first_name: 'Друг', pFlags: {} } as UserReal,
  ] }])
})

afterEach(() => {
  chat?.destroy()
  chat = undefined
  document.body.replaceChildren()
})

describe('лента отложенных (ChatType.Scheduled)', () => {
  it('открытие: свой ключ окна, весь набор очереди, без курсора прочтения; дата-баблы «Scheduled for»', async() => {
    const { c, managers } = await openScheduled([scheduled(5, today()), scheduled(6, SEND_WHEN_ONLINE_TIMESTAMP)])

    expect(c.type).toBe(ChatType.Scheduled)
    expect(c.container.dataset.type).toBe('scheduled')
    expect(c.messagesStorageKey).toBe(`${FRIEND}_scheduled`)
    expect(managers.messages.getScheduledMessages).toHaveBeenCalledWith(FRIEND)
    expect(managers.messages.getHistory).not.toHaveBeenCalled()
    expect(managers.dialogs.getReadMaxSeqIfUnread).not.toHaveBeenCalled()
    expect(mirrorWindow(`${FRIEND}_scheduled`)?.map((m) => m.id)).toEqual([5, 6])

    await vi.waitFor(() => expect(bubbleMids(c)).toEqual([5, 6]))
    expect(dateLabels(c)).toEqual(['Scheduled for today', 'Scheduled until online'])
  })

  it('«отправить сейчас»/удаление — `scheduled_delete` убирает бабл; пустая лента — «No scheduled messages»', async() => {
    const { c } = await openScheduled([scheduled(5, today())])
    await vi.waitFor(() => expect(bubbleMids(c)).toEqual([5]))

    rootScope.dispatchEventSingle('scheduled_delete', { peerId: FRIEND, mids: [5] })

    await vi.waitFor(() => expect(bubbleMids(c)).toEqual([]))
    expect(mirrorWindow(`${FRIEND}_scheduled`) ?? []).toEqual([])
    await vi.waitFor(() => {
      expect(c.bubbles.container.querySelector('.empty-bubble-placeholder-noScheduledMessages')?.textContent)
        .toContain('No scheduled messages here yet...')
    })
  })

  it('`scheduled_new` дорисовывает новое отложенное этого пира, чужое — нет', async() => {
    const { c } = await openScheduled([scheduled(5, today())])
    await vi.waitFor(() => expect(bubbleMids(c)).toEqual([5]))

    rootScope.dispatchEventSingle('scheduled_new', scheduled(7, today()))
    rootScope.dispatchEventSingle('scheduled_new', { ...scheduled(8, today()), peerId: 99 })

    await vi.waitFor(() => expect(bubbleMids(c)).toEqual([5, 7]))
  })

  it('кадры окна истории в ленту отложенных не попадают: `history_delete` того же номера бабл не снимает', async() => {
    const { c } = await openScheduled([scheduled(5, today())])
    await vi.waitFor(() => expect(bubbleMids(c)).toEqual([5]))

    rootScope.dispatchEventSingle('history_delete', { peerId: FRIEND, msgs: new Set([5]) })
    await Promise.resolve()

    expect(bubbleMids(c)).toEqual([5])
  })
})
