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
import type { Dialog, DraftMessage, DraftMessageReal, MyMessage } from '@core/models'
import ChatInput from './input'
import { ChatType } from './chatType'

// Отказы сервера (правка, пересылка) показываются тостом, а не тонут.
const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(orig) => ({ ...(await orig<typeof import('@components/toast')>()), toastNew }))

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
      sendText: vi.fn(async(_args: Record<string, unknown>) => ({ ok: true })),
      editMessage: vi.fn(async() => ({})),
      forwardMessages: vi.fn(async() => []),
      getMessageByPeer: vi.fn(async(_peerId: number, mid: number) => messages.get(mid)),
      reloadMessage: vi.fn(async(_peerId: number, mid: number) => messages.get(mid)),
      sendPoll: vi.fn(),
    },
    drafts: { syncDraft: vi.fn(async() => true), getDraft: vi.fn(async(_peerId: number, _threadId: number): Promise<DraftMessageReal | undefined> => undefined), clearDraft: vi.fn() },
    realtime: { sendTyping: vi.fn(async() => ({ ok: true })) },
    chats: { createPrivate: vi.fn(async(id: number) => id) },
    dialogs: { refresh: vi.fn(async() => {}) },
    channels: { post: vi.fn(async() => ({})) },
    groups: { setMute: vi.fn(async() => {}) },
    stickers: { use: vi.fn(async() => {}), saveGif: vi.fn(async() => {}) },
    peers: { fillMirror: vi.fn(async() => {}) },
  }
}

async function mountInput(options: { draft?: DraftMessage, threadId?: number, threadDraft?: DraftMessageReal } = {}) {
  setDialog(options.draft)
  const messages = new Map<number, MyMessage>()
  const managers = makeManagers(messages)
  if(options.threadDraft) managers.drafts.getDraft.mockImplementation(async(_p, threadId) => threadId === options.threadId ? options.threadDraft : undefined)
  const appImManager = new EventListenerBase<{ peer_changing: (chat: unknown) => void }>()
  const container = document.createElement('div')
  const chat = {
    peerId: PEER,
    threadId: options.threadId,
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
    expect(managers.messages.editMessage).toHaveBeenCalledWith(PEER, 7, 'новый', undefined, {
      scheduleDate: undefined,
      // превью не решалось (ссылки нет) — tweb :4733-4739
      noWebPage: undefined, webPage: null, webPageOptions: {}, invertMedia: undefined,
    })
    expect(managers.messages.sendText).not.toHaveBeenCalled()
    expect(input.editMsgId).toBeUndefined()
  })

  // Ф-5, п. 3.2.4: правка текста отложенного — тот же `editMessage` с
  // `schedule_date = message.date` (tweb appMessagesManager.ts:2209).
  it('правка отложенного несёт его дату отправки как scheduleDate', async() => {
    mounted = await mountInput()
    const { input, managers, messages, chat } = mounted
    chat.type = ChatType.Scheduled
    messages.set(7, { ...message(7, 'старый', ME), date: 1_900_000_000, pFlags: { out: true, is_scheduled: true } } as MyMessage)

    await input.initMessageEditing(7)
    input.messageInputField.setValueSilently('новый')
    await input.sendMessage()

    expect(managers.messages.editMessage).toHaveBeenCalledWith(PEER, 7, 'новый', undefined, expect.objectContaining({ scheduleDate: 1_900_000_000 }))
  })

  // НО-7 (tweb input.ts:1744-1748): отложенное, которое правят, удалили или
  // опубликовали (в том числе с другого устройства) — правка закрывается.
  it('scheduled_delete правимого отложенного закрывает правку', async() => {
    mounted = await mountInput()
    const { input, messages, chat } = mounted
    chat.type = ChatType.Scheduled
    messages.set(7, { ...message(7, 'старый', ME), date: 1_900_000_000, pFlags: { out: true, is_scheduled: true } } as MyMessage)
    await input.initMessageEditing(7)
    expect(input.editMsgId).toBe(7)

    const { default: rootScope } = await import('@lib/rootScope')
    rootScope.dispatchEventSingle('scheduled_delete', { peerId: PEER, mids: [8] })
    expect(input.editMsgId).toBe(7)
    rootScope.dispatchEventSingle('scheduled_delete', { peerId: PEER, mids: [7] })
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
    expect(managers.messages.forwardMessages).toHaveBeenCalledWith(PEER, 10, [3, 4], { silent: undefined, threadId: null })
    expect(managers.messages.sendText).not.toHaveBeenCalled()
    expect(input.forwarding).toBeUndefined()
  })

  it('отказ пересылки (403/429/402) — тост, а не молчание', async() => {
    mounted = await mountInput()
    const { input, managers, messages } = mounted
    messages.set(3, message(3, 'раз'))
    managers.messages.forwardMessages.mockRejectedValueOnce(new Error('403'))
    toastNew.mockClear()

    input.initMessagesForward({ [10]: [3] })
    await vi.waitFor(() => expect(input.forwarding).toEqual({ [10]: [3] }))
    await input.sendMessage()

    await vi.waitFor(() => expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Error.AnError' }))
  })

  it('отказ правки — тост, а не молчание', async() => {
    mounted = await mountInput()
    const { input, managers, messages } = mounted
    messages.set(7, message(7, 'старый', ME))
    managers.messages.editMessage.mockRejectedValueOnce(new Error('403'))
    toastNew.mockClear()

    await input.initMessageEditing(7)
    await vi.waitFor(() => expect(input.btnSend.classList.contains('edit')).toBe(true))
    input.messageInputField.setValueSilently('новый')
    await input.sendMessage()

    await vi.waitFor(() => expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Error.AnError' }))
  })
})

describe('ChatInput: черновик', () => {
  it('смена пира сохраняет набранное (tweb peer_changing → saveDraft)', async() => {
    mounted = await mountInput()
    const { input, managers, appImManager, chat } = mounted

    input.messageInputField.setValueSilently('недописанное')
    appImManager.dispatchEvent('peer_changing', chat)

    expect(managers.drafts.syncDraft).toHaveBeenCalledTimes(1)
    expect(managers.drafts.syncDraft).toHaveBeenCalledWith({ peerId: PEER, threadId: undefined, localDraft: expect.objectContaining({ _: 'draftMessage', message: 'недописанное' }) })
  })

  it('равный черновику текст не пересохраняется', async() => {
    mounted = await mountInput({ draft: { _: 'draftMessage', message: 'есть', date: 1 } })
    const { input, managers, appImManager, chat } = mounted
    await vi.waitFor(() => expect(input.messageInput.textContent).toBe('есть'))

    appImManager.dispatchEvent('peer_changing', chat)
    expect(managers.drafts.syncDraft).not.toHaveBeenCalled()
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

    // новое сообщение пересобрало строку диалога раньше кадра очистки: тот же черновик
    // новым объектом не возвращается в поле (найдено на стенде П-6)
    setDialog({ _: 'draftMessage', message: 'привет', date: 1 })
    await flush()
    await flush()
    expect(input.isInputEmpty()).toBe(true)

    // сервер снял черновик своим кадром — поле так и остаётся пустым, лишнего save нет
    setDialog(undefined)
    await flush()
    expect(input.isInputEmpty()).toBe(true)
    expect(managers.drafts.syncDraft).not.toHaveBeenCalled()
  })

  it('черновик, приехавший кадром, встаёт в пустое поле', async() => {
    mounted = await mountInput()
    const { input } = mounted

    setDialog({ _: 'draftMessage', message: 'с другого устройства', date: 2 })
    await vi.waitFor(() => expect(input.messageInput.textContent).toBe('с другого устройства'))
  })
})

// Черновик ТРЕДА — 1:1 с tweb (расхождение 3 шапки): `appDraftsManager` воркера —
// `syncDraft` с `threadId` (input.ts:2331), `getDraft(peerId, threadId)` (:2424),
// `draft_updated` с `threadId` (:1711-1727), `clearDraft` при отправке (:2637-2642).
describe('ChatInput: черновик треда', () => {
  const THREAD = 0x100000000 + 10

  it('смена пира сохраняет черновик треда с `threadId`; ответ несёт `top_msg_id`', async() => {
    mounted = await mountInput({ threadId: THREAD })
    const { input, managers, appImManager, chat } = mounted
    mounted.messages.set(0x100000000 + 12, message(0x100000000 + 12, 'оригинал'))
    await input.initMessageReply({ replyToMsgId: 0x100000000 + 12 })
    input.messageInputField.setValueSilently('в теме')
    appImManager.dispatchEvent('peer_changing', chat)

    expect(managers.drafts.syncDraft).toHaveBeenCalledWith({
      peerId: PEER, threadId: THREAD,
      localDraft: expect.objectContaining({ message: 'в теме', reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 0x100000000 + 12, top_msg_id: THREAD } }),
    })
  })

  it('вход в тред восстанавливает его черновик, а не черновик чата', async() => {
    mounted = await mountInput({ threadId: THREAD, draft: { _: 'draftMessage', message: 'чат', date: 1 }, threadDraft: { _: 'draftMessage', message: 'тред', date: 1 } })
    await vi.waitFor(() => expect(mounted!.input.messageInput.textContent).toBe('тред'))
    expect(mounted.managers.drafts.getDraft).toHaveBeenCalledWith(PEER, THREAD)
  })

  it('`draft_updated` открытого треда встаёт в пустое поле; чужой тред — нет', async() => {
    mounted = await mountInput({ threadId: THREAD })
    const { input } = mounted
    const { default: rootScope } = await import('@lib/rootScope')

    rootScope.dispatchEventSingle('draft_updated', { peerId: PEER, threadId: THREAD + 1, draft: { _: 'draftMessage', message: 'чужой', date: 2 } })
    await flush()
    expect(input.isInputEmpty()).toBe(true)

    rootScope.dispatchEventSingle('draft_updated', { peerId: PEER, threadId: THREAD, draft: { _: 'draftMessage', message: 'с другого устройства', date: 2 } })
    await vi.waitFor(() => expect(input.messageInput.textContent).toBe('с другого устройства'))
  })

  it('черновик чата (зеркало) поле треда не трогает', async() => {
    mounted = await mountInput({ threadId: THREAD })
    setDialog({ _: 'draftMessage', message: 'чат', date: 2 })
    await flush()
    await flush()
    expect(mounted.input.isInputEmpty()).toBe(true)
  })

  it('отправка в тред снимает черновик треда местно (`clearDraft`)', async() => {
    mounted = await mountInput({ threadId: THREAD })
    const { input, managers } = mounted
    input.messageInputField.setValueSilently('ушло')
    await input.sendMessage()
    expect(managers.drafts.clearDraft).toHaveBeenCalledWith(PEER, THREAD)
  })
})
