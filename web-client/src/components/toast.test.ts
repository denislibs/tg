import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toastNew } from './toast'

describe('toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('снимает узел по истечении показа', () => {
    toastNew({ langPackKey: 'Sessions.Error' })
    expect(document.querySelector('.toast')).not.toBeNull()
    vi.advanceTimersByTime(5000)
    expect(document.querySelector('.toast')).toBeNull()
  })
})
