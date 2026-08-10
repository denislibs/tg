// src/core/realtime/globalFunnel.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newGlobalFunnel } from './globalFunnel'
import { newCursor } from './cursor'

// Тот же приём, что и в cursor.test.ts: in-memory KV вместо настоящей IDB.
function memStore() {
  const m = new Map<string, unknown>()
  return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v) }
}

// Харнес: dispatch — шпион, собирающий {t, pts, catchUp}; курсор — настоящий newCursor
// с in-memory KV (persistDelay=0, чтобы не ждать дебаунс в тестах); isSyncing — управляемый
// флаг через syncing.value; catchUp — шпион.
function harness(opts: { syncDelay?: number } = {}) {
  const dispatched: Array<{ t: string; d: unknown; pts?: number; catchUp?: boolean }> = []
  const cursor = newCursor(memStore(), 0)
  const syncing = { value: false }
  const catchUp = vi.fn()
  const funnel = newGlobalFunnel({
    dispatch: (t, d, meta) => { dispatched.push({ t, d, pts: meta?.pts, catchUp: meta?.catchUp }) },
    cursor,
    isCursorReady: () => true,
    isSyncing: () => syncing.value,
    catchUp,
    syncDelay: opts.syncDelay,
  })
  return { funnel, dispatched, cursor, syncing, catchUp }
}

describe('globalFunnel.applyUpdate — live-next', () => {
  it('live-кадр pts===cursor+1 применяется с catchUp:false и двигает курсор', async () => {
    const h = harness()
    await h.cursor.ready()
    h.funnel.applyUpdate('read', h.cursor.get().pts + 1, { x: 1 }, true)
    expect(h.dispatched).toEqual([{ t: 'read', d: { x: 1 }, pts: 1, catchUp: false }])
    expect(h.cursor.get().pts).toBe(1)
  })
})

describe('globalFunnel.applyUpdate — /sync', () => {
  it('sync-кадр pts===cursor+1 применяется с catchUp:true', async () => {
    const h = harness()
    await h.cursor.ready()
    h.funnel.applyUpdate('read', h.cursor.get().pts + 1, { x: 1 }, false)
    expect(h.dispatched).toEqual([{ t: 'read', d: { x: 1 }, pts: 1, catchUp: true }])
    expect(h.cursor.get().pts).toBe(1)
  })
})

describe('globalFunnel.applyUpdate — дубль', () => {
  it('pts <= cursor отбрасывается в обеих ветках (live и sync)', async () => {
    const h = harness()
    await h.cursor.ready()
    h.funnel.applyUpdate('read', 1, {}, true)   // next → cursor=1
    h.dispatched.length = 0
    h.funnel.applyUpdate('read', 1, {}, true)   // dup (live)
    h.funnel.applyUpdate('read', 1, {}, false)  // dup (sync)
    h.funnel.applyUpdate('read', 0, {}, false)  // dup (позади)
    expect(h.dispatched).toHaveLength(0)
    expect(h.cursor.get().pts).toBe(1)
  })
})

describe('globalFunnel.applyUpdate — дыра live', () => {
  it('придерживает out-of-order кадр, а недостающий закрывает дыру и дренажит по порядку', async () => {
    const h = harness()
    await h.cursor.ready()
    h.funnel.applyUpdate('read', 2, { future: true }, true)  // gap → буфер, dispatch не вызван
    expect(h.dispatched).toHaveLength(0)
    expect(h.cursor.get().pts).toBe(0)

    h.funnel.applyUpdate('read', 1, { a: 1 }, true)  // next закрывает дыру → 1, затем дренаж 2
    expect(h.dispatched).toEqual([
      { t: 'read', d: { a: 1 }, pts: 1, catchUp: false },
      { t: 'read', d: { future: true }, pts: 2, catchUp: false },
    ])
    expect(h.cursor.get().pts).toBe(2)
  })
})

describe('globalFunnel.applyUpdate — без pts', () => {
  it('кадр без pts транслируется без meta, курсор не трогается, гейты не применяются', async () => {
    const h = harness()
    await h.cursor.ready()
    h.funnel.applyUpdate('typing', undefined, { chat: 1 }, true)
    expect(h.dispatched).toEqual([{ t: 'typing', d: { chat: 1 }, pts: undefined, catchUp: undefined }])
    expect(h.cursor.get().pts).toBe(0)
  })
})

describe('globalFunnel.applyUpdate — гейт syncLoading', () => {
  it('при isSyncing()===true живой кадр с pts отбрасывается, dispatch не вызван', async () => {
    const h = harness()
    await h.cursor.ready()
    h.syncing.value = true
    h.funnel.applyUpdate('read', 1, {}, true)
    expect(h.dispatched).toHaveLength(0)
    expect(h.cursor.get().pts).toBe(0)
  })
})

describe('globalFunnel.applyUpdate — гейт гидратации', () => {
  it('при isCursorReady()===false живой кадр не применяется, вызывается catchUp', () => {
    const dispatched: unknown[] = []
    const cursor = newCursor(memStore(), 0)
    const catchUp = vi.fn()
    const funnel = newGlobalFunnel({
      dispatch: (t, d) => { dispatched.push({ t, d }) },
      cursor,
      isCursorReady: () => false,
      isSyncing: () => false,
      catchUp,
    })
    funnel.applyUpdate('read', 1, {}, true)
    expect(dispatched).toHaveLength(0)
    expect(catchUp).toHaveBeenCalledTimes(1)
  })
})

describe('globalFunnel.applyUpdate — таймаут дыры', () => {
  it('незакрытая дыра по таймауту уходит в catchUp и очищает буфер', async () => {
    vi.useFakeTimers()
    try {
      const h = harness({ syncDelay: 0 })
      await h.cursor.ready()
      h.funnel.applyUpdate('read', 3, {}, true)  // gap → буфер, планируем таймер
      expect(h.catchUp).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(10)
      expect(h.catchUp).toHaveBeenCalledTimes(1)

      // Буфер очищен: последующий next больше не тянет за собой призрачный дренаж pts=3.
      h.funnel.applyUpdate('read', 1, { a: 1 }, true)
      expect(h.dispatched).toEqual([{ t: 'read', d: { a: 1 }, pts: 1, catchUp: false }])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('globalFunnel.clear()', () => {
  it('придержанный кадр после clear() не всплывает при следующем по порядку', async () => {
    const h = harness()
    await h.cursor.ready()
    h.funnel.applyUpdate('read', 3, { future: true }, true)  // gap → буфер
    h.funnel.clear()
    h.funnel.applyUpdate('read', 1, { a: 1 }, true)  // next → применяется, но дренажа быть не должно
    expect(h.dispatched).toEqual([{ t: 'read', d: { a: 1 }, pts: 1, catchUp: false }])
    expect(h.cursor.get().pts).toBe(1)
  })
})
