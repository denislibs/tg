// src/core/net/wsClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WsClient } from './wsClient'

class FakeWS {
  static instances: FakeWS[] = []
  onmessage: ((ev: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  readyState = 0
  constructor(public url: string) { FakeWS.instances.push(this) }
  send(s: string) { this.sent.push(s) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  message(s: string) { this.onmessage?.({ data: s }) }
}

beforeEach(() => { FakeWS.instances = []; vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket) })

describe('WsClient', () => {
  it('fires onOpen, routes frames by type, exposes isOpen', () => {
    const c = new WsClient('/ws')
    const opened = vi.fn(); const got = vi.fn()
    c.onOpen(opened); c.on('new_message', got)
    c.connect('tok')
    const ws = FakeWS.instances[0]
    expect(ws.url).toContain('/ws?token=tok')
    ws.open()
    expect(opened).toHaveBeenCalled()
    expect(c.isOpen()).toBe(true)
    ws.message(JSON.stringify({ t: 'new_message', d: { msg_id: 5 } }))
    expect(got).toHaveBeenCalledWith({ msg_id: 5 })
  })

  it('fires onClose and reports not open', () => {
    const c = new WsClient('/ws'); const closed = vi.fn(); c.onClose(closed)
    c.connect('tok'); const ws = FakeWS.instances[0]; ws.open(); ws.close()
    expect(closed).toHaveBeenCalled(); expect(c.isOpen()).toBe(false)
  })
})
