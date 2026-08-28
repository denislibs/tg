import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChannelRpc } from './channelRpc'
import { HttpError } from '../restClient'
import type { Transport } from '../transport'

class FakeTransport implements Transport {
  sent: Array<{ t: string; d: unknown }> = []
  private frameCbs: Array<(t: string, d: unknown) => void> = []
  private closeCbs: Array<() => void> = []
  private open = true
  connect(): void {}
  close(): void {}
  isOpen(): boolean { return this.open }
  onOpen(): void {}
  onClose(cb: () => void): void { this.closeCbs.push(cb) }
  onError(): void {}
  onFrame(cb: (t: string, d: unknown) => void): void { this.frameCbs.push(cb) }
  onBinary(): void {}
  send(t: string, d?: unknown): void { this.sent.push({ t, d }) }
  sendBinary(): void {}
  // test helpers
  emit(t: string, d: unknown): void { for (const cb of this.frameCbs) cb(t, d) }
  fireClose(): void { this.open = false; for (const cb of this.closeCbs) cb() }
}

describe('ChannelRpc', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends rpc_req and resolves on the matching rpc_resp', async () => {
    const ft = new FakeTransport(); const rpc = new ChannelRpc(ft)
    const p = rpc.call('GET', '/dialogs', null)
    expect(ft.sent).toHaveLength(1)
    const sent = ft.sent[0].d as { req_id: string; method: string; path: string; body: unknown }
    expect(sent.method).toBe('GET'); expect(sent.path).toBe('/dialogs')
    ft.emit('rpc_resp', { req_id: sent.req_id, status: 200, body: { ok: true } })
    await expect(p).resolves.toEqual({ status: 200, body: { ok: true } })
  })

  it('ignores a rpc_resp with an unknown req_id (stays pending until timeout)', async () => {
    const ft = new FakeTransport(); const rpc = new ChannelRpc(ft)
    const p = rpc.call('GET', '/x', null)
    ft.emit('rpc_resp', { req_id: 'other', status: 200, body: null })
    vi.advanceTimersByTime(30_000)
    await expect(p).rejects.toBeInstanceOf(HttpError)
  })

  it('rejects pending calls when the channel closes', async () => {
    const ft = new FakeTransport(); const rpc = new ChannelRpc(ft)
    const p = rpc.call('POST', '/y', { a: 1 })
    ft.fireClose()
    await expect(p).rejects.toBeInstanceOf(HttpError)
  })

  it('isReady reflects transport.isOpen', () => {
    const ft = new FakeTransport(); const rpc = new ChannelRpc(ft)
    expect(rpc.isReady()).toBe(true)
    ft.fireClose()
    expect(rpc.isReady()).toBe(false)
  })
})
