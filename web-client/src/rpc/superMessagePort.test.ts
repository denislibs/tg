import { describe, it, expect, vi, afterEach } from 'vitest'
import { SuperMessagePort, type Endpoint } from './superMessagePort'

describe('SuperMessagePort', () => {
  it('invokes a handler on the other end and resolves with its result', async () => {
    const ch = new MessageChannel()
    const a = new SuperMessagePort(ch.port1)
    const b = new SuperMessagePort(ch.port2)
    b.handle('sum', async (payload) => {
      const p = payload as { x: number; y: number }
      return p.x + p.y
    })

    await expect(a.invoke<number>('sum', { x: 2, y: 3 })).resolves.toBe(5)
  })

  it('rejects when the handler throws', async () => {
    const ch = new MessageChannel()
    const a = new SuperMessagePort(ch.port1)
    const b = new SuperMessagePort(ch.port2)
    b.handle('boom', async () => { throw new Error('nope') })

    await expect(a.invoke('boom', {})).rejects.toThrow('nope')
  })

  it('delivers events to on() listeners', async () => {
    const ch = new MessageChannel()
    const a = new SuperMessagePort(ch.port1)
    const b = new SuperMessagePort(ch.port2)
    const got: number[] = []
    a.on<number>('tick', (n) => got.push(n))
    b.emit('tick', 7)
    await new Promise((r) => setTimeout(r, 10))
    expect(got).toEqual([7])
  })
})

// Мок эндпоинта с синхронной доставкой — детерминирует таймаут/dispose без гонок
// реального MessageChannel (доставка сообщений — макротаск, не под fake-таймерами).
function makeEndpoint() {
  let listener: (ev: MessageEvent) => void = () => {}
  const posted: Array<{ kind: string; id?: number; type?: string }> = []
  const ep: Endpoint = {
    postMessage: (m) => { posted.push(m as { kind: string; id?: number; type?: string }) },
    addEventListener: (_t, l) => { listener = l },
    start: () => {},
  }
  return { ep, posted, deliver: (data: unknown) => listener({ data } as MessageEvent) }
}
const lastInvokeId = (posted: Array<{ kind: string; id?: number }>) =>
  [...posted].reverse().find((t) => t.kind === 'invoke')!.id!

describe('SuperMessagePort invoke timeout', () => {
  afterEach(() => { vi.useRealTimers() })

  it('rejects on timeout and cleans awaiting (late result ignored)', async () => {
    vi.useFakeTimers()
    const { ep, posted, deliver } = makeEndpoint()
    const smp = new SuperMessagePort(ep)
    const p = smp.invoke('slow', {}, undefined, 1000)
    const id = lastInvokeId(posted)
    vi.advanceTimersByTime(1000)
    await expect(p).rejects.toThrow(/invoke timeout: slow/)
    expect(() => deliver({ kind: 'result', id, result: 'late' })).not.toThrow()
  })

  it('clears the timeout when the result arrives in time (no late reject)', async () => {
    vi.useFakeTimers()
    const { ep, posted, deliver } = makeEndpoint()
    const smp = new SuperMessagePort(ep)
    const p = smp.invoke<string>('quick', {}, undefined, 1000)
    deliver({ kind: 'result', id: lastInvokeId(posted), result: 'ok' })
    await expect(p).resolves.toBe('ok')
    vi.advanceTimersByTime(5000) // таймер снят — позднего реджекта нет
  })
})

describe('SuperMessagePort dispose', () => {
  it('rejects all pending invokes (disconnect-reject)', async () => {
    const { ep } = makeEndpoint()
    const smp = new SuperMessagePort(ep)
    const p1 = smp.invoke('a', {})
    const p2 = smp.invoke('b', {})
    smp.dispose()
    await expect(p1).rejects.toThrow(/port disconnected/)
    await expect(p2).rejects.toThrow(/port disconnected/)
  })

  it('clears pending timeout timers so they do not fire after dispose', async () => {
    vi.useFakeTimers()
    const { ep } = makeEndpoint()
    const smp = new SuperMessagePort(ep)
    const p = smp.invoke('a', {}, undefined, 1000)
    smp.dispose('bye')
    await expect(p).rejects.toThrow('bye')
    vi.advanceTimersByTime(2000)
    vi.useRealTimers()
  })
})
