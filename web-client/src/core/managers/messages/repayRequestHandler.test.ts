// Порт теста поведения tweb `lib/appManagers/utils/repayRequestHandler.ts`
// (812502980): запрос на повторную оплату держит замыкание повтора, ведёт два
// события для главного потока и снимается подтверждением.
import { describe, it, expect, vi } from 'vitest'
import { newRepayRequestHandler, canHandleRepayReason } from './repayRequestHandler'

function setup() {
  const events: [string, unknown][] = []
  const h = newRepayRequestHandler({ dispatch: (event, payload) => { events.push([event, payload]) } })
  return { h, events }
}

describe('RepayRequestHandler', () => {
  it('ALLOW_PAYMENT_REQUIRED_<N> регистрирует запрос и шлёт insufficent_stars_for_message', () => {
    const { h, events } = setup()
    const repay = vi.fn()

    const req = h.tryRegisterRequest({ reason: 'ALLOW_PAYMENT_REQUIRED_15', peerId: 7, messageCount: 3, repay })

    expect(req).toEqual({ id: 1, messageCount: 3 })
    expect(events).toEqual([['insufficent_stars_for_message', { requestId: 1, messageCount: 3, peerId: 7, starsAmount: 5 }]])
    expect(repay).not.toHaveBeenCalled()
  })

  it('другой отказ (BALANCE_TOO_LOW, slowmode, мусор) не регистрируется', () => {
    const { h, events } = setup()
    for (const reason of ['BALANCE_TOO_LOW', 'slowmode', 'ALLOW_PAYMENT_REQUIRED_', 'ALLOW_PAYMENT_REQUIRED_x', '']) {
      expect(h.tryRegisterRequest({ reason, peerId: 7, messageCount: 1, repay: vi.fn() })).toBeUndefined()
    }
    expect(events).toEqual([])
  })

  it('номера запросов растут', () => {
    const { h } = setup()
    const a = h.tryRegisterRequest({ reason: 'ALLOW_PAYMENT_REQUIRED_5', peerId: 7, messageCount: 1, repay: vi.fn() })
    const b = h.tryRegisterRequest({ reason: 'ALLOW_PAYMENT_REQUIRED_5', peerId: 7, messageCount: 1, repay: vi.fn() })
    expect([a?.id, b?.id]).toEqual([1, 2])
  })

  it('confirmRepayRequest: повтор получает новую сумму, запрос снят, fulfill_repaid_message', () => {
    const { h, events } = setup()
    const repay = vi.fn()
    h.tryRegisterRequest({ reason: 'ALLOW_PAYMENT_REQUIRED_15', peerId: 7, messageCount: 3, repay })
    events.length = 0

    h.confirmRepayRequest(1, { starsAmount: 6 })

    expect(repay).toHaveBeenCalledWith({ starsAmount: 6 })
    expect(events).toEqual([['fulfill_repaid_message', { requestId: 1 }]])
    // второй раз тот же запрос уже не существует: повтор не уходит дважды
    h.confirmRepayRequest(1, { starsAmount: 6 })
    expect(repay).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(1)
  })

  it('cancelRepayRequest снимает запрос без повтора', () => {
    const { h, events } = setup()
    const repay = vi.fn()
    h.tryRegisterRequest({ reason: 'ALLOW_PAYMENT_REQUIRED_5', peerId: 7, messageCount: 1, repay })
    events.length = 0
    h.cancelRepayRequest(1)
    expect(repay).not.toHaveBeenCalled()
    expect(events).toEqual([['fulfill_repaid_message', { requestId: 1 }]])
  })

  it('canHandleRepayReason различает HTTP-тип отказа', () => {
    expect(canHandleRepayReason('ALLOW_PAYMENT_REQUIRED_15')).toBe(true)
    expect(canHandleRepayReason('BALANCE_TOO_LOW')).toBe(false)
  })
})
