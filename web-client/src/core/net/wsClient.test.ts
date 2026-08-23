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
  constructor(public url: string, public protocols?: string | string[]) { FakeWS.instances.push(this) }
  send(s: string) { this.sent.push(s) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  message(s: string) { this.onmessage?.({ data: s }) }
}

beforeEach(() => { FakeWS.instances = []; vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket) })

describe('WsClient', () => {
  it('fires onOpen, delivers every frame with its type, exposes isOpen', () => {
    const c = new WsClient('/ws')
    const opened = vi.fn(); const got = vi.fn()
    c.onOpen(opened); c.onFrame(got)
    c.connect('tok')
    const ws = FakeWS.instances[0]
    expect(ws.url).toBe('/ws')
    expect(ws.protocols).toEqual(['bearer', 'tok'])
    ws.open()
    expect(opened).toHaveBeenCalled()
    expect(c.isOpen()).toBe(true)
    ws.message(JSON.stringify({ t: 'new_message', d: { msg_id: 5 } }))
    expect(got).toHaveBeenCalledWith('new_message', { msg_id: 5 }, undefined)
    // Курсор ИЗ КОНВЕРТА доезжает до подписчика: у кадров, чей конструктор
    // схемы своего `pts` не объявляет, он едет только здесь.
    ws.message(JSON.stringify({ t: 'new_message', d: { msg_id: 6 }, pts: 42 }))
    expect(got).toHaveBeenCalledWith('new_message', { msg_id: 6 }, 42)
  })

  // Кадр НЕЗНАКОМОГО типа тоже доезжает — раньше он исчезал молча, потому что
  // слушателя именно этого имени никто не завёл.
  it('доставляет кадр, тип которого никому не известен', () => {
    const c = new WsClient('/ws')
    const got = vi.fn(); c.onFrame(got)
    c.connect('tok')
    const ws = FakeWS.instances[0]; ws.open()
    ws.message(JSON.stringify({ t: 'какой_то_новый_кадр', d: { x: 1 } }))
    expect(got).toHaveBeenCalledWith('какой_то_новый_кадр', { x: 1 }, undefined)
  })

  it('fires onClose and reports not open', () => {
    const c = new WsClient('/ws'); const closed = vi.fn(); c.onClose(closed)
    c.connect('tok'); const ws = FakeWS.instances[0]; ws.open(); ws.close()
    expect(closed).toHaveBeenCalled(); expect(c.isOpen()).toBe(false)
  })
})
