// Пины кнопки «Вступить»/«Подписаться» в `ChatInput` (tweb `input.ts:1584`,
// `:2024-2047`, `:2650-2672`; обработчик — tweb `topbar.ts:1189-1204`): публичный
// чат открывается без вступления (сервер читает его не-участнику, аудит A5-23), и
// вступает в него пользователь сам — кнопкой, а не `appImManager.op()` молча.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import { getMiddleware } from '@helpers/middleware'
import { useChatsStore } from '@stores/chatsStore'
import { winKey } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { Chat as MTChat } from '@core/peers/peer'
import { ChatType } from './chatType'

const { default: ChatInput } = await import('./input')

const CHANNEL = -300
const GROUP = -100

function upsert(id: number, pFlags: Record<string, true>) {
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'channel', id, title: 'Чат', username: 'pub' + id, photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags } as unknown as MTChat,
  ] }])
}

function makeManagers() {
  return {
    messages: { getScheduledMessages: vi.fn(async() => []) },
    drafts: { save: vi.fn(async() => ({ _: 'draftMessageEmpty' })) },
    realtime: { sendTyping: vi.fn(async() => ({ ok: true })) },
    chats: { getSendAs: vi.fn(async() => ({ _: 'channels.sendAsPeers', peers: [], chats: [], users: [] })) },
    dialogs: { refresh: vi.fn(async() => {}) },
    channels: { join: vi.fn(async(_username: string) => {}) },
    groups: { setMute: vi.fn(async() => {}) },
    peers: { fillMirror: vi.fn(async() => {}) },
    bots: { commands: vi.fn(async() => []), menuButton: vi.fn(async() => ({ text: '', url: '' })) },
  }
}

async function mountInput(peerId: PeerId) {
  useChatsStore.setState({ dialogs: [], loaded: true })
  const managers = makeManagers()
  const appImManager = Object.assign(new EventListenerBase<{ peer_changing: (chat: unknown) => void }>(), {
    openScheduled: vi.fn(),
    setPeer: vi.fn(),
    chat: undefined,
  })
  const container = document.createElement('div')
  const chat = {
    peerId,
    threadId: undefined as number | undefined,
    type: ChatType.Chat,
    container,
    messagesStorageKey: winKey(peerId),
    isBroadcast: false,
    isBot: false,
    isForum: false,
    canSend: vi.fn(async() => false),
    updateChatInputHeight: vi.fn(),
    getMessage: () => undefined,
    setMessageId: vi.fn(),
    bubbles: { onGoDownClick: vi.fn(), getMiddleware: () => () => true },
    destroyMiddlewareHelper: getMiddleware(),
    selection: { isSelecting: false },
    appImManager,
    managers,
  }
  const input = new ChatInput(chat as never, appImManager as never, managers as never, 'chat-input-main')
  input.construct()
  input.constructPeerHelpers()
  container.append(input.chatInput)
  document.body.append(container)
  const callback = await input.finishPeerChange({ peerId, middleware: () => true })
  callback()
  return { input, chat, managers }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function controlButtons(input: InstanceType<typeof ChatInput>) {
  const plate = (input as unknown as { controlContainer: HTMLElement }).controlContainer
  return [...plate.querySelectorAll<HTMLElement>('.chat-input-control-button')]
    .filter((b) => !b.classList.contains('hide'))
    .map((b) => b.textContent)
}

let mounted: Awaited<ReturnType<typeof mountInput>> | undefined

beforeEach(async() => {
  const { default: rootScope } = await import('@lib/rootScope')
  rootScope.myId = 1
})

afterEach(() => {
  mounted?.input.destroy()
  mounted?.chat.container.remove()
  mounted = undefined
  resetPeerMirror()
})

describe('ChatInput: «Вступить» (tweb joinBtn)', () => {
  it('канал, где мы не состоим: «SUBSCRIBE», клик вступает по @имени и меняет плашку на «Без звука»', async() => {
    upsert(300, { broadcast: true, left: true })
    mounted = await mountInput(CHANNEL)
    expect(controlButtons(mounted.input)).toEqual(['SUBSCRIBE'])

    mounted.managers.channels.join.mockImplementation(async() => { upsert(300, { broadcast: true }) })
    const btn = [...(mounted.input as unknown as { controlContainer: HTMLElement }).controlContainer.querySelectorAll<HTMLElement>('.chat-input-control-button')]
      .find((b) => b.textContent === 'SUBSCRIBE')!
    btn.click()
    await flush()
    await flush()

    expect(mounted.managers.channels.join).toHaveBeenCalledWith('pub300')
    expect(mounted.managers.dialogs.refresh).toHaveBeenCalled()
    expect(controlButtons(mounted.input)).toEqual(['Mute'])
  })

  it('подписчик канала: «Без звука», кнопки вступления нет', async() => {
    upsert(300, { broadcast: true })
    mounted = await mountInput(CHANNEL)
    expect(controlButtons(mounted.input)).toEqual(['Mute'])
  })

  it('публичная группа, где мы не состоим: «JOIN»', async() => {
    upsert(100, { megagroup: true, left: true })
    mounted = await mountInput(GROUP)
    expect(controlButtons(mounted.input)).toEqual(['JOIN'])
  })
})
