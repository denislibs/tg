// Права зрителя сменились живьём (Ф-3б, A2-05): кадр `chat_update` с полным
// `channel` зрителя пересобирает поле ввода, если право писать изменилось —
// порт tweb bubbles.ts:2351-2358 (`refreshInput`) и :2410-2432 (`chat_update`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '@core/realtime/events'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles } from './testChat'
import { ChatType } from './chatType'

const PEER = -140

let bubbles: ChatBubbles | undefined
let canWrite = true
let finishInput: ReturnType<typeof vi.fn<(options: { peerId: PeerId, middleware: () => boolean }) => Promise<() => void>>>

let onMessageInput = vi.fn()
let willSendWebPage: unknown = null

let setPeer = vi.fn()
let isForum = false
let mountedChat: ReturnType<typeof createTestChat> | undefined
let chatType: ChatType | undefined

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
    appImManager: { setPeer },
    isForum,
    type: chatType,
  })
  mountedChat = chat
  return bubbles = mountTestBubbles(chat, managers)
}

const settle = async() => { for(let i = 0; i < 5; ++i) await new Promise((r) => setTimeout(r, 0)) }
const frame = (peerId: number) => ({ _: 'updateChatFullSnapshot', peer: { _: 'peerChannel', channel_id: -peerId } }) as never

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  canWrite = true
  setPeer = vi.fn()
  isForum = false
  chatType = undefined
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

  // tweb bubbles.ts:2438-2441 — «Темы» включили или выключили у открытого чата:
  // он открывается заново тем же пиром, и раскладка (форум/лента) выбирается
  // заново. До порта раскладка менялась только перезагрузкой (P0 2026-10-16).
  // Повод — `chat_toggle_forum` (у tweb — `chat_update` из `saveApiChat`, см.
  // расхождение у обработчика): смена признака из любого источника, не только
  // живого кадра снимка.
  const channel = (forum: boolean) => applyPeerOps([{ op: 'upsert', peers: [
    { _: 'channel', id: -PEER, title: 'g', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true, ...(forum ? { forum: true } : {}) } } as never,
  ] }])

  it('форум включили у открытого чата — чат открывается заново тем же пиром', async() => {
    const feed = mount()
    feed.chatInner.classList.add('has-rights')
    channel(true)
    rootScope.dispatchEventSingle('chat_toggle_forum', { chatId: -PEER, enabled: true })
    await settle()
    expect(setPeer).toHaveBeenCalledTimes(1)
    expect(setPeer).toHaveBeenCalledWith({ peerId: PEER })
    expect(mountedChat?.peerId).toBe(0)
  })

  it('форум выключили — тоже заново; признак не сменился — без переоткрытия', async() => {
    isForum = true
    let feed = mount()
    feed.chatInner.classList.add('has-rights')
    channel(false)
    rootScope.dispatchEventSingle('chat_toggle_forum', { chatId: -PEER, enabled: false })
    await settle()
    expect(setPeer).toHaveBeenCalledTimes(1)
    bubbles?.destroy()

    setPeer = vi.fn()
    isForum = false
    feed = mount()
    feed.chatInner.classList.add('has-rights')
    rootScope.dispatchEventSingle('chat_toggle_forum', { chatId: -PEER, enabled: false })
    rootScope.dispatchEventSingle('chat_toggle_forum', { chatId: 999, enabled: true })
    await settle()
    expect(setPeer).not.toHaveBeenCalled()
  })

  // гвард `type === Chat` (tweb :2438): экран закрепов того же пира не переоткрывается
  it('экран закрепов не переоткрывается сменой форума', async() => {
    chatType = ChatType.Pinned
    mount().chatInner.classList.add('has-rights')
    channel(true)
    rootScope.dispatchEventSingle('chat_toggle_forum', { chatId: -PEER, enabled: true })
    await settle()
    expect(setPeer).not.toHaveBeenCalled()
  })
})
