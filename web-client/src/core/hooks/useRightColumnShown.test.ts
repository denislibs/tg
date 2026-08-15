// src/core/hooks/useRightColumnShown.test.ts
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useRightColumnShown } from './useRightColumnShown'

const CLASS = 'is-right-column-shown'

describe('useRightColumnShown', () => {
  beforeEach(() => document.body.classList.remove(CLASS))
  // Счётчик модульный — незакрытый renderHook из прошлого теста утёк бы в
  // следующий (нет глобального автоклинапа testing-library в проекте).
  afterEach(() => {
    cleanup()
    document.body.classList.remove(CLASS)
  })

  it('панель закрыта при монтировании — класса нет', () => {
    renderHook(() => useRightColumnShown(false))
    expect(document.body.classList.contains(CLASS)).toBe(false)
  })

  it('панель открыта при монтировании — класс на body', () => {
    renderHook(() => useRightColumnShown(true))
    expect(document.body.classList.contains(CLASS)).toBe(true)
  })

  it('открытие после монтирования ставит класс, закрытие — снимает', () => {
    const { rerender } = renderHook(({ open }) => useRightColumnShown(open), {
      initialProps: { open: false },
    })
    expect(document.body.classList.contains(CLASS)).toBe(false)

    rerender({ open: true })
    expect(document.body.classList.contains(CLASS)).toBe(true)

    rerender({ open: false })
    expect(document.body.classList.contains(CLASS)).toBe(false)
  })

  it('размонтирование снимает класс', () => {
    const { unmount } = renderHook(() => useRightColumnShown(true))
    expect(document.body.classList.contains(CLASS)).toBe(true)
    unmount()
    expect(document.body.classList.contains(CLASS)).toBe(false)
  })

  it('счётчик: две одновременно открытые панели — класс держится, пока открыта хотя бы одна', () => {
    const a = renderHook(() => useRightColumnShown(true))
    const b = renderHook(() => useRightColumnShown(true))
    expect(document.body.classList.contains(CLASS)).toBe(true)

    a.unmount()
    expect(document.body.classList.contains(CLASS)).toBe(true) // b всё ещё открыта

    b.unmount()
    expect(document.body.classList.contains(CLASS)).toBe(false)
  })

  it('счётчик: закрытие одной панели пропом (rerender) не гасит класс другой открытой', () => {
    const a = renderHook(({ open }) => useRightColumnShown(open), { initialProps: { open: true } })
    const b = renderHook(() => useRightColumnShown(true))
    expect(document.body.classList.contains(CLASS)).toBe(true)

    a.rerender({ open: false })
    expect(document.body.classList.contains(CLASS)).toBe(true) // b держит класс

    b.unmount()
    expect(document.body.classList.contains(CLASS)).toBe(false)
  })
})
