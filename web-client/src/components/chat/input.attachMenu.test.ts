// Меню вложений `ChatInput` (`components/chat/input.ts`, tweb `input.ts:1115-1352`):
// кнопка-скрепка `attach-menu-button`, пункты с `verify` по виду чата и
// правке, выбор файла (`onAttachClick` → `fileInput` → попап медиа) и опрос с
// проверкой права. Попапы — мосты в React (Р-2), здесь они подменены.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import { getMiddleware } from '@helpers/middleware'
import I18n from '@lib/langPack'
import { useChatsStore } from '@stores/chatsStore'
import { winKey } from '@core/history/messagesMirror'
import { makeDialog } from '@core/dialogs/testDialog'
import type { MyMessage } from '@core/models'
import { filterButtonMenuItems } from '@components/buttonMenuToggle'
import type { ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import { ChatType } from './chatType'

const newMedia = vi.hoisted(() => ({
  show: vi.fn(),
  current: undefined as { addFiles: (files: File[]) => void } | undefined,
}))
vi.mock('@components/popups/newMedia', () => ({
  default: newMedia.show,
  getCurrentNewMediaPopup: () => newMedia.current,
}))
const openCreatePollPopup = vi.hoisted(() => vi.fn())
vi.mock('@components/popups/createPoll.bridge', () => ({ openCreatePollPopup }))
const showChecklistPopup = vi.hoisted(() => vi.fn())
vi.mock('@components/popups/checklist.bridge', () => ({ default: showChecklistPopup }))
const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@components/toast')>()),
  toastNew,
}))

const { default: ChatInput } = await import('./input')

const ME = 1
const USER = 2
const GROUP = -5

async function mountInput(peerId: PeerId, options: { canSend?: boolean, isBot?: boolean } = {}) {
  useChatsStore.setState({ dialogs: [makeDialog({ peerId })], loaded: true })
  const messages = new Map<number, MyMessage>()
  const managers = {
    messages: {
      getScheduledMessages: vi.fn(async() => [] as MyMessage[]),
      sendText: vi.fn(async() => ({ ok: true })),
      editMessage: vi.fn(async() => ({})),
      sendPoll: vi.fn(async() => ({})),
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
    peerId,
    threadId: undefined as number | undefined,
    type: ChatType.Chat,
    container,
    messagesStorageKey: winKey(peerId),
    isBroadcast: false,
    isBot: !!options.isBot,
    isForum: false,
    canSend: vi.fn(async() => options.canSend ?? true),
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
  ;(await input.finishPeerChange({ peerId, middleware: () => true }))()

  return { input, chat, managers, messages }
}

type Mounted = Awaited<ReturnType<typeof mountInput>>

/** Пункты меню — закрытое поле класса, как у tweb (`input.ts:247`). */
const buttonsOf = (input: Mounted['input']) =>
  (input as unknown as { attachMenuButtons: ButtonMenuItemOptionsVerifiable[] }).attachMenuButtons

/** Ключи видимых пунктов — как их отбирает `ButtonMenuToggle` на открытии. */
async function visibleItems(input: Mounted['input']) {
  const visible = await filterButtonMenuItems(buttonsOf(input))
  return visible.map((button) => button.text)
}

function itemByText(input: Mounted['input'], text: string) {
  return buttonsOf(input).find((button) => button.text === text)!
}

let mounted: Mounted | undefined

beforeEach(async() => {
  const { default: rootScope } = await import('@lib/rootScope')
  rootScope.myId = ME
  newMedia.show.mockReset()
  newMedia.current = undefined
  openCreatePollPopup.mockReset()
  showChecklistPopup.mockReset()
  toastNew.mockReset()
})

afterEach(() => {
  mounted?.input.destroy()
  mounted?.chat.container.remove()
  mounted = undefined
  useChatsStore.setState({ dialogs: [] })
})

describe('ChatInput: меню вложений', () => {
  it('скрепка — `attach-menu-button` tweb первым в строке ввода', async() => {
    mounted = await mountInput(USER)
    const { attachMenu } = mounted.input

    expect(attachMenu.tagName.toLowerCase()).toBe('attach-menu-button')
    for(const className of ['btn-menu-toggle', 'btn-icon', 'attach-file']) {
      expect(attachMenu.classList.contains(className)).toBe(true)
    }
    expect(attachMenu.getAttribute('aria-label')).toBe(I18n.format('Chat.Input.Attach', true))
    expect(attachMenu.querySelector('.tgico.button-icon')).not.toBeNull()
    expect(attachMenu.parentElement?.firstElementChild).toBe(attachMenu)
  })

  it('личка: фото/видео, файл, чек-лист — опроса нет', async() => {
    mounted = await mountInput(USER)
    expect(await visibleItems(mounted.input)).toEqual([
      'Chat.Input.Attach.PhotoOrVideo',
      'Chat.Input.Attach.Document',
      'Checklist',
    ])
  })

  it('группа и бот: опрос есть', async() => {
    mounted = await mountInput(GROUP)
    expect(await visibleItems(mounted.input)).toEqual([
      'Chat.Input.Attach.PhotoOrVideo',
      'Chat.Input.Attach.Document',
      'Poll',
      'Checklist',
    ])
    mounted.input.destroy()
    mounted.chat.container.remove()

    mounted = await mountInput(USER, { isBot: true })
    expect(await visibleItems(mounted.input)).toContain('Poll')
  })

  it('на правке сообщения пунктов нет', async() => {
    mounted = await mountInput(GROUP)
    const { input, messages } = mounted
    messages.set(7, { _: 'message', id: 7, peerId: GROUP, fromId: ME, date: 1, message: 'текст', pFlags: {} } as MyMessage)
    await input.initMessageEditing(7)
    expect(await visibleItems(input)).toEqual([])
  })

  it('«Фото или видео» выбирает картинки и видео как медиа, «Файл» — любой файл документом', async() => {
    mounted = await mountInput(USER)
    const { input } = mounted
    const click = vi.spyOn(input.fileInput, 'click').mockImplementation(() => {})

    await Promise.resolve(itemByText(input, 'Chat.Input.Attach.PhotoOrVideo').onClick!(new MouseEvent('click')))
    const accept = input.fileInput.getAttribute('accept')!.split(', ')
    expect(accept).toEqual(expect.arrayContaining(['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime']))
    expect(input.willAttachType).toBe('media')

    await Promise.resolve(itemByText(input, 'Chat.Input.Attach.Document').onClick!(new MouseEvent('click')))
    expect(input.fileInput.hasAttribute('accept')).toBe(false)
    expect(input.willAttachType).toBe('document')
    expect(click).toHaveBeenCalledTimes(2)
  })

  it('выбранные файлы открывают попап медиа, а в открытый попап дописываются', async() => {
    mounted = await mountInput(USER)
    const { input, chat } = mounted
    vi.spyOn(input.fileInput, 'click').mockImplementation(() => {})
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const pick = () => {
      Object.defineProperty(input.fileInput, 'files', { value: [file], configurable: true })
      input.fileInput.dispatchEvent(new Event('change'))
    }

    await Promise.resolve(itemByText(input, 'Chat.Input.Attach.Document').onClick!(new MouseEvent('click')))
    pick()
    expect(newMedia.show).toHaveBeenCalledWith(chat, [file], 'document')

    const addFiles = vi.fn()
    newMedia.current = { addFiles }
    pick()
    expect(addFiles).toHaveBeenCalledWith([file])
    expect(newMedia.show).toHaveBeenCalledTimes(1)
  })

  it('опрос: без права — тост и без попапа; с правом — попап, отправка с пакетом параметров', async() => {
    mounted = await mountInput(GROUP, { canSend: false })
    await Promise.resolve(itemByText(mounted.input, 'Poll').onClick!(new MouseEvent('click')))
    expect(toastNew).toHaveBeenCalledTimes(1)
    expect(openCreatePollPopup).not.toHaveBeenCalled()
    mounted.input.destroy()
    mounted.chat.container.remove()

    mounted = await mountInput(GROUP)
    const { input, managers } = mounted
    await Promise.resolve(itemByText(input, 'Poll').onClick!(new MouseEvent('click')))
    expect(openCreatePollPopup).toHaveBeenCalledTimes(1)

    const payload = { question: 'Вопрос?', options: ['да', 'нет'], anonymous: true, multiple: false, quiz: false }
    openCreatePollPopup.mock.calls[0][0].onSubmit(payload)
    expect(managers.messages.sendPoll).toHaveBeenCalledTimes(1)
    expect(managers.messages.sendPoll.mock.calls[0]).toEqual([GROUP, expect.objectContaining({
      ...payload,
      clientMsgId: expect.any(String),
      replyToMsgId: null,
    })])
  })

  it('чек-лист открывает попап для чата', async() => {
    mounted = await mountInput(USER)
    await Promise.resolve(itemByText(mounted.input, 'Checklist').onClick!(new MouseEvent('click')))
    expect(showChecklistPopup).toHaveBeenCalledWith({ chat: mounted.chat })
  })
})
