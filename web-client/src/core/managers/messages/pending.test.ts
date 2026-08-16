// Семантика неотправленного сообщения — та же, что раньше пинили десять тестов
// stores/messagesStore.*.test.ts (dedup, ackEcho, tentativeSeq, threadRouting,
// sendStatus, uploadCancel). Она переехала из стора вкладки в менеджер воркера
// (порт формы tweb appMessagesManager), поэтому и тесты живут здесь: механика
// проверяется напрямую, без React и без zustand.
//
// Что тут НЕ проверяется и почему: отсутствие персиста временного бабла. Оно
// структурное — в ctx pending-механики персиста нет вовсе (см. pending.ts,
// «ЧЕГО НЕ ДЕЛАЕМ»), подделать его вызов неоткуда.
import { describe, it, expect } from 'vitest'
import SlicedArray, { SliceEnd } from '../../history/slicedArray'
import { newPendingMethods } from './pending'
import type { Message } from '../../models'
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
})
