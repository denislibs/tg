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
import { GENERAL_TOPIC_ID, generateMessageId, generateTempMessageId, isLocalMessageId } from '../../history/messageId'
import { makeMessage } from '../../messages/testMessage'
import type { MessageOp } from '../../realtime/messageOps'
import type { PendingNewEvt } from '../../realtime/events'
import type { SendArgs as WireSendArgs } from '../../realtime/connectionManager'
import type { UploadArgs } from '../mediaManager'
import { makeSticker } from '../../stickers/testSticker'

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
  /** Хранилища отложенных (порт `scheduledMessagesStorage`) и объявленные
   *  `scheduled_new` — сторона ленты отложенных. */
  const scheduled = new Map<number, Map<number, MyMessage>>()
  const scheduledFor = (peerId: number) => {
    let c = scheduled.get(peerId)
    if (!c) { c = new Map(); scheduled.set(peerId, c) }
    return c
  }
  const scheduledNews: MyMessage[] = []
  const h = {
    slices, msgsFor, emitted, sends, uploads, typings, progress, cancelled, order, broadcasts, scheduledFor, scheduledNews,
    /** подменяется в тестах аплоада (успех с другим id, отказ, «зависший» промис) */
    upload: vi.fn(async (a: UploadArgs) => { uploads.push(a); return 909 }),
    ctx: {
      hkey, slices, msgsFor,
      scheduledFor,
      scheduledKey: (peerId: number) => `${peerId}_scheduled`,
      scheduledNew: (m: MyMessage) => { scheduledNews.push(m) },
      appendNewest: (_key: string, sa: SlicedArray<number>, id: number) => { if (!sa.findSlice(id)) sa.unshift(id) },
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

    p.ackPendingMessage({ client_msg_id: 'c1', id: 50, date: 1 })

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

describe('pending: номер плашки «Обсуждение началось» занят', () => {
  // Пустой тред комментариев: в окне только корень, лента рисует за ним
  // плашку с номером generateTempMessageId(корень). Оригинал заводит плашку
  // тем же generateTempMessageId с записью в реестр tempMids
  // (appMessagesManager.ts:8793, :6956-6965), поэтому первый комментарий
  // встаёт ПОВЕРХ неё; без этого он получал номер плашки и не рисовался.
  it('первый комментарий пустого треда не делит номер с плашкой', () => {
    const { ctx, slices } = makeCtx()
    const root = cid(10)
    openWindow(slices, `1:${root}`, [root])
    const p = newPendingMethods(ctx)

    const msg = (p.beforeMessageSending(evt({ thread_root_id: root }))[0] as { msg: MessageReal }).msg

    expect(msg.id).not.toBe(generateTempMessageId(root))
    expect(msg.id).toBeGreaterThan(generateTempMessageId(root))
    expect(isLocalMessageId(msg.id)).toBe(true)
  })

  it('тред с комментариями — номер поверх последнего, как раньше', () => {
    const { ctx, slices } = makeCtx()
    const root = cid(10)
    openWindow(slices, `1:${root}`, [root, cid(12)])
    const p = newPendingMethods(ctx)

    const msg = (p.beforeMessageSending(evt({ thread_root_id: root }))[0] as { msg: MessageReal }).msg

    expect(msg.id).toBe(generateTempMessageId(cid(12)))
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
    const ops = p.ackPendingMessage({ client_msg_id: 'c-1', id: 20, date: 1786874400 })

    expect(ops).toHaveLength(1)
    const msg = (ops[0] as { msg: MessageReal }).msg
    // Номер в подтверждении СЕРВЕРНЫЙ — владелец переводит его на границе.
    expect(msg.id).toBe(cid(20))
    expect(msg.date).toBe(1786874400)
    expect(msg.message).toBe('привет')
    expect(msg.random_id).toBe('c-1')
    // временный номер ушёл из SSOT и из среза — иначе в окне осталось бы два бабла
    expect(temp.id).toBe(generateTempMessageId(cid(10)))
    expect(msgsFor(1).has(temp.id)).toBe(false)
    expect(slices.get('1')!.findSlice(temp.id)).toBeFalsy()
    expect(msgsFor(1).get(cid(20))).toEqual(msg)
  })

  // A4-17: ack несёт то, что сервер сделал с текстом сам — санитизированные
  // entities и превью ссылки; tweb кладёт их в бабл из updateShortSentMessage.
  it('ack кладёт серверные entities и вложение текста', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())
    const entities = [{ _: 'messageEntityBold' as const, offset: 0, length: 3 }]
    const media = { _: 'messageMediaWebPage' as const, webpage: { _: 'webPageEmpty' as const, id: '1' } }
    const ops = p.ackPendingMessage({ client_msg_id: 'c-1', id: 20, date: 5, entities, media } as never)
    const msg = (ops[0] as { msg: MessageReal }).msg
    expect(msg.date).toBe(5)
    expect(msg.entities).toEqual(entities)
    expect(msg.media).toMatchObject({ _: 'messageMediaWebPage' })
  })

  // Счёт истории (`historyStorage.count`) растёт на ФИНАЛЬНОМ сообщении, а не
  // на временном бабле: своя отправка — единственный путь новых сообщений в
  // «Избранном», и без этого «N messages» в его шапке стоял бы на месте.
  it('ack отдаёт финальный номер владельцу счёта истории, временный — нет', () => {
    const { ctx, slices } = makeCtx()
    const appended: [string, number][] = []
    const appendNewest = ctx.appendNewest
    ctx.appendNewest = (key, sa, id) => { appended.push([key, id]); appendNewest(key, sa, id) }
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())
    expect(appended).toEqual([])

    p.ackPendingMessage({ client_msg_id: 'c-1', id: 20, date: 1786874400 })

    expect(appended).toEqual([['1', cid(20)]])
  })

  it('echo-then-ack: эхо сняло бабл — повторный ack уже ничего не делает', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())

    p.checkPendingMessage('c-1') // пришло new_message со своим client_msg_id
    const ops = p.ackPendingMessage({ client_msg_id: 'c-1', id: 11, date: 1 })

    expect(ops).toEqual([])
    expect(p.hasPending('c-1')).toBe(false)
  })

  it('ack-then-echo: после ack эхо не находит регистрацию и ничего не ломает', () => {
    const { ctx, slices, msgsFor } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())
    p.ackPendingMessage({ client_msg_id: 'c-1', id: 11, date: 1786874400 })

    p.checkPendingMessage('c-1')

    // сверенное сообщение на месте, дубля нет
    expect([...msgsFor(1).keys()]).toEqual([cid(11)])
  })

  it('чужой clientId ack не трогает', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    const p = newPendingMethods(ctx)
    p.beforeMessageSending(evt())

    expect(p.ackPendingMessage({ client_msg_id: 'c-other', id: 1, date: 1 })).toEqual([])
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
    expect(p.ackPendingMessage({ client_msg_id: 'c-1', id: 11, date: 1 })).toHaveLength(1)
  })

  // Порт tweb `hasOutgoingMessage` (appMessagesManager.ts:10047-10055) — его читает
  // подсказка медленного режима: неотправленное, в том числе упавшее, держит пира.
  it('hasOutgoingMessage: есть у пира бабл в пути или с ошибкой — до ack/отмены', () => {
    const { ctx, slices } = makeCtx()
    openWindow(slices, '1', [cid(10)])
    openWindow(slices, '2', [cid(10)])
    const p = newPendingMethods(ctx)
    expect(p.hasOutgoingMessage(1)).toBe(false)

    p.beforeMessageSending(evt())
    expect(p.hasOutgoingMessage(1)).toBe(true)
    expect(p.hasOutgoingMessage(2)).toBe(false)

    p.failPendingMessage('c-1')
    expect(p.hasOutgoingMessage(1)).toBe(true)

    p.ackPendingMessage({ client_msg_id: 'c-1', id: 11, date: 1 })
    expect(p.hasOutgoingMessage(1)).toBe(false)

    p.beforeMessageSending(evt({ client_msg_id: 'c-2' }))
    p.cancelPendingMessage('c-2')
    expect(p.hasOutgoingMessage(1)).toBe(false)
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

    const acked = bubble(p.ackPendingMessage({ client_msg_id: 'c-1', id: 12, date: 1783987200 }))

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
      replyQuoteOffset: null, silent: false, effect: null, sendAsPeerId: null, scheduleDate: null, scheduleRepeatPeriod: null,
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

// Порт tweb `sendGrouped` (appMessagesManager.ts:3593-3830): все временные
// сообщения альбома — ОДНИМ объявлением до сети (`processAfter`, :3672-3727),
// отправка — после всех аплоадов, по порядку группы.
describe('sendGrouped: альбом — все баблы разом, затем аплоады, затем отправка', () => {
  const file = () => new Blob(['xxx'], { type: 'image/jpeg' })

  it('баблы группы уходят одним emit, кадры — после всех аплоадов, по порядку', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let n = 0
    h.upload.mockImplementation(async () => { const id = 900 + ++n; await gate; return id })
    const p = newPendingMethods(h.ctx)

    const sending = p.sendGrouped([1, 2, 3].map((i) => ({
      peerId: 1, clientMsgId: `c${i}`, senderId: 5, file: file(), type: 'photo' as const,
      isMedia: true, groupedId: 77, caption: i === 1 ? 'подпись' : '',
    })))
    // до аплоадов: ОДИН emit с тремя вставками, сеть не тронута
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].map((op) => (op as { msg: MessageReal }).msg.random_id)).toEqual(['c1', 'c2', 'c3'])
    expect(h.emitted[0].every((op) => (op as { msg: MessageReal }).msg.grouped_id === 77)).toBe(true)
    expect(h.sends).toEqual([])

    release()
    await sending
    expect(h.sends.map((a) => [a.clientMsgId, a.mediaId, a.groupedId])).toEqual([['c1', 901, 77], ['c2', 902, 77], ['c3', 903, 77]])
  })
})

describe('sendGrouped: отказ и отмена ячейки', () => {
  const file = () => new Blob(['xxx'], { type: 'image/jpeg' })
  const items = () => [1, 2, 3].map((i) => ({
    peerId: 1, clientMsgId: `c${i}`, senderId: 5, file: file(), type: 'photo' as const,
    isMedia: true, groupedId: 77, caption: i === 1 ? 'подпись' : '',
  }))

  // tweb :3836-3840 — `toggleError` ячейки и `throw`: `Promise.all` отклоняется,
  // `sendMultiMedia` не уходит; неполного альбома собеседник не получит.
  it('сорвался аплоад одной ячейки — не уходит ни один кадр, ячейка упавшая', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    let n = 0
    h.upload.mockImplementation(async () => { if (++n === 2) throw new Error('net'); return 900 + n })
    const p = newPendingMethods(h.ctx)
    await p.sendGrouped(items())
    expect(h.sends).toEqual([])
    expect(h.emitted.flat().some((op) => op.op === 'patch' && (op as { fields: { failed?: boolean } }).fields.failed)).toBe(true)
  })

  // tweb :3831-3834 — отменённая ячейка выпадает; подпись уходит с первой
  // отправляемой (:3879-3884).
  it('отменена первая ячейка — уходят остальные, подпись — со второй', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let n = 0
    h.upload.mockImplementation(async () => { const id = 900 + ++n; await gate; return id })
    const p = newPendingMethods(h.ctx)
    const sending = p.sendGrouped(items())
    await p.cancelPending({ clientMsgId: 'c1' })
    release()
    await sending
    expect(h.sends.map((a) => [a.clientMsgId, a.text])).toEqual([['c2', 'подпись'], ['c3', '']])
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
      replyQuoteOffset: null, silent: false, effect: null, sendAsPeerId: null, scheduleDate: null, scheduleRepeatPeriod: null,
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

  // tweb `sendFile({file: document})` (appMessagesManager.ts:2904-2987): у
  // стикера файл — УЖЕ сохранённый документ, и в бабл кладётся ровно он
  // (`document: isDocument ? file : document`), со всеми атрибутами и ступенями.
  // Что ломалось без этого (живой стенд): бабл «отправляется…» рождался БЕЗ
  // вложения — пустой пузырь с одним временем; ack переносит содержимое бабла
  // как есть, а эхо с тем же номером окно отбрасывает как дубль — стикер не
  // появлялся до перезагрузки, а время двух отправок подряд ложилось друг на друга.
  it('стикер: в бабле тот же документ, что выбран в пикере, — и после ack тоже', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)
    const sticker = makeSticker({ id: 2855, emoji: '🥳', mime: 'application/x-tgsticker', pathThumb: 'AAEC' })

    await p.sendText({
      peerId: 1, text: '', clientMsgId: 'c1', mediaId: sticker.id, type: 'sticker',
      optimistic: { senderId: 5, document: sticker },
    })

    const temp = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(temp.media).toEqual({ _: 'messageMediaDocument', document: sticker })
    expect(getDocumentFromMessage(temp)?.type).toBe('sticker')

    const acked = (p.ackPendingMessage({ client_msg_id: 'c1', id: 11, date: 1790447760 })[0] as { msg: MessageReal }).msg
    expect(acked.media).toEqual({ _: 'messageMediaDocument', document: sticker })
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
    expect(msg.reply_to).toEqual({ _: 'messageReplyHeader', pFlags: {}, reply_to_msg_id: cid(77) })
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
      _: 'messageReplyHeader', pFlags: {}, reply_to_msg_id: cid(77),
      reply_to_peer_id: { _: 'peerChannel', channel_id: 99 },
    })
  })

  // tweb generateReplyHeader (:4628-4718) + `replyToMsgId = threadId` (:4341-4342):
  // форма A1-16 у бабла сразу, иначе он читался бы сообщением General до эха
  // (ревью КЛ-1 М2)
  describe('форум', () => {
    const FORUM = -5
    const forumCtx = () => {
      const h = makeCtx()
      return { ...h, ctx: { ...h.ctx, isForum: (peerId: number) => peerId === FORUM } }
    }

    it('сообщение в теме: ответ на тему с `forum_topic`, без `reply_to_top_id`', () => {
      const h = forumCtx()
      openWindow(h.slices, `${FORUM}:${cid(10)}`)
      const msg = (newPendingMethods(h.ctx).beforeMessageSending(evt({ peer_id: FORUM, thread_root_id: cid(10) }))[0] as { msg: MessageReal }).msg
      expect(msg.reply_to).toEqual({ _: 'messageReplyHeader', pFlags: { forum_topic: true }, reply_to_msg_id: cid(10) })
    })

    it('ответ внутри темы: `reply_to_top_id` = тема', () => {
      const h = forumCtx()
      openWindow(h.slices, `${FORUM}:${cid(10)}`)
      const msg = (newPendingMethods(h.ctx).beforeMessageSending(evt({ peer_id: FORUM, thread_root_id: cid(10), reply_to_id: cid(12) }))[0] as { msg: MessageReal }).msg
      expect(msg.reply_to).toEqual({ _: 'messageReplyHeader', pFlags: { forum_topic: true }, reply_to_msg_id: cid(12), reply_to_top_id: cid(10) })
    })

    it('General: без `forum_topic`', () => {
      const h = forumCtx()
      openWindow(h.slices, `${FORUM}:${GENERAL_TOPIC_ID}`)
      const msg = (newPendingMethods(h.ctx).beforeMessageSending(evt({ peer_id: FORUM, thread_root_id: GENERAL_TOPIC_ID }))[0] as { msg: MessageReal }).msg
      expect(msg.reply_to).toEqual({ _: 'messageReplyHeader', pFlags: {}, reply_to_msg_id: GENERAL_TOPIC_ID })
    })

    it('ответ без треда — тред оригинала (:4672-4674)', () => {
      const h = forumCtx()
      openWindow(h.slices, `${FORUM}`)
      h.msgsFor(FORUM).set(cid(12), makeMessage({ id: cid(12), peerId: FORUM, replyToMsgId: cid(10), forumTopic: true }))
      const msg = (newPendingMethods(h.ctx).beforeMessageSending(evt({ peer_id: FORUM, reply_to_id: cid(12) }))[0] as { msg: MessageReal }).msg
      expect(msg.reply_to).toEqual({ _: 'messageReplyHeader', pFlags: { forum_topic: true }, reply_to_msg_id: cid(12), reply_to_top_id: cid(10) })
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

// Ф-5, п. 1.2.2: отложенная отправка — бабл ложится в хранилище отложенных, а не в
// историю (tweb `beforeMessageSending({isScheduled})`, appMessagesManager.ts:4370-4388:
// `saveMessages({isScheduled})` + `scheduled_new`, без `history_append`).
describe('pending: отложенная отправка', () => {
  it('sendText с scheduleDate: бабл в хранилище отложенных, scheduled_new, без операций окна истории', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendText({ peerId: 1, text: 'потом', clientMsgId: 'c-s', scheduleDate: 1_900_000_000, optimistic: { senderId: 42 } })

    expect(h.emitted).toEqual([])
    expect([...h.slices.get('1')!.first]).toEqual([cid(10)])
    expect(h.msgsFor(1).size).toBe(0)
    expect(h.scheduledNews).toHaveLength(1)
    const msg = h.scheduledNews[0] as MessageReal
    expect(msg).toMatchObject({ date: 1_900_000_000, random_id: 'c-s', pFlags: { out: true, is_scheduled: true } })
    expect(h.scheduledFor(1).get(msg.id)).toBe(msg)
    expect(h.sends).toEqual([expect.objectContaining({ clientMsgId: 'c-s', scheduleDate: 1_900_000_000 })])
  })

  it('отложенный файл: настоящий media_id и отмена правят окно ленты отложенных', async () => {
    const h = makeCtx()
    const p = newPendingMethods(h.ctx)
    let release!: () => void
    h.upload.mockImplementation(() => new Promise<number>((r) => { release = () => r(77) }))

    const sent = p.sendFile({ peerId: 1, clientMsgId: 'c-f', senderId: 42, file: new Blob(['x']), type: 'photo', isMedia: true, scheduleDate: 1_900_000_000 })
    const temp = h.scheduledNews[0] as MessageReal
    release()
    await sent

    expect(h.emitted).toEqual([[{ op: 'patch', key: '1_scheduled', msgId: temp.id, fields: { media: expect.anything() } }]])
    expect(h.sends).toEqual([expect.objectContaining({ mediaId: 77, scheduleDate: 1_900_000_000 })])

    expect(p.cancelPendingMessage('c-f')).toEqual([{ op: 'remove', key: '1_scheduled', msgId: temp.id }])
    expect(h.scheduledFor(1).size).toBe(0)
  })
})

describe('sendText: превью ссылки (tweb sendText :2695, generateOutgoingWebPage :4882-4910)', () => {
  const webPage = { _: 'webPage' as const, pFlags: {}, url: 'https://ex.com/a', display_url: 'ex.com/a', title: 'T' }

  it('карточка плашки: бабл сразу с messageMediaWebPage и invert_media, в кадре — media и invert_media', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendText({
      peerId: 1, text: 'смотри https://ex.com/a', clientMsgId: 'c1',
      webPage, webPageOptions: { optional: true }, invertMedia: true,
      optimistic: { senderId: 5 },
    })

    const msg = (h.emitted[0][0] as { msg: MessageReal }).msg
    expect(msg.media).toEqual({ _: 'messageMediaWebPage', pFlags: { force_large_media: undefined, force_small_media: undefined }, webpage: webPage })
    expect(msg.pFlags.invert_media).toBe(true)
    expect(h.sends[0].webPageFields).toEqual({
      media: { _: 'inputMediaWebPage', url: 'https://ex.com/a', pFlags: { force_large_media: undefined, force_small_media: undefined, optional: true } },
      invert_media: true,
    })
  })

  it('крестик плашки: no_webpage в кадре, бабл без карточки', async () => {
    const h = makeCtx()
    openWindow(h.slices, '1', [cid(10)])
    const p = newPendingMethods(h.ctx)

    await p.sendText({ peerId: 1, text: 'https://ex.com/a', clientMsgId: 'c1', noWebPage: true, optimistic: { senderId: 5 } })

    expect((h.emitted[0][0] as { msg: MessageReal }).msg.media).toBeUndefined()
    expect(h.sends[0].webPageFields).toEqual({ no_webpage: true })
  })
})
