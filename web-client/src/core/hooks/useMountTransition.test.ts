// src/core/hooks/useMountTransition.test.ts
import { it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMountTransition } from './useMountTransition'

it('держит узел смонтированным на время exit-анимации', () => {
  vi.useFakeTimers()
  const { result, rerender } = renderHook(({ open }) => useMountTransition(open, 'active', 200), {
    initialProps: { open: true },
  })
  expect(result.current).toEqual({ mounted: true, cls: 'active forwards' })

  rerender({ open: false })
  expect(result.current).toEqual({ mounted: true, cls: 'active backwards animating' })

  act(() => {
    vi.advanceTimersByTime(200)
  })
  expect(result.current).toEqual({ mounted: false, cls: '' })
  vi.useRealTimers()
})
