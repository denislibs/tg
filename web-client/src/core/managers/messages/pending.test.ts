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
import { describe, it, expect, vi } from 'vitest'
import type { SendMessageAction } from '../../realtime/events'
import SlicedArray, { SliceEnd } from '../../history/slicedArray'
import { newPendingMethods } from './pending'
import { getDocumentFromMessage, getMediaDimensions, getMediaFromMessage, isMediaSpoiler } from '../../media/messageMedia'
import { messageToConvMsg } from '../../messageToConvMsg'
import type { MessageReal, MyMessage } from '../../models'
import { generateMessageId, generateTempMessageId, isLocalMessageId } from '../../history/messageId'
import type { MessageOp } from '../../realtime/messageOps'
import type { PendingNewEvt } from '../../realtime/events'
import type { SendArgs as WireSendArgs } from '../../realtime/connectionManager'
import type { UploadArgs } from '../mediaManager'

/** Стенд владельца: SSOT + срезы окон + все инъекции (транспорт, аплоад, typing,
 *  прогресс). `order` фиксирует порядок «бабл на экран → сеть», ради которого в
 *  tweb `message.send()` стоит именно в хвосте beforeMessageSending. */
function makeCtx() {
  const slices = new Map<string, SlicedArray<number>>()
  const msgsByChat = new Map<number, Map<number, MyMessage>>()
  const hkey = (peerId: number, threadRoot?: number | null) =>
    threadRoot ? `${peerId}:${threadRoot}` : String(peerId)
  const msgsFor = (peerId: number) => {
    let c = msgsByChat.get(peerId)
    if (!c) { c = new Map(); msgsByChat.set(peerId, c) }
    return c
  }
  const emitted: MessageOp[][] = []
  const sends: WireSendArgs[] = []
  const uploads: UploadArgs[] = []
  const typings: { peerId: number; action: SendMessageAction }[] = []
  const progress: { id: string; loaded: number; total: number; done?: boolean }[] = []
  const cancelled: string[] = []
  const order: string[] = []
  /** Ключи чатов, которые стенд считает ВЕЩАТЕЛЬНЫМИ каналами (порт
   *  `appPeersManager.isBroadcast`). По умолчанию пуст — обычный чат. */
  const broadcasts = new Set<number>()
  const h = {
    slices, msgsFor, emitted, sends, uploads, typings, progress, cancelled, order, broadcasts,
    /** подменяется в тестах аплоада (успех с другим id, отказ, «зависший» промис) */
    upload: vi.fn(async (a: UploadArgs) => { uploads.push(a); return 909 }),
    ctx: {
      hkey, slices, msgsFor,
      // Тот же id, что `sender_id` в evt() ниже. `pFlags.out` на бабле ставит
      // владелец литералом (сообщение зрителя, ещё не ушедшее), а `me` нужен
      // сторонам, которые решают вопрос «чьё это» ниже по потоку.
      getMeId: () => 42,
      isBroadcastChat: (peerId: number) => broadcasts.has(peerId),
      emit: (ops: MessageOp[]) => { if (ops.length) { order.push('emit'); emitted.push(ops) } },
      send: (a: WireSendArgs) => { order.push('send'); sends.push(a) },
      upload: (a: UploadArgs) => h.upload(a),
      cancelUpload: (id: string) => { cancelled.push(id) },
      sendTyping: (peerId: number, action: SendMessageAction) => { typings.push({ peerId, action }) },
      uploadProgress: (id: string, loaded: number, total: number, done?: boolean) => { progress.push({ id, loaded, total, done }) },
    },
  }
  return h
}

/** Номер в КЛИЕНТСКОМ пространстве — окно живёт только в нём (порт tweb
 *  `generateMessageId`). Пишем его явно: временный номер бабла считается
 *  дробью ПОВЕРХ последнего занятого, и на серверных числах эта арифметика
 *  выглядела бы иначе, чем в бою. */
const cid = generateMessageId

/** Открытое окно, держащее НИЗ истории — только в такое вставляется бабл. */
function openWindow(slices: Map<string, SlicedArray<number>>, key: string, ids: number[] = []) {
  const sa = new SlicedArray<number>()
  for (const s of ids) sa.unshift(s) // unshift кладёт новейшее вперёд
  sa.first.setEnd(SliceEnd.Bottom)
  slices.set(key, sa)
  return sa
}

const evt = (over: Partial<PendingNewEvt> = {}): PendingNewEvt => ({
  peer_id: 1, client_msg_id: 'c-1', sender_id: 42, text: 'привет', type: 'text', ...over,
})

describe('pending: появление бабла', () => {
  it('бабл попадает в SSOT и в срез окна, наружу — insert с clientId', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [cid(10), cid(11)])
    const p = newPendingMethods(ctx)

    const ops = p.beforeMessageSending(evt())

    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe('insert')
    const msg = (ops[0] as { msg: MessageReal }).msg
    // Своя отправка узнаётся по `random_id` — это конструкторное поле схемы, а
    // не наш `client_id` рядом с ним.
    expect(msg.random_id).toBe('c-1')
    expect(msg.failed).toBeUndefined()
    // в SSOT воркера — та же копия (её увидит переоткрытие чата)
    expect(msgsFor(1).get(msg.id)).toEqual(msg)
    expect(slices.get('1')!.findSlice(msg.id)).toBeTruthy()
  })

  // Порт `generateFlags` (tweb appMessagesManager.ts:3128-3130). Флаг решает
  // СТОРОНУ бабла (`isOurMessage`, chat.ts:1379 — `&& !message.pFlags.post`):
  // пост вещательного канала рисуется входящим даже у своего автора. Поставить
  // его только на эхе поздно — бабл стоял бы справа и прыгнул влево на ack.
  it('в вещательном канале временный бабл рождается с pFlags.post', () => {
    const { ctx, slices, broadcasts } = makeCtx()
    broadcasts.add(1)
    openWindow(slices, '1')
    const p = newPendingMethods(ctx)

    const msg = (p.beforeMessageSending(evt())[0] as { msg: MessageReal }).msg

    expect(msg.pFlags).toEqual({ out: true, post: true })
  })

  it('в обычном чате флага post у бабла нет', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1')
    const p = newPendingMethods(ctx)

    const msg = (p.beforeMessageSending(evt())[0] as { msg: MessageReal }).msg

    expect(msg.pFlags).toEqual({ out: true })
  })

  it('временный номер — ДРОБЬ поверх последнего занятого номером окна', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10), cid(11)])
    const p = newPendingMethods(ctx)

    const msg = (p.beforeMessageSending(evt())[0] as { msg: MessageReal }).msg

    // Порт tweb `generateTempMessageId`: не «максимум + 1» и не отрицательное
    // число — дробь поверх последнего занятого. Она держит бабл ПОСЛЕ него при
    // сортировке и не занимает номер, который сервер отдаст кому-то другому.
    expect(msg.id).toBe(generateTempMessageId(cid(11)))
    // Дробность и есть признак «номер назначен клиентом» (`isLocalMessageId`):
    // по нему dedupKey ключует бабл по random_id, иначе чужое входящее с тем же
    // номером вытеснило бы его из окна.
    expect(isLocalMessageId(msg.id)).toBe(true)
  })

  // Переехало из stores/messagesStore.tentativeSeq.test.ts. Что ломается: если
  // расчёт временного номера перестанет учитывать уже добавленный первый бабл,
  // второй получит тот же номер — и dedupAsc схлопнет их в один (тот же класс
  // бага, что коллизия с чужим входящим, только между двумя СВОИМИ баблами).
  it('два бабла подряд без ack между ними: оба на месте, номера различны', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1')
    const p = newPendingMethods(ctx)

    const first = (p.beforeMessageSending(evt({ client_msg_id: 'c1', text: 'first' }))[0] as { msg: MessageReal }).msg
    const second = (p.beforeMessageSending(evt({ client_msg_id: 'c2', text: 'second' }))[0] as { msg: MessageReal }).msg

    expect(second.id).toBe(generateTempMessageId(first.id))
    expect([...msgsFor(1).keys()].sort((a, b) => a - b)).toEqual([first.id, second.id])
  })

  // Переехало оттуда же. Что ломается: если бы ack матчился не строго по
  // clientId (а по позиции/seq), соседний бабл пропал бы или потерял clientId —
  // ломая React-ключ и подхват его собственного ack/эха.
  it('ack первого не трогает второй: второй остаётся неотправленным', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1')
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt({ client_msg_id: 'c1', text: 'first' }))
    const second = (p.beforeMessageSending(evt({ client_msg_id: 'c2', text: 'second' }))[0] as { msg: MessageReal }).msg

    p.ackPendingMessage({ client_msg_id: 'c1', id: 50, created_at: 'x' })

    expect(p.hasPending('c2')).toBe(true)
    const still = msgsFor(1).get(second.id)!
    expect(still.random_id).toBe('c2')
    expect(isLocalMessageId(still.id)).toBe(true)
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
    openWindow(slices, '1', [cid(10)])
    openWindow(slices, '1:7', [cid(10)])
    const p = newPendingMethods(ctx)

    const ops = p.beforeMessageSending(evt({ thread_root_id: 7 }))

    expect(ops.map((o) => o.key).sort()).toEqual(['1', '1:7'])
  })
})

describe('pending: подтверждение сервера', () => {
  it('ack переставляет номер и дату, сохраняя содержимое и random_id', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    const temp = (p.beforeMessageSending(evt())[0] as { msg: MessageReal }).msg

    // Номер сервера намеренно НЕ совпадает с подгаданным — иначе уборку
    // временного бабла не отличить от его перезаписи.
    const ops = p.ackPendingMessage({ client_msg_id: 'c-1', id: 20, created_at: '2026-08-16T10:00:00Z' })

    expect(ops).toHaveLength(1)
    const msg = (ops[0] as { msg: MessageReal }).msg
    // Номер в подтверждении СЕРВЕРНЫЙ — владелец переводит его на границе.
    expect(msg.id).toBe(cid(20))
    expect(msg.date).toBe(Math.floor(Date.parse('2026-08-16T10:00:00Z') / 1000))
    expect(msg.message).toBe('привет')
    expect(msg.random_id).toBe('c-1')
    // временный номер ушёл из SSOT и из среза — иначе в окне осталось бы два бабла
    expect(temp.id).toBe(generateTempMessageId(cid(10)))
    expect(msgsFor(1).has(temp.id)).toBe(false)
    expect(slices.get('1')!.findSlice(temp.id)).toBeFalsy()
    expect(msgsFor(1).get(cid(20))).toEqual(msg)
  })

  it('echo-then-ack: эхо сняло бабл — повторный ack уже ничего не делает', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())

    p.checkPendingMessage('c-1') // пришло new_message со своим client_msg_id
    const ops = p.ackPendingMessage({ client_msg_id: 'c-1', id: 11, created_at: 'x' })

    expect(ops).toEqual([])
    expect(p.hasPending('c-1')).toBe(false)
  })

  it('ack-then-echo: после ack эхо не находит регистрацию и ничего не ломает', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())
    p.ackPendingMessage({ client_msg_id: 'c-1', id: 11, created_at: '2026-08-16T10:00:00Z' })

    p.checkPendingMessage('c-1')

    // сверенное сообщение на месте, дубля нет
    expect([...msgsFor(1).keys()]).toEqual([cid(11)])
  })

  it('чужой clientId ack не трогает', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())

    expect(p.ackPendingMessage({ client_msg_id: 'c-other', id: 1, created_at: 'x' })).toEqual([])
    expect(p.hasPending('c-1')).toBe(true)
  })
})

describe('pending: ошибка, ретрай, отмена', () => {
  it('ошибка помечает бабл, но регистрацию СОХРАНЯЕТ — ack после ретрая найдёт его', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())

    const ops = p.failPendingMessage('c-1')

    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'patch', key: '1', fields: { failed: true } })
    expect(p.hasPending('c-1')).toBe(true)
    // и ретрай действительно доводится до конца
    expect(p.retryPendingMessage('c-1')[0]).toMatchObject({ fields: { failed: undefined } })
    expect(p.ackPendingMessage({ client_msg_id: 'c-1', id: 11, created_at: 'x' })).toHaveLength(1)
  })

  it('отмена убирает бабл из SSOT и среза, повторная — no-op', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    const temp = (p.beforeMessageSending(evt())[0] as { msg: MessageReal }).msg

    const ops = p.cancelPendingMessage('c-1')

    expect(ops).toEqual([{ op: 'remove', key: '1', msgId: temp.id }])
    expect(msgsFor(1).has(temp.id)).toBe(false)
    expect(slices.get('1')!.findSlice(temp.id)).toBeFalsy()
    expect(p.cancelPendingMessage('c-1')).toEqual([])
  })

  it('аплоад завершился — настоящий id файла приклеивается ВНУТРЬ вложения', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    const temp = (p.beforeMessageSending(evt({
      type: 'photo', text: '', media: { mime: 'image/jpeg', size: 10, width: 4, height: 4 },
    }))[0] as { msg: MessageReal }).msg

    // Плоского `media_id` рядом с сообщением больше нет: адрес файла живёт
    // ВНУТРИ `messageMediaPhoto`/`messageMediaDocument`, и патч подменяет ровно
    // его — иначе бабл остался бы с вложением, указывающим в никуда.
    expect(getMediaFromMessage(temp)!.id).toBe(temp.id)

    const ops = p.attachPendingMedia('c-1', 909)

    expect(ops).toHaveLength(1)
    const patch = ops[0] as { op: string; key: string; msgId: number; fields: Partial<MessageReal> }
    expect(patch).toMatchObject({ op: 'patch', key: '1', msgId: temp.id })
    expect(getMediaFromMessage({ media: patch.fields.media })!.id).toBe(909)
    expect(getMediaFromMessage(msgsFor(1).get(temp.id)!)!.id).toBe(909)
  })

  // Переехало из stores/messagesStore.uploadCancel.test.ts. Что ломается: бабл
  // документа появляется ДО аплоада, и рисовать его не из чего, если локальная
  // мета (имя/размер/mime) не доехала — пользователь видел бы пустую плашку
  // файла, пока идёт загрузка. mediaId на этот момент ещё нет (null), а сам
  // файл живёт под ВРЕМЕННЫМ id бабла (tweb mediaTempId = message.id).
  it('бабл документа несёт настоящий messageMediaDocument до аплоада, mediaId ещё нет', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)

    const msg = (p.beforeMessageSending(evt({
      text: '', type: 'document', media: { mime: 'application/pdf', size: 1234, name: 'оферта.pdf' },
    }))[0] as { msg: MessageReal }).msg

    expect(msg.media?._).toBe('messageMediaDocument')
    const doc = getDocumentFromMessage(msg)!
    expect(doc.file_name).toBe('оферта.pdf')
    expect(doc.size).toBe(1234)
    expect(doc.mime_type).toBe('application/pdf')
    // тип выводит saveDocument из mime — как у пришедшего с сервера документа
    expect(doc.type).toBe('pdf')
    expect(doc.id).toBe(msg.id) // временный id = id бабла
  })

  // Переехало оттуда же. Отменённый аплоад роняет upload() с 'aborted', и
  // катч-ветка зовёт fail уже по снятому баблу. Что ломается: не будь это no-op,
  // бабл «воскрес» бы на экране красной ошибкой после собственной отмены.
  it('поздний fail после отмены бабл не воскрешает', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [cid(10)])
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
    openWindow(slices, '1', [cid(10)])
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
  const bubble = (ops: MessageOp[]): MyMessage => {
    const op = ops[0]
    if (op?.op !== 'insert') throw new Error('ожидалась insert-операция')
    return op.msg
  }

  it('неотправленное рисуется часами (sending), а не галочкой', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)

    const msg = bubble(p.beforeMessageSending(evt()))

    expect(isLocalMessageId(msg.id)).toBe(true)
    expect(messageToConvMsg(msg, 42).status).toBe('sending')
  })

  it('ошибка → status error (бабл остаётся), ретрай → снова sending', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    const temp = bubble(p.beforeMessageSending(evt()))

    p.failPendingMessage('c-1')
    expect(messageToConvMsg(msgsFor(1).get(temp.id)!, 42).status).toBe('error')

    p.retryPendingMessage('c-1')
    expect(messageToConvMsg(msgsFor(1).get(temp.id)!, 42).status).toBe('sending')
  })

  it('ack после ретрая → status sent', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())
    p.failPendingMessage('c-1')
    p.retryPendingMessage('c-1')

    const acked = bubble(p.ackPendingMessage({ client_msg_id: 'c-1', id: 12, created_at: '2026-07-14T00:00:00Z' }))

    expect(acked.id).toBe(cid(12))
    expect(messageToConvMsg(acked, 42).status).toBe('sent')
  })
})

// ── Транспорт и аплоад ВНУТРИ менеджера (порт tweb) ─────────────────────────
// До этого этапа кадр слал realtime.ts («иначе циклический импорт»), а байты
// грузила вкладка вторым RPC (флаг awaitMedia придерживал кадр в воркере до
// конца аплоада). Теперь и то, и другое — здесь: `ctx.send` приходит инъекцией,
// `sendFile` владеет аплоадом целиком, как оригинальный appMessagesManager.
describe('sendText: бабл + кадр (порт tweb sendText → beforeMessageSending → message.send)', () => {
  it('с optimistic: заявка собрана из проводных полей, операции разосланы, бабл — ДО кадра', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendText({
      peerId: 1, text: 'hi', clientMsgId: 'c1', threadId: cid(7), type: 'contact', contactUserId: 42,
      optimistic: { senderId: 5, contactName: 'Маша' },
    })

    // порядок обязателен: сперва бабл на экран, потом сеть
    expect(h.order).toEqual(['emit', 'send'])
    const msg = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(msg.random_id).toBe('c1')
    expect(msg.fromId).toBe(5)
    // Визитка бабла — КОНСТРУКТОР `messageMediaContact` в поле `media`, а не
    // собственный ключ `contact` рядом. Все пять параметров обязательные и
    // стоят всегда, в том числе пустыми: телефон гидрирует сервер.
    expect(msg.media).toEqual({
      _: 'messageMediaContact',
      phone_number: '', first_name: 'Маша', last_name: '', vcard: '', user_id: 42,
    })
    // на провод уходят только проводные поля — служебный optimistic отрезан
    // Пакет параметров (порт tweb MessageSendingParams) проставляет свои поля
    // ВСЕГДА — пусто = явный null/false, а не «поля нет»: так путь отправки не
    // может тихо не передать поле (core/managers/messages/sendingParams.ts).
    // Номер корня треда уезжает на провод СЕРВЕРНЫМ — пакет несёт клиентский,
    // приведение стоит ровно в одном месте (`sendingParamsToWire`).
    expect(h.sends).toEqual([{
      peerId: 1, text: 'hi', clientMsgId: 'c1', type: 'contact', contactUserId: 42,
      threadRootId: 7, replyToId: null, replyToPeerId: null, replyQuoteText: null,
      replyQuoteOffset: null, silent: false, effect: null, sendAsPeerId: null,
    }])
  })

  // Гео-бабл собирается ТЕМ ЖЕ правилом, что и на бэкенде (`geoWire`): три
  // конструктора, выбор по наличию срока и подписи. Что ломается без этого:
  // своя отправленная точка до эха сервера рисуется пустым текстовым баблом.
  it.each([
    ['точка', { lat: 55.7, lng: 37.6 }, { _: 'messageMediaGeo', geo: { _: 'geoPoint', long: 37.6, lat: 55.7 } }],
    ['место с подписью', { lat: 55.7, lng: 37.6, title: 'Кафе', address: 'Пушкина, 1' },
      { _: 'messageMediaVenue', geo: { _: 'geoPoint', long: 37.6, lat: 55.7 }, title: 'Кафе', address: 'Пушкина, 1' }],
    ['живая трансляция', { lat: 55.7, lng: 37.6, livePeriod: 900, heading: 90 },
      { _: 'messageMediaGeoLive', geo: { _: 'geoPoint', long: 37.6, lat: 55.7 }, period: 900, heading: 90 }],
  ])('гео-бабл: %s едет своим конструктором', async (_name, geo, expected) => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendText({
      peerId: 1, text: '', clientMsgId: 'c1', threadId: null, type: 'geo', geo,
      optimistic: { senderId: 5 },
    })

    expect((h.emitted[0][0] as { msg: MessageReal }).msg.media).toEqual(expected)
  })

  // send-as: автор бабла — ССЫЛКА на канал, а не снимок `{title, photo_id}`.
  // Что ломается без этого: свой пост от лица канала до эха сервера подписан
  // ЛИЧНЫМ именем и аватаркой, а после эха имя подменяется — то самое
  // «прыгает», ради которого бабл и собирается заранее.
  it('send-as: автор бабла — выбранный канал, а не сам отправитель', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendText({
      peerId: 1, text: 'hi', clientMsgId: 'c1',
      optimistic: { senderId: 5, sendAs: -9 },
    })

    const msg = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(msg.fromId).toBe(-9)
    expect(msg.from_id).toEqual({ _: 'peerChannel', channel_id: 9 })
    // и `out` при этом ОСТАЁТСЯ: сообщение отправил зритель, сторону бабла
    // решает уже `from_id` (пин самого предиката — core/models.test.ts)
    expect(msg.pFlags.out).toBe(true)
  })

  // Что ломается: не зовись транспорт внутри менеджера — сообщение просто не
  // ушло бы на сервер (это и есть мутация, которой проверяется проводка).
  it('без optimistic: бабла нет, кадр уходит', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendText({ peerId: 1, text: 'hi', clientMsgId: 'c1' })

    expect(h.emitted).toEqual([])
    expect(h.sends).toHaveLength(1)
  })

  // Окно чата не открыто (или прокручено в середину истории) — бабла быть не
  // может, но отправку это не отменяет. Что ломается: сообщение, отправленное
  // из чата, чьё окно не держит низ, молча пропало бы.
  it('окно не держит низ истории: бабла нет, кадр всё равно уходит', async () => {
    const h = makeCtx()
    const p = newPendingMethods(h.ctx)

    await p.sendText({ peerId: 1, text: 'hi', clientMsgId: 'c1', optimistic: { senderId: 5 } })

    expect(h.emitted).toEqual([])
    expect(h.sends).toHaveLength(1)
  })
})

describe('sendFile: бабл → аплоад → attach → отправка (порт tweb sendFile)', () => {
  const file = (bytes = 'xxx', type = 'image/jpeg') => new Blob([bytes], { type })

  it('весь путь одним вызовом, кадр уходит РОВНО ОДИН РАЗ и уже с media_id', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    const r = await p.sendFile({
      peerId: 1, clientMsgId: 'c1', senderId: 5, file: file(), type: 'photo',
      fileName: 'photo.jpg', caption: 'подпись', width: 640, height: 480, isMedia: true,
      uploadAction: { _: 'sendMessageUploadPhotoAction' },
    })

    expect(r).toEqual({ mediaId: 909 })
    // бабл появился ДО аплоада, кадр ушёл ПОСЛЕ него (emit бабла → emit attach → send)
    expect(h.order).toEqual(['emit', 'emit', 'send'])
    const bubble = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(bubble.random_id).toBe('c1')
    expect(bubble.message).toBe('подпись')
    // фото «как медиа» — messageMediaPhoto с одной ступенью `w` (tweb :1957-1979)
    expect(bubble.media?._).toBe('messageMediaPhoto')
    expect(getMediaDimensions(getMediaFromMessage(bubble))).toEqual({ w: 640, h: 480 })
    // настоящего id файла ещё нет — он приедет патчем; пока файл живёт под
    // ВРЕМЕННЫМ id бабла (tweb mediaTempId = message.id)
    expect(getMediaFromMessage(bubble)!.id).toBe(bubble.id)
    // localUrl минтит ВОРКЕР (blob-URL воркера валиден во всех вкладках)
    expect(bubble.localUrl).toMatch(/^blob:/)
    // байты ушли в аплоад с progressId === clientMsgId (по нему же идёт отмена)
    expect(h.uploads[0]).toMatchObject({ mime: 'image/jpeg', fileName: 'photo.jpg', width: 640, height: 480, progressId: 'c1' })
    // attach приклеил media_id к тому же баблу — И САМОМУ ВЛОЖЕНИЮ: файл,
    // живший под временным id, получил адрес на сервере
    expect(h.emitted[1]).toHaveLength(1)
    const patch = h.emitted[1][0] as { op: string; key: string; msgId: number; fields: Partial<MessageReal> }
    expect(patch).toMatchObject({ op: 'patch', key: '1', msgId: bubble.id })
    expect(getMediaFromMessage({ media: patch.fields.media })!.id).toBe(909)
    // ОДИН кадр, и он несёт media_id (двухфазной отправки awaitMedia больше нет)
    expect(h.sends).toEqual([{
      peerId: 1, text: 'подпись', entities: null, clientMsgId: 'c1', type: 'photo',
      groupedId: undefined, paidMediaPrice: null, mediaId: 909, mediaSpoiler: undefined,
      threadRootId: null, replyToId: null, replyToPeerId: null, replyQuoteText: null,
      replyQuoteOffset: null, silent: false, effect: null, sendAsPeerId: null,
    }])
  })

  // Что ломается: без isMedia превью минтилось бы и для документа — лишний
  // blob-URL, который никто не отзовёт, и плашка файла с «картинкой».
  it('документ (isMedia не задан): превью не минтится, мета файла в бабле есть', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendFile({ peerId: 1, clientMsgId: 'c1', senderId: 5, file: file('pdf', 'application/pdf'), type: 'document', fileName: 'оферта.pdf' })

    const bubble = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(bubble.localUrl).toBeUndefined()
    const doc = getDocumentFromMessage(bubble)!
    expect(doc.file_name).toBe('оферта.pdf')
    expect(doc.mime_type).toBe('application/pdf')
  })

  // Что ломается: без пинга собеседник не видит «отправляет фото…» всё время
  // аплоада (tweb sendMessageUpload*Action), а без гашения прогресса на бабле
  // навсегда остаётся кольцо загрузки.
  it('typing-пинг и границы прогресса объявляет владелец', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendFile({ peerId: 1, clientMsgId: 'c1', senderId: 5, file: file(), type: 'photo', isMedia: true, uploadAction: { _: 'sendMessageUploadPhotoAction' } })

    // Вид действия — КОНСТРУКТОР объединения, а не строка нашего словаря.
    expect(h.typings[0]).toEqual({ peerId: 1, action: { _: 'sendMessageUploadPhotoAction' } })
    expect(h.progress[0]).toEqual({ id: 'c1', loaded: 0, total: 1, done: undefined })
    expect(h.progress[h.progress.length - 1]).toEqual({ id: 'c1', loaded: 0, total: 0, done: true })
  })

  // Что ломается: сорвавшийся аплоад оставлял бы бабл вечно «отправляется…», а
  // кадр без media_id ушёл бы на сервер и создал сообщение без медиа.
  it('ошибка аплоада: бабл помечен failed, кадр НЕ уходит', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    h.upload.mockRejectedValueOnce(new Error('boom'))
    const p = newPendingMethods(h.ctx)

    const r = await p.sendFile({ peerId: 1, clientMsgId: 'c1', senderId: 5, file: file(), type: 'photo', isMedia: true })

    expect(r).toEqual({ mediaId: null })
    expect(h.sends).toEqual([])
    const bubble = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(h.emitted[1]).toEqual([{ op: 'patch', key: '1', msgId: bubble.id, fields: { failed: true } }])
    expect(h.progress[h.progress.length - 1]).toEqual({ id: 'c1', loaded: 0, total: 0, done: true })
  })

  // Отмена на полпути: аплоад рвёт САМ владелец (он им и владеет), бабл уходит
  // из окна, а поздний отказ upload() его не воскрешает.
  it('отмена на полпути: аплоад оборван, бабл снят, поздний fail — no-op', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    let rejectUpload: (e: Error) => void = () => {}
    h.upload.mockImplementationOnce(() => new Promise<number>((_, rej) => { rejectUpload = rej }))
    const p = newPendingMethods(h.ctx)

    const sending = p.sendFile({ peerId: 1, clientMsgId: 'c1', senderId: 5, file: file(), type: 'photo', isMedia: true })
    await p.cancelPending({ clientMsgId: 'c1' })

    expect(h.cancelled).toEqual(['c1']) // аплоад оборван владельцем
    expect(h.emitted[1][0]).toMatchObject({ op: 'remove', key: '1' })
    rejectUpload(new Error('aborted'))
    await sending
    expect(h.sends).toEqual([]) // кадр не ушёл
    expect(h.emitted).toHaveLength(2) // fail по снятому баблу операций не породил
    expect(p.hasPending('c1')).toBe(false)
  })

  // Альбом (grouped_id) и платное медиа едут проводными полями кадра — иначе
  // сервер разложил бы фото альбома по отдельным сообщениям, а платное медиа
  // ушло бы бесплатным.
  it('groupedId и paidMediaPrice доезжают до кадра, groupedId — и до бабла', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendFile({
      peerId: 1, clientMsgId: 'c1', senderId: 5, file: file(), type: 'photo',
      isMedia: true, groupedId: 7007, paidMediaPrice: 50, caption: 'подпись', threadId: null,
    })

    // Ключ альбома — ЧИСЛО (`grouped_id:flags.17?long`), а не строка-«g7».
    expect((h.emitted[0][0] as { msg: MessageReal }).msg.grouped_id).toBe(7007)
    expect(h.sends[0]).toMatchObject({ groupedId: 7007, paidMediaPrice: 50, text: 'подпись' })
  })

  // Спойлер ставит ОТПРАВИТЕЛЬ в попапе отправки — к моменту вызова sendFile
  // превью там уже накрыто (tweb applyMediaSpoiler). Что ломается без этого:
  // свой бабл на время аплоада показывает медиа ОТКРЫТЫМ и прячет его только
  // после эха сервера — то есть скрытое медиа успевает засветиться отправителю.
  it('спойлер доезжает и до кадра, и до оптимистичного бабла', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendFile({
      peerId: 1, clientMsgId: 'c1', senderId: 5, file: file(), type: 'photo',
      isMedia: true, spoiler: true, threadId: null,
    })

    // спойлер живёт в pFlags вложения, литералом true (tweb :1600-1602)
    const bubble = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(isMediaSpoiler(bubble)).toBe(true)
    expect(bubble.media?._ === 'messageMediaPhoto' && bubble.media.pFlags).toEqual({ spoiler: true })
    expect(h.sends[0]).toMatchObject({ mediaSpoiler: true })
  })

  it('без спойлера признака нет ни в бабле, ни в кадре', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendFile({
      peerId: 1, clientMsgId: 'c1', senderId: 5, file: file(), type: 'photo',
      isMedia: true, threadId: null,
    })

    // «выключено» — это ОТСУТСТВИЕ ключа, не false
    const bubble = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(isMediaSpoiler(bubble)).toBe(false)
    expect(bubble.media?._ === 'messageMediaPhoto' && bubble.media.pFlags).toBeUndefined()
    expect(h.sends[0].mediaSpoiler).toBeUndefined()
  })

  // Пики волны считает ВКЛАДКА при записи (core/audio/waveform), и это то же
  // значение, что уедет в media.waveform. Что ломается без этого: свой бабл
  // «отправляется…» стоит без волны (и без длительности) до ответа сервера, а
  // потом волна выскакивает — при том, что данные были на руках с самого начала.
  it('голосовое: бабл «отправляется…» несёт пики и длительность сразу', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)
    const peaks = new Uint8Array([0x1f, 0x00, 0x2a, 0xff, 0x07])

    await p.sendFile({
      peerId: 1, clientMsgId: 'c1', senderId: 5, file: file('ogg', 'audio/ogg'),
      type: 'voice', duration: 7, waveform: peaks,
    })

    const bubble = (h.emitted[0][0] as { msg: MessageReal }).msg
    // пики и длительность лежат там же, где у серверного голосового, —
    // в documentAttributeAudio, а тип выводит saveDocument по voice+mime
    const doc = getDocumentFromMessage(bubble)!
    expect(doc.attributes).toContainEqual({
      _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 7, waveform: 'HwAq/wc=',
    })
    expect(doc.duration).toBe(7)
    expect(doc.type).toBe('voice')
    // те же байты ушли и в аплоад — сервер вернёт их же, волна после ack не прыгнет
    expect(h.uploads[0].waveform).toBe(peaks)
  })

  // Порт tweb `sendFile({isAnimated})` → `documentAttributeAnimated` (:2010-2014):
  // из этого атрибута `saveDocument` и выводит `doc.type === 'gif'`. Что ломается
  // без него: свой гиф всё время аплоада рисуется обычным видео-баблом с
  // play-диском и перескакивает в автоплей-цикл только после эха сервера.
  it('гифка: documentAttributeAnimated → doc.type === gif', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendFile({
      peerId: 1, clientMsgId: 'c1', senderId: 5, file: file('mp4', 'video/mp4'), type: 'video',
      fileName: 'tenor.mp4', width: 320, height: 240, isMedia: true, isAnimated: true,
    })

    const doc = getDocumentFromMessage((h.emitted[0][0] as { msg: MessageReal }).msg)!
    expect(doc.attributes).toContainEqual({ _: 'documentAttributeAnimated' })
    expect(doc.type).toBe('gif')
    expect(doc.animated).toBe(true)
  })

  it('без isAnimated то же видео остаётся видео', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendFile({
      peerId: 1, clientMsgId: 'c1', senderId: 5, file: file('mp4', 'video/mp4'), type: 'video',
      fileName: 'tenor.mp4', width: 320, height: 240, duration: 4, isMedia: true,
    })

    const doc = getDocumentFromMessage((h.emitted[0][0] as { msg: MessageReal }).msg)!
    expect(doc.type).toBe('video')
    expect(doc.w).toBe(320)
    expect(doc.h).toBe(240)
    expect(doc.duration).toBe(4)
  })

  // Кружок отличается от видео ОДНИМ битом атрибута (tweb :1991-2009) — тем же,
  // по которому `saveDocument` выводит `doc.type === 'round'`.
  it('кружок: round_message в documentAttributeVideo → doc.type === round', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendFile({
      peerId: 1, clientMsgId: 'c1', senderId: 5, file: file('webm', 'video/webm'), type: 'roundVideo', duration: 5,
    })

    const doc = getDocumentFromMessage((h.emitted[0][0] as { msg: MessageReal }).msg)!
    expect(doc.attributes).toContainEqual({
      _: 'documentAttributeVideo', pFlags: { round_message: true, supports_streaming: true },
      duration: 5, w: 0, h: 0,
    })
    expect(doc.type).toBe('round')
  })

  // Не голосовое: пиков нет — и атрибута аудио на вложении тоже нет
  // (не «пустая волна» и не аудио-документ вместо фотографии).
  it('фото: атрибута аудио нет вовсе', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendFile({ peerId: 1, clientMsgId: 'c1', senderId: 5, file: file(), type: 'photo', isMedia: true })

    const bubble = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(bubble.media?._).toBe('messageMediaPhoto')
    expect(getDocumentFromMessage(bubble)).toBeUndefined()
  })
})

// Механизма awaitMedia/awaitingMedia (кадр придерживается в воркере до конца
// аплоада, потому что байты грузила вкладка) больше НЕТ — он был следствием
// того, что аплоад жил на вкладке. Проверяем структурно: у sendFile нет ни
// такого поля, ни второй фазы, а кадр за отправку рождается ровно один.
// Уже сохранённый файл (GIF из вкладки, стикер) уходит с ГОТОВЫМ media_id —
// это ветка `isDocument` оригинала (:1538-1541), где в бабл кладётся уже
// сохранённый документ, а не временный. Что ломается без этого: бабл ссылается
// на несуществующий временный id и превью не грузится вовсе.
describe('sendText с готовым media_id: вложение под НАСТОЯЩИМ id', () => {
  it('сохранённый GIF: doc.id === media_id, тип выведен из атрибутов', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendText({
      peerId: 1, text: '', clientMsgId: 'c1', mediaId: 777, type: 'video',
      optimistic: {
        senderId: 5,
        media: { width: 320, height: 240, mime: 'video/mp4', size: 100, name: 'g.mp4', animated: true },
      },
    })

    const doc = getDocumentFromMessage((h.emitted[0][0] as { msg: MessageReal }).msg)!
    expect(doc.id).toBe(777)
    expect(doc.type).toBe('gif')
  })
})

describe('двухфазной отправки медиа не существует', () => {
  it('пока аплоад идёт, кадра нет; после — ровно один, и второго входа для него не нужно', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    let finishUpload: (id: number) => void = () => {}
    h.upload.mockImplementationOnce(() => new Promise<number>((res) => { finishUpload = res }))
    const p = newPendingMethods(h.ctx)

    const sending = p.sendFile({ peerId: 1, clientMsgId: 'c1', senderId: 5, file: new Blob(['x']), type: 'photo', isMedia: true })
    await Promise.resolve()
    // бабл уже на экране, кадр ещё нет — но придерживает его сам sendFile, а не
    // карта awaitingMedia, ждущая второго RPC с вкладки
    expect(h.emitted).toHaveLength(1)
    expect(h.sends).toEqual([])

    finishUpload(77)
    await sending

    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].mediaId).toBe(77)
  })
})

// Порт tweb `generateOutgoingMessage` (appMessagesManager.ts:2926): исходящее
// сообщение получает `reply_to` ЕЩЁ ДО ухода на сервер. Что ломается без этого:
// бабл появляется без цитаты и «прыгает», когда её через полсекунды принесёт
// серверное эхо, — то есть ответ визуально теряется ровно в тот момент, когда
// пользователь на него смотрит.
//
// На бабле это именно ССЫЛКА (`messageReplyHeader`), а не снимок оригинала:
// превью строит тот, кто рисует, разрешив номер в СВОЁМ окне. Резолвить
// оригинал здесь больше не из чего и незачем — плоской пары
// `reply_snapshot_name`/`_text` в модели не существует.
describe('pending: оптимистичный бабл несёт ССЫЛКУ на ответ ДО подтверждения сервера', () => {
  it('ссылка на отвечаемое стоит на бабле сразу', () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    const ops = p.beforeMessageSending(evt({ reply_to_id: cid(77) }))

    const msg = (ops[0] as { msg: MessageReal }).msg
    expect(msg.reply_to).toEqual({ _: 'messageReplyHeader', reply_to_msg_id: cid(77) })
  })

  it('цитата едет ВНУТРИ ссылки, флагом схемы', () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    const ops = p.beforeMessageSending(evt({ reply_to_id: cid(77), reply_quote_text: 'ригин' }))

    expect((ops[0] as { msg: MessageReal }).msg.reply_to).toEqual({
      _: 'messageReplyHeader', reply_to_msg_id: cid(77),
      pFlags: { quote: true }, quote_text: 'ригин',
    })
  })

  // Кросс-чат ответ: оригинала в этом чате нет, поэтому ссылка несёт ЕЩЁ И чат
  // оригинала. Атрибуцию автора (`reply_from`) и вложение (`reply_media`)
  // принесёт эхо сервера — их клиент не выдумывает.
  it('кросс-чат ответ: ссылка несёт чат оригинала', () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    const ops = p.beforeMessageSending(evt({ reply_to_id: cid(77), reply_to_peer_id: -99 }))

    const msg = (ops[0] as { msg: MessageReal }).msg
    expect(msg.reply_to).toEqual({
      _: 'messageReplyHeader', reply_to_msg_id: cid(77),
      reply_to_peer_id: { _: 'peerChannel', channel_id: 99 },
    })
  })

  it('без ответа ссылки нет вовсе (idle-путь не выдумывает reply_to)', () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    expect((p.beforeMessageSending(evt())[0] as { msg: MessageReal }).msg.reply_to).toBeUndefined()
  })

  it('sendText: пакет параметров доезжает и до кадра, и до бабла', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendText({
      peerId: 1, text: 'ответ', clientMsgId: 'c1',
      replyToMsgId: cid(77), replyToQuote: { text: 'ригин', offset: 1 }, threadId: null,
      silent: true, effect: 'hearts', sendAsPeerId: 3,
      optimistic: { senderId: 42 },
    })

    // на провод номер уезжает СЕРВЕРНЫМ, в бабл — клиентским: одна и та же
    // граница, пройденная в разные стороны
    expect(h.sends[0]).toMatchObject({
      replyToId: 77, replyQuoteText: 'ригин', replyQuoteOffset: 1,
      silent: true, effect: 'hearts', sendAsPeerId: 3,
    })
    const msg = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(msg.reply_to?.reply_to_msg_id).toBe(cid(77))
    expect(msg.reply_to?.quote_text).toBe('ригин')
  })

  it('sendFile: тот же пакет — и в кадр, и в бабл', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendFile({
      peerId: 1, clientMsgId: 'c1', senderId: 42, file: new Blob(['x']), type: 'photo',
      isMedia: true, replyToMsgId: cid(77), replyToQuote: { text: 'ригин', offset: 1 }, silent: true,
    })

    expect(h.sends[0]).toMatchObject({ replyToId: 77, replyQuoteText: 'ригин', silent: true })
    expect((h.emitted[0][0] as { msg: MessageReal }).msg.reply_to?.reply_to_msg_id).toBe(cid(77))
  })

  // Порт правила tweb `getInputReplyTo` (:2674): quote_text/quote_offset лежат
  // ВНУТРИ inputReplyToMessage, поэтому без ответа их некуда положить; бэкенд
  // сбрасывает их тем же правилом (message.go:167-169).
  it('цитата без ответа на провод не уходит', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendText({ peerId: 1, text: 'x', clientMsgId: 'c1', replyToQuote: { text: 'ригин', offset: 1 } })

    expect(h.sends[0]).toMatchObject({ replyToId: null, replyQuoteText: null, replyQuoteOffset: null })
  })
})
