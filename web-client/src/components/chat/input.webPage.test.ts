// Ф-5 C2 (Б-72): плашка превью ссылки над полем ввода — порт tweb
// `components/chat/input.ts` `processWebPage` (:3533-3631), меню плашки
// (:799-851), крестик (:4124-4141), поля отправки и правки (:4690-4741).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import { getMiddleware } from '@helpers/middleware'
import { useChatsStore } from '@stores/chatsStore'
import { winKey } from '@core/history/messagesMirror'
import { makeDialog } from '@core/dialogs/testDialog'
import type { MyMessage } from '@core/models'
import type { WebPage } from '@core/media/messageMedia'
import ChatInput from './input'
import { ChatType } from './chatType'

const PEER = 2
const ME = 1
const URL1 = 'https://example.com/a'
const URL2 = 'https://example.org/b'

const card = (url: string, over: Partial<WebPage> = {}): WebPage => ({
  _: 'webPage', pFlags: {}, url, display_url: url.replace('https://', ''), site_name: 'Example', title: 'Title', ...over,
})

async function mountInput(getWebPage: (url: string) => Promise<WebPage | undefined>) {
  useChatsStore.setState({ dialogs: [makeDialog({ peerId: PEER })], loaded: true })
  const messages = new Map<number, MyMessage>()
  const managers = {
    messages: {
      getScheduledMessages: vi.fn(async() => [] as MyMessage[]),
      sendText: vi.fn(async(_args: Record<string, unknown>) => ({ ok: true })),
      editMessage: vi.fn(async(..._args: unknown[]) => ({})),
      getMessageByPeer: vi.fn(async(_peerId: number, mid: number) => messages.get(mid)),
    },
    webPages: { getWebPage: vi.fn(getWebPage) },
    drafts: { save: vi.fn(async() => ({ _: 'draftMessageEmpty' })) },
    realtime: { sendTyping: vi.fn(async() => ({ ok: true })) },
    chats: { createPrivate: vi.fn(async(id: number) => id) },
    dialogs: { refresh: vi.fn(async() => {}) },
    channels: { post: vi.fn(async() => ({})) },
    peers: { fillMirror: vi.fn(async() => {}) },
  }
  const container = document.createElement('div')
  const chat = {
    peerId: PEER, threadId: undefined, type: ChatType.Chat, container,
    messagesStorageKey: winKey(PEER), isBroadcast: false, isBot: false, isForum: false,
    canSend: vi.fn(async() => true),
    updateChatInputHeight: vi.fn(),
    getMessage: (mid: number) => messages.get(mid),
    setMessageId: vi.fn(),
    bubbles: { onGoDownClick: vi.fn(), getMiddleware: () => () => true },
    destroyMiddlewareHelper: getMiddleware(),
    selection: { isSelecting: false },
    managers,
  }
  const appImManager = new EventListenerBase<{ peer_changing: (chat: unknown) => void }>()
  const input = new ChatInput(chat as never, appImManager as never, managers as never, 'chat-input-main')
  input.construct()
  input.constructPeerHelpers()
  container.append(input.chatInput)
  document.body.append(container)
  const callback = await input.finishPeerChange({ peerId: PEER, middleware: () => true })
  callback()
  return { input, chat, managers, messages }
}

const flush = async() => { for(let i = 0; i < 5; ++i) await new Promise<void>((r) => setTimeout(r, 0)) }

async function type(input: ChatInput, text: string) {
  input.messageInputField.setValueSilently(text)
  input.onMessageInput()
  await flush()
}

/** меню плашки — узлы, которые строит `constructWebPageElements` (tweb :799-851) */
function menu(input: ChatInput) {
  const els = (input as unknown as { webPageElements: Record<'above' | 'below' | 'larger' | 'smaller', { element: HTMLElement, checkboxField: { input: HTMLInputElement } }> & { container: HTMLElement } }).webPageElements
  return els
}

const plateTitle = (input: ChatInput) => input.chat.container.querySelector('.reply-wrapper .reply-title')?.textContent

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

describe('ChatInput: плашка превью ссылки', () => {
  it('первая http(s)-ссылка текста → getWebPage → плашка; отправка несёт карточку (tweb :3594-3609, :4692-4696)', async() => {
    mounted = await mountInput(async(url) => card(url))
    const { input, managers, chat } = mounted
    await type(input, 'смотри ' + URL1 + ' и ' + URL2)

    expect(managers.webPages.getWebPage).toHaveBeenCalledTimes(1)
    expect(managers.webPages.getWebPage).toHaveBeenCalledWith(URL1)
    expect(chat.container.classList.contains('is-helper-active')).toBe(true)
    expect(plateTitle(input)).toBe('Example')
    expect(input.helperType).toBeUndefined()

    // повторный ввод с той же ссылкой — без запроса (tweb :3579-3581)
    await type(input, 'смотри ' + URL1 + ' и ' + URL2 + '!')
    expect(managers.webPages.getWebPage).toHaveBeenCalledTimes(1)

    await input.sendMessage()
    expect(managers.messages.sendText).toHaveBeenCalledWith(expect.objectContaining({
      webPage: card(URL1), webPageOptions: { optional: true }, invertMedia: false,
    }))
    expect(managers.messages.sendText.mock.calls[0][0].noWebPage).toBeUndefined()
  })

  it('без карточки (webPageEmpty/429) плашки нет, отправка без решения', async() => {
    mounted = await mountInput(async() => undefined)
    const { input, managers, chat } = mounted
    await type(input, URL1)
    expect(chat.container.classList.contains('is-helper-active')).toBe(false)
    await input.sendMessage()
    expect(managers.messages.sendText).toHaveBeenCalledWith(expect.objectContaining({ webPage: null, noWebPage: undefined }))
  })

  it('крестик плашки → noWebPage, плашка снята, та же ссылка больше не запрашивается (tweb :4124-4141)', async() => {
    mounted = await mountInput(async(url) => card(url))
    const { input, managers, chat } = mounted
    await type(input, URL1)
    expect(input.willSendWebPage).not.toBeNull()

    ;(chat.container.querySelector('.reply-cancel') as HTMLElement).click()
    await flush()

    expect(input.willSendWebPage).toBeNull()
    expect(chat.container.classList.contains('is-helper-active')).toBe(false)
    await type(input, URL1 + ' ')
    expect(managers.webPages.getWebPage).toHaveBeenCalledTimes(1)

    await input.sendMessage()
    expect(managers.messages.sendText).toHaveBeenCalledWith(expect.objectContaining({ noWebPage: true, webPage: null }))
  })

  it('ссылку стёрли — плашка снята, крестик сброшен (tweb :3546-3558)', async() => {
    mounted = await mountInput(async(url) => card(url))
    const { input, chat } = mounted
    await type(input, URL1)
    await type(input, 'без ссылки')
    expect(input.willSendWebPage).toBeNull()
    expect(input.lastUrl).toBe('')
    expect(chat.container.classList.contains('is-helper-active')).toBe(false)
  })

  it('меню: «выше» → invertMedia; группа размера скрыта без has_large_media (tweb :826-838, :3619)', async() => {
    mounted = await mountInput(async(url) => card(url))
    const { input, managers } = mounted
    await type(input, URL1)
    const m = menu(input)
    expect(m.below.checkboxField.input.checked).toBe(true)
    expect(m.larger.element.parentElement!.classList.contains('hide')).toBe(true)

    m.container.classList.add('active')
    m.above.element.click()
    expect(input.invertMedia).toBe(true)

    await input.sendMessage()
    expect(managers.messages.sendText).toHaveBeenCalledWith(expect.objectContaining({ invertMedia: true }))
  })

  it('меню: с has_large_media «мельче» → smallMedia (tweb :834-839)', async() => {
    mounted = await mountInput(async(url) => card(url, { pFlags: { has_large_media: true } }))
    const { input, managers } = mounted
    await type(input, URL1)
    const m = menu(input)
    expect(m.larger.element.parentElement!.classList.contains('hide')).toBe(false)
    expect(m.larger.checkboxField.input.checked).toBe(true)

    m.container.classList.add('active')
    m.smaller.element.click()
    await input.sendMessage()
    expect(managers.messages.sendText).toHaveBeenCalledWith(expect.objectContaining({
      webPageOptions: { optional: true, largeMedia: false, smallMedia: true },
    }))
  })

  it('отказ ручки (429) по новой ссылке: показанная плашка остаётся, no_webpage не уходит (tweb :3594-3631)', async() => {
    let fail = false
    mounted = await mountInput(async(url) => fail ? null as never : card(url))
    const { input, managers, chat } = mounted
    await type(input, URL1)
    expect(input.willSendWebPage).not.toBeNull()

    fail = true
    await type(input, URL2)
    expect(chat.container.classList.contains('is-helper-active')).toBe(true)
    expect(input.willSendWebPage).not.toBeNull()

    await input.sendMessage()
    const args = managers.messages.sendText.mock.calls[0][0]
    expect(args.noWebPage).toBeUndefined()
    // запрос «в полёте» по tweb не сбрасывается — карточку выбирает сервер
    expect(args.webPage).toBeUndefined()
  })

  it('длинный текст: карточка снимается у всех частей, если её ссылки нет в первой (tweb :2679-2683, :2848-2856)', async() => {
    mounted = await mountInput(async(url) => card(url))
    const { input, managers } = mounted
    await type(input, 'а'.repeat(4096) + ' ' + URL1)
    expect(input.willSendWebPage).not.toBeNull()
    await input.sendMessage()
    const calls = managers.messages.sendText.mock.calls.map((c) => c[0])
    expect(calls.length).toBe(2)
    expect(calls.every((c) => c.webPage === undefined)).toBe(true)
  })

  it('«Убрать превью» в меню — то же, что крестик (tweb :817-823)', async() => {
    mounted = await mountInput(async(url) => card(url))
    const { input } = mounted
    await type(input, URL1)
    const m = menu(input)
    m.container.classList.add('active')
    ;(m.container.querySelector('.btn-menu-item.danger') as HTMLElement).click()
    await flush()
    expect(input.willSendWebPage).toBeNull()
  })
})

describe('ChatInput: превью ссылки при правке', () => {
  const editable = (over: Record<string, unknown> = {}): MyMessage => ({
    _: 'message', id: 7, peerId: PEER, fromId: ME, date: 1, message: 'было ' + URL1,
    pFlags: { out: true, invert_media: true },
    media: { _: 'messageMediaWebPage', pFlags: { force_small_media: true }, webpage: card(URL1, { pFlags: { has_large_media: true } }) },
    ...over,
  } as MyMessage)

  it('ссылка и «над/мельче» берутся из сообщения; правка несёт карточку и выбор (tweb :3538-3542, :3612-3627, :4733-4739)', async() => {
    mounted = await mountInput(async(url) => card(url, { pFlags: { has_large_media: true } }))
    const { input, managers, messages } = mounted
    messages.set(7, editable())
    await input.initMessageEditing(7)
    await flush()

    expect(managers.webPages.getWebPage).toHaveBeenCalledWith(URL1)
    const m = menu(input)
    expect(m.above.checkboxField.input.checked).toBe(true)
    expect(m.smaller.checkboxField.input.checked).toBe(true)
    expect(input.invertMedia).toBe(true)
    expect(input.helperType).toBe('edit')

    input.messageInputField.setValueSilently('стало ' + URL1)
    await input.sendMessage()
    expect(managers.messages.editMessage).toHaveBeenCalledWith(PEER, 7, 'стало ' + URL1, undefined, expect.objectContaining({
      webPage: expect.objectContaining({ url: URL1 }),
      invertMedia: true,
      webPageOptions: { optional: true, smallMedia: true },
    }))
  })

  it('крестик во время правки возвращает плашку правки и снимает превью (no_webpage)', async() => {
    mounted = await mountInput(async(url) => card(url))
    const { input, managers, messages, chat } = mounted
    messages.set(7, editable({ pFlags: { out: true } }))
    await input.initMessageEditing(7)
    await flush()
    expect(input.willSendWebPage).not.toBeNull()

    ;(chat.container.querySelector('.reply-cancel') as HTMLElement).click()
    await flush()
    expect(input.helperType).toBe('edit')
    expect(input.willSendWebPage).toBeNull()

    await input.sendMessage()
    expect(managers.messages.editMessage).toHaveBeenCalledWith(PEER, 7, expect.any(String), undefined, expect.objectContaining({ noWebPage: true, webPage: null }))
  })

  it('правка добавляет превью сообщению без карточки', async() => {
    mounted = await mountInput(async(url) => card(url))
    const { input, managers, messages } = mounted
    messages.set(7, editable({ message: 'без ссылки', media: undefined, pFlags: { out: true } }))
    await input.initMessageEditing(7)
    await type(input, 'теперь ' + URL2)
    expect(managers.webPages.getWebPage).toHaveBeenCalledWith(URL2)
    await input.sendMessage()
    expect(managers.messages.editMessage).toHaveBeenCalledWith(PEER, 7, 'теперь ' + URL2, undefined, expect.objectContaining({
      webPage: expect.objectContaining({ url: URL2 }), invertMedia: false,
    }))
  })
})
