// Экран закрепов (`ChatType.Pinned`) — лента tweb в режиме списка закрепов:
// страница — список закрепов чата, а не история (tweb bubbles.ts:11793-11803), у каждого
// бабла сбоку «перейти к оригиналу» (:11021-11040, клик — :3944-3952), открепление удаляет
// бабл (:2544-2555), последний номер — новейший закреп (:5866-5867). Окно лежит под своим
// ключом и в окно чата не попадает.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { mirrorWindow, resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { useSettingsStore } from '@/settings'
import { makeMessage } from '@core/messages/testMessage'
import { onPinnedMessagesUpdate, resetPinnedMessagesCache } from '@core/pinnedMessages'
import type { MyMessage } from '@core/models'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { ChatType } from './chatType'
import { createTestChat, mountTestBubbles } from './testChat'

const PEER = 7
const KEY = PEER + ':pinned'
const msg = (id: number) => makeMessage({ peerId: PEER, fromId: 1, id, text: `m${id}`, createdAt: '2026-08-15T12:00:00Z' })

let pins: MyMessage[]
let listPins: ReturnType<typeof vi.fn>
let setInnerPeer: ReturnType<typeof vi.fn<(options: { peerId: PeerId, lastMsgId?: number }) => unknown>>
let bubbles: ChatBubbles | undefined

function mount() {
  const managers: BubblesManagers = {
    messages: {
      getHistory: vi.fn(async() => { throw new Error('страница закрепов не ходит в историю') }),
      getAround: vi.fn(async() => { throw new Error('страница закрепов не ходит в историю') }),
      messageByDate: vi.fn(async() => null),
    },
    peers: { fillMirror: vi.fn(async() => {}) },
    dialogs: {
      getReadMaxSeqIfUnread: vi.fn(async() => 0),
      getHistoryMaxSeq: vi.fn(async() => 999),
      getDialogReadState: vi.fn(async() => undefined),
    },
    realtime: { markRead: vi.fn(async() => ({ ok: true })) },
  }
  const chat = createTestChat({
    peerId: PEER,
    type: ChatType.Pinned,
    messagesStorageKey: KEY,
    managers: { messages: { listPins, pin: vi.fn(), unpin: vi.fn() } },
    appImManager: { setInnerPeer },
  })
  return bubbles = mountTestBubbles(chat, managers)
}

async function settle() {
  for(let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const renderedMids = (feed: ChatBubbles) =>
  Array.from(feed.chatInner.querySelectorAll<HTMLElement>('.bubble[data-mid]:not(.service)'))
    .map((b) => Number(b.dataset.mid))
    .sort((a, b) => a - b)

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  resetPinnedMessagesCache()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  rootScope.myId = 1
  pins = [msg(3), msg(9), msg(5)]
  listPins = vi.fn(async() => pins.slice())
  setInnerPeer = vi.fn<(options: { peerId: PeerId, lastMsgId?: number }) => unknown>()
})

afterEach(() => { bubbles?.destroy(); bubbles = undefined })

describe('ChatBubbles — экран закрепов (ChatType.Pinned)', () => {
  it('страница — список закрепов чата под своим ключом окна, не история', async() => {
    const feed = mount()
    await (await feed.setPeer())?.promise
    await settle()

    expect(listPins).toHaveBeenCalledWith(PEER)
    expect(renderedMids(feed)).toEqual([3, 5, 9])
    expect(mirrorWindow(KEY)?.map((m) => m.id)).toEqual([3, 5, 9])
    expect(mirrorWindow(String(PEER))).toBeUndefined()
  })

  it('у каждого бабла «перейти к оригиналу»; клик открывает сообщение в самом чате', async() => {
    const feed = mount()
    await (await feed.setPeer())?.promise
    await settle()

    const bubble = feed.chatInner.querySelector<HTMLElement>('.bubble[data-mid="5"]')!
    expect(bubble.classList.contains('with-beside-button')).toBe(true)
    const goto = bubble.querySelector<HTMLElement>('.bubble-beside-button.goto-original')!
    expect(goto.getAttribute('role')).toBe('button')

    goto.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(setInnerPeer).toHaveBeenCalledWith({ peerId: PEER, lastMsgId: 5 })
  })

  it('открепление убирает бабл из списка', async() => {
    const feed = mount()
    await (await feed.setPeer())?.promise
    await settle()

    pins = [msg(3), msg(9)]
    onPinnedMessagesUpdate(PEER, [5], false)
    await settle()
    expect(renderedMids(feed)).toEqual([3, 9])

    // закрепление нового на экране закрепов бабла не добавляет (tweb :2550-2552)
    onPinnedMessagesUpdate(PEER, [11], true)
    await settle()
    expect(renderedMids(feed)).toEqual([3, 9])
  })
})
