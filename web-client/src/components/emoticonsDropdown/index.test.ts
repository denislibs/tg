// Пины эмодзи-дропдауна (`components/emoticonsDropdown`, порт tweb `emoticonsDropdown/**`, П-6)
// на настоящей строке ввода (`ChatInput`): кнопка `.toggle-emoticons` открывает и закрывает
// панель; клик по эмодзи вставляет его в поле (`onEmojiSelected` → `insertAtCaret`); стикер и
// GIF из панели уходят в чат одним `messages.sendText`; свой эмодзи встаёт в поле сущностью
// `messageEntityCustomEmoji` и оживает в слое рендерера над полем (Б-74); без права на медиа
// вкладка стикеров не открывается; «стереть» снимает символ перед кареткой.
//
// happy-dom не раскладывает страницу: наблюдатель видимости заменён «всё видно сразу» (иначе
// категории панели так и остались бы пустыми), `execCommand('insertHTML')` — минимальной
// вставкой в точку выделения (как в `inputField.test.ts`); анимации выключены режимом
// «Энергосбережение» (`liteMode.all`) — событий конца перехода happy-dom не шлёт, а без них
// слайдер вкладок не доигрывает смену вкладки (у оригинала — так же).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import { useChatsStore } from '@stores/chatsStore'
import { winKey } from '@core/history/messagesMirror'
import { makeDialog } from '@core/dialogs/testDialog'
import type { Dialog } from '@core/models'
import type { MyDocument } from '@core/media/messageMedia'
import getRichValueWithCaret from '@helpers/dom/getRichValueWithCaret'
import { hideToast } from '@components/toast'

const PEER = 2
const ME = 1

const sticker = (id: number, emoji = '😀'): MyDocument => ({
  _: 'document', id, mime_type: 'application/x-tgsticker', size: 1, attributes: [],
  type: 'sticker', sticker: 2, animated: true, w: 512, h: 512, stickerEmojiRaw: emoji,
} as MyDocument)

const gif = (id: number): MyDocument => ({
  _: 'document', id, mime_type: 'video/mp4', size: 10, attributes: [], type: 'gif', w: 200, h: 100,
} as MyDocument)

const managers = {
  messages: {
    sendText: vi.fn(async(_args: Record<string, unknown>) => ({ ok: true })),
    editMessage: vi.fn(async() => ({})),
  },
  drafts: { save: vi.fn(async() => ({ _: 'draftMessageEmpty' })) },
  realtime: { sendTyping: vi.fn(async() => ({ ok: true })) },
  chats: { createPrivate: vi.fn(async(id: number) => id) },
  dialogs: { refresh: vi.fn(async() => {}) },
  peers: { fillMirror: vi.fn(async() => {}) },
  docs: { getDoc: vi.fn(async() => undefined) },
  stickers: {
    use: vi.fn(async() => {}),
    saveGif: vi.fn(async() => {}),
    recent: vi.fn(async(): Promise<MyDocument[]> => [sticker(101)]),
    faved: vi.fn(async(): Promise<MyDocument[]> => []),
    mySets: vi.fn(async() => [{ _: 'stickerSet', id: 7, title: 'Мои эмодзи', short_name: 'mine', count: 1, pFlags: { emojis: true } }]),
    getStickerSet: vi.fn(async() => ({ set: { _: 'stickerSet', id: 7, title: 'Мои эмодзи', short_name: 'mine', count: 1 }, stickers: [sticker(777, '🔥')] })),
    savedGifs: vi.fn(async(): Promise<MyDocument[]> => [gif(501)]),
    searchGifs: vi.fn(async() => ({ gifs: [], next: '' })),
    searchByEmoji: vi.fn(async(): Promise<MyDocument[]> => []),
    clearRecent: vi.fn(async() => {}),
  },
}

vi.mock('@/client/bootstrap', () => ({ startClient: () => ({ managers }) }))

class VisibleIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    const rect = target.getBoundingClientRect()
    queueMicrotask(() => this.callback([{
      target,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: rect,
      intersectionRect: rect,
      rootBounds: rect,
      time: 0,
    } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
  }
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

function stubInsertHTML() {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    writable: true,
    value: vi.fn((command: string, _showUI?: boolean, value?: string) => {
      if(command !== 'insertHTML') return false
      const selection = document.getSelection()!
      const range = selection.getRangeAt(0)
      const template = document.createElement('template')
      template.innerHTML = value!
      const last = template.content.lastChild
      range.deleteContents()
      range.insertNode(template.content)
      if(last) {
        range.setStartAfter(last)
        range.collapse(true)
      }
      const target = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement) as HTMLElement
      target.closest('[contenteditable="true"]')!.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }),
  })
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(get: () => T | null | undefined, timeout = 2000, what = get.toString()): Promise<T> {
  const start = Date.now()
  for(;;) {
    const value = get()
    if(value) return value
    if(Date.now() - start > timeout) throw new Error('waitFor: timeout — ' + what)
    await wait(10)
  }
}

let input: import('@components/chat/input').default
let chatContainer: HTMLElement
let dropdown: import('@components/emoticonsDropdown').EmoticonsDropdown

beforeAll(async() => {
  const { useSettingsStore } = await import('@/settings')
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver)
  stubInsertHTML()

  const { default: rootScope } = await import('@lib/rootScope')
  rootScope.myId = ME
  useChatsStore.setState({
    me: { user: { _: 'user', id: ME, first_name: 'Me', pFlags: { premium: true } } } as never,
    dialogs: [{ ...makeDialog({ peerId: PEER }) } as Dialog],
    loaded: true,
  })

  const { default: ChatInput } = await import('@components/chat/input')
  const { ChatType } = await import('@components/chat/chatType')
  const appImManager = new EventListenerBase<{ peer_changing: (chat: unknown) => void }>()
  chatContainer = document.createElement('div')
  const chat = {
    peerId: PEER,
    threadId: undefined as number | undefined,
    type: ChatType.Chat,
    container: chatContainer,
    messagesStorageKey: winKey(PEER),
    isBroadcast: false,
    isBot: false,
    isForum: false,
    canSend: vi.fn(async() => true),
    updateChatInputHeight: vi.fn(),
    getMessage: () => undefined,
    setMessageId: vi.fn(),
    bubbles: { onGoDownClick: vi.fn() },
    selection: { isSelecting: false },
    managers,
  }

  input = new ChatInput(chat as never, appImManager as never, managers as never, 'chat-input-main')
  input.construct()
  input.constructPeerHelpers()
  chatContainer.append(input.chatInput)
  document.body.append(chatContainer)
  const callback = await input.finishPeerChange({ peerId: PEER, middleware: () => true })
  callback()

  dropdown = input.emoticonsDropdown
  dropdown.chatInput = input
}, 60_000)

afterAll(() => {
  vi.unstubAllGlobals()
  chatContainer?.remove()
})

beforeEach(() => {
  managers.messages.sendText.mockClear()
})

afterEach(async() => {
  await dropdown.toggle(false)
  await wait(250)
  input.messageInputField.setValueSilently('')
})

const openDropdown = async() => {
  input.btnToggleEmoticons!.click()
  await waitFor(() => dropdown.isActive())
}

const selectTab = async(name: 'emoji' | 'stickers' | 'gifs') => {
  ;(dropdown.getElement().querySelector(`.emoji-tabs-${name}`) as HTMLElement).click()
  await wait(300)
}

describe('эмодзи-дропдаун: открытие и закрытие', () => {
  it('кнопка .toggle-emoticons открывает панель в строке ввода и закрывает повторным кликом', async() => {
    const button = input.btnToggleEmoticons!
    expect(button.classList.contains('toggle-emoticons')).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('false')

    await openDropdown()
    const element = dropdown.getElement()
    expect(element.parentElement).toBe(input.chatInput)
    expect(element.style.display).toBe('')
    expect(button.classList.contains('active')).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    // три вкладки и нижний ряд tweb: поиск · эмодзи · стикеры · GIF · стереть
    expect(element.querySelectorAll('.tabs-container > .tabs-tab.emoticons-container')).toHaveLength(3)
    expect(Array.from(element.querySelectorAll('.emoji-tabs > .menu-horizontal-div-item'), (el) => el.className.match(/emoji-tabs-(\w+)/)![1]))
    .toEqual(['search', 'emoji', 'stickers', 'gifs', 'delete'])

    button.click()
    await waitFor(() => !dropdown.isActive())
    expect(button.classList.contains('active')).toBe(false)
    await wait(250)
    expect(element.style.display).toBe('none')
  })
})

describe('эмодзи-дропдаун: вставка и отправка', () => {
  it('клик по эмодзи вставляет его в поле ввода', async() => {
    await openDropdown()
    const cell = await waitFor(() => dropdown.getElement().querySelector<HTMLElement>('#content-emoji .super-emoji-regular[data-emoji="😀"]'))
    cell.click()
    await waitFor(() => input.messageInput.textContent!.includes('😀') || input.messageInput.querySelector('img.emoji'))
    expect(getRichValueWithCaret(input.messageInput, false, false).value).toBe('😀')
  })

  it('«стереть» снимает символ перед кареткой', async() => {
    input.messageInputField.setValueSilently('аб')
    await openDropdown()
    ;(dropdown.getElement().querySelector('.emoji-tabs-delete') as HTMLElement).click()
    expect(getRichValueWithCaret(input.messageInput, false, false).value).toBe('а')
  })

  it('стикер из вкладки стикеров уходит в чат одним sendText и закрывает панель', async() => {
    await openDropdown()
    await selectTab('stickers')
    const cell = await waitFor(() => dropdown.getElement().querySelector<HTMLElement>('#content-stickers .super-sticker[data-doc-id="101"]'))
    cell.click()
    await waitFor(() => managers.messages.sendText.mock.calls.length)
    expect(managers.messages.sendText).toHaveBeenCalledTimes(1)
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ peerId: PEER, mediaId: 101, type: 'sticker' })
    await waitFor(() => !dropdown.isActive())
  })

  it('GIF из вкладки GIF уходит в чат одним sendText', async() => {
    await openDropdown()
    await selectTab('gifs')
    const cell = await waitFor(() => dropdown.getElement().querySelector<HTMLElement>('#content-gifs .gif[data-doc-id="501"]'))
    cell.click()
    await waitFor(() => managers.messages.sendText.mock.calls.length)
    expect(managers.messages.sendText).toHaveBeenCalledTimes(1)
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ peerId: PEER, mediaId: 501, type: 'video' })
  })

  it('без права на медиа вкладка стикеров не открывается', async() => {
    const checkRights = () => (dropdown as unknown as { checkRights: () => Promise<void> }).checkRights()
    // только права панели — строка ввода спрашивает тот же `chat.canSend` и заперла бы себя
    // eslint-disable-next-line typescript/unbound-method -- мок, `this` не читается
    vi.mocked(input.chat.canSend).mockResolvedValueOnce(false)
    await checkRights()
    await openDropdown()
    await selectTab('stickers')
    expect(dropdown.getElement().querySelector('.emoji-tabs-emoji')!.classList.contains('active')).toBe(true)
    // тост «нельзя» держит перехват клика по оверлею (`overlayClickHandler`) — снять до соседнего теста
    hideToast()
    await checkRights()
  })
})

describe('эмодзи-дропдаун: свои эмодзи (Б-74)', () => {
  it('свой эмодзи встаёт в поле сущностью и оживает в слое рендерера над полем', async() => {
    await openDropdown()
    await selectTab('emoji')
    const cell = await waitFor(() => dropdown.getElement().querySelector<HTMLElement>('#content-emoji .super-emoji-custom .custom-emoji[data-doc-id="777"]'))
    cell.click()
    const placeholder = await waitFor(() => input.messageInput.querySelector<HTMLImageElement>('img.custom-emoji-placeholder'))
    expect(placeholder.dataset.docId).toBe('777')
    expect(getRichValueWithCaret(input.messageInput, true, false).entities).toEqual([
      expect.objectContaining({ _: 'messageEntityCustomEmoji', document_id: '777', offset: 0 }),
    ])

    const layer = input.messageInput.nextElementSibling as HTMLElement
    expect(layer.classList.contains('custom-emoji-renderer')).toBe(true)
    expect(layer.querySelector('.custom-emoji[data-doc-id="777"]')).not.toBeNull()
    // в самом поле — только плейсхолдер
    expect(input.messageInput.querySelector('.custom-emoji')).toBeNull()
  })
})
