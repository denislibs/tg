// Ф7-Г (MC-06): порт поведения tweb `chat/priceChangedInterceptor/index.ts` (812502980).
// Перехватчик чата слушает запросы на повторную оплату, показывает плашку «Цена
// изменилась» с «Отправить снова» и по согласию зовёт `confirmRepayRequest`.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ListenerSetter from '@helpers/listenerSetter'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { PAYMENT_REJECTED } from '@components/chat/paidMessagesInterceptor'

const tooltip = vi.hoisted(() => ({ calls: [] as { starsAmount: number, onResend: () => void, onHide?: () => void, hide: ReturnType<typeof vi.fn> }[] }))
vi.mock('./priceChangedTooltip.solid', () => ({
  default: (args: { starsAmount: number, onResend: () => void, onHide?: () => void }) => {
    const hide = vi.fn(() => args.onHide?.())
    tooltip.calls.push({ ...args, hide })
    return { hide }
  },
}))

import PriceChangedInterceptor from './index'

const CHAT_ID = 500
const PEER: PeerId = -CHAT_ID

function putChannel(stars: number) {
  applyPeerOps([{ op: 'upsert', peers: [{
    _: 'channel', id: CHAT_ID, title: 'Платная', photo: { _: 'chatPhotoEmpty' }, date: 0,
    pFlags: { megagroup: true }, send_paid_messages_stars: stars,
  }] }])
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(prepare: () => Promise<unknown> = async () => ({ starsAmount: 6, canUndo: false })) {
  const confirmRepayRequest = vi.fn()
  const prepareStarsForPayment = vi.fn(prepare)
  const listenerSetter = new ListenerSetter()
  const interceptor = new PriceChangedInterceptor({
    chat: { peerId: PEER, input: { paidMessageInterceptor: { prepareStarsForPayment } } } as never,
    managers: { messages: { confirmRepayRequest } } as never,
    listenerSetter,
  })
  interceptor.init()
  return { interceptor, confirmRepayRequest, prepareStarsForPayment, listenerSetter }
}

const need = (requestId: number, messageCount: number, peerId: PeerId = PEER, starsAmount = 6) =>
  rootScope.dispatchEventSingle('insufficent_stars_for_message', { requestId, messageCount, peerId, starsAmount })

beforeEach(() => {
  tooltip.calls.length = 0
  resetPeerMirror()
  putChannel(6)
})

describe('PriceChangedInterceptor', () => {
  it('запрос для текущего чата показывает плашку с актуальной ценой', () => {
    const { listenerSetter } = setup()
    need(1, 1)
    expect(tooltip.calls.map((c) => c.starsAmount)).toEqual([6])
    listenerSetter.removeAll()
  })

  it('запрос для другого чата игнорируется', () => {
    const { listenerSetter } = setup()
    need(1, 1, -999)
    expect(tooltip.calls).toEqual([])
    listenerSetter.removeAll()
  })

  it('«Отправить снова»: оплата на сумму всех запросов, затем confirmRepayRequest по каждому', async () => {
    const { prepareStarsForPayment, confirmRepayRequest, listenerSetter } = setup()
    need(1, 1)
    need(2, 2)
    expect(tooltip.calls).toHaveLength(1) // цена одна — плашка одна

    tooltip.calls[0].onResend()
    await flush()

    expect(prepareStarsForPayment).toHaveBeenCalledWith(3, 6)
    expect(confirmRepayRequest.mock.calls).toEqual([
      [1, { starsAmount: 6, canUndo: false }],
      [2, { starsAmount: 6, canUndo: false }],
    ])
    listenerSetter.removeAll()
  })

  it('отказ от оплаты — повтор не уходит', async () => {
    const { confirmRepayRequest, listenerSetter } = setup(async () => PAYMENT_REJECTED)
    need(1, 1)
    tooltip.calls[0].onResend()
    await flush()
    expect(confirmRepayRequest).not.toHaveBeenCalled()
    listenerSetter.removeAll()
  })

  it('fulfill_repaid_message последнего запроса закрывает плашку', () => {
    const { listenerSetter } = setup()
    need(1, 1)
    need(2, 1)
    rootScope.dispatchEventSingle('fulfill_repaid_message', { requestId: 1 })
    expect(tooltip.calls[0].hide).not.toHaveBeenCalled()
    rootScope.dispatchEventSingle('fulfill_repaid_message', { requestId: 2 })
    expect(tooltip.calls[0].hide).toHaveBeenCalledTimes(1)
    listenerSetter.removeAll()
  })

  // Ревью п.2: цена берётся из отказа сервера, а не из зеркала — оно может отстать.
  it('цена из отказа важнее устаревшего зеркала и не обнуляется при отсутствии карточки', () => {
    const { listenerSetter } = setup()
    resetPeerMirror()
    need(1, 1, PEER, 8)
    expect(tooltip.calls.map((c) => c.starsAmount)).toEqual([8])
    listenerSetter.removeAll()
  })

  it('цена снова поменялась — старая плашка закрывается, открывается новая', () => {
    const { listenerSetter } = setup()
    need(1, 1)
    need(2, 1, PEER, 9)
    expect(tooltip.calls.map((c) => c.starsAmount)).toEqual([6, 9])
    expect(tooltip.calls[0].hide).toHaveBeenCalled()
    listenerSetter.removeAll()
  })

  it('cleanup закрывает плашку и забывает запросы', () => {
    const { interceptor, listenerSetter } = setup()
    need(1, 1)
    interceptor.cleanup()
    expect(tooltip.calls[0].hide).toHaveBeenCalled()
    listenerSetter.removeAll()
  })
})
