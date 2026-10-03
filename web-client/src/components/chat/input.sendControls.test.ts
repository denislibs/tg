// Пины пачки П-6 «отправка» в `ChatInput` (`components/chat/input.ts`):
//  - меню отправки (`chat/sendContextMenu.ts`, tweb `sendContextMenu.ts`): пункты по
//    `setPeerParams` (расписание/напоминание/платный чат), «без звука» — один `sendText`
//    с `silent` и сброс флага (`resetSendingFlags`);
//  - расписание (tweb `scheduleSending`/`setScheduleTimestamp`): лента отложенных
//    открывает календарь вместо отправки, выбранное время уходит в `scheduleMessage`,
//    прошлое время — обычной отправкой;
//  - «отправить, когда будет в сети» (`canSendWhenOnline`);
//  - экран закрепов (Б-90): плашка «Открепить все»/«Скрыть закреплённые»;
//  - send-as (`chat/sendAs.ts`): одна личность — кнопки нет, две — аватарка, пакет
//    отправки несёт `sendAsPeerId`, плейсхолдер «Отправить анонимно».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import { getMiddleware } from '@helpers/middleware'
import I18n from '@lib/langPack'
import { useChatsStore } from '@stores/chatsStore'
import { winKey } from '@core/history/messagesMirror'
import { makeDialog } from '@core/dialogs/testDialog'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { MyMessage } from '@core/models'
import type { Chat as MTChat, UserReal } from '@core/peers/peer'
import { SEND_WHEN_ONLINE_TIMESTAMP } from '@core/format/dayLabel'
import { ChatType } from './chatType'

const scheduleSpy = vi.hoisted(() => ({ opts: undefined as undefined | { onPick: (ts: number, repeat: number | undefined, silent: boolean) => void, canSendWhenOnline?: boolean, initDate?: Date } }))
vi.mock('@components/popups/scheduleSendingPopup', () => ({
  default: (opts: NonNullable<typeof scheduleSpy.opts>) => { scheduleSpy.opts = opts },
}))
const pinSpy = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('@components/popups/unpinMessage', () => ({
  default: (...args: unknown[]) => { pinSpy.calls.push(args) },
}))

const { default: ChatInput } = await import('./input')

const ME = 1
const BOB = 2
const GROUP = -100
const CHANNEL = -300

function makeManagers() {
  return {
    messages: {
      sendText: vi.fn(async(_args: Record<string, unknown>) => ({ ok: true })),
      scheduleMessage: vi.fn(async(_peerId: number, _p: Record<string, unknown>) => ({})),
      getScheduledMessages: vi.fn(async() => [] as MyMessage[]),
      editMessage: vi.fn(async() => ({})),
      forwardMessages: vi.fn(async() => []),
      getMessageByPeer: vi.fn(async() => undefined),
      reloadMessage: vi.fn(async() => undefined),
      sendPoll: vi.fn(),
    },
    drafts: { save: vi.fn(async() => ({ _: 'draftMessageEmpty' })) },
    realtime: { sendTyping: vi.fn(async() => ({ ok: true })) },
    chats: {
      createPrivate: vi.fn(async(id: number) => id),
      getSendAs: vi.fn(async(_peerId: number) => ({ _: 'channels.sendAsPeers', peers: [] as { _: 'sendAsPeer', peer: unknown }[], chats: [], users: [] })),
    },
    dialogs: { refresh: vi.fn(async() => {}) },
    channels: { post: vi.fn(async() => ({})) },
    groups: { setMute: vi.fn(async() => {}) },
    stickers: { use: vi.fn(async() => {}), saveGif: vi.fn(async() => {}) },
    peers: { fillMirror: vi.fn(async() => {}) },
  }
}

async function mountInput(options: { peerId?: PeerId, type?: ChatType, managers?: ReturnType<typeof makeManagers> } = {}) {
  const peerId = options.peerId ?? BOB
  useChatsStore.setState({ dialogs: [makeDialog({ peerId })], loaded: true })
  const managers = options.managers ?? makeManagers()
  const appImManager = Object.assign(new EventListenerBase<{ peer_changing: (chat: unknown) => void }>(), {
    openScheduled: vi.fn(),
    setPeer: vi.fn(),
    chat: undefined,
  })
  const container = document.createElement('div')
  const chat = {
    peerId,
    threadId: undefined as number | undefined,
    type: options.type ?? ChatType.Chat,
    container,
    messagesStorageKey: winKey(peerId),
    isBroadcast: false,
    isBot: false,
    isForum: false,
    canSend: vi.fn(async() => true),
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

  return { input, chat, managers, appImManager }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Открыть меню отправки так, как его открывает пользователь (ПКМ по кнопке). */
async function openSendMenu(input: InstanceType<typeof ChatInput>) {
  input.btnSend.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await flush()
  return input.btnSendContainer.querySelector<HTMLElement>('.menu-send')!
}

function visibleItems(menu: HTMLElement) {
  return [...menu.querySelectorAll<HTMLElement>('.btn-menu-item')]
    .filter((item) => !item.classList.contains('hide'))
    .map((item) => item.querySelector('.btn-menu-item-text')?.textContent)
}

let mounted: Awaited<ReturnType<typeof mountInput>> | undefined

beforeEach(async() => {
  const { default: rootScope } = await import('@lib/rootScope')
  rootScope.myId = ME
  scheduleSpy.opts = undefined
  pinSpy.calls = []
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ME, first_name: 'Алиса', pFlags: { self: true } } as UserReal,
    { _: 'user', id: BOB, first_name: 'Боб', pFlags: {}, status: { _: 'userStatusOffline', was_online: 1000 } } as UserReal,
    { _: 'channel', id: 100, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } } as unknown as MTChat,
    { _: 'channel', id: 300, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true } } as unknown as MTChat,
  ] }])
})

afterEach(() => {
  mounted?.input.destroy()
  mounted?.chat.container.remove()
  mounted = undefined
  useChatsStore.setState({ dialogs: [], presence: {} })
  resetPeerMirror()
})

describe('ChatInput: меню отправки', () => {
  it('пустое поле — меню не открывается (гейт `onOpen`)', async() => {
    mounted = await mountInput()
    const menu = await openSendMenu(mounted.input)
    expect(menu.classList.contains('active')).toBe(false)
  })

  it('в чужом чате — «Без звука», «Запланировать», «Когда будет в сети»; в «Избранном» — «Напомнить»', async() => {
    mounted = await mountInput()
    mounted.input.messageInputField.setValueSilently('привет')
    let menu = await openSendMenu(mounted.input)
    expect(visibleItems(menu)).toEqual([
      I18n.format('Chat.Send.WithoutSound', true),
      I18n.format('Chat.Send.ScheduledMessage', true),
      I18n.format('Schedule.SendWhenOnline', true),
    ])
    mounted.input.destroy()
    mounted.chat.container.remove()

    mounted = await mountInput({ peerId: ME })
    mounted.input.messageInputField.setValueSilently('напомни')
    menu = await openSendMenu(mounted.input)
    expect(visibleItems(menu)).toEqual([I18n.format('Chat.Send.SetReminder', true)])
  })

  it('«Без звука» — один sendText с silent, следующая отправка уже без него', async() => {
    mounted = await mountInput()
    const { input, managers } = mounted
    input.messageInputField.setValueSilently('тихо')
    const menu = await openSendMenu(input)
    menu.querySelector<HTMLElement>('.btn-menu-item')!.click()
    await flush()

    expect(managers.messages.sendText).toHaveBeenCalledTimes(1)
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ text: 'тихо', silent: true })
    expect(input.sendSilent).toBeUndefined()

    input.messageInputField.setValueSilently('громко')
    await input.sendMessage()
    expect(managers.messages.sendText.mock.calls[1][0]).toMatchObject({ text: 'громко', silent: undefined })
  })
})

describe('ChatInput: расписание', () => {
  it('«Запланировать» — календарь, выбранное время уходит в scheduleMessage, sendText не зовётся, лента отложенных открывается', async() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 3, 12, 0))
    try {
      mounted = await mountInput()
      const { input, managers, appImManager } = mounted
      input.messageInputField.setValueSilently('потом')
      void input.scheduleSending()
      await flush()
      expect(scheduleSpy.opts).toBeDefined()

      const at = Math.floor(Date.now() / 1000) + 3600
      scheduleSpy.opts!.onPick(at, undefined, false)
      await flush()

      expect(managers.messages.sendText).not.toHaveBeenCalled()
      expect(managers.messages.scheduleMessage).toHaveBeenCalledTimes(1)
      expect(managers.messages.scheduleMessage.mock.calls[0]).toEqual([BOB, expect.objectContaining({ text: 'потом', sendAt: at, whenOnline: false })])
      expect(appImManager.openScheduled).toHaveBeenCalledWith(BOB)
      expect(input.scheduleDate).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('время в прошлом (≤ сейчас + 10 с) — обычная отправка (tweb `setScheduleTimestamp`)', async() => {
    mounted = await mountInput()
    const { input, managers } = mounted
    input.messageInputField.setValueSilently('сейчас')
    input.setScheduleTimestamp(Math.floor(Date.now() / 1000) + 5, () => void input.sendMessage(true))
    await flush()
    expect(managers.messages.scheduleMessage).not.toHaveBeenCalled()
    expect(managers.messages.sendText).toHaveBeenCalledTimes(1)
  })

  it('«Когда будет в сети» — whenOnline у scheduleMessage', async() => {
    mounted = await mountInput()
    const { input, managers } = mounted
    input.messageInputField.setValueSilently('когда появишься')
    input.setScheduleTimestamp(SEND_WHEN_ONLINE_TIMESTAMP, () => void input.sendMessage(true))
    await flush()
    expect(managers.messages.scheduleMessage.mock.calls[0][1]).toMatchObject({ text: 'когда появишься', whenOnline: true })
  })

  it('в ленте отложенных Enter открывает календарь, а не шлёт', async() => {
    mounted = await mountInput({ type: ChatType.Scheduled })
    const { input, managers } = mounted
    input.messageInputField.setValueSilently('в очередь')
    await input.sendMessage()
    expect(managers.messages.sendText).not.toHaveBeenCalled()
    expect(scheduleSpy.opts).toBeDefined()
  })

  it('canSendWhenOnline: не в сети и статус виден — да; онлайн, «Избранное», группа — нет', async() => {
    mounted = await mountInput()
    expect(mounted.input.canSendWhenOnline()).toBe(true)

    useChatsStore.setState({ presence: { [BOB]: { _: 'userStatusOnline', expires: 2_000_000_000 } } })
    expect(mounted.input.canSendWhenOnline()).toBe(false)

    useChatsStore.setState({ presence: { [BOB]: { _: 'userStatusRecently' } } })
    expect(mounted.input.canSendWhenOnline()).toBe(false)
    mounted.input.destroy()
    mounted.chat.container.remove()

    mounted = await mountInput({ peerId: ME })
    expect(mounted.input.canSendWhenOnline()).toBe(false)
  })

  it('кнопка «Отложенные» в строке — видна, когда у пира есть отложенные', async() => {
    const managers = makeManagers()
    managers.messages.getScheduledMessages.mockResolvedValue([{ _: 'message', id: 1, peerId: BOB, date: 1, message: 'x', pFlags: {} } as MyMessage])
    mounted = await mountInput({ managers })
    const btn = mounted.input.newMessageWrapper.querySelector('.btn-scheduled')!
    expect(btn.classList.contains('hide')).toBe(false)
    expect(btn.classList.contains('show')).toBe(true)
    ;(btn as HTMLElement).click()
    expect(mounted.appImManager.openScheduled).toHaveBeenCalledWith(BOB)
  })
})

describe('ChatInput: экран закрепов (Б-90)', () => {
  it('вместо поля — «Открепить все» (право закреплять), клик — попап открепления всех', async() => {
    mounted = await mountInput({ type: ChatType.Pinned })
    const { input } = mounted
    const button = input.chatInput.querySelector<HTMLElement>('.chat-input-control .chat-input-plate-button:not(.hide)')!
    expect(button.textContent).toBe(I18n.format('Chat.Input.UnpinAll', true))
    expect(input.chatInput.classList.contains('can-pin')).toBe(true)

    button.click()
    expect(pinSpy.calls[0]?.slice(0, 3)).toEqual([BOB, 0, true])
  })
})

describe('ChatInput: send-as', () => {
  it('одна личность — кнопки нет, пакет без sendAsPeerId', async() => {
    const managers = makeManagers()
    managers.chats.getSendAs.mockResolvedValue({ _: 'channels.sendAsPeers', peers: [{ _: 'sendAsPeer', peer: { _: 'peerUser', user_id: ME } }], chats: [], users: [] })
    mounted = await mountInput({ peerId: GROUP, managers })
    expect(managers.chats.getSendAs).toHaveBeenCalledWith(GROUP)
    expect(mounted.input.newMessageWrapper.querySelector('.new-message-send-as-container')).toBeNull()
    expect(mounted.input.getMessageSendingParams().sendAsPeerId).toBeNull()
  })

  it('две личности — аватарка в строке, по умолчанию — первая (сам), выбор канала уходит в пакет и плейсхолдер', async() => {
    const managers = makeManagers()
    managers.chats.getSendAs.mockResolvedValue({ _: 'channels.sendAsPeers', peers: [
      { _: 'sendAsPeer', peer: { _: 'peerUser', user_id: ME } },
      { _: 'sendAsPeer', peer: { _: 'peerChannel', channel_id: 300 } },
    ], chats: [], users: [] })
    mounted = await mountInput({ peerId: GROUP, managers })
    const { input } = mounted

    const container = input.newMessageWrapper.querySelector('.new-message-send-as-container')
    expect(container).not.toBeNull()
    expect(input.newMessageWrapper.dataset.offset).toBe('as')
    expect(input.sendAsPeerId).toBe(ME)
    expect(input.getMessageSendingParams().sendAsPeerId).toBeNull()

    void (input as unknown as { sendAs: { changeSendAsPeerId(id: PeerId): Promise<void> } }).sendAs.changeSendAsPeerId(CHANNEL)
    expect(input.getMessageSendingParams().sendAsPeerId).toBe(CHANNEL)
    expect((await input.getPlaceholderParams(true)).key).toBe('SendAnonymously')
  })
})
