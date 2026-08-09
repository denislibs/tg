// src/core/hooks/useLeftColumnShown.test.ts
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLeftColumnShown } from './useLeftColumnShown'

describe('useLeftColumnShown', () => {
  beforeEach(() => document.body.classList.remove('is-left-column-shown'))
  afterEach(() => document.body.classList.remove('is-left-column-shown'))

  it('чат не открыт — класс на body (список активен)', () => {
    renderHook(() => useLeftColumnShown(false))
    expect(document.body.classList.contains('is-left-column-shown')).toBe(true)
  })

  it('чат открыт при монтировании — класса нет', () => {
    renderHook(() => useLeftColumnShown(true))
    expect(document.body.classList.contains('is-left-column-shown')).toBe(false)
  })

  it('открытие чата после монтирования снимает класс, закрытие — возвращает', () => {
    const { rerender } = renderHook(({ open }) => useLeftColumnShown(open), {
      initialProps: { open: false },
    })
    expect(document.body.classList.contains('is-left-column-shown')).toBe(true)

    rerender({ open: true })
    expect(document.body.classList.contains('is-left-column-shown')).toBe(false)

    rerender({ open: false })
    expect(document.body.classList.contains('is-left-column-shown')).toBe(true)
  })

  it('размонтирование Shell снимает класс', () => {
    const { unmount } = renderHook(() => useLeftColumnShown(false))
    expect(document.body.classList.contains('is-left-column-shown')).toBe(true)
    unmount()
    expect(document.body.classList.contains('is-left-column-shown')).toBe(false)
  })
})
