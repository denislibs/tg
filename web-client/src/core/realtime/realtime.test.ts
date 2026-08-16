// src/core/realtime/realtime.test.ts
//
// Регрессия (финальное ревью feat/remaining-ops, Regression 1): markMediaRead —
// RPC-путь клика по голосовому/кружку (useVoiceQueue/SearchView/SharedMedia/
// mediaBubbles → core/mediaRead.ts → realtime.markMediaRead). Stage 1B.3 убрала
// [RT.mediaRead] из реестра APPLY проектора (storeProjection.ts) — окно теперь
// правит ТОЛЬКО applyOps(RT.messageOp). messages.cacheMediaRead уже отдаёт
// MessageOp[], но markMediaRead их выбрасывал (тип зависимости был `void`),
// поэтому точка «не прослушано» не гасла ни в одной вкладке до перезагрузки.
import { describe, it, expect, vi } from 'vitest'
import { newRealtime } from './realtime'
import { newConnectionManager } from './connectionManager'
import { newSyncEngine } from './syncEngine'
import { RT } from './events'
import type { MessageOp } from './messageOps'
import type { Cursor } from './cursor'

// Pending-механика в этих кейсах не участвует: заглушки возвращают пустой список
// операций (свой предмет — describe'ы ниже).
const noPending = {
  beforeMessageSending: () => [] as MessageOp[],
  attachPendingMedia: () => [] as MessageOp[],
  failPendingMessage: () => [] as MessageOp[],
  retryPendingMessage: () => [] as MessageOp[],
  cancelPendingMessage: () => [] as MessageOp[],
}

describe('realtime.markMediaRead', () => {
  it('broadcasts the MessageOp[] returned by cacheMediaRead as rt:message_op', async () => {
    const ops: MessageOp[] = [{ op: 'patch', key: '1', msgId: 7, fields: { mediaUnread: false } }]
    const conn = { markMediaRead: vi.fn() } as unknown as Parameters<typeof newRealtime>[0]['conn']
    const messages = { ...noPending, cacheMediaRead: vi.fn(() => ops) }
    const broadcast = vi.fn()
    const rt = newRealtime({
      conn,
      sync: { isSyncing: () => false },
      tokens: { load: async () => undefined },
      messages,
      broadcast,
      channelFunnel: { open: async () => undefined, close: () => undefined } as unknown as Parameters<typeof newRealtime>[0]['channelFunnel'],
    })

    await rt.markMediaRead({ chatId: 1, msgId: 7 })

    expect(broadcast).toHaveBeenCalledWith(RT.messageOp, { ops })
  })

  it('does not broadcast rt:message_op when cacheMediaRead produces no ops (idempotent replay)', async () => {
    const conn = { markMediaRead: vi.fn() } as unknown as Parameters<typeof newRealtime>[0]['conn']
    const messages = { ...noPending, cacheMediaRead: vi.fn(() => []) }
    const broadcast = vi.fn()
    const rt = newRealtime({
      conn,
      sync: { isSyncing: () => false },
      tokens: { load: async () => undefined },
      messages,
      broadcast,
      channelFunnel: { open: async () => undefined, close: () => undefined } as unknown as Parameters<typeof newRealtime>[0]['channelFunnel'],
    })

    await rt.markMediaRead({ chatId: 1, msgId: 7 })

    expect(broadcast).not.toHaveBeenCalledWith(RT.messageOp, expect.anything())
  })
})

// Ревью Задачи 1 («сигнал только push — новая вкладка слепа»): realtime.start()
// возвращал { state } и выбрасывался (`void managers.realtime.start()`), а
// retryAt/syncing нигде не хранились — вкладка, подключившаяся посреди
// reconnect-backoff'а (до MAX_BACKOFF=30с), не видела ни одного события RT.state
// вплоть до следующего перехода. getStatus() — pull-эквивалент tweb
// getConnectionStatus() (connectionStatus.ts:87-91) для state/retryAt; syncing —
// наше расширение той же дисциплины (не в getConnectionStatus() у tweb,
// см. докблок getStatus в realtime.ts).
describe('realtime.getStatus', () => {
  it('снимает текущее состояние/retryAt/syncing с conn и sync', async () => {
    const conn = {
      state: vi.fn(() => 'reconnecting'),
      retryAt: vi.fn(() => 1_700_000_000_000),
    } as unknown as Parameters<typeof newRealtime>[0]['conn']
    const sync = { isSyncing: vi.fn(() => true) }
    const rt = newRealtime({
      conn,
      sync,
      tokens: { load: async () => undefined },
      messages: { ...noPending, cacheMediaRead: vi.fn(() => []) },
      broadcast: vi.fn(),
      channelFunnel: { open: async () => undefined, close: () => undefined } as unknown as Parameters<typeof newRealtime>[0]['channelFunnel'],
    })

    await expect(rt.getStatus()).resolves.toEqual({
      state: 'reconnecting',
      retryAt: 1_700_000_000_000,
      syncing: true,
    })
  })
})

// Уточнение ревью Задачи 1: getStatus() обязан быть ПОЛНОЦЕННЫМ pull (tweb
// connectionStatus.ts:47-51/:87-91 — для state/retryAt, 1:1; syncing — наше
// расширение, не факт оригинала, см. realtime.ts), а не разовым снапшотом поверх
// push-канала. Ключевое свойство — иммунность к потере уведомления:
// SuperMessagePort не буферизует кадры, а realtimeBridge вешает `smp.on(...)` в
// эффекте ПОСЛЕ первого рендера,
// поэтому ранний rt:state физически теряется для подписчика, смонтировавшегося
// позже (тот же класс дыры, что у loadChats vs push для `me`). Этот тест гоняет
// НАСТОЯЩИЕ connectionManager + syncEngine (не моки функций conn.state/retryAt) и
// нарочно НЕ подписывается ни на одно onState/onSyncStart-уведомление — имитируя
// подписчика, который эти события пропустил целиком, — затем убеждается, что
// getStatus() всё равно отдаёт актуальное состояние, потому что читает его
// напрямую с живых conn/sync, а не кэширует то, что «увидела» через push.
describe('realtime.getStatus — иммунность к потере push-уведомления', () => {
  function fakeWs() {
    let openCb = () => {}; let closeCb = () => {}
    return {
      client: {
        connect: vi.fn(), onOpen: (cb: () => void) => { openCb = cb }, onClose: (cb: () => void) => { closeCb = cb },
        onError: () => {}, on: () => {}, send: () => {}, isOpen: () => true, close: vi.fn(() => closeCb()),
      },
      fireOpen: () => openCb(), fireClose: () => closeCb(),
    }
  }
  function fakeCursor(): Cursor {
    let pts = 0; let date = 0
    return { ready: async () => {}, get: () => ({ pts, date }), advance: (p, d) => { if (p > pts) pts = p; if (typeof d === 'number' && d > date) date = d }, set: (p, d) => { pts = p; date = d } }
  }

  it('поздний подписчик, пропустивший и rt:state, и rt:state_synchronizing, получает актуальные state/retryAt/syncing через pull', async () => {
    const ws = fakeWs()
    // onState/onSyncStart/onSyncEnd — намеренно "глухие": ни один колбэк ничего не
    // запоминает, имитируя подписчика, который эти push-уведомления не услышал.
    const conn = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    conn.start(); ws.fireOpen() // 'ready'
    ws.fireClose() // реальный внутренний переход в 'reconnecting' с посчитанным retryAt — синхронно внутри scheduleReconnect

    let resolveGet: ((v: unknown) => void) | null = null
    const rest = { get: vi.fn(() => new Promise((r) => { resolveGet = r })) }
    const sync = newSyncEngine({ rest: rest as never, cursor: fakeCursor(), onUpdate: () => {}, onResync: () => {} })
    const catchUpDone = sync.catchUp() // running присваивается синхронно — isSyncing() уже true

    const rt = newRealtime({
      conn, sync,
      tokens: { load: async () => undefined },
      messages: { ...noPending, cacheMediaRead: () => [] },
      broadcast: () => {},
      channelFunnel: { open: async () => undefined, close: () => undefined } as unknown as Parameters<typeof newRealtime>[0]['channelFunnel'],
    })

    const status = await rt.getStatus()
    expect(status.state).toBe('reconnecting')
    expect(status.retryAt).toEqual(expect.any(Number))
    expect(status.syncing).toBe(true)

    resolveGet!({ new_messages: [], other_updates: [], state: { pts: 0, date: 0 }, slice: false })
    await catchUpDone

    // Второй pull ловит мутацию «getStatus() запомнил значение с первого вызова»
    // (памятка не спасла бы первый ассерт выше — ловится только повторным чтением
    // ПОСЛЕ дальнейшего изменения). conn.stop() меняет state НАПРЯМУЮ, минуя даже
    // внутренний вызов setState/onState — предельный случай «события не было
    // вообще ни разу», и getStatus() обязан увидеть его всё равно.
    conn.stop()
    const after = await rt.getStatus()
    expect(after.state).toBe('offline')
    expect(after.syncing).toBe(false)
  })
})

// Этап «оптимистика в воркере»: sendMessage — ЕДИНСТВЕННАЯ точка отправки, она же
// заводит временный бабл (порт tweb beforeMessageSending → message.send()).
// Раньше вкладка звала два независимых RPC (appendPending + sendMessage), а
// воркер своего бабла не держал вовсе. Тесты ниже пинят проводку: менеджер
// зовётся, его операции уходят веером, кадр уходит транспортом, и порядок
// «бабл → кадр» сохранён (иначе бабл появлялся бы уже после сети).
describe('realtime.sendMessage — временный бабл + отправка', () => {
  function makeRt() {
    const sends: unknown[] = []
    const order: string[] = []
    const broadcasts: { event: string; payload: unknown }[] = []
    const conn = { sendMessage: (a: unknown) => { order.push('send'); sends.push(a) } } as unknown as Parameters<typeof newRealtime>[0]['conn']
    const ops: MessageOp[] = [{ op: 'insert', key: '1', msg: { id: -1, chatId: 1, seq: 1, senderId: 5, type: 'text', text: 'hi', replyToId: null, mediaId: null, createdAt: 'now', threadRootId: null, clientId: 'c1' } }]
    const messages = {
      cacheMediaRead: () => [] as MessageOp[],
      beforeMessageSending: vi.fn(() => { order.push('pending'); return ops }),
      attachPendingMedia: vi.fn(() => [{ op: 'patch', key: '1', msgId: -1, fields: { mediaId: 9 } }] as MessageOp[]),
      failPendingMessage: vi.fn(() => [{ op: 'patch', key: '1', msgId: -1, fields: { failed: true } }] as MessageOp[]),
      retryPendingMessage: vi.fn(() => [{ op: 'patch', key: '1', msgId: -1, fields: { failed: undefined } }] as MessageOp[]),
      cancelPendingMessage: vi.fn(() => [{ op: 'remove', key: '1', msgId: -1 }] as MessageOp[]),
    }
    const rt = newRealtime({
      conn,
      sync: { isSyncing: () => false },
      tokens: { load: async () => undefined },
      messages,
      broadcast: (event, payload) => { broadcasts.push({ event, payload }) },
      channelFunnel: { open: async () => undefined, close: () => undefined } as unknown as Parameters<typeof newRealtime>[0]['channelFunnel'],
    })
    return { rt, sends, order, broadcasts, messages, ops }
  }

  it('с optimistic: заявка собрана из проводных полей, операции разосланы, бабл — ДО кадра', async () => {
    const { rt, sends, order, broadcasts, messages, ops } = makeRt()

    await rt.sendMessage({
      chatId: 1, text: 'hi', clientMsgId: 'c1', threadRootId: 7, type: 'contact', contactUserId: 42,
      optimistic: { senderId: 5, contactName: 'Маша', sendAs: { chatId: 9, title: 'Канал' } },
    })

    expect(messages.beforeMessageSending).toHaveBeenCalledWith({
      chat_id: 1, thread_root_id: 7, client_msg_id: 'c1', sender_id: 5, text: 'hi', type: 'contact',
      entities: undefined, media_id: null, grouped_id: undefined, media: undefined, geo: undefined,
      contact: { userId: 42, name: 'Маша', phone: '' }, secret: undefined, send_as: { chatId: 9, title: 'Канал' },
    })
    expect(broadcasts).toEqual([{ event: RT.messageOp, payload: { ops } }])
    // порядок обязателен: сперва бабл на экран, потом сеть
    expect(order).toEqual(['pending', 'send'])
    // на провод уходят только поля SendArgs — служебные optimistic/awaitMedia отрезаны
    expect(sends[0]).toEqual({ chatId: 1, text: 'hi', clientMsgId: 'c1', threadRootId: 7, type: 'contact', contactUserId: 42 })
  })

  // Пути без оптимистики: черновик → createPrivate (окна ещё нет), комментарий к
  // форварду, переотправка упавшего бабла (он уже зарегистрирован — второй
  // beforeMessageSending завёл бы рядом дубль).
  it('без optimistic: бабл не заводится, кадр уходит', async () => {
    const { rt, sends, broadcasts, messages } = makeRt()

    await rt.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })

    expect(messages.beforeMessageSending).not.toHaveBeenCalled()
    expect(broadcasts).toEqual([])
    expect(sends).toHaveLength(1)
  })

  // awaitMedia: бабл нужен СРАЗУ (кольцо прогресса аплоада), а кадр — только когда
  // появился media_id. Уйди кадр сразу — сервер создал бы сообщение без медиа.
  it('awaitMedia: кадр придержан до attachPendingMedia и уходит уже с media_id', async () => {
    const { rt, sends, broadcasts, messages } = makeRt()

    await rt.sendMessage({ chatId: 1, text: 'подпись', clientMsgId: 'c1', type: 'photo', awaitMedia: true, optimistic: { senderId: 5 } })
    expect(sends).toEqual([])

    await rt.attachPendingMedia({ clientMsgId: 'c1', mediaId: 9 })

    expect(messages.attachPendingMedia).toHaveBeenCalledWith('c1', 9)
    expect(sends).toEqual([{ chatId: 1, text: 'подпись', clientMsgId: 'c1', type: 'photo', mediaId: 9 }])
    expect(broadcasts.map((b) => b.event)).toEqual([RT.messageOp, RT.messageOp])
    // повторный attach ничего не досылает — придержанный кадр уже ушёл
    await rt.attachPendingMedia({ clientMsgId: 'c1', mediaId: 9 })
    expect(sends).toHaveLength(1)
  })

  it('failPending выбрасывает придержанный кадр: поздний attach его уже не шлёт', async () => {
    const { rt, sends, messages } = makeRt()

    await rt.sendMessage({ chatId: 1, text: '', clientMsgId: 'c1', type: 'photo', awaitMedia: true, optimistic: { senderId: 5 } })
    await rt.failPending({ clientMsgId: 'c1' })
    await rt.attachPendingMedia({ clientMsgId: 'c1', mediaId: 9 })

    expect(messages.failPendingMessage).toHaveBeenCalledWith('c1')
    expect(sends).toEqual([])
  })

  it('cancelPending (отмена аплоада) выбрасывает придержанный кадр и снимает бабл', async () => {
    const { rt, sends, broadcasts, messages } = makeRt()

    await rt.sendMessage({ chatId: 1, text: '', clientMsgId: 'c1', type: 'document', awaitMedia: true, optimistic: { senderId: 5 } })
    await rt.cancelPending({ clientMsgId: 'c1' })
    await rt.attachPendingMedia({ clientMsgId: 'c1', mediaId: 9 })

    expect(messages.cancelPendingMessage).toHaveBeenCalledWith('c1')
    // [0] — insert бабла из sendMessage, [1] — remove из отмены (заглушка
    // attachPendingMedia в этом стенде отвечает и на неизвестный clientMsgId).
    expect(broadcasts[1]).toEqual({ event: RT.messageOp, payload: { ops: [{ op: 'remove', key: '1', msgId: -1 }] } })
    expect(sends).toEqual([])
  })

  it('retryPending снимает пометку ошибки операцией владельца', async () => {
    const { rt, broadcasts, messages } = makeRt()

    await rt.retryPending({ clientMsgId: 'c1' })

    expect(messages.retryPendingMessage).toHaveBeenCalledWith('c1')
    expect(broadcasts).toEqual([{ event: RT.messageOp, payload: { ops: [{ op: 'patch', key: '1', msgId: -1, fields: { failed: undefined } }] } }])
  })

  // Пустой список операций — не повод для кадра: бабла в окнах нет (окно не
  // держит низ истории / бабл уже снят). Лишний rt:message_op заставил бы каждую
  // вкладку впустую пересобирать окно.
  it('пустой список операций кадром не рассылается', async () => {
    const { rt, broadcasts, messages } = makeRt()
    messages.cancelPendingMessage.mockReturnValueOnce([])

    await rt.cancelPending({ clientMsgId: 'c-unknown' })

    expect(broadcasts).toEqual([])
  })
})
