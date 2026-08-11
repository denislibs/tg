// src/core/realtime/connectionManager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { newConnectionManager } from './connectionManager'

function fakeWs() {
  const frames: Array<{ t: string; d?: unknown }> = []
  let openCb = () => {}; let closeCb = () => {}
  const onHandlers = new Map<string, (d: unknown) => void>()
  return {
    client: {
      connect: vi.fn(),
      onOpen: (cb: () => void) => { openCb = cb },
      onClose: (cb: () => void) => { closeCb = cb },
      onError: () => {},
      on: (t: string, cb: (d: unknown) => void) => onHandlers.set(t, cb),
      send: (t: string, d?: unknown) => frames.push({ t, d }),
      isOpen: () => true,
      close: vi.fn(() => closeCb()),
    },
    frames, fireOpen: () => openCb(), fireClose: () => closeCb(),
    recv: (t: string, d: unknown) => onHandlers.get(t)?.(d),
  }
}

// NOTE: vitest 4.1.9 in this repo deadlocks when `vi.useRealTimers()` runs
// inside an `afterEach` hook with fake timers active. Restoring real timers at
// the start of `beforeEach` (before re-faking) gives identical isolation
// without the hook hang. See task report for details.
beforeEach(() => { vi.useRealTimers(); vi.useFakeTimers() })

describe('ConnectionManager', () => {
  it('connects, reaches ready on open, runs onReady', async () => {
    const ws = fakeWs(); const onReady = vi.fn(); const onState = vi.fn()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady, onState, onFrame: () => {} })
    cm.start()
    expect(ws.client.connect).toHaveBeenCalledWith('tok')
    ws.fireOpen()
    expect(onState).toHaveBeenCalledWith('ready')
    expect(onReady).toHaveBeenCalled()
  })

  it('queues a send in the outbox and clears it on ack', () => {
    const ws = fakeWs()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    cm.start(); ws.fireOpen()
    cm.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })
    expect(ws.frames.find(f => f.t === 'send_message')).toBeTruthy()
    expect(cm.outboxSize()).toBe(1)
    ws.recv('message_ack', { client_msg_id: 'c1', msg_id: 9, seq: 5, created_at: 'now' })
    expect(cm.outboxSize()).toBe(0)
  })

  it('sends a subscribe_channel frame after open', () => {
    const ws = fakeWs()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    cm.start(); ws.fireOpen()
    cm.subscribeChannel(5)
    const f = ws.frames.find(f => f.t === 'subscribe_channel')
    expect(f).toBeTruthy()
    expect(f?.d).toEqual({ chat_id: 5 })
  })

  it('resends the outbox after a reconnect', () => {
    const ws = fakeWs()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    cm.start(); ws.fireOpen()
    cm.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })
    ws.frames.length = 0
    ws.fireClose()
    vi.advanceTimersByTime(1000) // backoff elapses → reconnect
    ws.fireOpen()
    expect(ws.frames.filter(f => f.t === 'send_message').length).toBe(1)
  })

  it('persists the outbox on send/ack and resends restored entries on connect', async () => {
    const ws = fakeWs()
    const saved: unknown[][] = []
    const store = {
      load: () => Promise.resolve([{ chatId: 2, text: 'restored', clientMsgId: 'old1' }]),
      save: (list: unknown[]) => { saved.push(list) },
    }
    const cm = newConnectionManager({
      ws: ws.client as never, getToken: () => 'tok',
      onReady: () => {}, onState: () => {}, onFrame: () => {},
      outboxStore: store as never,
    })
    cm.start(); ws.fireOpen()
    // drain the restore→resend microtask chain (load.then/catch/finally + resend.then)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    // the restored entry was resent after the async load
    expect(ws.frames.filter(f => f.t === 'send_message').length).toBe(1)
    expect(cm.outboxSize()).toBe(1)
    // a fresh send persists the whole outbox (restored + new)
    cm.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })
    expect(saved[saved.length - 1]).toHaveLength(2)
    // acks shrink the persisted outbox
    ws.recv('message_ack', { client_msg_id: 'old1' })
    ws.recv('message_ack', { client_msg_id: 'c1' })
    expect(saved[saved.length - 1]).toHaveLength(0)
    expect(cm.outboxSize()).toBe(0)
  })

  // Задача 1 (порт ConnectionStatusComponent из tweb): scheduleReconnect считал
  // delay и терял его — retryAt должен уйти вторым аргументом onState вместе с
  // состоянием 'reconnecting', чтобы витрина умела рисовать обратный отсчёт
  // (tweb connectionStatus.ts:114, отсчёт :150-158).
  it('publishes retryAt = now() + delay when scheduling a reconnect after a real connection drop', () => {
    const ws = fakeWs()
    const onState = vi.fn()
    const now = vi.fn(() => 1_000_000)
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState, onFrame: () => {}, now })
    cm.start(); ws.fireOpen() // reach 'ready' first — a close only reconnects when state !== 'offline'
    onState.mockClear()

    ws.fireClose()

    const reconnectingCalls = onState.mock.calls.filter(([s]) => s === 'reconnecting')
    expect(reconnectingCalls).toHaveLength(1)
    const [, retryAt] = reconnectingCalls[0]
    // Детерминировано через инъекцию now() — не `toBeGreaterThan(before)` — CMDeps.now
    // существовал, но был мёртв (ничего его не звало); теперь и scheduleReconnect,
    // и cm.retryAt() читают именно его. Диапазон — base=500 (attempt 0) со
    // случайным jitter в [base/2, base]: retryAt = now() + delay ∈ [now()+250, now()+500].
    expect(retryAt as number).toBeGreaterThanOrEqual(1_000_000 + 250)
    expect(retryAt as number).toBeLessThanOrEqual(1_000_000 + 500)
  })

  // Транзиции без пересчитанного backoff (ready/connecting) не несут retryAt — та
  // же арность вызова, что была до Задачи 1 (см. коммент у setState).
  it('does not attach retryAt to a plain "ready" transition', () => {
    const ws = fakeWs()
    const onState = vi.fn()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState, onFrame: () => {} })
    cm.start(); ws.fireOpen()
    expect(onState).toHaveBeenCalledWith('ready')
  })

  // Ревью Задачи 1: «сигнал только push — новая вкладка слепа» — connectionManager
  // теперь держит снимок последнего опубликованного retryAt (lastRetryAt), которым
  // питается realtime.getStatus() для позднего подписчика.
  describe('retryAt() snapshot', () => {
    it('is undefined before any reconnect is scheduled', () => {
      const ws = fakeWs()
      const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
      cm.start(); ws.fireOpen()
      expect(cm.retryAt()).toBeUndefined()
    })

    it('mirrors the retryAt published on scheduleReconnect', () => {
      const ws = fakeWs()
      const now = vi.fn(() => 2_000_000)
      const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {}, now })
      cm.start(); ws.fireOpen()
      ws.fireClose() // schedules a reconnect → 'reconnecting' with retryAt
      expect(cm.retryAt()).toBeGreaterThanOrEqual(2_000_000)
    })

    it('resets to undefined on the next transition that carries no retryAt (attempt reaches connect())', () => {
      const ws = fakeWs()
      const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
      cm.start(); ws.fireOpen()
      ws.fireClose()
      expect(cm.retryAt()).toBeDefined()
      vi.advanceTimersByTime(1000) // backoff elapses → connect() fires setState('reconnecting') WITHOUT retryAt
      expect(cm.retryAt()).toBeUndefined()
    })
  })
})

// Бэклог этапа 2.1, п.4: markRead раньше слался без дедупа — источником был
// только троттленный скролл, терпимо. С пересчётом после КАЖДОЙ тихой записи
// scrollTop (Task 4) один и тот же upToSeq мог уйти десятками кадров подряд на
// медиа-тяжёлом открытии чата.
describe('ConnectionManager.markRead — дедуп по upToSeq', () => {
  it('два подряд markRead с одинаковым upToSeq — один кадр', () => {
    const ws = fakeWs()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    cm.start(); ws.fireOpen()

    cm.markRead(1, 5)
    cm.markRead(1, 5)

    expect(ws.frames.filter(f => f.t === 'read')).toHaveLength(1)
    expect(ws.frames.find(f => f.t === 'read')?.d).toEqual({ chat_id: 1, up_to_seq: 5 })
  })

  it('markRead с бо́льшим upToSeq для того же чата — второй кадр', () => {
    const ws = fakeWs()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    cm.start(); ws.fireOpen()

    cm.markRead(1, 5)
    cm.markRead(1, 7)

    const reads = ws.frames.filter(f => f.t === 'read')
    expect(reads).toHaveLength(2)
    expect(reads.map(f => f.d)).toEqual([{ chat_id: 1, up_to_seq: 5 }, { chat_id: 1, up_to_seq: 7 }])
  })

  it('меньший или равный upToSeq после большего — не шлётся (дедуп не только на точное совпадение)', () => {
    const ws = fakeWs()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    cm.start(); ws.fireOpen()

    cm.markRead(1, 7)
    cm.markRead(1, 5) // меньше уже отправленного — не шлётся
    cm.markRead(1, 7) // равно уже отправленному — не шлётся

    expect(ws.frames.filter(f => f.t === 'read')).toHaveLength(1)
  })

  it('дедуп по чату независим — тот же upToSeq в другом чате шлётся', () => {
    const ws = fakeWs()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    cm.start(); ws.fireOpen()

    cm.markRead(1, 5)
    cm.markRead(2, 5)

    const reads = ws.frames.filter(f => f.t === 'read')
    expect(reads).toHaveLength(2)
    expect(reads.map(f => f.d)).toEqual([{ chat_id: 1, up_to_seq: 5 }, { chat_id: 2, up_to_seq: 5 }])
  })

  it('реконнект сбрасывает дедуп — тот же upToSeq после разрыва шлётся заново (кадр read не подтверждается outbox-ом)', () => {
    const ws = fakeWs()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState: () => {}, onFrame: () => {} })
    cm.start(); ws.fireOpen()

    cm.markRead(1, 5)
    ws.fireClose()
    vi.advanceTimersByTime(1000) // backoff elapses → reconnect
    ws.fireOpen()
    cm.markRead(1, 5) // тот же рубеж — но предыдущая отправка могла не дойти

    expect(ws.frames.filter(f => f.t === 'read')).toHaveLength(2)
  })
})
