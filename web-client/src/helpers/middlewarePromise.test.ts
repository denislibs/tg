import { describe, expect, it } from 'vitest'
import middlewarePromise from './middlewarePromise'
import { getMiddleware } from './middleware'

describe('middlewarePromise: семантика tweb', () => {
  it('пропускает результат, пока middleware жив', async () => {
    const helper = getMiddleware()
    const m = middlewarePromise(helper.get())
    await expect(m(Promise.resolve(42))).resolves.toBe(42)
  })

  it('бросает {type: MIDDLEWARE}, если протух к моменту резолва', async () => {
    const helper = getMiddleware()
    const m = middlewarePromise(helper.get())
    const p = m(new Promise<number>((r) => setTimeout(() => r(42), 0)))
    helper.clean()
    let thrown: unknown
    try {
      await p
    } catch (e) {
      thrown = e
    }
    expect((thrown as { type?: string } | undefined)?.type).toBe('MIDDLEWARE')
  })

  it('не-промис проходит насквозь; Error бросается сразу', () => {
    const m = middlewarePromise(() => true)
    expect(m(42 as unknown as Promise<number>)).toBe(42)
    const err = new Error('boom')
    expect(() => m(err as unknown as Promise<never>)).toThrow('boom')
  })

  it('кастомный throwWhat подменяет ошибку', async () => {
    const helper = getMiddleware()
    const custom = { type: 'PEER_CHANGED' }
    const m = middlewarePromise(helper.get(), custom)
    const p = m(new Promise<number>((r) => setTimeout(() => r(1), 0)))
    helper.clean()
    await expect(p).rejects.toBe(custom)
  })
})
