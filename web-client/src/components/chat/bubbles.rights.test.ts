// Права зрителя сменились живьём (Ф-3б, A2-05): кадр `chat_update` с полным
// `channel` зрителя пересобирает поле ввода, если право писать изменилось —
// порт tweb bubbles.ts:2351-2358 (`refreshInput`) и :2410-2432 (`chat_update`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '@core/realtime/events'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles } from './testChat'

const PEER = -140

let bubbles: ChatBubbles | undefined
let canWrite = true
let finishInput: ReturnType<typeof vi.fn<(options: { peerId: PeerId, middleware: () => boolean }) => Promise<() => void>>>

let onMessageInput = vi.fn()
let willSendWebPage: unknown = null

function mount() {
  const managers: BubblesManagers = {
    messages: {
      getHistory: vi.fn(async() => ({ messages: [], count: 0 })),
      getAround: vi.fn(async() => ({ messages: [], count: 0 })),
      messageByDate: vi.fn(async() => null),
    },
    peers: { fillMirror: vi.fn(async() => {}) },
    dialogs: {
      getReadMaxSeqIfUnread: vi.fn(async() => 0),
      getHistoryMaxSeq: vi.fn(async() => 0),
      getDialogReadState: vi.fn(async() => undefined),
    },
    realtime: { markRead: vi.fn(async() => ({ ok: true })) },
  } as unknown as BubblesManagers
  const chat = createTestChat({
    peerId: PEER,
    canSend: () => canWrite,
    input: { finishPeerChange: finishInput, onMessageInput, willSendWebPage },
  })
  return bubbles = mountTestBubbles(chat, managers)
}

const settle = async() => { for(let i = 0; i < 5; ++i) await new Promise((r) => setTimeout(r, 0)) }
const frame = (peerId: number) => ({ _: 'updateChatFullSnapshot', peer: { _: 'peerChannel', channel_id: -peerId } }) as never

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  canWrite = true
  finishInput = vi.fn<(options: { peerId: PeerId, middleware: () => boolean }) => Promise<() => void>>(async() => () => {})
})
afterEach(() => { bubbles?.destroy(); bubbles = undefined })

describe('ChatBubbles — права зрителя по chat_update', () => {
  it('отняли право писать — поле ввода пересобирается, has-rights снят', async() => {
    const feed = mount()
    feed.chatInner.classList.add('has-rights')
    canWrite = false
    rootScope.dispatchEvent(RT.chatUpdate, frame(PEER))
    await settle()
    expect(finishInput).toHaveBeenCalledTimes(1)
    expect(feed.chatInner.classList.contains('has-rights')).toBe(false)
  })

  it('право не изменилось или кадр чужого чата — без пересборки', async() => {
    const feed = mount()
    feed.chatInner.classList.add('has-rights')
    rootScope.dispatchEvent(RT.chatUpdate, frame(PEER))
    rootScope.dispatchEvent(RT.chatUpdate, frame(-999))
    await settle()
    expect(finishInput).not.toHaveBeenCalled()
  })

  // tweb bubbles.ts:2434-2438 — плашка превью ссылки пересчитывается, когда право
  // вставлять ссылки разошлось с её наличием (у нас право — `send_messages`)
  it('сброс плашки превью: есть право и нет плашки / нет права и есть плашка → onMessageInput', async() => {
    onMessageInput = vi.fn()
    willSendWebPage = null
    mount().chatInner.classList.add('has-rights')
    rootScope.dispatchEvent(RT.chatUpdate, frame(PEER))
    await settle()
    expect(onMessageInput).toHaveBeenCalledTimes(1)
    bubbles?.destroy()

    onMessageInput = vi.fn()
    willSendWebPage = { _: 'webPage' }
    mount().chatInner.classList.add('has-rights')
    rootScope.dispatchEvent(RT.chatUpdate, frame(PEER))
    await settle()
    expect(onMessageInput).not.toHaveBeenCalled()
  })
})
