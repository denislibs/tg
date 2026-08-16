// Семантика неотправленного сообщения — та же, что раньше пинили тесты
// stores/messagesStore.*.test.ts (ackEcho, tentativeSeq, sendStatus,
// uploadCancel — файлы удалены, их смысл перенесён сюда). Она переехала из
// стора вкладки в менеджер воркера (порт формы tweb appMessagesManager),
// поэтому и тесты живут здесь: механика проверяется напрямую, без React и без
// zustand. Оконная половина тех же гарантий (дедуп бабла по clientId, слияние
// эха, ack-then-echo) живёт в core/realtime/messageOps.test.ts — она про
// применение операции к списку, а не про жизненный цикл; путь целиком
// (операция → окно) пинит client/realtime/storeProjection.pending.test.ts.
//
// Что тут НЕ проверяется и почему: отсутствие персиста временного бабла. Оно
// структурное — в ctx pending-механики персиста нет вовсе (см. pending.ts,
// «ЧЕГО НЕ ДЕЛАЕМ»), подделать его вызов неоткуда.
import { describe, it, expect } from 'vitest'
import SlicedArray, { SliceEnd } from '../../history/slicedArray'
import { newPendingMethods } from './pending'
import { messageToConvMsg } from '../../messageToConvMsg'
import type { Message } from '../../models'
import type { MessageOp } from '../../realtime/messageOps'
import type { PendingNewEvt } from '../../realtime/events'

function makeCtx() {
  const slices = new Map<string, SlicedArray<number>>()
  const msgsByChat = new Map<number, Map<number, Message>>()
  const hkey = (chatId: number, threadRoot?: number | null) =>
    threadRoot ? `${chatId}:${threadRoot}` : String(chatId)
  const msgsFor = (chatId: number) => {
    let c = msgsByChat.get(chatId)
    if (!c) { c = new Map(); msgsByChat.set(chatId, c) }
    return c
  }
  return { ctx: { hkey, slices, msgsFor }, slices, msgsFor }
}

/** Открытое окно, держащее НИЗ истории — только в такое вставляется бабл. */
function openWindow(slices: Map<string, SlicedArray<number>>, key: string, seqs: number[] = []) {
  const sa = new SlicedArray<number>()
  for (const s of seqs) sa.unshift(s) // unshift кладёт новейшее вперёд
  sa.first.setEnd(SliceEnd.Bottom)
  slices.set(key, sa)
  return sa
}

const evt = (over: Partial<PendingNewEvt> = {}): PendingNewEvt => ({
  chat_id: 1, client_msg_id: 'c-1', sender_id: 42, text: 'привет', type: 'text', ...over,
})

describe('pending: появление бабла', () => {
  it('бабл попадает в SSOT и в срез окна, наружу — insert с clientId', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [10, 11])
    const p = newPendingMethods(ctx)

    const ops = p.beforeMessageSending(evt())

    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe('insert')
    const msg = (ops[0] as { msg: Message }).msg
    expect(msg.clientId).toBe('c-1')
    expect(msg.failed).toBeUndefined()
    // в SSOT воркера — та же копия (её увидит переоткрытие чата)
    expect(msgsFor(1).get(msg.seq)).toEqual(msg)
    expect(slices.get('1')!.findSlice(msg.seq)).toBeTruthy()
  })

  it('tentativeSeq ставит бабл ПОСЛЕ последнего сообщения окна', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [10, 11])
    const p = newPendingMethods(ctx)

    const msg = (p.beforeMessageSending(evt())[0] as { msg: Message }).msg

    expect(msg.seq).toBe(12)
    // Отрицательный id помечает неотправленное: dedupKey ключует такое по
    // clientId, иначе чужое входящее с тем же seq вытеснило бы бабл из окна.
    expect(msg.id).toBeLessThan(0)
  })

  // Переехало из stores/messagesStore.tentativeSeq.test.ts. Что ломается: если
  // расчёт tentativeSeq перестанет учитывать уже добавленный первый бабл, второй
  // получит тот же seq — и dedupAsc схлопнет их в один (тот же класс бага, что
  // коллизия с чужим входящим, только между двумя СВОИМИ баблами).
  it('два бабла подряд без ack между ними: оба на месте, seq различны', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1')
    const p = newPendingMethods(ctx)

    const first = (p.beforeMessageSending(evt({ client_msg_id: 'c1', text: 'first' }))[0] as { msg: Message }).msg
    const second = (p.beforeMessageSending(evt({ client_msg_id: 'c2', text: 'second' }))[0] as { msg: Message }).msg

    expect(second.seq).toBe(first.seq + 1)
    expect([...msgsFor(1).keys()].sort((a, b) => a - b)).toEqual([first.seq, second.seq])
  })

  // Переехало оттуда же. Что ломается: если бы ack матчился не строго по
  // clientId (а по позиции/seq), соседний бабл пропал бы или потерял clientId —
  // ломая React-ключ и подхват его собственного ack/эха.
  it('ack первого не трогает второй: второй остаётся неотправленным', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1')
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt({ client_msg_id: 'c1', text: 'first' }))
    const second = (p.beforeMessageSending(evt({ client_msg_id: 'c2', text: 'second' }))[0] as { msg: Message }).msg

    p.ackPendingMessage({ client_msg_id: 'c1', msg_id: 900, seq: 50, created_at: 'x' })

    expect(p.hasPending('c2')).toBe(true)
    const still = msgsFor(1).get(second.seq)!
    expect(still.clientId).toBe('c2')
    expect(still.id).toBeLessThan(0)
  })

  it('окно, не держащее низ истории, бабл не получает — и операции не рождаются', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    const sa = new SlicedArray<number>()
    // insertSlice кладёт страницу истории, НЕ помечая концы, — так выглядит окно,
    // прокрученное в середину (unshift здесь не подходит: он сам ставит Bottom).
    sa.insertSlice([10])
    slices.set('1', sa)
    const p = newPendingMethods(ctx)

    expect(p.beforeMessageSending(evt())).toEqual([])
    expect(msgsFor(1).size).toBe(0)
  })

  it('тред-сообщение вставляется и в окно чата, и в окно треда', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [10])
    openWindow(slices, '1:7', [10])
    const p = newPendingMethods(ctx)

    const ops = p.beforeMessageSending(evt({ thread_root_id: 7 }))

    expect(ops.map((o) => o.key).sort()).toEqual(['1', '1:7'])
  })
})

describe('pending: подтверждение сервера', () => {
  it('ack переставляет id/seq/дату, сохраняя содержимое и clientId', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    const temp = (p.beforeMessageSending(evt())[0] as { msg: Message }).msg

    // seq сервера намеренно НЕ совпадает с подгаданным (у окна [10] это был 11) —
    // иначе уборку временного бабла не отличить от его перезаписи.
    const ops = p.ackPendingMessage({ client_msg_id: 'c-1', msg_id: 555, seq: 20, created_at: '2026-08-16T10:00:00Z' })

    expect(ops).toHaveLength(1)
    const msg = (ops[0] as { msg: Message }).msg
    expect(msg.id).toBe(555)
    expect(msg.seq).toBe(20)
    expect(msg.createdAt).toBe('2026-08-16T10:00:00Z')
    expect(msg.text).toBe('привет')
    expect(msg.clientId).toBe('c-1')
    // временный seq ушёл из SSOT и из среза — иначе в окне осталось бы два бабла
    expect(temp.seq).toBe(11)
    expect(msgsFor(1).has(temp.seq)).toBe(false)
    expect(slices.get('1')!.findSlice(temp.seq)).toBeFalsy()
    expect(msgsFor(1).get(20)).toEqual(msg)
  })

  it('echo-then-ack: эхо сняло бабл — повторный ack уже ничего не делает', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())

    p.checkPendingMessage('c-1') // пришло new_message со своим client_msg_id
    const ops = p.ackPendingMessage({ client_msg_id: 'c-1', msg_id: 555, seq: 11, created_at: 'x' })

    expect(ops).toEqual([])
    expect(p.hasPending('c-1')).toBe(false)
  })

  it('ack-then-echo: после ack эхо не находит регистрацию и ничего не ломает', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())
    p.ackPendingMessage({ client_msg_id: 'c-1', msg_id: 555, seq: 11, created_at: 'x' })

    p.checkPendingMessage('c-1')

    // сверенное сообщение на месте, дубля нет
    expect([...msgsFor(1).keys()]).toEqual([11])
  })

  it('чужой clientId ack не трогает', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())

    expect(p.ackPendingMessage({ client_msg_id: 'c-other', msg_id: 1, seq: 1, created_at: 'x' })).toEqual([])
    expect(p.hasPending('c-1')).toBe(true)
  })
})

describe('pending: ошибка, ретрай, отмена', () => {
  it('ошибка помечает бабл, но регистрацию СОХРАНЯЕТ — ack после ретрая найдёт его', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())

    const ops = p.failPendingMessage('c-1')

    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'patch', key: '1', fields: { failed: true } })
    expect(p.hasPending('c-1')).toBe(true)
    // и ретрай действительно доводится до конца
    expect(p.retryPendingMessage('c-1')[0]).toMatchObject({ fields: { failed: undefined } })
    expect(p.ackPendingMessage({ client_msg_id: 'c-1', msg_id: 7, seq: 11, created_at: 'x' })).toHaveLength(1)
  })

  it('отмена убирает бабл из SSOT и среза, повторная — no-op', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    const temp = (p.beforeMessageSending(evt())[0] as { msg: Message }).msg

    const ops = p.cancelPendingMessage('c-1')

    expect(ops).toEqual([{ op: 'remove', key: '1', msgId: temp.id }])
    expect(msgsFor(1).has(temp.seq)).toBe(false)
    expect(slices.get('1')!.findSlice(temp.seq)).toBeFalsy()
    expect(p.cancelPendingMessage('c-1')).toEqual([])
  })

  it('аплоад завершился — mediaId приклеивается к тому же баблу', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    const temp = (p.beforeMessageSending(evt({ type: 'photo', text: '' }))[0] as { msg: Message }).msg

    const ops = p.attachPendingMedia('c-1', 909)

    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: temp.id, fields: { mediaId: 909 } }])
    expect(msgsFor(1).get(temp.seq)!.mediaId).toBe(909)
  })

  // Переехало из stores/messagesStore.uploadCancel.test.ts. Что ломается: бабл
  // документа появляется ДО аплоада, и рисовать его не из чего, если локальная
  // мета (имя/размер/mime) не доехала — пользователь видел бы пустую плашку
  // файла, пока идёт загрузка. mediaId на этот момент ещё нет (null).
  it('бабл документа несёт имя/размер/mime до аплоада, mediaId ещё нет', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)

    const msg = (p.beforeMessageSending(evt({
      text: '', type: 'document', media: { mime: 'application/pdf', size: 1234, name: 'оферта.pdf' },
    }))[0] as { msg: Message }).msg

    expect(msg.mediaName).toBe('оферта.pdf')
    expect(msg.mediaSize).toBe(1234)
    expect(msg.mediaMime).toBe('application/pdf')
    expect(msg.mediaId).toBeNull()
  })

  // Переехало оттуда же. Отменённый аплоад роняет upload() с 'aborted', и
  // катч-ветка зовёт fail уже по снятому баблу. Что ломается: не будь это no-op,
  // бабл «воскрес» бы на экране красной ошибкой после собственной отмены.
  it('поздний fail после отмены бабл не воскрешает', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt({ text: '', type: 'document' }))
    p.cancelPendingMessage('c-1')

    expect(p.failPendingMessage('c-1')).toEqual([])
    expect(msgsFor(1).size).toBe(0)
  })

  // Переехало оттуда же: отмена по неизвестному clientMsgId — no-op (никакого
  // «удалить хоть что-нибудь» по соседнему баблу).
  it('отмена по неизвестному clientMsgId — no-op', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt({ text: '', type: 'document' }))

    expect(p.cancelPendingMessage('nope')).toEqual([])
    expect(msgsFor(1).size).toBe(1)
  })
})

// Переехало из stores/messagesStore.sendStatus.test.ts: как жизненный цикл
// выглядит в UI. Статус бабла витрина выводит из самого сообщения
// (messageToConvMsg), поэтому пин остаётся осмысленным и после переезда
// механики в воркер — меняется только источник этих сообщений.
describe('pending: статус бабла в UI (tweb sendingStatus)', () => {
  const bubble = (ops: MessageOp[]): Message => {
    const op = ops[0]
    if (op?.op !== 'insert') throw new Error('ожидалась insert-операция')
    return op.msg
  }

  it('неотправленное рисуется часами (sending), а не галочкой', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)

    const msg = bubble(p.beforeMessageSending(evt()))

    expect(msg.id).toBeLessThan(0)
    expect(messageToConvMsg(msg, 42).status).toBe('sending')
  })

  it('ошибка → status error (бабл остаётся), ретрай → снова sending', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    const temp = bubble(p.beforeMessageSending(evt()))

    p.failPendingMessage('c-1')
    expect(messageToConvMsg(msgsFor(1).get(temp.seq)!, 42).status).toBe('error')

    p.retryPendingMessage('c-1')
    expect(messageToConvMsg(msgsFor(1).get(temp.seq)!, 42).status).toBe('sending')
  })

  it('ack после ретрая → status sent', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [10])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())
    p.failPendingMessage('c-1')
    p.retryPendingMessage('c-1')

    const acked = bubble(p.ackPendingMessage({ client_msg_id: 'c-1', msg_id: 100, seq: 12, created_at: '2026-07-14T00:00:00Z' }))

    expect(acked.id).toBe(100)
    expect(messageToConvMsg(acked, 42).status).toBe('sent')
  })
})
