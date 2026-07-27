import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLockStore, runWhenUnlocked } from './lockStore'

describe('runWhenUnlocked (passcode gating)', () => {
  beforeEach(() => useLockStore.setState({ locked: false, attempts: 0, retryAt: 0 }))

  it('runs immediately when not locked', () => {
    const fn = vi.fn()
    runWhenUnlocked(fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('defers under lock, runs once on unlock', () => {
    useLockStore.getState().lock()
    const fn = vi.fn()
    runWhenUnlocked(fn)
    expect(fn).not.toHaveBeenCalled()

    useLockStore.getState().unlock()
    expect(fn).toHaveBeenCalledTimes(1)

    // повторные lock/unlock не дергают fn снова (подписка снята)
    useLockStore.getState().lock()
    useLockStore.getState().unlock()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cleanup unsubscribes before unlock (fn never runs)', () => {
    useLockStore.getState().lock()
    const fn = vi.fn()
    const unsub = runWhenUnlocked(fn)
    unsub()
    useLockStore.getState().unlock()
    expect(fn).not.toHaveBeenCalled()
  })
})
