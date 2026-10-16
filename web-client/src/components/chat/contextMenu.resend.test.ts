// Пункт «Resend» меню сообщения — tweb 812502980 `chat/contextMenu.ts:1390-1395`
// (`handleRepay` :2394-2404): повторная ОПЛАТА неудавшегося платного сообщения.
// Виден только у сообщения с `repayRequest`; клик спрашивает согласие на плату
// (`prepareStarsForPayment(messageCount)`) и зовёт `confirmRepayRequest`.
// Меню поднимается настоящим, как в `contextMenu.statistics.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatContextMenu, { type ContextMenuManagers } from './contextMenu'
import type Chat from './chat'
import { attachTestSelection, createTestChat, fakeMenuAppConfig } from './testChat'
import contextMenuController from '@helpers/contextMenuController'
import { putMirrorPage, resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { Channel } from '@core/peers/peer'
import type { MyMessage } from '@core/models'
import { PAYMENT_REJECTED } from '@components/chat/paidMessagesInterceptor'

const GROUP: PeerId = -100
const KEY = 'win'

const group = (id: number): Channel => ({
  _: 'channel', id, title: 'G' + id, photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true },
  default_banned_rights: { _: 'chatBannedRights', pFlags: {}, until_date: 0 },
} as Channel)

function failed(id: number, repayRequest?: { id: number, messageCount: number, starsAmount?: number }): MyMessage {
  return {
    _: 'message', id, pFlags: { out: true }, peerId: GROUP,
    peer_id: { _: 'peerChannel', channel_id: 100 }, date: 1700000000, message: 'привет',
    failed: true, ...(repayRequest ? { repayRequest } : {}),
  } as MyMessage
}

function makeBubble(mid: number) {
  const bubble = document.createElement('div')
  bubble.classList.add('bubble', 'is-out')
  bubble.dataset.mid = String(mid)
  bubble.dataset.peerId = String(GROUP)
  const content = document.createElement('div')
  content.classList.add('bubble-content')
  bubble.append(content)
  return { bubble, content }
}

const confirmRepayRequest = vi.fn()
const managers = {
  messages: {
    votePoll: vi.fn(), closePoll: vi.fn(), viewers: vi.fn().mockResolvedValue([]),
    setFactCheck: vi.fn(), removeFactCheck: vi.fn(),
    confirmRepayRequest,
  },
  chats: { getReadDate: vi.fn().mockResolvedValue(null) },
  appConfig: fakeMenuAppConfig(),
} satisfies ContextMenuManagers

const prepareStarsForPayment = vi.fn()
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const items = () => Array.from(document.getElementById('bubble-contextmenu')?.querySelectorAll<HTMLElement>('.btn-menu-item') ?? [])
const resendItem = () => items().find((item) => item.querySelector('.btn-menu-item-text')?.textContent === 'Resend')

let container: HTMLElement

async function openOn(message: MyMessage) {
  putMirrorPage(KEY, [message])
  const { bubble, content } = makeBubble(message.id)
  container.append(bubble)
  const chat: Chat = createTestChat({ peerId: GROUP, messagesStorageKey: KEY, isMegagroup: true, input: { paidMessageInterceptor: { prepareStarsForPayment } } })
  attachTestSelection(chat, { getRenderedHistory: () => [], getBubble: () => undefined, getBubbleGroupedItems: () => [] })
  const menu = new ChatContextMenu(chat, managers)
  menu.attachTo(container)
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pageX', { value: 10 })
  Object.defineProperty(e, 'pageY', { value: 10 })
  content.dispatchEvent(e)
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMessagesMirror()
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [group(100)] }])
  document.body.innerHTML = ''
  container = document.createElement('div')
  container.classList.add('bubbles-inner')
  document.body.append(container)
})

afterEach(() => { contextMenuController.close() })

describe('«Resend» в меню сообщения (Ф7-Г)', () => {
  it('у сообщения с repayRequest пункт есть; клик платит за messageCount и подтверждает запрос', async () => {
    prepareStarsForPayment.mockResolvedValue({ starsAmount: 6, canUndo: false })
    await openOn(failed(7.0001, { id: 3, messageCount: 2, starsAmount: 6 }))
    const item = resendItem()
    expect(item).toBeDefined()

    item!.click()
    await flush()

    // цена — из самого отказа (ревью п.2), а не из возможно отставшего зеркала
    expect(prepareStarsForPayment).toHaveBeenCalledWith(2, 6)
    expect(confirmRepayRequest).toHaveBeenCalledWith(3, { starsAmount: 6, canUndo: false })
  })

  it('отказ от оплаты — запрос не подтверждается', async () => {
    prepareStarsForPayment.mockResolvedValue(PAYMENT_REJECTED)
    await openOn(failed(7.0001, { id: 3, messageCount: 1, starsAmount: 5 }))
    resendItem()!.click()
    await flush()
    expect(confirmRepayRequest).not.toHaveBeenCalled()
  })

  it('без repayRequest пункта нет (упавшее по другой причине сообщение)', async () => {
    await openOn(failed(7.0001))
    expect(items().length).toBeGreaterThan(0)
    expect(resendItem()).toBeUndefined()
  })
})
