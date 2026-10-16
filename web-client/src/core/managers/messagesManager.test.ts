// src/core/managers/messagesManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newMessagesManager } from './messagesManager'
import { HttpError, type RestClient } from '../net/restClient'
import { mapMyMessage, type MessageReal, type MyMessage, type RawMessage, type RawMessageReal, type RawMyMessage } from '../models'
import type { NewMessageEvt, WebPageUpdateEvt, FactCheckUpdateEvt, MediaReadEvt, DeleteMessageEvt } from '../realtime/events'
import { RT } from '../realtime/events'
import type { MessageOp } from '../realtime/messageOps'
import { GENERAL_TOPIC_ID, generateMessageId } from '../history/messageId'
import type { Chat } from '../peers/peer'
import { toPeerId } from '../peers/peerId'
import { SliceEnd } from '../history/slicedArray'
import { makeRawMessage } from '../messages/testMessage'
import { getDocumentFromMessage, getMediaFromMessage, pollOptionKey, type MessageMedia, type MessageMediaPoll, type MessageMediaToDo } from '../media/messageMedia'

/** Номер в КЛИЕНТСКОМ пространстве. Чисел стало ОДНО (решение Р1): у сообщения
 *  больше нет пары «адрес + порядок», а на проводе номера СЕРВЕРНЫЕ — граница
 *  между пространствами и есть то, что здесь проверяется чаще всего. */
const cid = generateMessageId

const real = (m: MyMessage | undefined): MessageReal | undefined =>
  m?._ === 'message' ? m : undefined

function rawPage(ids: number[], peerId = 1): { messages: RawMessage[]; count: number } {
  // backend returns newest-first (DESC) for offset_id=0 / older pages
  const messages = ids.map((id) => makeRawMessage({
    id, peerId, fromId: 1, text: `m${id}`, createdAt: '2026-06-24T10:00:00Z',
  }) as RawMessage)
  return { messages, count: messages.length }
}

function countingRest(pages: Record<string, { messages: RawMessage[]; count: number }>) {
  let calls = 0
  const rest = {
    get: async (_path: string, q?: Record<string, string | number>) => {
      calls++
      const key = `${q?.offset_id ?? 0}:${q?.add_offset ?? 0}:${q?.limit ?? 0}`
      return pages[key] ?? { messages: [], count: 0 }
    },
    post: async () => ({}),
  } as unknown as RestClient
  return { rest, calls: () => calls }
}

describe('MessagesManager.getHistory', () => {
  it('fetches the newest window and returns ascending messages', async () => {
    const { rest } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    // Номера на выходе КЛИЕНТСКИЕ: страница пришла с сервера, границу маппинга
    // она уже прошла.
    expect(r.messages.map((m) => m.id)).toEqual([cid(3), cid(4), cid(5)]) // ascending for UI
    expect(r.count).toBe(3)
  })

  it('serves the second identical request from cache (no extra REST call)', async () => {
    const { rest, calls } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    expect(calls()).toBe(1)
  })

  it('reports reachedTop when an older page is short', async () => {
    const { rest } = countingRest({
      '0:0:40': rawPage([5, 4, 3, 2, 1]),
      '1:1:40': rawPage([1]), // older inclusive of 1 → just [1] (< limit)
    })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const older = await mgr.getHistory({ peerId: 1, offsetId: cid(1), addOffset: 1, limit: 40 })
    expect(older.reachedTop).toBe(true)
  })

  // Regression: re-opening a chat (cached newest page of exactly `limit`) must
  // NOT report reachedTop — the real top isn't reached, so scroll-up paging
  // stays enabled. (Previously `fulfilled` conflated page-satisfied with top.)
  it('does not report reachedTop on re-open when only the newest page is cached', async () => {
    const { rest } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    const first = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    expect(first.reachedTop).toBe(false)
    // simulate re-open: identical initial request, now served from cache
    const reopen = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    expect(reopen.reachedBottom).toBe(true)
    expect(reopen.reachedTop).toBe(false)
  })
})

describe('MessagesManager.flushHistoryWindows (tweb flushStoragesByPeerId)', () => {
  it('после сброса окно основного чата снова идёт в сеть; соседний чат не тронут', async () => {
    const { rest, calls } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    await mgr.getHistory({ peerId: 2, offsetId: 0, addOffset: 0, limit: 3 })
    expect(calls()).toBe(2)

    expect(mgr.getMessageByPeer(1, cid(5))).toBeDefined()
    mgr.flushHistoryWindows(1)
    expect(mgr.getMessageByPeer(1, cid(5))).toBeUndefined() // объекты чата — тоже (tweb flushStoragesByPeerId)
    await mgr.getHistory({ peerId: 2, offsetId: 0, addOffset: 0, limit: 3 })
    expect(calls()).toBe(2) // чат 2 из кэша
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    expect(calls()).toBe(3) // чат 1 — заново
  })
})

describe('MessagesManager.flushHistoryWindows — счёт истории', () => {
  it('известный счёт окна объявляется нулём (шапка «Избранного» не держит «N сообщений»)', async () => {
    const { rest } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const broadcast = vi.fn()
    const mgr = newMessagesManager({ rest, broadcast })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    broadcast.mockClear()

    mgr.flushHistoryWindows(1)

    expect(broadcast).toHaveBeenCalledWith(RT.historyCount, { key: '1', count: 0 })
  })
})

describe('MessagesManager.sendMessage', () => {
  it('POSTs and returns the created message, caching it', async () => {
    const created = makeRawMessage({ id: 6, peerId: 1, fromId: 1, text: 'hey', createdAt: '2026-06-24T11:00:00Z' })
    const rest = { post: async () => created, get: async () => ({ messages: [], count: 0 }) } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const m = await mgr.sendMessage({ peerId: 1, text: 'hey', clientMsgId: 'c1' })
    expect(m.id).toBe(cid(6))
    expect(real(m)?.message).toBe('hey')
  })

  it('forwards reply_to_peer_id for a cross-chat reply', async () => {
    let body: Record<string, unknown> = {}
    const created = makeRawMessage({ id: 6, peerId: 1, fromId: 1, text: 'hey', createdAt: '2026-06-24T11:00:00Z', replyToMsgId: 5 })
    const rest = { post: async (_p: string, b: Record<string, unknown>) => { body = b; return created } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.sendMessage({ peerId: 1, text: 'hey', clientMsgId: 'c1', replyToId: cid(5), replyToPeerId: 99 })
    // В теле запроса номер СЕРВЕРНЫЙ: всё, что уходит на сервер, проходит через
    // `getServerMessageId` — иначе бэкенд получил бы клиентское число и ответил
    // бы 404 (громко, а не молчаливой подменой).
    expect(body.reply_to_id).toBe(5)
    expect(body.reply_to_peer_id).toBe(99)
  })
})

describe('MessagesManager.forwardMessages', () => {
  // Тело ручки `POST /chats/{id}/forward` — `forwardBody` бэкенда
  // (`chat_handler.go:858-865`): номера едут ключом `ids` (схема
  // `messages.forwardMessages`, `id:Vector<int>`), СЕРВЕРНЫМИ. Под ключом `msg_ids`
  // ручка отвечала 400, и пересылка не уходила вовсе — входа в неё не было с К-3.
  it('шлёт номера ключом ids в серверном пространстве', async () => {
    let path = ''
    let body: Record<string, unknown> = {}
    const rest = {
      post: async (p: string, b: Record<string, unknown>) => { path = p; body = b; return { messages: [], users: [], chats: [] } },
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.forwardMessages(1, 2, [cid(3), cid(4)], { dropAuthor: true })
    expect(path).toBe('/chats/1/forward')
    expect(body).toEqual({ from_peer_id: 2, ids: [3, 4], drop_author: true, drop_caption: false, silent: false, top_msg_id: null, schedule_date: 0, schedule_repeat_period: 0 })
  })

  // Ф7-И1: HTTP 420 SLOWMODE_WAIT_<N> у пересылки объявляется как отказ отправки
  // пира (tweb forwardMessages → onMessagesSendError → попап медленного режима) и
  // пробрасывается вызывающему; прочие отказы события не рождают.
  it('SLOWMODE_WAIT_N объявляется rt:message_send_error и пробрасывается', async () => {
    const rest = {
      post: async () => { throw new HttpError(420, 'SLOWMODE_WAIT_20', 'SLOWMODE_WAIT_20') },
    } as unknown as RestClient
    const broadcast = vi.fn()
    const mgr = newMessagesManager({ rest, broadcast })
    await expect(mgr.forwardMessages(1, 2, [cid(3)])).rejects.toMatchObject({ status: 420 })
    expect(broadcast).toHaveBeenCalledWith('rt:message_send_error', { peerId: 1, error: { type: 'SLOWMODE_WAIT_20' } })
  })

  // Ф7-Г (MC-06): allow_paid_stars у пересылки — сумма ЗА ПАЧКУ: цена одного
  // сообщения × число сообщений (tweb forwardMessagesInner, appMessagesManager.ts:5634).
  it('allow_paid_stars = цена × число сообщений пачки', async () => {
    let body: Record<string, unknown> = {}
    const rest = {
      post: async (_p: string, b: Record<string, unknown>) => { body = b; return { messages: [], users: [], chats: [] } },
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.forwardMessages(1, 2, [cid(3), cid(4), cid(5)], { confirmedPaymentResult: { starsAmount: 5 } })
    expect(body.allow_paid_stars).toBe(15)
    await mgr.forwardMessages(1, 2, [cid(3)])
    expect(body.allow_paid_stars).toBeUndefined()
  })

  // Ф7-Г (MC-06): 403 ALLOW_PAYMENT_REQUIRED_<N> у пересылки — не «ошибка», а
  // запрос на повторную оплату (tweb :5805 → `tryRegisterRequest` с повтором
  // `forwardMessagesInner({...options, ...override})`): вызывающий не получает
  // ошибки, подсказка о смене цены — по событию.
  it('403 ALLOW_PAYMENT_REQUIRED регистрирует повтор; подтверждение повторяет пересылку с новой суммой', async () => {
    const bodies: Record<string, unknown>[] = []
    let first = true
    const events: [string, unknown][] = []
    const rest = {
      post: async (_p: string, b: Record<string, unknown>) => {
        bodies.push(b)
        if (first) { first = false; throw new HttpError(403, 'ALLOW_PAYMENT_REQUIRED_15', 'ALLOW_PAYMENT_REQUIRED_15') }
        return { messages: [], users: [], chats: [] }
      },
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest, broadcast: (e, p) => { events.push([e, p]) } })

    const r = await mgr.forwardMessages(1, 2, [cid(3), cid(4), cid(5)], { confirmedPaymentResult: { starsAmount: 5 } })

    expect(r).toEqual([])
    expect(events).toEqual([['insufficent_stars_for_message', { requestId: 1, messageCount: 3, peerId: 1, starsAmount: 5 }]])

    mgr.confirmRepayRequest(1, { starsAmount: 6 })
    await new Promise((res) => setTimeout(res, 0))

    expect(bodies).toHaveLength(2)
    expect(bodies[1].allow_paid_stars).toBe(18)
    expect(events[events.length - 1]).toEqual(['fulfill_repaid_message', { requestId: 1 }])
  })

  // Мост пересылки не открывает чат получателя: плашки там нет, поэтому запрос не заводится —
  // отказ бросается, и мост не засчитывает чат отправленным (ревью Ф7-Г п.1).
  it('noRepay: 403 ALLOW_PAYMENT_REQUIRED бросается, запрос не заводится', async () => {
    const events: unknown[] = []
    const rest = { post: async () => { throw new HttpError(403, 'ALLOW_PAYMENT_REQUIRED_15', 'ALLOW_PAYMENT_REQUIRED_15') } } as unknown as RestClient
    const mgr = newMessagesManager({ rest, broadcast: (e) => { events.push(e) } })
    await expect(mgr.forwardMessages(1, 2, [cid(3)], { noRepay: true })).rejects.toBeInstanceOf(HttpError)
    // запрос оплаты не заведён; остаётся только общее объявление отказа
    expect(events).toEqual([RT.messageSendError])
  })

  it('прочие отказы пересылки по-прежнему бросаются вызывающему', async () => {
    const rest = { post: async () => { throw new HttpError(403, 'forbidden', 'forbidden') } } as unknown as RestClient
    const mgr = newMessagesManager({ rest, broadcast: () => {} })
    await expect(mgr.forwardMessages(1, 2, [cid(3)])).rejects.toBeInstanceOf(HttpError)
  })

  // tweb `forwardMessagesInner`: нехватка баланса — тоже не повтор оплаты.
  it('BALANCE_TOO_LOW не регистрирует повтор и бросается', async () => {
    const events: unknown[] = []
    const rest = { post: async () => { throw new HttpError(400, 'BALANCE_TOO_LOW', 'BALANCE_TOO_LOW') } } as unknown as RestClient
    const mgr = newMessagesManager({ rest, broadcast: (e) => { events.push(e) } })
    await expect(mgr.forwardMessages(1, 2, [cid(3)], { confirmedPaymentResult: { starsAmount: 5 } })).rejects.toBeInstanceOf(HttpError)
    expect(events).toEqual([RT.messageSendError])
  })

  // tweb `forwardMessagesInner`: `silent` и `top_msg_id` (корень темы/треда у
  // приёмника, серверный номер) — без них пересылка в тему уходила в General.
  it('несёт silent и top_msg_id темы приёмника', async () => {
    let body: Record<string, unknown> = {}
    const rest = {
      post: async (_p: string, b: Record<string, unknown>) => { body = b; return { messages: [], users: [], chats: [] } },
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.forwardMessages(1, 2, [cid(3)], { silent: true, threadId: cid(9) })
    expect(body).toMatchObject({ silent: true, top_msg_id: 9 })
  })
})

// Лента отложенных — порт tweb `scheduledMessagesStorage` и обработчиков
// `onUpdateNewScheduledMessage`/`onUpdateDeleteScheduledMessages`
// (appMessagesManager.ts:11773-11815, :12386-12427, :12606-12613). Постановка —
// обычная отправка с `scheduleDate` (поле пакета), источник перемен ленты —
// кадры, а не ответ ручки.
describe('MessagesManager — лента отложенных', () => {
  const rawScheduled = (id: number, date: number, over: Record<string, unknown> = {}) => ({
    ...makeRawMessage({ id, peerId: 1, fromId: 1, text: 'later', createdAt: '2026-07-19T10:00:00Z' }),
    date, ...over,
  }) as RawMessage
  const page = (...messages: RawMessage[]) => ({ _: 'messages.messages', messages, users: [], chats: [] })
  const newScheduled = (m: RawMessage) => ({ _: 'updateNewScheduledMessage' as const, message: m })
  const deleteScheduled = (ids: number[]) => ({
    _: 'updateDeleteScheduledMessages' as const, peer: { _: 'peerUser' as const, user_id: 1 }, messages: ids,
  })

  function setup(restOver: Record<string, unknown> = {}) {
    const events: [string, unknown][] = []
    const sends: Record<string, unknown>[] = []
    let gets = 0
    const rest = {
      get: async () => { gets++; return page(rawScheduled(2, 300), rawScheduled(1, 100), rawScheduled(3, 200)) },
      ...restOver,
    } as unknown as RestClient
    const mgr = newMessagesManager({
      rest,
      broadcast: (e, p) => { events.push([e, p]) },
      send: (a) => { sends.push(a as unknown as Record<string, unknown>) },
    })
    const ops = () => events.filter(([e]) => e === RT.messageOp).flatMap(([, p]) => (p as { ops: MessageOp[] }).ops)
    return { mgr, events, sends, ops, gets: () => gets }
  }

  it('getScheduledMessages: по возрастанию даты, флаг is_scheduled; повтор — из хранилища, без сети (tweb :12398-12401)', async () => {
    const { mgr, gets } = setup()
    const list = await mgr.getScheduledMessages(1)
    expect(list.map((m) => m.date)).toEqual([100, 200, 300])
    expect(list.every((m) => m.pFlags.is_scheduled)).toBe(true)
    await mgr.getScheduledMessages(1)
    expect(gets()).toBe(1)
  })

  it('updateNewScheduledMessage без хранилища пропускается (tweb :11777-11780)', () => {
    const { mgr, events } = setup()
    mgr.applyNewScheduledMessage(newScheduled(rawScheduled(5, 500)))
    expect(events).toEqual([])
  })

  it('updateNewScheduledMessage: новый номер → scheduled_new, тот же номер → правка окна отложенных (message_edit)', async () => {
    const { mgr, events, ops } = setup()
    await mgr.getScheduledMessages(1)
    mgr.applyNewScheduledMessage(newScheduled(rawScheduled(5, 500)))
    expect(events.map(([e]) => e)).toEqual(['scheduled_new'])
    expect((events[0][1] as MyMessage).id).toBe(cid(5))

    mgr.applyNewScheduledMessage(newScheduled(rawScheduled(5, 900, { message: 'правка' })))
    expect(ops()).toEqual([{ op: 'replace', key: '1_scheduled', msg: expect.objectContaining({ id: cid(5), date: 900, message: 'правка' }) }])
    expect((await mgr.getScheduledMessages(1)).map((m) => m.date)).toEqual([100, 200, 300, 900])
  })

  it('updateDeleteScheduledMessages → scheduled_delete с клиентскими номерами, хранилище худеет', async () => {
    const { mgr, events } = setup()
    await mgr.getScheduledMessages(1)
    mgr.applyDeleteScheduledMessages(deleteScheduled([1, 2]))
    expect(events).toEqual([['scheduled_delete', { peerId: 1, mids: [cid(1), cid(2)] }]])
    expect((await mgr.getScheduledMessages(1)).map((m) => m.id)).toEqual([cid(3)])
  })

  it('постановка — обычная отправка с scheduleDate: бабл в хранилище отложенных и scheduled_new, кадр несёт schedule_date', async () => {
    const { mgr, events, sends, ops } = setup()
    await mgr.getScheduledMessages(1)
    await mgr.sendText({ peerId: 1, text: 'потом', clientMsgId: 'c-9', scheduleDate: 1_900_000_000, scheduleRepeatPeriod: 86400, optimistic: { senderId: 1 } })
    expect(sends).toEqual([expect.objectContaining({ clientMsgId: 'c-9', scheduleDate: 1_900_000_000, scheduleRepeatPeriod: 86400 })])
    // в историю бабл не встаёт — операций окна нет
    expect(ops()).toEqual([])
    const [[event, temp]] = events as [[string, MessageReal]]
    expect(event).toBe('scheduled_new')
    expect(temp).toMatchObject({ random_id: 'c-9', date: 1_900_000_000, schedule_repeat_period: 86400, pFlags: { out: true, is_scheduled: true } })
    expect((await mgr.getScheduledMessages(1)).map((m) => m.id)).toContain(temp.id)
  })

  it('свой временный бабл снимает кадр с тем же random_id (tweb checkPendingMessage → history_update)', async () => {
    const { mgr, events, ops } = setup()
    await mgr.getScheduledMessages(1)
    await mgr.sendText({ peerId: 1, text: 'потом', clientMsgId: 'c-9', scheduleDate: 1_900_000_000, optimistic: { senderId: 1 } })
    events.length = 0
    mgr.applyNewScheduledMessage(newScheduled(rawScheduled(11, 1_900_000_000, { random_id: 'c-9' })))
    // не scheduled_new (иначе дубль), а вставка финального в окно отложенных —
    // зеркало сольёт её с временным по random_id
    expect(events.map(([e]) => e)).toEqual([RT.messageOp])
    expect(ops()).toEqual([{ op: 'insert', key: '1_scheduled', msg: expect.objectContaining({ id: cid(11), random_id: 'c-9' }), sequential: true }])
    const ids = (await mgr.getScheduledMessages(1)).map((m) => m.id)
    expect(ids).toContain(cid(11))
    expect(ids.filter((id) => !Number.isInteger(id))).toEqual([])
  })

  it('ack постановки (scheduled) финализирует бабл в хранилище отложенных, а не в истории', async () => {
    const { mgr, ops } = setup()
    await mgr.getScheduledMessages(1)
    await mgr.sendText({ peerId: 1, text: 'потом', clientMsgId: 'c-9', scheduleDate: 1_900_000_000, optimistic: { senderId: 1 } })
    expect(mgr.ackPendingMessage({ client_msg_id: 'c-9', id: 12, date: 1_900_000_000, scheduled: true }))
      .toEqual([{ op: 'insert', key: '1_scheduled', msg: expect.objectContaining({ id: cid(12) }), sequential: true }])
    expect(ops()).toEqual([])
    // кадр следом — правка уже финального, без второго бабла
    mgr.applyNewScheduledMessage(newScheduled(rawScheduled(12, 1_900_000_000, { random_id: 'c-9' })))
    expect(ops()).toEqual([expect.objectContaining({ op: 'replace', key: '1_scheduled' })])
  })

  it('sendScheduledMessages — один пакетный вызов, кадры ответа применяются (tweb :12420-12427)', async () => {
    const calls: [string, unknown][] = []
    const { mgr, events } = setup({
      post: async (p: string, b: unknown) => { calls.push([p, b]); return { updates: [deleteScheduled([1, 2])] } },
    })
    await mgr.getScheduledMessages(1)
    await mgr.sendScheduledMessages(1, [cid(1), cid(2)])
    expect(calls).toEqual([['/chats/1/scheduled/send_now', { id: [1, 2] }]])
    expect(events).toEqual([['scheduled_delete', { peerId: 1, mids: [cid(1), cid(2)] }]])
  })

  it('deleteScheduledMessages — один пакетный вызов; отказ ручки ничего не объявляет', async () => {
    const calls: [string, unknown][] = []
    const ok = setup({ post: async (p: string, b: unknown) => { calls.push([p, b]); return { updates: [deleteScheduled([3])] } } })
    await ok.mgr.getScheduledMessages(1)
    await ok.mgr.deleteScheduledMessages(1, [cid(3)])
    expect(calls).toEqual([['/chats/1/scheduled/delete', { id: [3] }]])
    expect(ok.events).toEqual([['scheduled_delete', { peerId: 1, mids: [cid(3)] }]])

    const bad = setup({ post: async () => { throw new Error('500') } })
    await expect(bad.mgr.deleteScheduledMessages(1, [cid(9)])).rejects.toThrow()
    expect(bad.events).toEqual([])
  })

  it('editMessage с scheduleDate — PATCH сообщения с schedule_date (tweb :2209-2222), ответ — правка ленты', async () => {
    const calls: [string, Record<string, unknown>][] = []
    const { mgr, ops } = setup({
      patch: async (p: string, b: Record<string, unknown>) => { calls.push([p, b]); return { updates: [newScheduled(rawScheduled(1, 0x7FFFFFFE))] } },
    })
    await mgr.getScheduledMessages(1)
    await mgr.editMessage(1, cid(1), 'later', undefined, { scheduleDate: 0x7FFFFFFE })
    // «Когда в сети» едет ДАТОЙ-меткой, а не флагом (НО-3: не 2038 год)
    // Период не передан — ключа нет: сервер повтор не меняет (tweb :2218)
    expect(calls).toEqual([['/chats/1/messages/1', { text: 'later', entities: null, schedule_date: 0x7FFFFFFE }]])
    expect(ops()).toEqual([expect.objectContaining({ op: 'replace', key: '1_scheduled', msg: expect.objectContaining({ date: 0x7FFFFFFE }) })])
  })

  // Ф-5 C2: правка (и отложенного) несёт решение плашки превью (tweb :2207-2220)
  it('editMessage: no_webpage / invert_media / media в теле PATCH — и у отложенного', async () => {
    const bodies: Record<string, unknown>[] = []
    const { mgr } = setup({ patch: async (_p: string, b: Record<string, unknown>) => { bodies.push(b); return { updates: [] } } })
    await mgr.getScheduledMessages(1)
    const webPage = { _: 'webPage' as const, pFlags: { has_large_media: true as const }, url: 'https://ex.com', display_url: 'ex.com' }
    await mgr.editMessage(1, cid(1), 'https://ex.com', undefined, { scheduleDate: 1_900_000_000, webPage, webPageOptions: { smallMedia: true, optional: true }, invertMedia: true })
    await mgr.editMessage(1, cid(1), 'https://ex.com', undefined, { scheduleDate: 1_900_000_000, noWebPage: true })
    expect(bodies[0]).toEqual(expect.objectContaining({
      invert_media: true,
      media: { _: 'inputMediaWebPage', url: 'https://ex.com', pFlags: { force_large_media: undefined, force_small_media: true, optional: true } },
    }))
    expect(bodies[1]).toEqual(expect.objectContaining({ no_webpage: true }))
    expect('media' in bodies[1]).toBe(false)
  })

  it('правка с явным периодом шлёт его, 0 — снять повтор; правка текста без периода повтор не снимает', async () => {
    const bodies: Record<string, unknown>[] = []
    const { mgr } = setup({ patch: async (_p: string, b: Record<string, unknown>) => { bodies.push(b); return { updates: [] } } })
    await mgr.getScheduledMessages(1)
    await mgr.editMessage(1, cid(1), 'a', undefined, { scheduleDate: 1_900_000_000, scheduleRepeatPeriod: 604800 })
    await mgr.editMessage(1, cid(1), 'a', undefined, { scheduleDate: 1_900_000_000, scheduleRepeatPeriod: 0 })
    await mgr.editMessage(1, cid(1), 'b', undefined, { scheduleDate: 1_900_000_000 })
    expect(bodies.map((b) => b.schedule_repeat_period)).toEqual([604800, 0, undefined])
    expect('schedule_repeat_period' in bodies[2]).toBe(false)
  })

  // Сервер шлёт кадр всем устройствам автора, включая отправившее, — тот же кадр
  // приходит ответом ручки и затем сокетом. tweb дубля не видит (MTProto апдейты
  // ответа сессии повторно не шлёт); у нас второй отсекается.
  it('дубль кадра (ответ ручки + сокет): второе событие не объявляется', async () => {
    const { mgr, events } = setup({
      post: async () => ({ updates: [deleteScheduled([1])] }),
    })
    await mgr.getScheduledMessages(1)
    mgr.applyNewScheduledMessage(newScheduled(rawScheduled(5, 500)))
    mgr.applyNewScheduledMessage(newScheduled(rawScheduled(5, 500)))
    await mgr.deleteScheduledMessages(1, [cid(1)])
    mgr.applyDeleteScheduledMessages(deleteScheduled([1]))
    expect(events.map(([e]) => e)).toEqual(['scheduled_new', 'scheduled_delete'])
  })

  it('ответ Updates чужого транспорта (пост канала, опрос) — applyScheduledUpdates кладёт в ленту', async () => {
    const { mgr, events } = setup()
    await mgr.getScheduledMessages(1)
    mgr.applyScheduledUpdates({ updates: [newScheduled(rawScheduled(6, 600))], users: [], chats: [] })
    expect(events.map(([e]) => e)).toEqual(['scheduled_new'])
  })

  it('правка отложенного без изменений (MESSAGE_NOT_MODIFIED) — не отказ (tweb :2230-2233)', async () => {
    const { mgr } = setup({ patch: async () => { throw new HttpError(400, 'MESSAGE_NOT_MODIFIED', 'MESSAGE_NOT_MODIFIED') } })
    await expect(mgr.editMessage(1, cid(1), 'same', undefined, { scheduleDate: 1_900_000_000 })).resolves.toBeUndefined()
  })

  it('пересылка с scheduleDate шлёт schedule_date; ответ Updates — в ленту отложенных, не в историю', async () => {
    let body: Record<string, unknown> = {}
    const { mgr, events } = setup({ post: async (_p: string, b: Record<string, unknown>) => {
      body = b
      return { updates: [newScheduled(rawScheduled(4, 1_900_000_000))], users: [], chats: [] }
    } })
    await mgr.getScheduledMessages(1)
    expect(await mgr.forwardMessages(1, 2, [cid(3)], { scheduleDate: 1_900_000_000 })).toEqual([])
    expect(body).toMatchObject({ schedule_date: 1_900_000_000, ids: [3] })
    expect(mgr.getMessageByPeer(1, cid(4))).toBeUndefined()
    expect(events.map(([e]) => e)).toEqual(['scheduled_new'])
  })
})

/** Кадр `new_message` несёт сообщение ЦЕЛИКОМ под ключом `message` — форма
 *  `updateNewMessage` (решение Р5). Второй проводной формы сообщения (плоские
 *  `msg_id`/`seq`/`sender_id`/`text` прямо в кадре) и второго маппера к ней
 *  больше нет, поэтому и фикстура кадра строится той же фабрикой, что страница
 *  истории. */
const liveEvt = (m: RawMessageReal, over: Partial<NewMessageEvt> = {}): NewMessageEvt =>
  ({ _: 'updateNewMessage', message: m as RawMessage, ...over })

describe('MessagesManager.cacheLive', () => {
  // Ссылка на кросс-чат ответ должна пережить кэш — иначе при переоткрытии чата
  // из кэша плашка ответа теряет чат оригинала. Снимка `{name, text}` рядом
  // больше нет: едет `reply_to.reply_from`/`reply_media`, а превью строит тот,
  // кто рисует.
  it('preserves the cross-chat reply reference in the cache entry', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.cacheLive(liveEvt({
      ...makeRawMessage({ id: 4, peerId: 1, fromId: 1, text: 'ответ', createdAt: '2026-06-24T10:00:00Z' }),
      reply_to: {
        _: 'messageReplyHeader',
        reply_to_msg_id: 999,
        reply_to_peer_id: { _: 'peerChannel', channel_id: 77 },
        reply_from: { _: 'messageFwdHeader', from_name: 'Алиса', date: 0 },
      },
    }))
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const live = r.messages.find((m) => m.id === cid(4))
    expect(live).toBeTruthy()
    expect(live?.reply_to?.reply_to_peer_id).toEqual({ _: 'peerChannel', channel_id: 77 })
    expect(live?.reply_to?.reply_from?.from_name).toBe('Алиса')
    // Номер оригинала тоже переведён в клиентское пространство — иначе плашка
    // не нашла бы его в окне.
    expect(live?.reply_to?.reply_to_msg_id).toBe(cid(999))
  })

  // Эхо своей отправки узнаётся по `random_id` — КОНСТРУКТОРНОМУ параметру
  // схемы, а не по нашему `client_msg_id` рядом с ним. По нему же сливается
  // временный бабл (messageOps.insert), поэтому потеря поля в кэше означала бы
  // «отправляется…» рядом с уже отправленным после переоткрытия чата.
  it('preserves random_id of a live message for cache reopen', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.cacheLive(liveEvt(makeRawMessage({
      id: 4, peerId: 1, fromId: 1, text: 'hi', createdAt: '2026-06-24T10:00:00Z', randomId: 'c-live-1',
    })))
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const live = r.messages.find((m) => m.id === cid(4))
    expect(live).toBeTruthy()
    expect(live?.random_id).toBe('c-live-1')
  })

  // Task 3 (Stage 1B.2): cacheLive должен возвращать MessageOp[] — операции для
  // проектора на главном потоке. Обычное сообщение → одна операция insert с
  // ключом основного окна (тот же формат, что hkey/winKey — просто String(peerId)).
  it('returns one insert op keyed to the main window for an ordinary message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheLive(liveEvt(makeRawMessage({
      id: 4, peerId: 1, fromId: 1, text: 'hi', createdAt: '2026-06-24T10:00:00Z',
    })))
    expect(ops).toHaveLength(1)
    expect(ops[0]).toEqual({ op: 'insert', key: '1', msg: expect.objectContaining({ id: cid(4) }) })
  })

  // Тред-сообщение при обоих загруженных срезах (основное окно чата + окно
  // треда) → ДВЕ операции, по одной на каждое затронутое окно (порт applyIncoming,
  // который пишет в оба ключа при threadRootId).
  it('returns two insert ops (main + thread window) when both slices are loaded', async () => {
    // thread window — свой ключ истории (thread_root=100), тоже полная «нижняя»
    // страница (offsetId=0 → всегда держит низ). Чат — группа: тред есть только
    // у группы/канала (tweb getThreadKey :11910).
    const threadPage = { messages: [makeRawMessage({ id: 2, peerId: -1, fromId: 1, text: 'root reply', threadRootId: 100, createdAt: '2026-06-24T10:00:00Z' }) as RawMessage], count: 1 }
    const rest = {
      get: async (_path: string, q?: Record<string, string | number>) => {
        if (q?.thread_root === 100) return threadPage
        return rawPage([3, 2, 1], -1)
      },
      post: async () => ({}),
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: -1, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: -1, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(100) })
    // Корень треда живёт ВНУТРИ ссылки на ответ (`reply_to.reply_to_top_id`) —
    // отдельного `thread_root_id` рядом с сообщением больше нет.
    const ops = mgr.cacheLive(liveEvt(makeRawMessage({
      id: 5, peerId: -1, fromId: 1, text: 'thread hi', threadRootId: 100, createdAt: '2026-06-24T10:00:00Z',
    })))
    expect(ops).toHaveLength(2)
    expect(ops.map((o) => o.key).sort()).toEqual(['-1', `-1:${cid(100)}`])
    for (const op of ops) {
      expect(op.op).toBe('insert')
      if (op.op === 'insert') expect(op.msg.id).toBe(cid(5))
    }
  })

  // A1-16 + порт getMessageThreadId (tweb getThreadKey, appMessagesManager.ts:11903-11921):
  // в форуме простое сообщение темы — `reply_to_msg_id` = номер темы с
  // `forum_topic`, БЕЗ `reply_to_top_id`; без флага — General.
  it('форум: сообщение темы уходит в окно темы, без `forum_topic` — в окно General', async () => {
    const FORUM = -5
    const forumChat = { _: 'channel', id: 5, title: 'Ф', pFlags: { megagroup: true, forum: true } } as unknown as Chat
    const rest = {
      get: async () => ({ messages: [], count: 0 }),
      post: async () => ({}),
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest, getPeer: (id) => (id === FORUM ? forumChat : undefined) })
    await mgr.getHistory({ peerId: FORUM, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(10) })
    await mgr.getHistory({ peerId: FORUM, offsetId: 0, addOffset: 0, limit: 40, threadRoot: GENERAL_TOPIC_ID })
    const inTopic = mgr.cacheLive(liveEvt(makeRawMessage({ id: 11, peerId: FORUM, fromId: 1, replyToMsgId: 10, forumTopic: true })))
    expect(inTopic.map((o) => o.key)).toEqual([`${FORUM}:${cid(10)}`])
    const inGeneral = mgr.cacheLive(liveEvt(makeRawMessage({ id: 12, peerId: FORUM, fromId: 1 })))
    expect(inGeneral.map((o) => o.key)).toEqual([`${FORUM}:${GENERAL_TOPIC_ID}`])
  })

  // tweb getThreadKey :11910 — тред только у группы/канала: ответ в личке
  // окна треда «номер ответа» не заводит (ревью КЛ-1 М1)
  it('личка: ответ уходит в основное окно, не в тред номера ответа', async () => {
    const USER = 7
    const rest = {
      get: async () => ({ messages: [], count: 0 }),
      post: async () => ({}),
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest, getPeer: () => undefined })
    await mgr.getHistory({ peerId: USER, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: USER, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(3) })
    const reply = mgr.cacheLive(liveEvt(makeRawMessage({ id: 4, peerId: USER, fromId: USER, replyToMsgId: 3 })))
    expect(reply.map((o) => o.key)).toEqual([`${USER}`])
  })

  // КРИТИЧНО: окно, не державшее низ истории (сохранена только «средняя»/старая
  // страница, offsetId!==0 без short-page), должно дать НОЛЬ операций — та же
  // семантика, что и сам гейт вставки в SSOT (messagesManager.ts:~500-501). Иначе
  // главный поток вставит туда, где воркер не вставлял, и представления разъедутся.
  it('produces no op for a window that did not hold the bottom of history', async () => {
    const { rest } = countingRest({ '10:1:3': rawPage([9, 8, 7]) }) // paging older, full (non-short) page
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 2, offsetId: cid(10), addOffset: 1, limit: 3 })
    const ops = mgr.cacheLive(liveEvt(makeRawMessage({
      id: 99, peerId: 2, fromId: 1, text: 'x', createdAt: '2026-06-24T10:00:00Z',
    })))
    expect(ops).toEqual([])
  })

  // tweb getDiscussionMessage (:8843-8846): горизонты и последнее сообщение
  // треда комментариев уходят владельцу прочтения тредов клиентскими номерами
  it('getDiscussionMessage: состояние треда — `saveDiscussion` клиентскими номерами', async () => {
    const mirror = makeRawMessage({ id: 200, peerId: -5, fromId: -5, text: 'пост' }) as RawMessage
    const rest = {
      get: async () => ({ _: 'messages.discussionMessage', messages: [mirror], max_id: 230, read_inbox_max_id: 225, read_outbox_max_id: 220, unread_count: 4, chats: [], users: [] }),
    } as unknown as RestClient
    const saveDiscussion = vi.fn()
    const mgr = newMessagesManager({ rest, saveDiscussion })
    const m = await mgr.getDiscussionMessage(-3, cid(9))
    expect(m?.id).toBe(cid(200))
    expect(saveDiscussion).toHaveBeenCalledWith(-5, cid(200), { maxId: cid(230), readMaxId: cid(225), readOutboxMaxId: cid(220), unreadCount: 4 })
  })

  // tweb `threadsToReplies` (:8772-8779, :8859, :11876-11898, :11923-11937):
  // футер поста подписывается на тред, и пост перечитывается на новое и
  // удалённое сообщение треда и на прочтение треда.
  describe('тред поста — перечитывание поста (threadsToReplies)', () => {
    const CHANNEL = -3
    const GROUP = -5
    const POST = 9
    const MIRROR = 200
    const setup = () => {
      const mirror = makeRawMessage({ id: MIRROR, peerId: GROUP, fromId: GROUP, text: 'пост' }) as RawMessage
      const get = vi.fn(async (path: string) => path.endsWith('/discussion')
        ? { _: 'messages.discussionMessage', messages: [mirror], max_id: 230, read_inbox_max_id: 225, chats: [], users: [] }
        : { messages: [] })
      const rest = { get, post: async () => ({}) } as unknown as RestClient
      const mgr = newMessagesManager({ rest })
      const reloads = () => get.mock.calls.filter(([path]) => path === `/chats/${CHANNEL}/messages`).length
      const discussions = () => get.mock.calls.filter(([path]) => String(path).endsWith('/discussion')).length
      return { mgr, reloads, discussions }
    }
    const comment = (id: number): MyMessage => mapMyMessage({
      ...makeRawMessage({ id, peerId: GROUP, fromId: 7, text: 'к' }),
      reply_to: { _: 'messageReplyHeader', reply_to_msg_id: MIRROR, reply_to_top_id: MIRROR },
    } as RawMyMessage, 1)

    it('subscribeRepliesThread: один запрос discussion на пост, повтор — ничего', async () => {
      const { mgr, discussions } = setup()
      mgr.subscribeRepliesThread(CHANNEL, cid(POST))
      mgr.subscribeRepliesThread(CHANNEL, cid(POST))
      await new Promise((r) => setTimeout(r, 0))
      mgr.subscribeRepliesThread(CHANNEL, cid(POST))
      expect(discussions()).toBe(1)
    })

    it('новое сообщение треда перечитывает пост; чужой тред — нет', async () => {
      const { mgr, reloads } = setup()
      mgr.updateMessageRepliesIfNeeded(comment(231))
      await new Promise((r) => setTimeout(r, 0))
      expect(reloads()).toBe(0) // тред ещё не подписан
      await mgr.getDiscussionMessage(CHANNEL, cid(POST))
      mgr.updateMessageRepliesIfNeeded(comment(232))
      await new Promise((r) => setTimeout(r, 0))
      expect(reloads()).toBe(1)
    })

    it('удалённое сообщение треда перечитывает пост (tweb :14082)', async () => {
      const { mgr, reloads } = setup()
      await mgr.getDiscussionMessage(CHANNEL, cid(POST))
      await mgr.saveApiMessages([{ ...makeRawMessage({ id: 233, peerId: GROUP, fromId: 7, text: 'к' }), reply_to: { _: 'messageReplyHeader', reply_to_msg_id: MIRROR, reply_to_top_id: MIRROR } } as RawMyMessage])
      mgr.cacheDelete({ _: 'updateDeletePeerMessages', peer: { _: 'peerChannel', channel_id: 5 }, messages: [233] })
      await new Promise((r) => setTimeout(r, 0))
      expect(reloads()).toBe(1)
    })

    it('прочтение треда перечитывает пост', async () => {
      const { mgr, reloads } = setup()
      await mgr.getDiscussionMessage(CHANNEL, cid(POST))
      mgr.onThreadRead(GROUP, cid(MIRROR))
      mgr.onThreadRead(GROUP, cid(MIRROR + 1))
      await new Promise((r) => setTimeout(r, 0))
      expect(reloads()).toBe(1)
    })
  })

  // Комментарий канала: окно треда адресовано номером ЗЕРКАЛА поста в группе
  // обсуждения (tweb `getDiscussionMessage` → `threadId` = mid в группе), тем
  // же номером, что `reply_to_top_id` комментария. Поэтому и эхо своей
  // отправки, и ЧУЖОЙ живой комментарий попадают в открытое окно треда (Б-110).
  describe('тред комментариев адресован номером зеркала', () => {
    const MIRROR = 200
    const threadKey = `-5:${cid(MIRROR)}`
    const openThread = async () => {
      // Окно треда: корень — зеркало поста в группе, под своим номером.
      const mirror = makeRawMessage({ id: MIRROR, peerId: -5, fromId: -5, text: 'пост', createdAt: '2026-06-24T09:00:00Z' }) as RawMessage
      const rest = {
        get: async () => ({ messages: [mirror], count: 1 }),
        post: async () => ({}),
      } as unknown as RestClient
      const ops: MessageOp[] = []
      const mgr = newMessagesManager({ rest, broadcast: (e, p) => { if (e === RT.messageOp) ops.push(...(p as { ops: MessageOp[] }).ops) } })
      await mgr.getHistory({ peerId: -5, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(MIRROR) })
      return { mgr, ops }
    }

    it('чужой живой комментарий вставляется в открытое окно треда', async () => {
      const { mgr } = await openThread()
      const ops = mgr.cacheLive(liveEvt(makeRawMessage({
        id: 8, peerId: -5, fromId: 2, text: 'чужой', threadRootId: MIRROR, createdAt: '2026-06-24T10:00:00Z',
      })))
      expect(ops.find((o) => o.key === threadKey)).toEqual({ op: 'insert', key: threadKey, msg: expect.objectContaining({ id: cid(8) }) })
    })

    it('эхо своей отправки раньше ack финализирует бабл в окне треда', async () => {
      const { mgr, ops } = await openThread()
      await mgr.sendText({ peerId: -5, text: 'коммент', clientMsgId: 'c-thread-1', threadId: cid(MIRROR), optimistic: { senderId: 1 } })
      expect(ops.find((o) => o.key === threadKey)?.op).toBe('insert') // временный бабл в окне треда

      const echoOps = mgr.cacheLive(liveEvt(makeRawMessage({
        id: 7, peerId: -5, fromId: 1, text: 'коммент', threadRootId: MIRROR, randomId: 'c-thread-1', createdAt: '2026-06-24T10:00:00Z',
      })))

      const thread = echoOps.find((o) => o.key === threadKey)
      expect(thread).toEqual({ op: 'insert', key: threadKey, msg: expect.objectContaining({ id: cid(7), random_id: 'c-thread-1' }), sequential: true })
      // ack после эха — no-op: финализировать больше нечего, и это не потеря
      expect(mgr.ackPendingMessage({ client_msg_id: 'c-thread-1', id: 7, date: 1782295200 })).toEqual([])
    })
  })
})

// Пин на СПОСОБ: `cacheLive` не имеет своего маппера. Раньше их было два —
// `fromNewMessageEvt` для живого кадра и `mapMessage` для страницы истории, —
// и они молча расходились полями (кадр нёс сообщение плоско, страница —
// объектом). Теперь проводная форма ОДНА (`updateNewMessage`: сообщение целиком
// под ключом `message`), поэтому маппер тоже один, и расхождение невозможно
// by construction. Тест краснеет, если в `cacheLive` снова заведут параллельный
// литерал сборки сообщения.
describe('MessagesManager.cacheLive — сообщение собирает ТОТ ЖЕ маппер, что и страница истории', () => {
  const ME = 9
  // Кадр с максимумом полей конструктора `message`, какие несёт живое сообщение.
  // Чат — группа: тред есть только у группы/канала (tweb getThreadKey :11910).
  const fullMessage: RawMessageReal = {
    ...makeRawMessage({
      id: 42, peerId: -3, fromId: ME, text: 'caption', createdAt: '2026-08-10T13:00:00Z',
      entities: [{ _: 'messageEntityBold', offset: 0, length: 3 }],
      threadRootId: 100, replyToMsgId: 41, groupedId: 7007, randomId: 'c-parity-1',
      mediaUnread: true, out: true,
      media: {
        _: 'messageMediaPhoto',
        photo: {
          _: 'photo', id: 555,
          sizes: [
            { _: 'photoStrippedSize', type: 'i', bytes: 'abc' },
            { _: 'photoSize', type: 'y', w: 320, h: 240, size: 1024 },
            { _: 'photoSize', type: 'w', w: 640, h: 480, size: 2048 },
          ],
        },
      },
    }),
    fwd_from: { _: 'messageFwdHeader', from_id: { _: 'peerUser', user_id: 11 }, date: 1754733600, channel_post: 13 },
    reply_markup: { _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'Click', data: 'Y2I=' }] }] },
    effect_name: 'confetti',
    secretMedia: { mediaId: 1, keyB64: 'k', ivB64: 'i', name: 'photo.jpg', mime: 'image/jpeg', size: 2048, mediaType: 'photo' },
  } as RawMessageReal

  it('cacheLive(evt).msg равен mapMyMessage(evt.message) без исключений', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([1]) })
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    await mgr.getHistory({ peerId: -3, offsetId: 0, addOffset: 0, limit: 40 }) // держит низ — гейт вставки открыт
    const ops = mgr.cacheLive(liveEvt(fullMessage))
    const main = ops.find((o) => o.key === '-3')
    expect(main?.op).toBe('insert')
    expect(main && main.op === 'insert' ? main.msg : null).toEqual(mapMyMessage(fullMessage, ME))
  })

  it('тред-ключ той же операции тоже несёт полный (не урезанный) msg', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([1]) })
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    await mgr.getHistory({ peerId: -3, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: -3, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(100) })
    const ops = mgr.cacheLive(liveEvt(fullMessage))
    const thread = ops.find((o) => o.key === `-3:${cid(100)}`)
    expect(thread?.op).toBe('insert')
    expect(thread && thread.op === 'insert' ? thread.msg : null).toEqual(mapMyMessage(fullMessage, ME))
  })

  // `pFlags.out` производит СЕРВЕР (решение Р7 отменено): владелец его больше не
  // выводит и не имеет права переспорить. Прежний describe про `send_as` здесь
  // УДАЛЁН вместе с предметом — параметра `send_as` на проводе не существует, а
  // правило «сообщение от лица канала рисуется входящим» выражено через `from_id`
  // (ссылку на ЧАТ, а не на человека) и пинится там, где ему место, —
  // `core/models.test.ts` (предикат) и `core/messageToConvMsg.test.ts` (сторона
  // бабла). Здесь остаётся ровно то, за что отвечает менеджер: флаг доезжает как есть.
  it('pFlags.out кадра доезжает до операции неизменным', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([1]) })
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    await mgr.getHistory({ peerId: -3, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheLive(liveEvt(fullMessage))
    const main = ops.find((o) => o.key === '-3')
    expect(main && main.op === 'insert' ? main.msg.pFlags.out : null).toBe(true)
  })
})

// Баг (см. BRIEF.md): cacheEdit патчил только text/entities/editedAt и молча
// игнорировал reply_markup из кадра edit_message, хотя витрина применяет его
// (storeProjection.ts: RT.editMessage → applyEdit(..., e.reply_markup ?? null)).
// Значит живая правка клавиатуры бота выглядела правильно (витрина её ловила
// из сырого кадра мимо SSOT), а SSOT воркера оставался со старой клавиатурой —
// расхождение всплывало только при переоткрытии чата/второй вкладке, поднимающей
// окно из кэша воркера. Правило то же, что у витрины: поле есть → положить
// значение кадра, поля нет → клавиатура снята (бэк шлёт reply_markup абсолютным
// значением, backend/internal/usecase/chat/frame.go:243).
describe('MessagesManager.cacheEdit — reply_markup', () => {
  function pageWithMarkup(): { messages: RawMessage[]; count: number } {
    const messages = [3, 2, 1].map((id) => ({
      ...makeRawMessage({ id, peerId: 1, fromId: 1, text: `m${id}`, createdAt: '2026-06-24T10:00:00Z' }),
      ...(id === 2 ? { reply_markup: { _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'Old', data: 'b2xk' }] }] } } : {}),
    }) as RawMessage)
    return { messages, count: messages.length }
  }

  it('maps reply_markup into the SSOT when the edit carries a new keyboard', async () => {
    const { rest } = countingRest({ '0:0:40': pageWithMarkup() })
    const mgr = newMessagesManager({ rest })
    const before = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(real(before.messages.find((m) => m.id === cid(2)))?.reply_markup).toEqual({ _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'Old', data: 'b2xk' }] }] })
    // Кадр несёт сообщение ЦЕЛИКОМ — той же формы, что приходит историей.
    mgr.cacheEdit({
      _: 'updateEditMessage',
      message: makeRawMessage({
        id: 2, peerId: 1, fromId: 1, text: 'edited', editDate: 1_786_536_000,
        replyMarkup: { _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'New', data: 'bmV3' }] }] },
      }),
    })
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const edited = real(r.messages.find((m) => m.id === cid(2)))
    expect(edited?.reply_markup).toEqual({ _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'New', data: 'bmV3' }] }] })
  })

  it('clears replyMarkup in the SSOT when the edit carries no reply_markup (removed)', async () => {
    const { rest } = countingRest({ '0:0:40': pageWithMarkup() })
    const mgr = newMessagesManager({ rest })
    const before = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(real(before.messages.find((m) => m.id === cid(2)))?.reply_markup).toEqual({ _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'Old', data: 'b2xk' }] }] })
    mgr.cacheEdit({
      _: 'updateEditMessage',
      message: makeRawMessage({ id: 2, peerId: 1, fromId: 1, text: 'edited', editDate: 1_786_536_000 }),
    })
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(real(r.messages.find((m) => m.id === cid(2)))?.reply_markup).toBeUndefined()
  })
})

// Stage 1B.3 (Task 3): простые правки сообщения (без обогащений витрины, см.
// docs/research/2026-08-10-message-enrichments.md) переведены на операции — по
// одной 'patch'/'remove' на каждое окно, где сообщение видно. rawPage([id...])
// заводит id===seq, поэтому msg_id ниже совпадает с seq тестовых фикстур.
// Op-перевод правки (messages.cacheEdit, в том числе гео) покрыт сквозным
// тестом client/realtime/storeProjection.windowWriters.test.ts.

// Тред-фикстура (порт паттерна из describe('MessagesManager.cacheLive') выше):
// сообщение id=2/seq=2 видно и в основном окне чата (rawPage[3,2,1]), и в окне
// треда (thread_root=100) — оба среза ссылаются на ОДНУ запись SSOT (карта по
// чату, не по окну), поэтому это годный фикстур для проверки многооконности.
function restWithThreadOverlap(): RestClient {
  const threadPage = {
    messages: [makeRawMessage({
      id: 2, peerId: 1, fromId: 1, text: 'root reply', threadRootId: 100,
      createdAt: '2026-06-24T10:00:00Z',
    }) as RawMessage],
    count: 1,
  }
  return {
    get: async (_path: string, q?: Record<string, string | number>) => {
      if (q?.thread_root === 100) return threadPage
      return rawPage([3, 2, 1])
    },
    post: async () => ({}),
  } as unknown as RestClient
}

/** Карточка ссылки в форме кадра: конструктор, а не плоский снимок. */
function webPageMedia(title: string): MessageMedia {
  return {
    _: 'messageMediaWebPage', pFlags: {},
    webpage: { _: 'webPage', pFlags: {}, url: 'https://x/', display_url: 'x', title },
  }
}

describe('MessagesManager.cacheWebPage', () => {
  it('returns a patch op carrying the mapped web page for an existing message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    // Кадр несёт КОНСТРУКТОР — тот же, что и в самом сообщении, с обычной
    // лестницей ступеней у картинки. Плоской формы (`site_name`/`photo_w`/
    // `photo_blur` россыпью) на проводе нет, поэтому и переводить нечего.
    const media: MessageMedia = {
      _: 'messageMediaWebPage', pFlags: {},
      webpage: {
        _: 'webPage', pFlags: {}, url: 'https://x/', display_url: 'x',
        site_name: 'X', title: 'Title', has_iv: true,
        photo: {
          _: 'photo', id: 7,
          sizes: [
            { _: 'photoStrippedSize', type: 'i', bytes: 'Ymx1cg==' },
            { _: 'photoSize', type: 'y', w: 1280, h: 640, size: 0 },
            { _: 'photoSize', type: 'w', w: 2000, h: 1000, size: 0 },
          ],
        },
      },
    }
    const evt: WebPageUpdateEvt = { _: 'updateMessageWebPage', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2, media }
    const ops = mgr.cacheWebPage(evt)
    // Номер в кадре СЕРВЕРНЫЙ, в операции — уже клиентский: иначе патч не нашёл
    // бы сообщение в окне. Вложение доезжает как есть.
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { media } }])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheWebPage({ _: 'updateMessageWebPage', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 999, media: webPageMedia('Title') })
    expect(ops).toEqual([])
  })

  // Многооконность: воркерный patchMsg мутирует ОДНУ копию в SSOT (единая Map на
  // чат) и останавливается на первом совпадении — но сторный patchChat проходит по
  // ВСЕМ окнам чата. Без явного перечисления окон операция дошла бы только до
  // одного, и окно треда осталось бы со старыми данными.
  it('returns one patch op per window when the message is visible in both the main and thread windows', async () => {
    const mgr = newMessagesManager({ rest: restWithThreadOverlap() })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(100) })
    const evt: WebPageUpdateEvt = { _: 'updateMessageWebPage', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2, media: webPageMedia('Title') }
    const ops = mgr.cacheWebPage(evt)
    expect(ops).toHaveLength(2)
    expect(ops.map((o) => o.key).sort()).toEqual(['1', `1:${cid(100)}`])
    for (const op of ops) {
      expect(op.op).toBe('patch')
      if (op.op === 'patch') {
        expect(op.fields.media?._).toBe('messageMediaWebPage')
        expect(op.fields.media?._ === 'messageMediaWebPage' && op.fields.media.webpage.title).toBe('Title')
      }
    }
  })
})

describe('MessagesManager.cacheFactCheck', () => {
  it('returns a patch op carrying the mapped fact-check for an existing message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    // `factCheck` — КОНСТРУКТОР схемы, приезжающий целиком (текст внутри —
    // `textWithEntities`), поэтому маппера у него нет и быть не должно.
    const evt: FactCheckUpdateEvt = {
      _: 'updateMessageFactCheck', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2,
      factcheck: { _: 'factCheck', country: 'RU', text: { _: 'textWithEntities', text: 'проверено', entities: [] } },
    }
    const ops = mgr.cacheFactCheck(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { factcheck: evt.factcheck } }])
  })

  // «Сняли» — ОТСУТСТВИЕ параметра в кадре (а не null под тем же ключом);
  // fields.factcheck при этом обязан быть undefined, как и у остальных cacheX.
  it('returns fields.factcheck: undefined when the fact-check is removed', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheFactCheck({ _: 'updateMessageFactCheck', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2 })
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { factcheck: undefined } }])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheFactCheck({ _: 'updateMessageFactCheck', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 999 })
    expect(ops).toEqual([])
  })
})

// «Проверка фактов» СВОИМ действием. Оптимистика: `patch {factcheck}` уходит в
// окно ДО ответа сервера, а на упавшей сети откатывается предыдущим значением —
// та же форма, что у своей реакции (`messages/reactionMethods.ts::react`).
// Долг снесённой React-ленты: прежде «показать сразу» делал main-сторный
// мутатор по второй копии окна, и вместе с ней отклик до эха исчез.
//
// У tweb оптимистики здесь нет вовсе (`updateFactCheck`,
// `lib/appManagers/appMessagesManager.ts:10812-10830`, просто ждёт `Updates`) —
// это наша модель отклика на своё действие, и она объявлена расхождением.
describe('MessagesManager.setFactCheck (оптимистика)', () => {
  /** REST, у которого POST зависает до ручного `release` — только так видно,
   *  что патч объявлен РАНЬШЕ ответа, а не «где-то до конца вызова». */
  function pendingPostRest() {
    const { rest: base } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    let release!: (v: RawMessageReal) => void
    let reject!: (e: unknown) => void
    const answer = new Promise<RawMessageReal>((res, rej) => { release = res; reject = rej })
    const rest = {
      ...(base as unknown as { get: RestClient['get'] }),
      post: () => answer,
    } as unknown as RestClient
    return { rest, release: (v: RawMessageReal) => release(v), reject: (e: unknown) => reject(e) }
  }

  const CHECK = { _: 'factCheck' as const, country: 'RU', text: { _: 'textWithEntities' as const, text: 'проверено', entities: [] } }

  it('объявляет patch {factcheck} ДО ответа сервера', async () => {
    const { rest, release } = pendingPostRest()
    const ops: MessageOp[] = []
    const mgr = newMessagesManager({ rest, broadcast: (e, p) => { if (e === RT.messageOp) ops.push(...(p as { ops: MessageOp[] }).ops) } })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })

    const promise = mgr.setFactCheck(1, cid(2), 'проверено', [], 'RU')
    // Сеть ещё не ответила — а окно уже знает.
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { factcheck: CHECK } }])

    release({ ...makeRawMessage({ id: 2, peerId: 1, fromId: 1, text: 'm2' }), factcheck: CHECK } as RawMessageReal)
    await promise
    // Серверное значение объявляется вторым патчем — он абсолютный, поэтому
    // повтор идемпотентен.
    expect(ops[ops.length - 1]).toEqual({ op: 'patch', key: '1', msgId: cid(2), fields: { factcheck: CHECK } })
  })

  it('на упавшей сети откатывает объявленное предыдущим значением', async () => {
    const { rest, reject } = pendingPostRest()
    const ops: MessageOp[] = []
    const mgr = newMessagesManager({ rest, broadcast: (e, p) => { if (e === RT.messageOp) ops.push(...(p as { ops: MessageOp[] }).ops) } })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })

    const promise = mgr.setFactCheck(1, cid(2), 'проверено', [], 'RU')
    reject(new Error('offline'))
    await expect(promise).rejects.toThrow('offline')

    // Проверки на сообщении не было — откат объявляет ОТСУТСТВИЕ параметра.
    expect(ops).toEqual([
      { op: 'patch', key: '1', msgId: cid(2), fields: { factcheck: CHECK } },
      { op: 'patch', key: '1', msgId: cid(2), fields: { factcheck: undefined } },
    ])
  })

  // Имя поля модели — `factcheck` нижним регистром; здесь уже был дефект, где
  // патчился несуществующий `factCheck`, и SSOT воркера правки не видел.
  it('пишет оптимистику в SSOT воркера полем `factcheck`', async () => {
    const { rest, release } = pendingPostRest()
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })

    const promise = mgr.setFactCheck(1, cid(2), 'проверено', [], 'RU')
    const page = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(real(page.messages.find((m) => m.id === cid(2)))?.factcheck).toEqual(CHECK)

    release({ ...makeRawMessage({ id: 2, peerId: 1, fromId: 1, text: 'm2' }), factcheck: CHECK } as RawMessageReal)
    await promise
  })
})

describe('MessagesManager.cacheMediaRead', () => {
  function voicePage(unread: boolean) {
    return {
      messages: [makeRawMessage({
        id: 7, peerId: 1, fromId: 1, text: '', createdAt: '2026-06-24T10:00:00Z',
        mediaUnread: unread,
        media: {
          _: 'messageMediaDocument',
          document: {
            _: 'document', id: 5, mime_type: 'audio/ogg', size: 10,
            attributes: [{ _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 3 }],
          },
        },
      }) as RawMessage],
      count: 1,
    }
  }

  it('returns a patch op clearing mediaUnread for an unread voice message', async () => {
    const { rest } = countingRest({ '0:0:40': voicePage(true) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const evt: MediaReadEvt = { _: 'updateReadPeerMessagesContents', peer: { _: 'peerUser', user_id: 1 }, messages: [7] }
    const ops = mgr.cacheMediaRead(evt)
    // «Прочитано» — ОТСУТСТВИЕ флага схемы, а не `false`: пустой `pFlags`
    // и есть снятая точка.
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(7), fields: { pFlags: {} } }])
  })

  // Гейт паритетен воркерному patchMsg: уже прочитанное сообщение не патчится в
  // SSOT — значит и операция на него порождаться не должна (иначе повторный/
  // задвоенный кадр слал бы избыточный, хоть и no-op на сторной стороне, патч).
  it('produces no op when the message is already read (idempotent replay)', async () => {
    const { rest } = countingRest({ '0:0:40': voicePage(false) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheMediaRead({ _: 'updateReadPeerMessagesContents', peer: { _: 'peerUser', user_id: 1 }, messages: [7] })
    expect(ops).toEqual([])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheMediaRead({ _: 'updateReadPeerMessagesContents', peer: { _: 'peerUser', user_id: 1 }, messages: [999] })
    expect(ops).toEqual([])
  })
})

// Ф-6, задача 18: кадр `media_read` от readMentions несёт ВСЕ снятые номера
// (tweb onUpdateReadMessagesContents, appMessagesManager.ts:10996-11079 — цикл
// по `mids`), впервые от сервера.
describe('MessagesManager: кадр прочтения содержимого с вектором номеров', () => {
  const FORUM = -5
  const forumChat = { _: 'channel', id: 5, title: 'Ф', pFlags: { megagroup: true, forum: true } } as unknown as Chat
  const unreadMention = { mentioned: true, media_unread: true } as const
  const inTopic = (id: number, topic: number, flags: Record<string, true> = unreadMention) =>
    ({ ...makeRawMessage({ id, peerId: FORUM, fromId: 9, text: `m${id}`, replyToMsgId: topic, forumTopic: true }), pFlags: flags }) as RawMessage
  const general = (id: number, flags: Record<string, true> = unreadMention) =>
    ({ ...makeRawMessage({ id, peerId: FORUM, fromId: 9, text: `m${id}` }), pFlags: flags }) as RawMessage
  const frame = (messages: number[]): MediaReadEvt => ({ _: 'updateReadPeerMessagesContents', peer: { _: 'peerChannel', channel_id: 5 }, messages })

  async function setup(list: RawMessage[]) {
    const rest = { get: async () => ({ messages: list, count: list.length }), post: async () => ({}) } as unknown as RestClient
    const mgr = newMessagesManager({ rest, getPeer: (id) => (id === FORUM ? forumChat : undefined) })
    await mgr.getHistory({ peerId: FORUM, offsetId: 0, addOffset: 0, limit: 40 })
    return mgr
  }

  it('cacheMediaRead гасит точку у КАЖДОГО названного сообщения, а не только у первого', async () => {
    const mgr = await setup([inTopic(5, 4), general(7), general(8, {})])
    const ops = mgr.cacheMediaRead(frame([5, 7, 8]))
    // у 8 точки не было — операции на него нет
    expect(ops.map((o) => (o as { msgId: number }).msgId).sort((a, b) => a - b)).toEqual([cid(5), cid(7)])
    expect(mgr.cacheMediaRead(frame([5, 7]))).toEqual([]) // повтор — идемпотентно
  })

  it('mediaReadEffects: тема каждого снимаемого упоминания и число номеров вне памяти', async () => {
    const mgr = await setup([inTopic(5, 4), general(7), inTopic(8, 4, {}), { ...inTopic(9, 4), pFlags: { ...unreadMention, out: true } } as RawMessage])
    // 8 уже прочитано, 9 моё, 50 в памяти нет
    expect(mgr.mediaReadEffects(frame([5, 7, 8, 9, 50]))).toEqual({ mentionThreads: [cid(4), GENERAL_TOPIC_ID], readReactions: [], missing: 1 })
  })

  it('не форум: тема не выводится — упоминание считается за диалог', async () => {
    const rest = { get: async () => ({ messages: [{ ...makeRawMessage({ id: 3, peerId: 1, fromId: 9, text: 'x' }), pFlags: unreadMention }], count: 1 }), post: async () => ({}) } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(mgr.mediaReadEffects({ _: 'updateReadPeerMessagesContents', peer: { _: 'peerUser', user_id: 1 }, messages: [3] }))
      .toEqual({ mentionThreads: [undefined], readReactions: [], missing: 0 })
  })
})

// Порт цикла tweb onUpdateReadHistory (appMessagesManager.ts:10851-10892) в
// части «@»: свежими вперёд, выше горизонта кадра — мимо, исходящие — мимо,
// первое уже прочитанное (по горизонту ДО кадра) обрывает проход.
describe('MessagesManager.countReadMentions', () => {
  const msg = (id: number, flags: Record<string, true> = {}) =>
    ({ ...makeRawMessage({ id, peerId: 1, fromId: 9, text: `m${id}`, createdAt: '2026-06-24T10:00:00Z' }), pFlags: flags }) as RawMessage
  const mention = { mentioned: true, media_unread: true } as const
  const setup = async (messages: RawMessage[]) => {
    const { rest } = countingRest({ '0:0:40': { messages, count: messages.length } })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    return mgr
  }

  it('считает непрочитанные упоминания между горизонтами', async () => {
    const mgr = await setup([msg(6, mention), msg(5, mention), msg(4), msg(3, mention), msg(2, mention)])
    // Горизонт кадра — 5: упоминание 6 выше него и остаётся; прочитано было до 2.
    expect(mgr.countReadMentions(1, cid(5), cid(2))).toBe(2)
  })

  it('исходящие и прочитанные упоминания (без media_unread) не в счёт', async () => {
    const mgr = await setup([msg(4, { ...mention, out: true }), msg(3, { mentioned: true }), msg(2, mention)])
    expect(mgr.countReadMentions(1, cid(4), cid(1))).toBe(1)
  })

  it('повтор того же прочтения — ноль: горизонт уже сдвинут', async () => {
    const mgr = await setup([msg(3, mention), msg(2, mention)])
    expect(mgr.countReadMentions(1, cid(3), cid(3))).toBe(0)
  })

  it('чата в памяти нет — ноль', async () => {
    const mgr = await setup([])
    expect(mgr.countReadMentions(42, cid(3), 0)).toBe(0)
  })
})

// Порт tweb onUpdatePinnedMessages (appMessagesManager.ts:11719-11751): бит
// `pinned` у сообщений окна ставится/снимается тем же конструктором кадра,
// окно узнаёт операцией — по ней меню сообщения выбирает «Открепить».
describe('MessagesManager.cachePinned', () => {
  const peer = { _: 'peerUser' as const, user_id: 1 }

  it('закрепление ставит pFlags.pinned, открепление снимает (отсутствие бита)', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })

    const pin = mgr.cachePinned({ _: 'updatePinnedMessages', peer, messages: [2, 3], pFlags: { pinned: true } })
    expect(pin).toEqual([
      { op: 'patch', key: '1', msgId: cid(2), fields: { pFlags: { pinned: true } } },
      { op: 'patch', key: '1', msgId: cid(3), fields: { pFlags: { pinned: true } } },
    ])
    expect(mgr.getMessageByPeer(1, cid(2))?.pFlags.pinned).toBe(true)

    const unpin = mgr.cachePinned({ _: 'updatePinnedMessages', peer, messages: [2] })
    expect(unpin).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { pFlags: {} } }])
    expect(mgr.getMessageByPeer(1, cid(2))?.pFlags.pinned).toBeUndefined()
  })

  it('повтор и неизвестное сообщение — без операций', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.cachePinned({ _: 'updatePinnedMessages', peer, messages: [2], pFlags: { pinned: true } })

    expect(mgr.cachePinned({ _: 'updatePinnedMessages', peer, messages: [2], pFlags: { pinned: true } })).toEqual([])
    expect(mgr.cachePinned({ _: 'updatePinnedMessages', peer, messages: [999], pFlags: { pinned: true } })).toEqual([])
  })
})

// f6-pin: тело `messages.updatePinnedMessage` и разбор ответа `Updates` (tweb
// appMessagesManager.ts:6838-6856: ответ идёт в `processUpdateMessage`), локальный итог
// `unpinAllMessages` (:6869-6888).
describe('MessagesManager — закреп: флаги, ответ Updates, «открепить все»', () => {
  const peer = { _: 'peerUser' as const, user_id: 1 }
  const pinUpdate = (messages: number[], pinned = true) =>
    ({ _: 'updatePinnedMessages' as const, peer, messages, pts: 5, pts_count: 1, ...(pinned ? { pFlags: { pinned: true as const } } : {}) })

  async function setup(answer: unknown, ids = [3, 2, 1], over: (id: number) => Record<string, unknown> = () => ({}), peerId = 1) {
    const events: [string, unknown][] = []
    const post = vi.fn(async () => answer)
    const del = vi.fn(async () => answer)
    const rest = {
      get: async () => ({
        messages: ids.map((id) => ({ ...makeRawMessage({ id, peerId, fromId: 1, text: `m${id}`, createdAt: '2026-06-24T10:00:00Z', ...over(id) }) })),
        count: ids.length,
      }),
      post, del,
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest, broadcast: (e, p) => { events.push([e, p]) } })
    await mgr.getHistory({ peerId, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = () => events.filter(([e]) => e === RT.messageOp).flatMap(([, p]) => (p as { ops: MessageOp[] }).ops)
    return { mgr, post, del, ops }
  }

  it('pin: POST …/pin с серверным номером и только истинными флагами', async () => {
    const { mgr, post } = await setup({ _: 'updates', updates: [pinUpdate([2])] })
    await mgr.pin(1, cid(2), { silent: true, pm_oneside: true })
    expect(post).toHaveBeenCalledWith('/chats/1/messages/2/pin', { silent: true, pm_oneside: true })
    await mgr.pin(1, cid(2), { silent: false, pm_oneside: undefined })
    expect(post).toHaveBeenLastCalledWith('/chats/1/messages/2/pin', {})
    await mgr.pin(1, cid(2))
    expect(post).toHaveBeenLastCalledWith('/chats/1/messages/2/pin', {})
  })

  it('ответ pin: updatePinnedMessages сразу помечает сообщение закреплённым; живой кадр следом — без операций', async () => {
    const { mgr, ops } = await setup({ _: 'updates', updates: [pinUpdate([2])] })
    await mgr.pin(1, cid(2))
    expect(ops()).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { pFlags: { pinned: true } } }])
    expect(mgr.getMessageByPeer(1, cid(2))?.pFlags.pinned).toBe(true)
    expect(mgr.cachePinned(pinUpdate([2]))).toEqual([])
  })

  it('ответ канала: updatePinnedChannelMessages приводится к паре того же канала', async () => {
    const channelPeer = toPeerId(7, true)
    const answer = { _: 'updates', updates: [{ _: 'updatePinnedChannelMessages', channel_id: 7, messages: [2], pts: 3, pts_count: 1, pFlags: { pinned: true } }] }
    const { mgr, ops } = await setup(answer, [3, 2], () => ({}), channelPeer)
    await mgr.pin(channelPeer, cid(2))
    expect(ops()).toEqual([{ op: 'patch', key: String(channelPeer), msgId: cid(2), fields: { pFlags: { pinned: true } } }])
  })

  it('unpin: DELETE, ответ без бита снимает закреп', async () => {
    const { mgr, del, ops } = await setup({ _: 'updates', updates: [pinUpdate([2], false)] })
    mgr.cachePinned(pinUpdate([2]))
    await mgr.unpin(1, cid(2))
    expect(del).toHaveBeenCalledWith('/chats/1/messages/2/pin')
    expect(ops()[ops().length - 1]).toEqual({ op: 'patch', key: '1', msgId: cid(2), fields: { pFlags: {} } })
    expect(mgr.getMessageByPeer(1, cid(2))?.pFlags.pinned).toBeUndefined()
  })

  it('listPins: без темы — /pins без параметров, с темой — top_msg_id серверным номером', async () => {
    const get = vi.fn(async () => ({ _: 'messages.messages', messages: [], users: [], chats: [] }))
    const mgr = newMessagesManager({ rest: { get } as unknown as RestClient })
    await mgr.listPins(1)
    expect(get).toHaveBeenLastCalledWith('/chats/1/pins', undefined)
    await mgr.listPins(1, cid(9))
    expect(get).toHaveBeenLastCalledWith('/chats/1/pins', { top_msg_id: 9 })
  })

  it('cacheUnpinAll: снимает pinned у всех закреплённых в окне', async () => {
    const { mgr, ops } = await setup({})
    mgr.cachePinned(pinUpdate([1, 3]))
    const out = mgr.cacheUnpinAll(1)
    expect(out.map((o) => (o as { msgId: number }).msgId).sort((a, b) => a - b)).toEqual([cid(1), cid(3)].sort((a, b) => a - b))
    expect(mgr.getMessageByPeer(1, cid(1))?.pFlags.pinned).toBeUndefined()
    expect(mgr.getMessageByPeer(1, cid(3))?.pFlags.pinned).toBeUndefined()
    expect(ops().filter((o) => o.op === 'patch' && (o.fields as { pFlags?: { pinned?: boolean } }).pFlags?.pinned === undefined).length).toBeGreaterThanOrEqual(2)
    // повтор — снимать нечего
    expect(mgr.cacheUnpinAll(1)).toEqual([])
  })

  it('cacheUnpinAll с threadId: другие треды не трогаются (tweb :6872-6882)', async () => {
    // 3 и 2 — в треде с корнем 1, 1 — вне треда
    const { mgr } = await setup({}, [3, 2, 1], (id) => (id === 1 ? {} : { threadRootId: 1 }))
    mgr.cachePinned(pinUpdate([1, 2, 3]))
    mgr.cacheUnpinAll(1, cid(1))
    expect(mgr.getMessageByPeer(1, cid(2))?.pFlags.pinned).toBeUndefined()
    expect(mgr.getMessageByPeer(1, cid(3))?.pFlags.pinned).toBeUndefined()
    expect(mgr.getMessageByPeer(1, cid(1))?.pFlags.pinned).toBe(true)
  })
})

const lockedPaid: MessageMedia = {
  _: 'messageMediaPaidMedia',
  stars_amount: 10,
  extended_media: [{ _: 'messageExtendedMediaPreview', w: 640, h: 480 }],
}

describe('MessagesManager.cachePaidUnlock', () => {
  it('returns a patch op carrying the media fields + paidMedia (not a whole-message replace)', async () => {
    // Сообщение в SSOT — ЗАБЛОКИРОВАННОЕ платное: цену кадр не везёт (она
    // свойство самого вложения), поэтому обёртку берём у сообщения.
    const { rest } = countingRest({ '0:0:40': mediaPage(2, lockedPaid) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    // Кадр разблокировки несёт ВЛОЖЕНИЕ целиком: у заблокированного сервер
    // отдавал псевдо-фото из одной stripped-ступени (LockedPlaceholder), здесь
    // приезжает настоящая лестница.
    const media: MessageMedia = {
      _: 'messageMediaPhoto',
      photo: {
        _: 'photo',
        id: 55,
        sizes: [
          { _: 'photoStrippedSize', type: 'i', bytes: 'abc' },
          { _: 'photoSize', type: 'w', w: 640, h: 480, size: 2048 },
        ],
      },
    }
    // Оплачено — позиция вектора становится `messageExtendedMedia` с настоящим
    // вложением внутри; цена (`stars_amount`) при этом на месте, она свойство
    // самого платного вложения.
    const unlocked: MessageMedia = {
      _: 'messageMediaPaidMedia',
      stars_amount: 10,
      extended_media: [{ _: 'messageExtendedMedia', media }],
    }
    // Кадр несёт РОВНО предмет — вектор позиций; цена берётся у сообщения,
    // потому что она свойство самого платного вложения, а не приписка кадра.
    const ops = mgr.cachePaidUnlock({
      _: 'updateMessageExtendedMedia', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2,
      extended_media: unlocked.extended_media,
    })
    // Плоского `media_id` рядом нет — адрес файла живёт ВНУТРИ вложения.
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { media: unlocked } }])
    expect(getMediaFromMessage({ media: ops[0].op === 'patch' ? ops[0].fields.media : undefined })!.id).toBe(55)
  })

  // Бэк вычищает у заблокированного медиа ВСЮ мету контента (stripLockedMedia
  // оставляет только псевдо-фото из stripped-ступени) и возвращает её кадром
  // разблокировки. Патч обязан нести вложение целиком и УЖЕ нормализованным
  // (`saveMessageMedia`), иначе у оплаченного документа нет выведенного типа:
  // оплаченное аудио остаётся без подписи, а оплаченная гифка рисуется
  // видео-баблом до перезагрузки истории.
  it('переносит вложение целиком, с выведенным типом документа', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(2, lockedPaid) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cachePaidUnlock({
      _: 'updateMessageExtendedMedia', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2,
      extended_media: [{
        _: 'messageExtendedMedia',
        media: {
          _: 'messageMediaDocument',
          document: {
            _: 'document', id: 55, mime_type: 'video/mp4', size: 10,
            attributes: [
              { _: 'documentAttributeVideo', duration: 3, w: 320, h: 240 },
              { _: 'documentAttributeAnimated' },
              { _: 'documentAttributeFilename', file_name: 'g.mp4' },
            ],
          },
        },
      }],
    })
    const patch = ops[0]
    const fields = patch?.op === 'patch' ? patch.fields : null
    // Нормализация обязана зайти ВНУТРЬ обёртки платного медиа — иначе у
    // оплаченного документа нет выведенного типа.
    const doc = getDocumentFromMessage({ media: fields?.media })
    expect(doc?.type).toBe('gif') // выведен из documentAttributeAnimated
    expect(doc?.file_name).toBe('g.mp4')
    expect(doc?.duration).toBe(3)
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cachePaidUnlock({
      _: 'updateMessageExtendedMedia', peer: { _: 'peerUser', user_id: 1 }, msg_id: 999,
      extended_media: [{ _: 'messageExtendedMedia', media: { _: 'messageMediaPhoto', photo: { _: 'photo', id: 1, sizes: [] } } }],
    })
    expect(ops).toEqual([])
  })
})

describe('MessagesManager.cacheDelete', () => {
  it('returns a remove op for the window holding the deleted message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const evt: DeleteMessageEvt = { _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [2] }
    const ops = mgr.cacheDelete(evt)
    expect(ops).toEqual([{ op: 'remove', key: '1', msgId: cid(2) }])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheDelete({ _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [999] })
    expect(ops).toEqual([])
  })

  // Владелец диалогов вычитает удалённые непрочитанные входящие (tweb
  // onUpdateDeleteMessages) — а «было ли оно входящим» знает только снимок ДО
  // эвикции. Неизвестное SSOT сообщение сообщается СЧЁТОМ (`missing`): посчитать
  // его нечем, и владелец диалогов перечитывает строку с ненулевыми «@»/❤
  // (tweb handleDeletedMessages → fixDialogUnreadMentionsIfNoMessage, :14055-14058).
  it('отдаёт удалённое сообщение снимком до эвикции, неизвестное — счётом (onMessagesDeleted)', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const deleted: { peerId: number; ids: number[]; missing: number }[] = []
    const mgr = newMessagesManager({ rest, onMessagesDeleted: (peerId, list, missing) => deleted.push({ peerId, ids: list.map((m) => m.id), missing }) })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.cacheDelete({ _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [2, 999] })
    expect(deleted).toEqual([{ peerId: 1, ids: [cid(2)], missing: 0 }, { peerId: 1, ids: [], missing: 1 }])
  })

  // Закреп вне окна воркер не знает (кэш закрепов живёт на главном потоке), поэтому
  // сообщение о удалении несёт ВСЕ удалённые клиентские номера, включая неизвестные
  // SSOT (`peer_pinned_deleted`, порт `resetPinnedMessagesCache` tweb :14078-14080).
  it('onMessagesDeleted: четвёртым параметром — клиентский номер, в том числе неизвестного сообщения', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mids: number[][] = []
    const mgr = newMessagesManager({ rest, onMessagesDeleted: (_peerId, _list, _missing, m) => mids.push(m) })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.cacheDelete({ _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [2, 999] })
    expect(mids).toEqual([[cid(2)], [cid(999)]])
  })

  // Владелец диалогов решает по этому срезу, кто станет последним после
  // удаления верхнего (tweb onUpdateDeleteMessages :11579 — `history.first`):
  // к моменту onMessagesDeleted удалённого в срезе уже нет, а низ — загружен.
  it('getHistoryFirstSlice: к onMessagesDeleted срез уже без удалённого и с известным низом', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    let seen: { ids: number[]; bottom: boolean } | undefined
    const mgr = newMessagesManager({
      rest,
      onMessagesDeleted: (peerId) => {
        const slice = mgr.getHistoryFirstSlice(peerId)!
        seen = { ids: [...slice], bottom: slice.isEnd(SliceEnd.Bottom) }
      },
    })
    expect(mgr.getHistoryFirstSlice(1)).toBeUndefined()
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.cacheDelete({ _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [3] })
    expect(seen).toEqual({ ids: [cid(2), cid(1)], bottom: true })
  })

  // Многооконность для remove: ключи окон обязаны вычисляться ДО evictMsg — после
  // удаления seq уже выкинут из всех срезов, и второй проход не нашёл бы ни
  // основное окно, ни окно треда (регресс, который эта проверка ловит).
  it('returns one remove op per window when the message is visible in both the main and thread windows', async () => {
    const mgr = newMessagesManager({ rest: restWithThreadOverlap() })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(100) })
    const ops = mgr.cacheDelete({ _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [2] })
    expect(ops).toHaveLength(2)
    expect(ops.map((o) => o.key).sort()).toEqual(['1', `1:${cid(100)}`])
    for (const op of ops) expect(op).toEqual({ op: 'remove', key: op.key, msgId: cid(2) })
  })
})

// Регрессия (финальное ревью feat/remaining-ops, Regression 2): deleteMessage
// (RPC-путь удаления из меню сообщения) после REST зовёт evictMsg НАПРЯМУЮ, минуя
// cacheDelete — окна опустошаются в SSOT, но операции remove не рассылаются.
// [RT.deleteMessage] убран из реестра APPLY проектора (storeProjection.ts) —
// окно теперь правит ТОЛЬКО applyOps(RT.messageOp), поэтому другие вкладки того
// же пользователя не удаляют сообщение из открытых окон, пока не перезагрузятся.
// Вкладка-инициатор чинит своё окно сама (useMessageActions → applyDelete) — эти
// тесты бьют именно по RPC-пути, который должен разослать ops остальным вкладкам.
describe('MessagesManager.deleteMessage (RPC path)', () => {
  it('broadcasts one remove op per window where the message was visible, computed BEFORE eviction', async () => {
    const overlap = restWithThreadOverlap() as unknown as { get: RestClient['get']; post: RestClient['post'] }
    const rest = { ...overlap, del: async () => ({ ok: true }) } as unknown as RestClient
    // Только операции окна: счёт истории (`rt:history_count`) — свой канал.
    const all = vi.fn()
    const broadcast = vi.fn()
    const mgr = newMessagesManager({ rest, broadcast: (e, p) => { all(e, p); if (e === RT.messageOp) broadcast(e, p) } })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(100) })

    await mgr.deleteMessage(1, cid(2), false)

    expect(broadcast).toHaveBeenCalledTimes(1)
    const [event, payload] = broadcast.mock.calls[0] as [string, { ops: MessageOp[] }]
    expect(event).toBe(RT.messageOp)
    expect(payload.ops).toHaveLength(2)
    expect(payload.ops.map((o) => o.key).sort()).toEqual(['1', `1:${cid(100)}`])
    for (const op of payload.ops) expect(op).toEqual({ op: 'remove', key: op.key, msgId: cid(2) })
  })

  it('does not broadcast when the message is absent from every window', async () => {
    const { rest: base } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const rest = { ...(base as unknown as { get: RestClient['get']; post: RestClient['post'] }), del: async () => ({ ok: true }) } as unknown as RestClient
    // Только операции окна: счёт истории (`rt:history_count`) — свой канал.
    const all = vi.fn()
    const broadcast = vi.fn()
    const mgr = newMessagesManager({ rest, broadcast: (e, p) => { all(e, p); if (e === RT.messageOp) broadcast(e, p) } })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })

    await mgr.deleteMessage(1, cid(999), false)

    expect(broadcast).not.toHaveBeenCalled()
  })
})

// Task 4 (Stage 1B.3): опросы / чек-листы / розыгрыши. Все три едут ТЕМ ЖЕ
// конструктором, что и внутри сообщения, под ключом `media`, и сообщение
// находят не по номеру (его в кадре нет), а по идентификатору ВНУТРИ вложения.
//
// cachePoll обновляет SSOT воркера целиком — это его офлайн-кэш; операция же
// несёт агрегат КАК ПРИШЁЛ, без `pFlags.chosen`, потому что общий кадр его и не
// содержит (сервер собирает итоги для «зрителя 0»). Сохранение выбора ОКНА
// проверяет messageOps.test.ts (applyOp).
const pollMedia = (over?: { id?: number; voters?: number[]; chosen?: number; totalVoters?: number }): MessageMediaPoll => ({
  _: 'messageMediaPoll',
  poll: {
    _: 'poll',
    id: over?.id ?? 5,
    question: { _: 'textWithEntities', text: 'q', entities: [] },
    answers: [0, 1].map((i) => ({
      _: 'pollAnswer' as const,
      text: { _: 'textWithEntities' as const, text: i ? 'b' : 'a', entities: [] },
      option: pollOptionKey(i),
    })),
  },
  results: {
    _: 'pollResults',
    total_voters: over?.totalVoters ?? 1,
    results: [0, 1].map((i) => ({
      _: 'pollAnswerVoters' as const,
      option: pollOptionKey(i),
      voters: (over?.voters ?? [1, 0])[i],
      ...(over?.chosen === i ? { pFlags: { chosen: true as const } } : {}),
    })),
  },
})

function mediaPage(msgId: number, media: MessageMedia) {
  return {
    messages: [{
      ...makeRawMessage({ id: msgId, peerId: 1, fromId: 1, text: '', createdAt: '2026-06-24T10:00:00Z' }),
      media,
    } as RawMessage],
    count: 1,
  }
}

describe('MessagesManager.cachePoll', () => {
  it('операция несёт вложение КАК ПРИШЛО — без chosen из SSOT', async () => {
    // SSOT уже держит МОЙ выбор (вариант 0) — live-кадр его не несёт.
    const { rest } = countingRest({ '0:0:40': mediaPage(2, pollMedia({ chosen: 0 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    // Кадр несёт опрос и итоги ОТДЕЛЬНЫМИ параметрами: вложение собирается
    // обратно на границе разбора, окно хранит его вложением сообщения.
    const media = pollMedia({ voters: [1, 1], totalVoters: 2 })
    const ops = mgr.cachePoll({
      _: 'updateMessagePoll', peer: { _: 'peerUser', user_id: 1 },
      poll_id: media.poll.id, poll: media.poll, results: media.results,
    })
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { media } }])
    const patched = ops[0].op === 'patch' ? ops[0].fields.media : undefined
    expect(patched?._ === 'messageMediaPoll' && patched.results.results?.some((r) => r.pFlags?.chosen)).toBe(false)
  })

  it('produces no op when no message in the SSOT carries this poll id', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(2, pollMedia({ id: 5 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cachePoll({ _: 'updateMessagePoll' as const, peer: { _: 'peerUser' as const, user_id: 1 }, poll_id: (pollMedia({ id: 999 })).poll.id, poll: (pollMedia({ id: 999 })).poll, results: (pollMedia({ id: 999 })).results })
    expect(ops).toEqual([])
  })
})

const todoMedia = (over?: { id?: number; marked?: boolean }): MessageMediaToDo => ({
  _: 'messageMediaToDo',
  todo: {
    _: 'todoList',
    id: over?.id ?? 8,
    pFlags: { others_can_complete: true },
    title: { _: 'textWithEntities', text: 't', entities: [] },
    list: [{ _: 'todoItem', id: 1, title: { _: 'textWithEntities', text: 'i1', entities: [] } }],
  },
  ...(over?.marked
    ? { completions: [{ _: 'todoCompletion' as const, id: 1, completed_by: { _: 'peerUser' as const, user_id: 1 }, date: 7 }] }
    : {}),
})

describe('MessagesManager.cacheChecklist', () => {
  it('returns a patch op carrying the media (no local field — full replace is correct here)', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(3, todoMedia()) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const evt = { _: 'updateMessageToDo' as const, peer: { _: 'peerUser' as const, user_id: 1 }, media: todoMedia({ marked: true }) }
    const ops = mgr.cacheChecklist(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(3), fields: { media: evt.media } }])
  })

  it('produces no op when no message in the SSOT carries this checklist id', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(3, todoMedia({ id: 8 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheChecklist({ _: 'updateMessageToDo' as const, peer: { _: 'peerUser' as const, user_id: 1 }, media: todoMedia({ id: 999 }) })
    expect(ops).toEqual([])
  })
})

const giveawayMedia = (over?: { id?: number; participants?: number }): MessageMedia => ({
  _: 'messageMediaGiveaway',
  id: over?.id ?? 9,
  pFlags: { winners_are_visible: true },
  channels: [1],
  quantity: 1,
  months: 3,
  until_date: 0,
})

/** Состоявшийся розыгрыш — ДРУГОЙ конструктор того же вложения. */
const giveawayResultsMedia = (id = 9): MessageMedia => ({
  _: 'messageMediaGiveawayResults',
  id,
  channel_id: 1,
  launch_msg_id: 4,
  winners_count: 1,
  unclaimed_count: 0,
  winners: [77],
  months: 3,
  until_date: 0,
})

describe('MessagesManager.cacheGiveaway', () => {
  it('находит сообщение по id ВНУТРИ вложения и заменяет вложение целиком', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(4, giveawayMedia()) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    // Розыгрыш состоялся — приезжает ДРУГОЙ конструктор с тем же id.
    const evt = { _: 'updateMessageGiveaway' as const, peer: { _: 'peerUser' as const, user_id: 1 }, media: giveawayResultsMedia() }
    const ops = mgr.cacheGiveaway(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(4), fields: { media: evt.media } }])
    // Номер сообщения-запуска — такой же адрес, как `message.id`, и на границе
    // кадра он переводится тем же приведением, что и на границе разбора
    // сообщения. Иначе «перейти к сообщению-запуску» промахнулось бы: кадр
    // несёт СЕРВЕРНОЕ число, а окно живёт в клиентском пространстве.
    const patched = ops[0].op === 'patch' ? ops[0].fields.media : undefined
    expect(patched?._ === 'messageMediaGiveawayResults' && patched.launch_msg_id).toBe(cid(4))
  })

  it('produces no op when no message in the SSOT carries this giveaway id', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(4, giveawayMedia({ id: 9 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheGiveaway({ _: 'updateMessageGiveaway' as const, peer: { _: 'peerUser' as const, user_id: 1 }, media: giveawayMedia({ id: 999 }) })
    expect(ops).toEqual([])
  })

  it('вложение не розыгрыш — операции нет вовсе', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(4, giveawayMedia()) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(mgr.cacheGiveaway({ _: 'updateMessageGiveaway' as const, peer: { _: 'peerUser' as const, user_id: 1 }, media: todoMedia() })).toEqual([])
  })
})

// ── Что владелец делает НА ГРАНИЦЕ МАППИНГА ────────────────────────────────
// Раньше здесь выводился `out`: бэкенд флага не отдавал, и владелец вычислял
// его сам на каждой границе. Теперь `pFlags.out` производит СЕРВЕР (решение Р7
// отменено), выводить нечего — вопрос «моё ли это» ушёл с клиента целиком.
//
// Но граница маппинга работой не осталась: сервер производит только НАСТОЯЩИЕ
// конструкторы служебного действия, а до синтетических («Вы присоединились»
// против «X присоединился») их уточняет клиент — `refineMessageAction`, порт
// appMessagesManager.ts:5215-5238. Для этого нужен `me`, и нужен ВЕЗДЕ, где
// сообщение уходит наружу: ставить уточнение в `put()` недостаточно — `put`
// единственный вход в SSOT, но мимо него отдают `getAround`, офлайн-ветка
// `getHistory` и вся поисковая группа (они в SSOT вообще не пишут).
describe('MessagesManager: служебное действие уточняет владелец на границе маппинга', () => {
  const ME = 7
  // Страница из двух пилюль: «сам себя добавил» ЗРИТЕЛЬ и «сам себя добавил»
  // кто-то другой. Обе приезжают одним и тем же серверным конструктором —
  // различает их только уточнение.
  const pillsPage = (): { messages: RawMessage[]; count: number } => ({
    messages: [
      makeRawMessage({ id: 2, peerId: -1, fromId: 2, createdAt: '2026-06-24T10:00:00Z' }) as RawMessage,
      makeRawMessage({ id: 1, peerId: -1, fromId: ME, createdAt: '2026-06-24T10:00:00Z' }) as RawMessage,
    ].map((m, i) => ({
      ...m, _: 'messageService',
      action: { _: 'messageActionChatAddUser', users: [i === 0 ? 2 : ME] },
    }) as unknown as RawMessage),
    count: 2,
  })

  const actionsOf = (list: MyMessage[]) =>
    list.map((m) => (m._ === 'messageService' ? m.action._ : m._))

  it('страница истории: своё вступление → JoinedYou, чужое → Joined', async () => {
    const { rest } = countingRest({ '0:0:40': pillsPage() })
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    const r = await mgr.getHistory({ peerId: -1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(actionsOf(r.messages)).toEqual(['messageActionChatJoinedYou', 'messageActionChatJoined'])
  })

  it('повторная выдача из кэша (без сети) несёт то же уточнение', async () => {
    const { rest, calls } = countingRest({ '0:0:40': pillsPage() })
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    await mgr.getHistory({ peerId: -1, offsetId: 0, addOffset: 0, limit: 40 })
    const cached = await mgr.getHistory({ peerId: -1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(cached.cached).toBe(true)
    expect(calls()).toBe(1)
    expect(actionsOf(cached.messages)).toEqual(['messageActionChatJoinedYou', 'messageActionChatJoined'])
  })

  it('getAround (jump-to-message) идёт мимо put — и всё равно уточняет', async () => {
    const rest = {
      get: async () => ({ _: 'messages.messagesSlice', ...pillsPage(), users: [], chats: [] }),
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    const r = await mgr.getAround(-1, cid(2), 40)
    expect(actionsOf(r.messages)).toEqual(['messageActionChatJoined', 'messageActionChatJoinedYou'])
  })

  // Концы окна ВЫВОДЯТСЯ клиентом: признаков в ответе нет вовсе (порт
  // appMessagesManager.ts:9512-9518). Окно короче запрошенного с обеих сторон —
  // значит за ним ничего нет; полное окно — значит края не достигнуты.
  it('getAround выводит концы окна из его полноты, а не из полей ответа', async () => {
    const page = (n: number) => ({
      _: 'messages.messagesSlice',
      count: 100,
      users: [], chats: [],
      messages: Array.from({ length: n }, (_, i) => ({
        _: 'message', id: i + 1, peer_id: { _: 'peerChat', chat_id: 1 },
        from_id: { _: 'peerUser', user_id: ME }, date: 1, message: 'm',
      })),
    })
    const short = { get: async () => page(3) } as unknown as RestClient
    const tiny = await newMessagesManager({ rest: short, getMeId: () => ME }).getAround(-1, cid(2), 40)
    expect(tiny).toMatchObject({ reachedTop: true, reachedBottom: true })

    const full = { get: async () => page(40) } as unknown as RestClient
    const mid = await newMessagesManager({ rest: full, getMeId: () => ME }).getAround(-1, cid(21), 40)
    expect(mid).toMatchObject({ reachedTop: false, reachedBottom: false })
  })

  // Карточки авторов приезжают ПОПУТНО со списком (`users` контейнера) и
  // публикуются в общий приёмник пиров — тот же, которым питаются диалоги.
  // Без этого бабл рисовался бы без имени до отдельного запроса о пире.
  it('авторы из контейнера уходят в приёмник пиров', async () => {
    const users = [{ _: 'user', id: 77, first_name: 'Аня' }]
    const rest = { get: async () => ({ _: 'messages.messages', ...pillsPage(), users, chats: [] }) } as unknown as RestClient
    const saveApiPeers = vi.fn()
    const mgr = newMessagesManager({ rest, getMeId: () => ME, peers: { saveApiPeers } })
    await mgr.listPins(-1)
    expect(saveApiPeers).toHaveBeenCalledWith({ users, chats: [] })
  })

  it('поиск по чату (в SSOT не пишет вовсе) — тоже уточняет', async () => {
    const rest = { get: async () => pillsPage() } as unknown as RestClient
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    const r = await mgr.searchMessages(-1, 'м')
    expect(actionsOf(r.messages)).toEqual(['messageActionChatJoined', 'messageActionChatJoinedYou'])
  })

  // Гонка личности. `me` появляется у воркера асинхронно; страница, обслуженная
  // раньше, уехала бы вкладке с ЧУЖОЙ формулировкой пилюли — молчаливая
  // регрессия. Гейт meReady (workerCore: гидрация `me` с диска / первый setMe)
  // обязан удержать маппинг. Мутация «убрать await whenMeReady()» красит именно
  // этот тест: сеть отвечает микротаском, а личность приезжает макротаском,
  // поэтому без гейта маппинг гарантированно застаёт meId === null.
  it('ранняя страница истории ЖДЁТ готовности `me`', async () => {
    let meId: number | null = null
    let release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    const { rest } = countingRest({ '0:0:40': pillsPage() })
    const mgr = newMessagesManager({ rest, getMeId: () => meId, meReady: () => ready })

    setTimeout(() => { meId = ME; release() }, 0)
    const r = await mgr.getHistory({ peerId: -1, offsetId: 0, addOffset: 0, limit: 40 })

    expect(actionsOf(r.messages)).toEqual(['messageActionChatJoinedYou', 'messageActionChatJoined'])
  })
})

// Вид ЧАТА (вещательный канал) владельцу временного бабла приносит workerCore
// (`isBroadcastChat`, порт `appPeersManager.isBroadcast` в роли `generateFlags`,
// tweb appMessagesManager.ts:3128-3130). Здесь пинится ПЕРЕДАЧА признака сквозь
// менеджер: сама механика флага — в `messages/pending.test.ts`, соединение
// стрелки с кэшем карточек — в `workerCore.pendingPost.test.ts`. Без передачи
// бабл поста стоял бы СПРАВА до ответа сервера и прыгал влево на эхе
// (`isOurMessage`, tweb chat.ts:1379 — `&& !message.pFlags.post`).
describe('MessagesManager: вид чата доходит до временного бабла', () => {
  const pendingOp = async (isBroadcastChat: (peerId: number) => boolean) => {
    const { rest } = countingRest({ '0:0:40': rawPage([]) })
    const ops: MessageOp[] = []
    const mgr = newMessagesManager({
      rest,
      isBroadcastChat,
      broadcast: (e, p) => { if (e === RT.messageOp) ops.push(...(p as { ops: MessageOp[] }).ops) },
    })
    // Бабл вставляется только в окно, доведённое до НИЗА истории.
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.beforeMessageSending({ peer_id: 1, client_msg_id: 'c-1', sender_id: 42, text: 'пост', type: 'text' })
    return ops.find((o) => o.op === 'insert') as { msg: MessageReal } | undefined
  }

  it('вещательный канал → у бабла pFlags.post', async () => {
    expect((await pendingOp(() => true))!.msg.pFlags).toEqual({ out: true, post: true })
  })

  it('обычный чат → флага нет', async () => {
    expect((await pendingOp(() => false))!.msg.pFlags).toEqual({ out: true })
  })
})

// Шаред-медиа листается КУРСОРОМ, а не смещением (порт tweb
// `appSearchSuper.ts:2278-2279` — `offsetId = lastItem?.mid`). Разница не
// косметическая: тот же список пополняется СВЕРХУ живыми апдейтами, и числовое
// смещение при этом отдаёт вторую страницу с дублем или дырой. Здесь пинится
// ГРАНИЦА пространств номеров: наружу менеджер берёт клиентский `mid`, а в URL
// уходит серверный `seq` (`getServerMessageId`).
describe('MessagesManager.mediaHistory: курсор `offset_id`', () => {
  const capturingRest = () => {
    const queries: Record<string, string | number>[] = []
    const rest = {
      get: async (_path: string, q?: Record<string, string | number>) => {
        queries.push(q ?? {})
        return { messages: [], count: 0 }
      },
      post: async () => ({}),
    } as unknown as RestClient
    return { rest, queries }
  }

  it('первая страница идёт без курсора', async () => {
    const { rest, queries } = capturingRest()
    await newMessagesManager({ rest }).mediaHistory(1, 'media', 0, 30)
    expect(queries[0]).toEqual({ filter: 'media', offset_id: 0, limit: 30 })
    // смещения на проводе больше нет вовсе — иначе сервер листал бы по нему
    expect(queries[0]).not.toHaveProperty('offset')
  })

  it('следующая страница — по СЕРВЕРНОМУ номеру последнего показанного', async () => {
    const { rest, queries } = capturingRest()
    await newMessagesManager({ rest }).mediaHistory(1, 'files', cid(77), 50)
    expect(queries[0]).toEqual({ filter: 'files', offset_id: 77, limit: 50 })
  })
})

// Глобальный поиск листается курсором СЕРВЕРА `next_rate`, а не смещением
// (tweb `appMessagesManager.ts:9995` — `offset_rate: nextRate`, `:9432` —
// `nextRate: slice.next_rate`). Пинится граница: курсор уходит в URL
// параметром `offset_rate`, приходит из ключа `next_rate`, а его отсутствие —
// «дальше ничего» (undefined), по которому класс помечает вкладку
// загруженной (tweb `appSearchSuper.ts:2312`).
describe('MessagesManager.searchGlobal: курсор `next_rate`', () => {
  const rateRest = (reply: Record<string, unknown>) => {
    const queries: Record<string, string | number>[] = []
    const rest = {
      get: async (_path: string, q?: Record<string, string | number>) => {
        queries.push(q ?? {})
        return { _: 'messages.messagesSlice', messages: [], users: [], chats: [], count: 0, ...reply }
      },
      post: async () => ({}),
    } as unknown as RestClient
    return { rest, queries }
  }

  it('первая страница — offset_rate 0, next_rate ответа уходит наружу', async () => {
    const { rest, queries } = rateRest({ count: 7, next_rate: 4242 })
    const r = await newMessagesManager({ rest }).searchGlobal('кот', '', { limit: 30 })
    expect(queries[0]).toEqual({ q: 'кот', filter: '', offset_rate: 0, limit: 30 })
    expect(queries[0]).not.toHaveProperty('offset')
    expect(r.nextRate).toBe(4242)
    expect(r.count).toBe(7)
  })

  // ChatTypeMenu и чипы дат (tweb `appMessagesManager.ts:9992-9999`). Даты
  // менеджер берёт в МИЛЛИСЕКУНДАХ, как `getHistory` оригинала (чипы —
  // `DateData` в мс, `helpers/date.ts:240-268`), а в URL кладёт секунды —
  // ровно `minDate / 1000 | 0` оригинала (`:9931-9932`).
  it('chat_type и даты уходят в URL; даты — секундами', async () => {
    const { rest, queries } = rateRest({})
    await newMessagesManager({ rest }).searchGlobal('кот', '', {
      limit: 30, chatType: 'channels', minDate: 1768089600000, maxDate: 1768175999999,
    })
    expect(queries[0]).toEqual({
      q: 'кот', filter: '', offset_rate: 0, limit: 30,
      chat_type: 'channels', min_date: 1768089600, max_date: 1768175999,
    })
  })

  it('следующая страница — по курсору; последняя — без nextRate', async () => {
    const { rest, queries } = rateRest({ count: 7 })
    const r = await newMessagesManager({ rest }).searchGlobal('кот', 'media', { offsetRate: 4242, limit: 30 })
    expect(queries[0]).toEqual({ q: 'кот', filter: 'media', offset_rate: 4242, limit: 30 })
    expect(r.nextRate).toBeUndefined()
  })
})

// Поиск в одном чате (чип пира → `messages.search`, tweb
// `appMessagesManager.ts:9966-9982`) листается курсором `offset_id` — СЕРВЕРНЫМ
// номером последнего отданного, как `/media`; смещения на проводе нет. Даты —
// миллисекунды на входе, секунды в URL; `filter` — лексика вкладок класса,
// `media_type` — топбара, обе уходят как есть.
describe('MessagesManager.searchMessages: курсор `offset_id`', () => {
  const capture = () => {
    const queries: Record<string, string | number>[] = []
    const rest = {
      get: async (_path: string, q?: Record<string, string | number>) => {
        queries.push(q ?? {})
        return { _: 'messages.messagesSlice', messages: [], users: [], chats: [], count: 0 }
      },
      post: async () => ({}),
    } as unknown as RestClient
    return { rest, queries }
  }

  it('первая страница — offset_id 0, без offset', async () => {
    const { rest, queries } = capture()
    await newMessagesManager({ rest }).searchMessages(1, 'кот', { limit: 30 })
    expect(queries[0]).toEqual({ q: 'кот', offset_id: 0, limit: 30 })
    expect(queries[0]).not.toHaveProperty('offset')
  })

  it('курсор — серверный номер; фильтры и даты — в URL', async () => {
    const { rest, queries } = capture()
    await newMessagesManager({ rest }).searchMessages(1, 'кот', {
      offsetId: cid(77), limit: 30, filter: 'media', mediaType: 'photo', senderId: 5, reaction: '👍',
      minDate: 1768089600000, maxDate: 1768175999999,
    })
    expect(queries[0]).toEqual({
      q: 'кот', offset_id: 77, limit: 30, filter: 'media', media_type: 'photo', sender_id: 5, reaction: '👍',
      min_date: 1768089600, max_date: 1768175999,
    })
  })
})

// Порт `fetchMessageReplyTo` → `reloadMessage` → `fetchSingleMessages`
// (tweb appMessagesManager.ts:13609-13880). Сквозная проводка до ленты —
// `components/chat/bubbles.replyTarget.test.ts`; здесь — правила владельца.
describe('MessagesManager.fetchMessageReplyTo', () => {
  const CHAT = -7
  const reply = (id: number, toId: number, extra: Record<string, unknown> = {}) => ({
    ...makeRawMessage({ id, peerId: CHAT, fromId: 2, text: `ответ ${id}` }),
    reply_to: { _: 'messageReplyHeader', reply_to_msg_id: toId, ...extra },
  }) as unknown as RawMessage

  /** REST: история отдаёт ответы, ручка адресов — то, что есть в `known`,
   *  остальное — дырой. */
  function standRest(history: RawMessage[], known: RawMessage[]) {
    const byId = new Map(known.map((m) => [m.id, m]))
    const idsCalls: string[] = []
    const rest = {
      get: vi.fn(async (path: string, q: Record<string, string | number> = {}) => {
        if (path.endsWith('/history')) return { _: 'messages.messagesSlice', messages: history, users: [], chats: [], count: history.length }
        idsCalls.push(`${path}?ids=${q.ids}`)
        const ids = String(q.ids).split(',').map(Number)
        return { _: 'messages.messages', messages: ids.map((id) => byId.get(id) ?? { _: 'messageEmpty', id }), users: [], chats: [] }
      }),
    } as unknown as RestClient
    return { rest, idsCalls }
  }

  it('запросы одного хода уходят ОДНИМ вызовом ручки адресов (tweb pause(0) + needSingleMessages)', async () => {
    const orig = (id: number) => makeRawMessage({ id, peerId: CHAT, fromId: 3, text: `оригинал ${id}` }) as RawMessage
    const { rest, idsCalls } = standRest([reply(20, 5), reply(21, 6)], [orig(5), orig(6)])
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: CHAT, limit: 2 })

    const [a, b] = await Promise.all([mgr.fetchMessageReplyTo(CHAT, cid(20)), mgr.fetchMessageReplyTo(CHAT, cid(21))])
    expect(idsCalls).toEqual([`/chats/${CHAT}/messages?ids=5,6`])
    expect(real(a)?.message).toBe('оригинал 5')
    expect(real(b)?.message).toBe('оригинал 6')
    // Лёг в SSOT — повторный вопрос сети не трогает.
    await mgr.fetchMessageReplyTo(CHAT, cid(20))
    expect(idsCalls).toHaveLength(1)
  })

  it('дыра: ответ помечается reply_to_msg_deleted и объявляется окну, повтор в сеть не ходит', async () => {
    const { rest, idsCalls } = standRest([reply(20, 5)], [])
    const ops: MessageOp[][] = []
    const mgr = newMessagesManager({ rest, broadcast: (ev, p) => { if (ev === RT.messageOp) ops.push((p as { ops: MessageOp[] }).ops) } })
    await mgr.getHistory({ peerId: CHAT, limit: 1 })

    expect(await mgr.fetchMessageReplyTo(CHAT, cid(20))).toBeUndefined()
    expect(mgr.getMessageByPeer(CHAT, cid(20))?.reply_to?.reply_to_msg_deleted).toBe(true)
    expect(ops.flat()).toEqual([expect.objectContaining({ op: 'patch', key: String(CHAT), msgId: cid(20) })])

    // tweb `missingMessages`: адрес дыры запомнен.
    expect(await mgr.fetchMessageReplyTo(CHAT, cid(20))).toBeUndefined()
    expect(idsCalls).toHaveLength(1)
  })

  it('ответ из ДРУГОГО чата ищется в чате reply_to_peer_id (tweb :13862)', async () => {
    const OTHER = -9
    const { rest, idsCalls } = standRest([reply(20, 5, { reply_to_peer_id: { _: 'peerChannel', channel_id: 9 } })], [])
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: CHAT, limit: 1 })

    await mgr.fetchMessageReplyTo(CHAT, cid(20))
    expect(idsCalls).toEqual([`/chats/${OTHER}/messages?ids=5`])
  })
})

// Счёт истории окна — порт `historyStorage.count` (tweb appMessagesManager.ts):
// ставит ответ истории (:13088), растит новое сообщение (:10430-10432),
// уменьшает удаление (:11523-11525). Владелец — менеджер, наружу — значение
// `rt:history_count`; читает шапка «Избранного» («N messages»).
describe('MessagesManager: счёт истории (historyStorage.count)', () => {
  const setup = (page = { ...rawPage([3, 2, 1]), count: 10 }) => {
    const { rest: base } = countingRest({ '0:0:40': page })
    const rest = { ...(base as unknown as { get: RestClient['get']; post: RestClient['post'] }), del: async () => ({ ok: true }) } as unknown as RestClient
    const counts: { key: string; count: number }[] = []
    const mgr = newMessagesManager({ rest, broadcast: (e, p) => { if (e === RT.historyCount) counts.push(p as { key: string; count: number }) } })
    return { mgr, counts, last: () => counts[counts.length - 1] }
  }

  it('ответ истории ставит счёт из `count` страницы и объявляет его', async () => {
    const { mgr, last } = setup()
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(r.count).toBe(10)
    expect(last()).toEqual({ key: '1', count: 10 })
  })

  it('попадание в кэш объявляет известный счёт заново (поздняя вкладка) и отдаёт его, а не длину окна', async () => {
    const { mgr, counts } = setup()
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    counts.length = 0
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(r.cached).toBe(true)
    expect(r.count).toBe(10)
    expect(counts).toEqual([{ key: '1', count: 10 }])
  })

  it('новое сообщение в низ истории растит счёт; повтор того же — нет', async () => {
    const { mgr, last } = setup()
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const live = makeRawMessage({ id: 4, peerId: 1, fromId: 1, text: 'hi', createdAt: '2026-06-24T10:00:00Z' })
    mgr.cacheLive(liveEvt(live))
    expect(last()).toEqual({ key: '1', count: 11 })
    mgr.cacheLive(liveEvt(live))
    expect(last()).toEqual({ key: '1', count: 11 })
  })

  it('удаление известного сообщения уменьшает счёт', async () => {
    const { mgr, last } = setup()
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.cacheDelete({ _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [2] })
    expect(last()).toEqual({ key: '1', count: 9 })
  })

  it('пока история не грузилась — счёт неизвестен и не объявляется', () => {
    const { mgr, counts } = setup()
    mgr.cacheLive(liveEvt(makeRawMessage({ id: 4, peerId: 1, fromId: 1, text: 'hi', createdAt: '2026-06-24T10:00:00Z' })))
    expect(counts).toEqual([])
  })
})
