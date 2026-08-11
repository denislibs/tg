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

describe('realtime.markMediaRead', () => {
  it('broadcasts the MessageOp[] returned by cacheMediaRead as rt:message_op', async () => {
    const ops: MessageOp[] = [{ op: 'patch', key: '1', msgId: 7, fields: { mediaUnread: false } }]
    const conn = { markMediaRead: vi.fn() } as unknown as Parameters<typeof newRealtime>[0]['conn']
    const messages = { cacheMediaRead: vi.fn(() => ops) }
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
    const messages = { cacheMediaRead: vi.fn(() => []) }
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
      messages: { cacheMediaRead: vi.fn(() => []) },
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
      messages: { cacheMediaRead: () => [] },
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
