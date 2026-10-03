// Попапы действий над сообщением (П-5, Б-28): каждое действие — ОДИН правильный
// RPC с правильными полями. Попапы гоняются настоящими классами
// (`PopupPeer`/`PopupElement`) на DOM; подменены только менеджеры
// (`startClient().managers`) и React-хост моста пересылки (`popupStore`).
//
//   • `popups/deleteMessages.ts`  — tweb `popups/deleteMessages.ts`;
//   • `popups/unpinMessage.ts`    — tweb `popups/unpinMessage.ts`;
//   • `popups/forward.bridge.ts`  — tweb `popups/forward.tsx` (ВРЕМЕННО до 2C-24);
//   • `popups/reportAd.bridge.ts` — tweb `popups/reportAd.tsx` (ВРЕМЕННО до 2C-27).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import rootScope from '@lib/rootScope'
import type { MyMessage } from '@core/models'
import { ChatType } from '@components/chat/chatType'
import { useReportStore } from '@stores/reportStore'

const managers = vi.hoisted(() => ({
  peers: { fillMirror: vi.fn(async() => {}) },
  messages: {
    deleteMessages: vi.fn(async() => {}),
    pin: vi.fn(async() => {}),
    unpin: vi.fn(async() => {}),
    forwardMessages: vi.fn(async() => []),
  },
}))
vi.mock('@/client/bootstrap', () => ({ startClient: () => ({ managers }) }))

// Мост пересылки открывает React-`ForwardPicker` через `popupStore`; здесь
// важен не пикер, а что мост делает с выбором — его `onPick` берётся из рендера.
const picker = vi.hoisted(() => ({ onPick: undefined as undefined | ((peerIds: number[]) => void), chatRightsActions: undefined as unknown }))
vi.mock('@stores/popupStore', () => ({
  openPopup: (render: (api: { destroy: () => void }) => { props: { onPick: (ids: number[]) => void, chatRightsActions: unknown } }) => {
    const element = render({ destroy: () => {} })
    picker.onPick = element.props.onPick
    picker.chatRightsActions = element.props.chatRightsActions
    return 1
  },
}))

const im = vi.hoisted(() => ({
  chat: {
    peerId: 5,
    getMessage: (mid: number) => ({ _: 'message', id: mid, peerId: 5, pFlags: {}, message: 't' }),
    input: { initMessagesForward: vi.fn() },
  },
  setInnerPeer: vi.fn(async() => {}),
}))
vi.mock('@lib/appImManager', () => ({ default: im }))

const toasts = vi.hoisted(() => ({ toastNew: vi.fn() }))
vi.mock('@components/toast', () => toasts)

const { default: showDeleteMessagesPopup } = await import('./deleteMessages')
const { default: showPinMessagePopup } = await import('./unpinMessage')
const { default: showForwardPopup } = await import('./forward.bridge')
const { showMessageReport } = await import('./reportAd.bridge')

const USER = 5
const CHANNEL = -7
const MEGAGROUP = -9

function message(id: number, extra: Partial<MyMessage> = {}): MyMessage {
  return { _: 'message', id, peerId: USER, fromId: USER, pFlags: {}, date: 0, message: 'x', ...extra } as MyMessage
}

function click(selector: string) {
  const el = document.querySelector<HTMLElement>(selector)
  expect(el, selector).not.toBeNull()
  el!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
}

beforeEach(() => {
  resetPeerMirror()
  rootScope.myId = 1
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: USER, first_name: 'Bob', pFlags: {} } as never,
    { _: 'channel', id: 7, title: 'ch', pFlags: { broadcast: true }, date: 0 } as never,
    { _: 'channel', id: 9, title: 'gr', pFlags: { megagroup: true }, date: 0 } as never,
  ] }])
  Object.values(managers.messages).forEach((fn) => fn.mockClear())
  im.setInnerPeer.mockClear()
  im.chat.input.initMessagesForward.mockClear()
  toasts.toastNew.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('showDeleteMessagesPopup (tweb popups/deleteMessages.ts)', () => {
  it('личка: чекбокс «Also delete for Bob»; без отметки — deleteMessages(…, false) одним вызовом', () => {
    const onConfirm = vi.fn()
    showDeleteMessagesPopup(USER, [1], ChatType.Chat, onConfirm, (mid) => message(mid))

    expect(document.querySelector('.popup')!.classList.contains('popup-delete-chat')).toBe(true)
    expect(document.querySelector('.popup-title')!.textContent).toBe('Delete message')
    expect(document.querySelector('.checkbox-caption')!.textContent).toBe('Also delete for Bob')

    click('.popup-buttons > button.danger')

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(managers.messages.deleteMessages).toHaveBeenCalledTimes(1)
    expect(managers.messages.deleteMessages).toHaveBeenCalledWith(USER, [1], false)
  })

  it('личка: отмеченный чекбокс — удалить у обоих (revoke)', () => {
    showDeleteMessagesPopup(USER, [1, 2], ChatType.Chat, undefined, (mid) => message(mid))
    expect(document.querySelector('.popup-title')!.textContent).toBe('Delete 2 messages')

    document.querySelector<HTMLElement>('.checkbox-field-input')!.click()
    click('.popup-buttons > button.danger')

    expect(managers.messages.deleteMessages).toHaveBeenCalledTimes(1)
    expect(managers.messages.deleteMessages).toHaveBeenCalledWith(USER, [1, 2], true)
  })

  it('канал: чекбокса нет, удаление всегда у всех (:177)', () => {
    showDeleteMessagesPopup(CHANNEL, [3], ChatType.Chat, undefined, (mid) => message(mid, { peerId: CHANNEL }))
    expect(document.querySelector('.checkbox-field-input')).toBeNull()

    click('.popup-buttons > button.danger')

    expect(managers.messages.deleteMessages).toHaveBeenCalledWith(CHANNEL, [3], true)
  })

  it('мегагруппа: описание «для всех» (:93-96), удаление у всех', () => {
    showDeleteMessagesPopup(MEGAGROUP, [4], ChatType.Chat, undefined, (mid) => message(mid, { peerId: MEGAGROUP }))
    expect(document.querySelector('.popup-description')!.textContent).toBe('Are you sure you want to delete this message for everyone?')

    click('.popup-buttons > button.danger')

    expect(managers.messages.deleteMessages).toHaveBeenCalledWith(MEGAGROUP, [4], true)
  })

  it('«Отмена» ничего не удаляет и onConfirm не зовёт', () => {
    const onConfirm = vi.fn()
    showDeleteMessagesPopup(USER, [1], ChatType.Chat, onConfirm)
    click('.popup-buttons > button:not(.danger)')

    expect(managers.messages.deleteMessages).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('showPinMessagePopup (tweb popups/unpinMessage.ts)', () => {
  it('закрепить в личке: «Pin message», кнопка «Pin» шлёт ОДИН pin через 300 мс (:24)', () => {
    vi.useFakeTimers()
    showPinMessagePopup(USER, 11)
    expect(document.querySelector('.popup-title')!.textContent).toBe('Pin message')
    expect(document.querySelector('.popup-description')!.textContent).toBe('Do you want to pin this message at the top of the chat?')

    click('.popup-buttons > button.primary')
    expect(managers.messages.pin).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)

    expect(managers.messages.pin).toHaveBeenCalledTimes(1)
    expect(managers.messages.pin).toHaveBeenCalledWith(USER, 11)
    expect(managers.messages.unpin).not.toHaveBeenCalled()
  })

  it('закрепить в канале — описание канала (:84)', () => {
    showPinMessagePopup(CHANNEL, 2)
    expect(document.querySelector('.popup-description')!.textContent).toBe('Do you want to pin this message in this channel?')
  })

  it('открепить: danger-кнопка «Unpin» шлёт ОДИН unpin', () => {
    vi.useFakeTimers()
    showPinMessagePopup(MEGAGROUP, 8, true)
    expect(document.querySelector('.popup-title')!.textContent).toBe('Unpin message')

    click('.popup-buttons > button.danger')
    vi.advanceTimersByTime(300)

    expect(managers.messages.unpin).toHaveBeenCalledTimes(1)
    expect(managers.messages.unpin).toHaveBeenCalledWith(MEGAGROUP, 8)
    expect(managers.messages.pin).not.toHaveBeenCalled()
  })
})

describe('showForwardPopup — мост (tweb popups/forward.tsx, ВРЕМЕННО до 2C-24)', () => {
  it('один получатель: открыть его чат и поставить плашку пересылки, без RPC (:203-205)', async() => {
    await showForwardPopup({ [USER]: [1, 2] })
    picker.onPick!([42])
    await vi.waitFor(() => expect(im.chat.input.initMessagesForward).toHaveBeenCalledTimes(1))

    expect(im.setInnerPeer).toHaveBeenCalledWith({ peerId: 42 })
    expect(im.chat.input.initMessagesForward).toHaveBeenCalledWith({ [USER]: [1, 2] })
    expect(managers.messages.forwardMessages).not.toHaveBeenCalled()
  })

  it('несколько получателей: по ОДНОЙ пересылке каждому и тост (:350-390)', async() => {
    const onSelect = vi.fn()
    await showForwardPopup({ [USER]: [3] }, onSelect)
    picker.onPick!([42, 43])
    await vi.waitFor(() => expect(toasts.toastNew).toHaveBeenCalledTimes(1))

    expect(managers.messages.forwardMessages.mock.calls).toEqual([[42, USER, [3]], [43, USER, [3]]])
    expect(onSelect.mock.calls).toEqual([[42], [43]])
    expect(im.setInnerPeer).not.toHaveBeenCalled()
    expect(toasts.toastNew.mock.calls[0][0].langPackKey).toBe('FwdMessageTo')
  })

  it('«Избранное» одним получателем — сразу пересылка и тост «в Избранное» (:355-358, :368-371)', async() => {
    await showForwardPopup({ [USER]: [3, 4] })
    picker.onPick!([rootScope.myId])
    await vi.waitFor(() => expect(toasts.toastNew).toHaveBeenCalledTimes(1))

    expect(managers.messages.forwardMessages).toHaveBeenCalledWith(rootScope.myId, USER, [3, 4])
    expect(toasts.toastNew).toHaveBeenCalledWith({ langPackKey: 'FwdMessagesToSavedMessages' })
  })

  it('права получателя выводятся из пересылаемых сообщений (:99-102)', async() => {
    await showForwardPopup({ [USER]: [1] })
    expect(picker.chatRightsActions).toEqual(['send_messages'])
  })
})

describe('showMessageReport — мост (tweb reportAd.tsx:360, ВРЕМЕННО до 2C-27)', () => {
  it('кладёт цель жалобы (первое сообщение) в reportStore — её берёт ReportPopup', () => {
    const onFinish = vi.fn()
    showMessageReport(CHANNEL, [5, 6], onFinish)
    expect(useReportStore.getState().target).toEqual({ peerId: CHANNEL, msgId: 5 })
    expect(onFinish).toHaveBeenCalledTimes(1)
    useReportStore.getState().close()
  })
})
