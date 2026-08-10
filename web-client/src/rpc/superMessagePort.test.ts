import { describe, it, expect, vi, afterEach } from 'vitest'
import { SuperMessagePort, type Endpoint, type EventMeta } from './superMessagePort'

// Пара связанных эндпоинтов поверх колбэков с синхронной доставкой — в happy-dom
// MessageChannel не гарантирован (см. брифы задачи 3), а для этих тестов важна
// детерминированная доставка без ожидания макротаска. postMessage на одном конце
// сразу вызывает listener, зарегистрированный на другом.
function pair(): [Endpoint, Endpoint] {
  let listenerA: (ev: MessageEvent) => void = () => {}
  let listenerB: (ev: MessageEvent) => void = () => {}
  const epA: Endpoint = {
    postMessage: (m) => listenerB({ data: m } as MessageEvent),
    addEventListener: (_t, l) => { listenerA = l },
  }
  const epB: Endpoint = {
    postMessage: (m) => listenerA({ data: m } as MessageEvent),
    addEventListener: (_t, l) => { listenerB = l },
  }
  return [epA, epB]
}

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

describe('SuperMessagePort — meta во втором аргументе кадра события', () => {
  it('meta доезжает вторым аргументом подписчику', () => {
    const [epA, epB] = pair()
    const a = new SuperMessagePort(epA)
    const b = new SuperMessagePort(epB)
    const got: Array<[number, EventMeta | undefined]> = []
    b.on<number>('tick', (n, meta) => got.push([n, meta]))
    a.emit('tick', 7, { pts: 42, catchUp: true })
    expect(got).toEqual([[7, { pts: 42, catchUp: true }]])
  })

  it('без meta подписчик получает undefined вторым аргументом', () => {
    const [epA, epB] = pair()
    const a = new SuperMessagePort(epA)
    const b = new SuperMessagePort(epB)
    let receivedMeta: EventMeta | undefined
    let called = false
    b.on<number>('tick', (_n, meta) => { called = true; receivedMeta = meta })
    a.emit('tick', 1)
    expect(called).toBe(true)
    expect(receivedMeta).toBeUndefined()
  })

  it('подписчик-одноаргументник (не читает meta) продолжает работать — обратная совместимость', () => {
    const [epA, epB] = pair()
    const a = new SuperMessagePort(epA)
    const b = new SuperMessagePort(epB)
    const got: number[] = []
    b.on<number>('tick', (n) => got.push(n)) // второй аргумент игнорируется, как раньше
    a.emit('tick', 9, { pts: 1 })
    expect(got).toEqual([9])
  })
})

describe('SuperMessagePort — ретрансляция воркером (invokeExceptSource)', () => {
  it('событие, пришедшее в воркер от вкладки A, доезжает до вкладки B и НЕ возвращается в A', () => {
    // Имитация проводки core/worker.ts:bind() — на воркере по одному SMP на
    // каждую подключённую вкладку; onAny + рассылка всем портам, кроме источника.
    const [epWA, epAW] = pair()
    const [epWB, epBW] = pair()
    const a = new SuperMessagePort(epAW)
    const b = new SuperMessagePort(epBW)
    const portOnWorkerForA = new SuperMessagePort(epWA)
    const portOnWorkerForB = new SuperMessagePort(epWB)
    const ports = [portOnWorkerForA, portOnWorkerForB]
    for (const p of ports) {
      p.onAny((event, payload, meta) => {
        for (const other of ports) if (other !== p) other.emit(event, payload, meta)
      })
    }

    const receivedByA: unknown[] = []
    const receivedByB: unknown[] = []
    a.on('rt:test', (p) => receivedByA.push(p))
    b.on('rt:test', (p) => receivedByB.push(p))

    a.emit('rt:test', { hello: 1 }, { pts: 5 })

    // B получил событие источника A...
    expect(receivedByB).toEqual([{ hello: 1 }])
    // ...а сам источник A не получил обратно то же событие (иначе — кольцо;
    // без исключения источника этот ассерт первым бы поймал регресс).
    expect(receivedByA).toEqual([])
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
