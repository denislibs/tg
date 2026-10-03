// Пины ядра `ChatInput` (`components/chat/input.ts`, порт tweb `chat/input.ts`, шаг К-4):
// отправка текста, ответ, правка, пересылка — ровно ОДИН вызов менеджера с правильными
// полями; черновик сохраняется на смене пира и восстанавливается на `finishPeerChange`;
// отправленный текст не возвращается из прежнего черновика зеркала (расхождение 3 шапки).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import { getMiddleware } from '@helpers/middleware'
import { useChatsStore } from '@stores/chatsStore'
import { winKey } from '@core/history/messagesMirror'
import { makeDialog } from '@core/dialogs/testDialog'
import type { Dialog, DraftMessage, MyMessage } from '@core/models'
import ChatInput from './input'
import { ChatType } from './chatType'

const PEER = 2
const ME = 1

const message = (id: number, text: string, fromId = PEER): MyMessage => ({
  _: 'message', id, peerId: PEER, fromId, date: 1, message: text, pFlags: {},
} as MyMessage)

function setDialog(draft?: DraftMessage) {
  const dialog: Dialog = { ...makeDialog({ peerId: PEER }), draft }
  useChatsStore.setState({ dialogs: [dialog], loaded: true })
}

function makeManagers(messages: Map<number, MyMessage>) {
  return {
    messages: {
      getScheduledMessages: vi.fn(async() => [] as MyMessage[]),
      scheduleMessage: vi.fn(async() => ({})),
      sendText: vi.fn(async(_args: Record<string, unknown>) => ({ ok: true })),
      editMessage: vi.fn(async() => ({})),
      forwardMessages: vi.fn(async() => []),
      getMessageByPeer: vi.fn(async(_peerId: number, mid: number) => messages.get(mid)),
      reloadMessage: vi.fn(async(_peerId: number, mid: number) => messages.get(mid)),
      sendPoll: vi.fn(),
    },
    drafts: { save: vi.fn(async() => ({ _: 'draftMessageEmpty' })) },
    realtime: { sendTyping: vi.fn(async() => ({ ok: true })) },
    chats: { createPrivate: vi.fn(async(id: number) => id) },
    dialogs: { refresh: vi.fn(async() => {}) },
    channels: { post: vi.fn(async() => ({})) },
    groups: { setMute: vi.fn(async() => {}) },
    stickers: { use: vi.fn(async() => {}), saveGif: vi.fn(async() => {}) },
    peers: { fillMirror: vi.fn(async() => {}) },
  }
}

async function mountInput(options: { draft?: DraftMessage } = {}) {
  setDialog(options.draft)
  const messages = new Map<number, MyMessage>()
  const managers = makeManagers(messages)
  const appImManager = new EventListenerBase<{ peer_changing: (chat: unknown) => void }>()
  const container = document.createElement('div')
  const chat = {
    peerId: PEER,
    threadId: undefined as number | undefined,
    type: ChatType.Chat,
    container,
    messagesStorageKey: winKey(PEER),
    isBroadcast: false,
    isBot: false,
    isForum: false,
    canSend: vi.fn(async() => true),
    updateChatInputHeight: vi.fn(),
    getMessage: (mid: number) => messages.get(mid),
    setMessageId: vi.fn(),
    bubbles: { onGoDownClick: vi.fn(), getMiddleware: () => () => true },
    destroyMiddlewareHelper: getMiddleware(),
    selection: { isSelecting: false },
    managers,
  }

  const input = new ChatInput(chat as never, appImManager as never, managers as never, 'chat-input-main')
  input.construct()
  input.constructPeerHelpers()
  container.append(input.chatInput)
  document.body.append(container)

  const callback = await input.finishPeerChange({ peerId: PEER, middleware: () => true })
  callback()

  return { input, chat, managers, messages, appImManager }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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

describe('ChatInput: отправка', () => {
  it('текст с разметкой — один sendText, маркеры разобраны, поле очищено', async() => {
    mounted = await mountInput()
    const { input, managers } = mounted

    input.messageInputField.setValueSilently('**жирный** текст')
    await input.sendMessage()

    expect(managers.messages.sendText).toHaveBeenCalledTimes(1)
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({
      peerId: PEER,
      text: 'жирный текст',
      entities: [{ _: 'messageEntityBold', offset: 0, length: 6 }],
      replyToMsgId: null,
    })
    expect(managers.messages.editMessage).not.toHaveBeenCalled()
    await flush()
    expect(input.isInputEmpty()).toBe(true)
  })

  it('пустое поле ничего не шлёт', async() => {
    mounted = await mountInput()
    await mounted.input.sendMessage()
    expect(mounted.managers.messages.sendText).not.toHaveBeenCalled()
  })

  it('ответ: плашка ставится, отправка уходит с replyToMsgId, плашка гаснет', async() => {
    mounted = await mountInput()
    const { input, managers, messages, chat } = mounted
    messages.set(5, message(5, 'оригинал'))

    await input.initMessageReply(input.getChatInputReplyToFromMessage(messages.get(5)!))
    expect(input.helperType).toBe('reply')
    expect(chat.container.classList.contains('is-helper-active')).toBe(true)

    input.messageInputField.setValueSilently('ответ')
    await input.sendMessage()

    expect(managers.messages.sendText).toHaveBeenCalledTimes(1)
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ peerId: PEER, text: 'ответ', replyToMsgId: 5 })
    expect(input.helperType).toBeUndefined()
    expect(input.replyToMsgId).toBeUndefined()
    expect(chat.container.classList.contains('is-helper-active')).toBe(false)
  })

  it('правка: текст сообщения в поле, отправка — один editMessage, без sendText', async() => {
    mounted = await mountInput()
    const { input, managers, messages } = mounted
    messages.set(7, message(7, 'старый', ME))

    await input.initMessageEditing(7)
    expect(input.editMsgId).toBe(7)
    expect(input.messageInput.textContent).toBe('старый')
    // tweb `setTopInfo` морфит кнопку следующим тиком (`setTimeout(updateSendBtn)`, :5419)
    await vi.waitFor(() => expect(input.btnSend.classList.contains('edit')).toBe(true))

    input.messageInputField.setValueSilently('новый')
    await input.sendMessage()

    expect(managers.messages.editMessage).toHaveBeenCalledTimes(1)
    expect(managers.messages.editMessage).toHaveBeenCalledWith(PEER, 7, 'новый', undefined)
    expect(managers.messages.sendText).not.toHaveBeenCalled()
    expect(input.editMsgId).toBeUndefined()
  })

  it('пересылка: пустое поле — один forwardMessages из исходного чата', async() => {
    mounted = await mountInput()
    const { input, managers, messages } = mounted
    messages.set(3, message(3, 'раз'))
    messages.set(4, message(4, 'два'))

    input.initMessagesForward({ [10]: [3, 4] })
    await vi.waitFor(() => expect(input.forwarding).toEqual({ [10]: [3, 4] }))
    expect(input.helperType).toBe('forward')

    await input.sendMessage()

    expect(managers.messages.forwardMessages).toHaveBeenCalledTimes(1)
    expect(managers.messages.forwardMessages).toHaveBeenCalledWith(PEER, 10, [3, 4], {})
    expect(managers.messages.sendText).not.toHaveBeenCalled()
    expect(input.forwarding).toBeUndefined()
  })
})

describe('ChatInput: черновик', () => {
  it('смена пира сохраняет набранное (tweb peer_changing → saveDraft)', async() => {
    mounted = await mountInput()
    const { input, managers, appImManager, chat } = mounted

    input.messageInputField.setValueSilently('недописанное')
    appImManager.dispatchEvent('peer_changing', chat)

    expect(managers.drafts.save).toHaveBeenCalledTimes(1)
    expect(managers.drafts.save).toHaveBeenCalledWith(PEER, 'недописанное', null, undefined)
  })

  it('равный черновику текст не пересохраняется', async() => {
    mounted = await mountInput({ draft: { _: 'draftMessage', message: 'есть', date: 1 } })
    const { input, managers, appImManager, chat } = mounted
    await vi.waitFor(() => expect(input.messageInput.textContent).toBe('есть'))

    appImManager.dispatchEvent('peer_changing', chat)
    expect(managers.drafts.save).not.toHaveBeenCalled()
  })

  it('finishPeerChange восстанавливает черновик диалога в поле', async() => {
    mounted = await mountInput({ draft: { _: 'draftMessage', message: 'из черновика', date: 1 } })
    await vi.waitFor(() => expect(mounted!.input.messageInput.textContent).toBe('из черновика'))
  })

  it('отправленный текст не возвращается из прежнего черновика зеркала', async() => {
    mounted = await mountInput({ draft: { _: 'draftMessage', message: 'привет', date: 1 } })
    const { input, managers } = mounted
    await vi.waitFor(() => expect(input.messageInput.textContent).toBe('привет'))

    await input.sendMessage()
    expect(managers.messages.sendText).toHaveBeenCalledTimes(1)

    await flush()
    await flush()
    expect(input.isInputEmpty()).toBe(true)

    // сервер снял черновик своим кадром — поле так и остаётся пустым, лишнего save нет
    setDialog(undefined)
    await flush()
    expect(input.isInputEmpty()).toBe(true)
    expect(managers.drafts.save).not.toHaveBeenCalled()
  })

  it('черновик, приехавший кадром, встаёт в пустое поле', async() => {
    mounted = await mountInput()
    const { input } = mounted

    setDialog({ _: 'draftMessage', message: 'с другого устройства', date: 2 })
    await vi.waitFor(() => expect(input.messageInput.textContent).toBe('с другого устройства'))
  })
})
