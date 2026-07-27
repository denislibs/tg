import { describe, it, expect, vi, afterEach } from 'vitest'
import { preventCrossTabDynamicImportDeadlock } from './preventDeadlock'

describe('preventCrossTabDynamicImportDeadlock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('резолвится после одного requestAnimationFrame', async () => {
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', raf)

    await preventCrossTabDynamicImportDeadlock()
    expect(raf).toHaveBeenCalledTimes(1)
  })

  it('падает в Promise.resolve, если requestAnimationFrame недоступен', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    // не должно кинуть и должно зарезолвиться
    await expect(preventCrossTabDynamicImportDeadlock()).resolves.toBeUndefined()
  })
})
