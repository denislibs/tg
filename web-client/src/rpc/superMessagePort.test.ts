import { describe, it, expect } from 'vitest'
import { SuperMessagePort } from './superMessagePort'

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
