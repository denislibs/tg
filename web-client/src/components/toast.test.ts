import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toastNew } from './toast'

describe('toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('снимает узел по истечении показа', () => {
    toastNew({ langPackKey: 'Error.AnError' })
    expect(document.querySelector('.toast')).not.toBeNull()
    vi.advanceTimersByTime(5000)
    expect(document.querySelector('.toast')).toBeNull()
  })
})
