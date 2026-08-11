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
