// src/core/managers/messages/pollMethods.sendingParams.test.ts
//
// Опрос — единственный путь отправки, который у нас идёт СВОИМ REST-эндпоинтом
// (POST /chats/{id}/polls), а не кадром send_message. В tweb такого разделения
// нет: опрос уезжает `sendOther({...sendingParams, inputMedia: inputMediaPoll})`
// и потому несёт пакет параметров наравне с текстом. Здесь пинится то же самое —
// пакет разворачивается в проводные поля тела запроса.
//
// Что ломается без этого: «Ответить» + «Опрос» создаёт опрос БЕЗ ответа, и
// висящая плашка уводит в ответ уже следующее сообщение.
import { describe, it, expect, vi } from 'vitest'
import { newPollMethods } from './pollMethods'
import { newRepayRequestHandler } from './repayRequestHandler'
import { HttpError } from '../../net/restClient'

function ctx() {
  const post = vi.fn(async (_url: string, _body: Record<string, unknown>) => ({
    id: 1, peer_id: 1, seq: 1, sender_id: 5, type: 'poll', text: '',
    reply_to_id: null, media_id: null, created_at: '2026-01-01T00:00:00Z',
  }))
  return {
    post,
    ctx: { rest: { post } as never, patchMsg: () => {}, getMeId: () => 5, opWindowsFor: () => [] } as never,
  }
}

const poll = { question: 'Q', options: ['a', 'b'], anonymous: true, multiple: false, quiz: false }

describe('sendPoll: пакет параметров разворачивается в тело REST-запроса', () => {
  it('ответ, цитата, тред, тихо и send-as доезжают', async () => {
    const h = ctx()
    const m = newPollMethods(h.ctx)

    await m.sendPoll(1, {
      ...poll, clientMsgId: 'c1',
      replyToMsgId: 77, replyToQuote: { text: 'риг', offset: 1 }, threadId: 3,
      silent: true, sendAsPeerId: 9,
    })

    expect(h.post.mock.calls[0][1]).toMatchObject({
      reply_to_id: 77, reply_quote_text: 'риг', reply_quote_offset: 1,
      thread_root_id: 3, silent: true, send_as_peer_id: 9,
    })
  })

  it('без пакета поля уходят пустыми, а не отсутствуют', async () => {
    const h = ctx()
    const m = newPollMethods(h.ctx)

    await m.sendPoll(1, { ...poll, clientMsgId: 'c1' })

    expect(h.post.mock.calls[0][1]).toMatchObject({
      reply_to_id: null, reply_quote_text: null, thread_root_id: null,
      silent: false, send_as_peer_id: null,
    })
  })

  // tweb `sendOther` → `processUpdateMessage(updates)` (appMessagesManager.ts:4183):
  // ответ отложенного опроса — `Updates`, их применяет владелец ленты отложенных.
  it('отложенный опрос: schedule_date в теле, ответ Updates уходит владельцу ленты отложенных', async () => {
    const updates = { updates: [{ _: 'updateNewScheduledMessage', message: { _: 'message', id: 4 } }], users: [], chats: [] }
    const post = vi.fn(async () => updates)
    const applyScheduledUpdates = vi.fn()
    const m = newPollMethods({ rest: { post } as never, patchMsg: () => {}, getMeId: () => 5, opWindowsFor: () => [], emitOps: () => {}, readMsg: () => undefined, applyScheduledUpdates })

    expect(await m.sendPoll(1, { ...poll, clientMsgId: 'c1', scheduleDate: 1_900_000_000, scheduleRepeatPeriod: 86400 })).toBeUndefined()
    expect(post.mock.calls[0]).toEqual(['/chats/1/polls', expect.objectContaining({ schedule_date: 1_900_000_000, schedule_repeat_period: 86400 })])
    expect(applyScheduledUpdates).toHaveBeenCalledWith(updates)
  })

  // Ф7-Г (MC-06): согласие на плату — `allow_paid_stars` тела /polls и /checklists
  // (tweb appPollsManager.ts:1133, :1149).
  it('sendPoll и sendChecklist несут allow_paid_stars из confirmedPaymentResult', async () => {
    const post = vi.fn(async () => ({}))
    const m = newPollMethods({ rest: { post } as never, patchMsg: () => {}, getMeId: () => 5, opWindowsFor: () => [], emitOps: () => {}, readMsg: () => undefined })
    await m.sendPoll(1, { ...poll, clientMsgId: 'c1', confirmedPaymentResult: { starsAmount: 5 } }).catch(() => {})
    expect(post.mock.calls[0]).toEqual(['/chats/1/polls', expect.objectContaining({ allow_paid_stars: 5 })])
    await m.sendChecklist(1, { title: 't', items: ['a'], othersCanAdd: false, othersCanMark: false, confirmedPaymentResult: { starsAmount: 5 } }).catch(() => {})
    expect(post.mock.calls[1]).toEqual(['/chats/1/checklists', expect.objectContaining({ allow_paid_stars: 5 })])
  })

  // 403 ALLOW_PAYMENT_REQUIRED у опроса/чек-листа — запрос на повторную оплату
  // (тот же tryRegisterRequest, что у пересылки); вызывающему ошибки нет.
  it('403 ALLOW_PAYMENT_REQUIRED у опроса и чек-листа заводит запрос и повторяет с новой суммой', async () => {
    const events: [string, unknown][] = []
    const repay = newRepayRequestHandler({ dispatch: (e, p) => { events.push([e, p]) } })
    let n = 0
    const post = vi.fn(async (_url: string, _body: Record<string, unknown>) => {
      if (n++ < 2) throw new HttpError(403, 'ALLOW_PAYMENT_REQUIRED_5', 'ALLOW_PAYMENT_REQUIRED_5')
      return { id: 1, peer_id: 1, seq: 1, sender_id: 5, type: 'poll', text: '', reply_to_id: null, media_id: null, created_at: '2026-01-01T00:00:00Z' }
    })
    const m = newPollMethods({ rest: { post } as never, patchMsg: () => {}, getMeId: () => 5, opWindowsFor: () => [], emitOps: () => {}, readMsg: () => undefined, repay })

    expect(await m.sendPoll(1, { ...poll, clientMsgId: 'c1', confirmedPaymentResult: { starsAmount: 5 } })).toBeUndefined()
    expect(await m.sendChecklist(1, { title: 't', items: ['a'], othersCanAdd: false, othersCanMark: false })).toBeUndefined()
    expect(events.map(([e]) => e)).toEqual(['insufficent_stars_for_message', 'insufficent_stars_for_message'])

    repay.confirmRepayRequest(1, { starsAmount: 8 })
    await Promise.resolve()
    expect(post.mock.calls[2]).toEqual(['/chats/1/polls', expect.objectContaining({ allow_paid_stars: 8 })])
    // чек-лист повторяется с новым client_msg_id? нет: тот же вызов, новая сумма
    repay.confirmRepayRequest(2, { starsAmount: 9 })
    await Promise.resolve()
    expect(post.mock.calls[3]).toEqual(['/chats/1/checklists', expect.objectContaining({ allow_paid_stars: 9 })])
  })

  it('прочие отказы опроса бросаются', async () => {
    const post = vi.fn(async () => { throw new HttpError(400, 'invalid poll', 'invalid') })
    const m = newPollMethods({ rest: { post } as never, patchMsg: () => {}, getMeId: () => 5, opWindowsFor: () => [], emitOps: () => {}, readMsg: () => undefined, repay: newRepayRequestHandler({ dispatch: () => {} }) })
    await expect(m.sendPoll(1, { ...poll, clientMsgId: 'c1' })).rejects.toBeInstanceOf(HttpError)
  })
})
