// Этап «оптимистика в воркере»: кадры message_ack / message_error применяет
// ВЛАДЕЛЕЦ окна (messages.ackPendingMessage / failPendingMessage) прямо в
// onFrame — раньше их разбирала каждая вкладка у себя (storeProjection →
// reconcileAckByClient / failOptimisticByClient), а воркер лишь транслировал.
// Проверяется именно проводка workerCore.ts: что вызов владельца стоит, что его
// операции уходят кадром rt:message_op и что СЫРОЙ кадр при этом продолжает
// лететь дальше (у rt:ack остался потребитель — звук отправки в
// client/realtime/soundSubscriber.ts; у rt:message_error — тост paid_required).
//
// Приём — тот же, что в workerCore.dialogFrames.test.ts: частичный vi.mock
// connectionManager, чтобы перехватить onFrame и позвать его напрямую. Плюс
// частичный vi.mock messagesManager: pending-механика подменяется заглушкой,
// иначе для живого бабла пришлось бы поднимать историю чата по сети (сама
// механика покрыта managers/messages/pending.test.ts — здесь предмет другой).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import type { MessageOp } from './realtime/messageOps'
import { RT } from './realtime/events'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => { capturedConnDeps = deps; return actual.newConnectionManager(deps) },
  }
})

const ACK_OPS: MessageOp[] = [{ op: 'insert', key: '1', msg: { id: 500, peerId: 1, seq: 20, senderId: 5, type: 'text', text: 'hi', replyToId: null, mediaId: null, createdAt: 'now', threadRootId: null, clientId: 'c-1' } }]
const FAIL_OPS: MessageOp[] = [{ op: 'patch', key: '1', msgId: -11, fields: { failed: true } }]
const ackPendingMessage = vi.fn(() => ACK_OPS)
const failPendingMessage = vi.fn(() => FAIL_OPS)
vi.mock('./managers/messagesManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/messagesManager')>()
  return {
    ...actual,
    newMessagesManager: (deps: Parameters<typeof actual.newMessagesManager>[0]) => ({
      ...actual.newMessagesManager(deps),
      ackPendingMessage,
      failPendingMessage,
    }),
  }
})

import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

/** Поднимает воркер с подключённой вкладкой; собирает всё, что вкладке прилетело. */
function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  const ops: MessageOp[] = []
  const raw: { event: string; payload: unknown }[] = []
  tab.on(RT.messageOp, (p) => ops.push(...(p as { ops: MessageOp[] }).ops))
  tab.on(RT.ack, (p) => raw.push({ event: RT.ack, payload: p }))
  tab.on(RT.messageError, (p) => raw.push({ event: RT.messageError, payload: p }))
  expect(capturedConnDeps).not.toBeNull()
  return { ops, raw }
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
  ackPendingMessage.mockClear()
  failPendingMessage.mockClear()
})

describe('createWorkerCore(): message_ack / message_error применяет владелец', () => {
  // Что ломается, если гарантия нарушена: без вызова ackPendingMessage бабл
  // навсегда остаётся «отправляется…» — ни в одной вкладке (реконсиляции больше
  // нет нигде: сторные reconcileAckByClient/clientToWin удалены вместе с этим
  // переносом), а переоткрытие чата показало бы его рядом с настоящим.
  it('message_ack → ackPendingMessage + rt:message_op, сырой rt:ack летит дальше', () => {
    const { ops, raw } = boot()
    const ack = { client_msg_id: 'c-1', msg_id: 500, seq: 20, created_at: '2026-08-16T10:00:00Z' }

    capturedConnDeps!.onFrame('message_ack', ack)

    expect(ackPendingMessage).toHaveBeenCalledWith(ack)
    expect(ops).toEqual(ACK_OPS)
    expect(raw).toEqual([{ event: RT.ack, payload: ack }])
  })

  // Что ломается: без вызова failPendingMessage отвергнутое сервером сообщение
  // выглядело бы вечно отправляющимся — красной пометки и меню
  // «Переотправить/Удалить» пользователь бы не увидел.
  it('message_error → failPendingMessage(client_msg_id) + rt:message_op, сырой кадр летит дальше', () => {
    const { ops, raw } = boot()
    const err = { client_msg_id: 'c-1', reason: 'too_long' }

    capturedConnDeps!.onFrame('message_error', err)

    expect(failPendingMessage).toHaveBeenCalledWith('c-1')
    expect(ops).toEqual(FAIL_OPS)
    expect(raw).toEqual([{ event: RT.messageError, payload: err }])
  })

  // Идемпотентность: бабла уже нет (эхо new_message сняло его раньше) — владелец
  // отдаёт пустой список, и лишнего кадра быть не должно.
  it('пустой список операций кадром rt:message_op не рассылается', () => {
    const { ops, raw } = boot()
    ackPendingMessage.mockReturnValueOnce([])

    capturedConnDeps!.onFrame('message_ack', { client_msg_id: 'c-gone', msg_id: 1, seq: 1, created_at: 'now' })

    expect(ops).toEqual([])
    expect(raw).toHaveLength(1) // сырой кадр всё равно ушёл
  })
})
