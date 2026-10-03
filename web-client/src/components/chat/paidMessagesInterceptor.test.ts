// Ветки порта tweb `chat/paidMessagesInterceptor.ts`: нет платы / мало звёзд /
// «не спрашивать» / подтверждение с чекбоксом / отказ, плюс статический путь (без
// чекбокса). Попап подтверждения — настоящий (`popups/popupPeer.ts::confirmationPopup`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { setAppState, useAppStateStore } from '@stores/appState'
import { initialState } from '@core/state/state'

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', () => ({ toastNew }))
vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { peers: { fillMirror: async() => {} } } }),
}))

import PaidMessagesInterceptor, { PAYMENT_REJECTED } from './paidMessagesInterceptor'

const CHAT_ID = 400
const PEER_ID: PeerId = -CHAT_ID

function putChannel(stars?: number, admin?: boolean) {
  applyPeerOps([{ op: 'upsert', peers: [{
    _: 'channel', id: CHAT_ID, title: 'Платная', photo: { _: 'chatPhotoEmpty' }, date: 0,
    pFlags: { megagroup: true },
    ...(stars ? { send_paid_messages_stars: stars } : {}),
    ...(admin ? { admin_rights: { _: 'chatAdminRights', pFlags: {} } } : {}),
  }] }])
}

const click = (selector: string) => document.querySelector<HTMLElement>(selector)!.dispatchEvent(
  new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }),
)
const confirmButton = '.popup-confirmation .popup-button' // первая — подтверждение, «Отмена» после
const cancelButton = '.popup-confirmation .popup-button:last-child'
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let interceptor: PaidMessagesInterceptor
beforeEach(() => {
  useAppStateStore.setState(initialState())
  setAppState('starsBalance', 100)
  interceptor = new PaidMessagesInterceptor({ peerId: PEER_ID })
})

afterEach(() => {
  document.body.replaceChildren()
  resetPeerMirror()
  vi.clearAllMocks()
})

describe('PaidMessagesInterceptor.prepareStarsForPayment (экземпляр)', () => {
  it('платы нет — undefined, без попапа', async() => {
    putChannel()
    expect(await interceptor.prepareStarsForPayment(1)).toBeUndefined()
    expect(document.querySelector('.popup-confirmation')).toBeNull()
  })

  it('зритель — админ: платы нет (appChatsManager.getStarsAmount — !chat.admin_rights)', async() => {
    putChannel(5, true)
    expect(await interceptor.prepareStarsForPayment(1)).toBeUndefined()
  })

  it('мало звёзд на все сообщения — PAYMENT_REJECTED и тост вместо попапа покупки', async() => {
    putChannel(30)
    expect(await interceptor.prepareStarsForPayment(4)).toBe(PAYMENT_REJECTED)
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Stars.Subscription.MissingBalance' })
    expect(document.querySelector('.popup-confirmation')).toBeNull()
  })

  it('подтверждение: описание по числу сообщений, кнопка «Pay for N messages»', async() => {
    putChannel(10)
    const promise = interceptor.prepareStarsForPayment(3)
    await flush()

    const root = document.querySelector('.popup-confirmation')!
    expect(root.querySelector('.popup-title')!.textContent).toBe('Confirm Payment')
    expect(root.querySelector('.popup-description')!.textContent)
      .toBe('Платная charges 10 Stars per incoming message. Would you like to pay 30 Stars to send 3 messages?')
    expect(root.querySelector('.popup-button')!.textContent).toBe('Pay for 3 messages')
    expect(root.querySelector('.checkbox-field .checkbox-caption')!.textContent).toBe('Don\'t ask again')

    click(confirmButton)
    expect(await promise).toEqual({ starsAmount: 10, canUndo: false })
    expect(useAppStateStore.getState().dontShowPaidMessageWarningFor).toEqual([])
  })

  it('«Больше не спрашивать» отмечен — пир в dontShowPaidMessageWarningFor, следующий раз без попапа', async() => {
    putChannel(10)
    const promise = interceptor.prepareStarsForPayment(1)
    await flush()

    expect(document.querySelector('.popup-confirmation .popup-description')!.textContent)
      .toBe('Платная charges 10 Stars per incoming message. Would you like to pay 10 Stars to send one message?')
    document.querySelector<HTMLInputElement>('.popup-confirmation .checkbox-field-input')!.click()
    click(confirmButton)
    expect(await promise).toEqual({ starsAmount: 10, canUndo: false })
    expect(useAppStateStore.getState().dontShowPaidMessageWarningFor).toEqual([PEER_ID])

    document.body.replaceChildren()
    expect(await interceptor.prepareStarsForPayment(2)).toEqual({ starsAmount: 10, canUndo: false })
    expect(document.querySelector('.popup-confirmation')).toBeNull()
  })

  it('отказ в попапе — PAYMENT_REJECTED', async() => {
    putChannel(10)
    const promise = interceptor.prepareStarsForPayment(1)
    await flush()

    click(cancelButton)
    expect(await promise).toBe(PAYMENT_REJECTED)
  })
})

describe('PaidMessagesInterceptor.prepareStarsForPayment (статический, вне чата)', () => {
  it('спрашивает всегда и без чекбокса — даже если пир в «не спрашивать»', async() => {
    putChannel(10)
    setAppState('dontShowPaidMessageWarningFor', [PEER_ID])
    const promise = PaidMessagesInterceptor.prepareStarsForPayment({ peerId: PEER_ID, messageCount: 1 })
    await flush()

    expect(document.querySelector('.popup-confirmation')).not.toBeNull()
    expect(document.querySelector('.popup-confirmation .checkbox-field')).toBeNull()
    click(confirmButton)
    expect(await promise).toEqual({ starsAmount: 10, canUndo: false })
  })

  it('мало звёзд — PAYMENT_REJECTED', async() => {
    putChannel(500)
    expect(await PaidMessagesInterceptor.prepareStarsForPayment({ peerId: PEER_ID, messageCount: 1 })).toBe(PAYMENT_REJECTED)
    expect(toastNew).toHaveBeenCalledTimes(1)
  })
})
