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
  // (tweb connectionStatus.ts:110-111).
  it('publishes retryAt in the future when scheduling a reconnect after a real connection drop', () => {
    const ws = fakeWs()
    const onState = vi.fn()
    const cm = newConnectionManager({ ws: ws.client as never, getToken: () => 'tok', onReady: () => {}, onState, onFrame: () => {} })
    cm.start(); ws.fireOpen() // reach 'ready' first — a close only reconnects when state !== 'offline'
    onState.mockClear()
    const before = Date.now()

    ws.fireClose()

    const reconnectingCalls = onState.mock.calls.filter(([s]) => s === 'reconnecting')
    expect(reconnectingCalls).toHaveLength(1)
    const [, retryAt] = reconnectingCalls[0]
    expect(typeof retryAt).toBe('number')
    expect(retryAt as number).toBeGreaterThan(before)
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
})
