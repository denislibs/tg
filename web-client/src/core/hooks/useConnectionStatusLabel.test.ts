// src/core/hooks/useConnectionStatusLabel.test.ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStatusLabel } from './useConnectionStatusLabel'

describe('useConnectionStatusLabel', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('первые 2с — false, даже если не loaded', () => {
    const { result } = renderHook(() => useConnectionStatusLabel(false))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1999))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('loaded до истечения 2с — не показывается вовсе', () => {
    const { result, rerender } = renderHook(({ l }) => useConnectionStatusLabel(l), { initialProps: { l: false } })
    act(() => vi.advanceTimersByTime(1000))
    rerender({ l: true })
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current).toBe(false)
  })
})
