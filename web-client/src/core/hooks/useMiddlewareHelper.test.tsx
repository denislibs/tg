import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMiddlewareHelper } from './useMiddlewareHelper'

describe('useMiddlewareHelper', () => {
  it('хелпер стабилен между рендерами', () => {
    const { result, rerender } = renderHook(() => useMiddlewareHelper())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('на unmount выданные middleware протухают', () => {
    const { result, unmount } = renderHook(() => useMiddlewareHelper())
    const middleware = result.current.get()
    expect(middleware()).toBe(true)
    unmount()
    expect(middleware()).toBe(false)
  })

  it('дочерние scope независимы: destroy одного не гасит другой', () => {
    const { result } = renderHook(() => useMiddlewareHelper())
    const a = result.current.get().create()
    const b = result.current.get().create()
    const mb = b.get()
    a.destroy()
    expect(mb()).toBe(true)
    b.destroy()
    expect(mb()).toBe(false)
  })

  it('переживает StrictMode-цикл: фантомный destroy не ломает хелпер', () => {
    const { result, rerender, unmount } = renderHook(() => useMiddlewareHelper(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    })

    // Контрольная точка 1: после маунта (после фантомного цикла)
    // хелпер РАБОЧИЙ (destroy→clean() пересоздают details, get() выдаёт живой middleware)
    const helper = result.current
    expect(helper.get()()).toBe(true)

    // Контрольная точка 2: идентичность ссылки через rerender (ловит мутацию A: нет ??=)
    const middleware = helper.get()
    rerender()
    expect(result.current).toBe(helper)
    expect(result.current.get()()).toBe(true)

    // Контрольная точка 3: cleanup вызовет destroy(), гасящий старое поколение (ловит мутацию B: нет destroy())
    unmount()
    expect(middleware()).toBe(false)
  })
})
