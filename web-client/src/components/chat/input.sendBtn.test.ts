// Морф кнопки отправки `ChatInput` (`components/chat/input.ts`, tweb
// `input.ts:1398-1416` — узел, `:4390-4442` — `updateSendBtn`): одна кнопка
// `.btn-send` с семью иконками, состояние — ровно один класс из набора tweb
// и подпись `aria-label` по нему. В happy-dom нет ни WebCodecs, ни `window.Recorder`,
// рекордера голоса у строки нет — пустое поле тоже «отправить», как у tweb без
// рекордера (`:4400`). Ветки «записать» — `recording/chatRecording.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import I18n from '@lib/langPack'
import { useChatsStore } from '@stores/chatsStore'
import { winKey } from '@core/history/messagesMirror'
import { makeDialog } from '@core/dialogs/testDialog'
import type { MyMessage } from '@core/models'
import ChatInput from './input'
import { ChatType } from './chatType'

const PEER = 2
const ME = 1
const STATES = ['send', 'schedule', 'edit', 'record', 'record-video', 'forward', 'stop']

async function mountInput(type = ChatType.Chat) {
  useChatsStore.setState({ dialogs: [makeDialog({ peerId: PEER })], loaded: true })
  const messages = new Map<number, MyMessage>()
  const managers = {
    messages: {
      sendText: vi.fn(async() => ({ ok: true })),
      editMessage: vi.fn(async() => ({})),
      getMessageByPeer: vi.fn(async(_peerId: number, mid: number) => messages.get(mid)),
      reloadMessage: vi.fn(async(_peerId: number, mid: number) => messages.get(mid)),
    },
    drafts: { save: vi.fn(async() => ({ _: 'draftMessageEmpty' })) },
    realtime: { sendTyping: vi.fn(async() => ({ ok: true })) },
    groups: { setMute: vi.fn(async() => {}) },
    peers: { fillMirror: vi.fn(async() => {}) },
  }
  const container = document.createElement('div')
  const chat = {
    peerId: PEER,
    threadId: undefined as number | undefined,
    type,
    container,
    messagesStorageKey: winKey(PEER),
    isBroadcast: false,
    isBot: false,
    isForum: false,
    canSend: vi.fn(async() => true),
    updateChatInputHeight: vi.fn(),
    getMessage: (mid: number) => messages.get(mid),
    setMessageId: vi.fn(),
    bubbles: { onGoDownClick: vi.fn() },
    selection: { isSelecting: false },
    managers,
  }

  const appImManager = new EventListenerBase<{ peer_changing: (chat: unknown) => void }>()
  const input = new ChatInput(chat as never, appImManager as never, managers as never, 'chat-input-main')
  input.construct()
  input.constructPeerHelpers()
  container.append(input.chatInput)
  document.body.append(container)
  ;(await input.finishPeerChange({ peerId: PEER, middleware: () => true }))()

  return { input, chat, messages }
}

/** Состояния кнопки, выставленные сейчас (из набора tweb). */
const activeStates = (input: ChatInput) => STATES.filter((state) => input.btnSend.classList.contains(state))

let mounted: Awaited<ReturnType<typeof mountInput>> | undefined

beforeEach(async() => {
  const { default: rootScope } = await import('@lib/rootScope')
  rootScope.myId = ME
})

afterEach(() => {
  mounted?.input.destroy()
  mounted?.chat.container.remove()
  mounted = undefined
  useChatsStore.setState({ dialogs: [] })
})

describe('ChatInput: кнопка отправки', () => {
  it('узел tweb: `.btn-send-container > .btn-send` последним в строке, семь иконок в порядке оригинала', async() => {
    mounted = await mountInput()
    const { input } = mounted

    expect(input.btnSend.classList.contains('btn-circle')).toBe(true)
    expect(input.btnSend.classList.contains('animated-button-icon')).toBe(true)
    expect(input.btnSend.parentElement?.classList.contains('btn-send-container')).toBe(true)
    expect(input.btnSend.parentElement?.parentElement?.lastElementChild).toBe(input.btnSend.parentElement)

    const icons = [...input.btnSend.querySelectorAll('.animated-button-icon-icon')]
      .map((icon) => [...icon.classList].find((c) => c.startsWith('btn-send-icon-'))!.slice('btn-send-icon-'.length))
    expect(icons).toEqual(STATES)
  })

  it('пустое поле без рекордера — «отправить»', async() => {
    mounted = await mountInput()
    expect(activeStates(mounted.input)).toEqual(['send'])
    expect(mounted.input.btnSend.getAttribute('aria-label')).toBe(I18n.format('Send', true))
  })

  it('текст в поле — «отправить»', async() => {
    mounted = await mountInput()
    const { input } = mounted
    input.messageInputField.setValueSilently('привет')
    input.onMessageInput()
    expect(activeStates(input)).toEqual(['send'])
  })

  it('правка — «изменить», отмена правки возвращает «отправить»', async() => {
    mounted = await mountInput()
    const { input, messages } = mounted
    messages.set(7, { _: 'message', id: 7, peerId: PEER, fromId: ME, date: 1, message: 'старый', pFlags: {} } as MyMessage)

    await input.initMessageEditing(7)
    // tweb `setTopInfo` морфит кнопку следующим тиком (`setTimeout(updateSendBtn)`)
    await vi.waitFor(() => expect(activeStates(input)).toEqual(['edit']))
    expect(input.btnSend.getAttribute('aria-label')).toBe(I18n.format('Edit', true))

    input.clearHelper()
    await vi.waitFor(() => expect(activeStates(input)).toEqual(['send']))
  })

  it('отложенные — «запланировать»', async() => {
    mounted = await mountInput(ChatType.Scheduled)
    expect(activeStates(mounted.input)).toEqual(['schedule'])
    expect(mounted.input.btnSend.getAttribute('aria-label')).toBe(I18n.format('Chat.Send.ScheduledMessage', true))
  })
})
