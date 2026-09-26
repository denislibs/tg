// Порт ожидания difference из tweb 1dc32d889 (`apiUpdatesManager.waitForSync`,
// `getSyncPatience`, `isInitialSync`): уведомление придерживается, пока идёт
// difference, который ещё может его отменить, — но не дольше, чем difference
// молчит.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { newSyncWait, SYNC_MAX_SILENCE, type SyncState } from './syncWait'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('syncWait.waitForSync', () => {
  let global: SyncState
  const channels = new Map<number, SyncState>()
  const wait = () => newSyncWait({ global: () => global, channel: (peerId) => channels.get(peerId) })

  beforeEach(() => {
    vi.useFakeTimers()
    global = { loading: null, progressTime: 0 }
    channels.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function settled(p: Promise<void>) {
    let done = false
    void p.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    return done
  }

  it('ничего не синхронизируется — отпускает сразу', async () => {
    expect(await settled(wait().waitForSync(5))).toBe(true)
  })

  it('ждёт идущий общий difference и отпускает на его завершении', async () => {
    const d = deferred()
    global = { loading: d.promise, progressTime: Date.now() }
    const p = wait().waitForSync(5)

    expect(await settled(p)).toBe(false)

    global = { loading: null, progressTime: Date.now() }
    d.resolve()
    expect(await settled(p)).toBe(true)
  })

  it('ждёт и тот difference, что пошёл следом за первым', async () => {
    // tweb: «waits out the running difference AND any that follows it».
    const first = deferred()
    const second = deferred()
    global = { loading: first.promise, progressTime: Date.now() }
    const p = wait().waitForSync(5)

    global = { loading: second.promise, progressTime: Date.now() }
    first.resolve()
    expect(await settled(p)).toBe(false)

    global = { loading: null, progressTime: Date.now() }
    second.resolve()
    expect(await settled(p)).toBe(true)
  })

  it('канальный difference держит только свой канал', async () => {
    const d = deferred()
    channels.set(-100, { loading: d.promise, progressTime: Date.now() })
    const w = wait()

    expect(await settled(w.waitForSync(5))).toBe(true)

    const own = w.waitForSync(-100)
    expect(await settled(own)).toBe(false)
    channels.set(-100, { loading: null, progressTime: Date.now() })
    d.resolve()
    expect(await settled(own)).toBe(true)
  })

  it('замолчавший difference перестаёт держать через SYNC_MAX_SILENCE', async () => {
    global = { loading: new Promise(() => {}), progressTime: Date.now() }
    const p = wait().waitForSync(5)

    await vi.advanceTimersByTimeAsync(SYNC_MAX_SILENCE - 1)
    expect(await settled(p)).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(await settled(p)).toBe(true)
  })

  it('каждая пришедшая страница продлевает ожидание', async () => {
    // Бюджет тратится ТИШИНОЙ, а не общим временем (tweb SYNC_MAX_SILENCE).
    global = { loading: new Promise(() => {}), progressTime: Date.now() }
    const p = wait().waitForSync(5)

    await vi.advanceTimersByTimeAsync(SYNC_MAX_SILENCE - 1000)
    global.progressTime = Date.now()
    await vi.advanceTimersByTimeAsync(SYNC_MAX_SILENCE - 1000)
    expect(await settled(p)).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(await settled(p)).toBe(true)
  })
})

describe('syncWait.isInitialSync', () => {
  const wait = () => newSyncWait({ global: () => ({ loading: null, progressTime: 0 }), channel: () => undefined })

  it('первый difference после старта — начальный, пока не закончится', async () => {
    const w = wait()
    const d = deferred()
    expect(w.isInitialSync()).toBe(true)

    w.attach(d.promise)
    await Promise.resolve()
    expect(w.isInitialSync()).toBe(true)

    d.resolve()
    await d.promise
    await Promise.resolve()
    expect(w.isInitialSync()).toBe(false)
  })

  it('догонять нечего — начальная синхронизация кончается сразу', async () => {
    const w = wait()
    w.attach(undefined)
    await Promise.resolve()
    await Promise.resolve()
    expect(w.isInitialSync()).toBe(false)
  })

  it('упавший difference тоже заканчивает начальную синхронизацию', async () => {
    const w = wait()
    const failing = Promise.reject(new Error('сеть'))
    w.attach(failing)
    await failing.catch(() => {})
    await Promise.resolve()
    expect(w.isInitialSync()).toBe(false)
  })

  it('следующий attach (реконнект) начальным не считается', async () => {
    const w = wait()
    w.attach(undefined)
    await Promise.resolve()
    await Promise.resolve()

    w.attach(new Promise(() => {}))
    expect(w.isInitialSync()).toBe(false)
  })
})
