// src/core/realtime/cursor.test.ts
import { describe, it, expect } from 'vitest'
import { classifyPts, newCursor } from './cursor'

describe('classifyPts (funnel arithmetic)', () => {
  it('pts <= cursor → dup (already applied / out-of-order replay)', () => {
    expect(classifyPts(10, 10)).toBe('dup')
    expect(classifyPts(10, 3)).toBe('dup')
  })
  it('pts === cursor+1 → next (apply + advance)', () => {
    expect(classifyPts(10, 11)).toBe('next')
    expect(classifyPts(0, 1)).toBe('next')
  })
  it('pts > cursor+1 → gap (catch-up)', () => {
    expect(classifyPts(10, 12)).toBe('gap')
    expect(classifyPts(0, 500)).toBe('gap')
  })
})

function memStore() {
  const m = new Map<string, unknown>()
  return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v), _m: m }
}

describe('newCursor', () => {
  it('hydrates pts/date from IDB before ready() resolves', async () => {
    const store = memStore()
    store._m.set('pts', 42); store._m.set('date', 7)
    const c = newCursor(store, 0)
    await c.ready()
    expect(c.get()).toEqual({ pts: 42, date: 7 })
  })

  it('advance is monotonic (ignores dup/backwards), set is unconditional', async () => {
    const c = newCursor(memStore(), 0)
    await c.ready()
    c.advance(5); expect(c.get().pts).toBe(5)
    c.advance(3); expect(c.get().pts).toBe(5) // backwards ignored
    c.advance(6); expect(c.get().pts).toBe(6)
    c.set(2, 1); expect(c.get().pts).toBe(2)  // resync can move backwards
  })

  it('persists pts/date to the store (debounced)', async () => {
    const store = memStore()
    const c = newCursor(store, 0)
    await c.ready()
    c.advance(9, 3)
    await new Promise((r) => setTimeout(r, 5))
    expect(store._m.get('pts')).toBe(9)
    expect(store._m.get('date')).toBe(3)
  })

  it('hydration merges forward-only: a set() before ready is not clobbered by stale IDB', async () => {
    const store = memStore()
    store._m.set('pts', 3) // stale on disk
    const c = newCursor(store, 0)
    c.set(10, 5) // /sync advanced us before hydration completed
    await c.ready()
    expect(c.get().pts).toBe(10) // max(10, 3) — not rolled back to 3
  })
})
