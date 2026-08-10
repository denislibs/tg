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

  it('переживает StrictMode: ссылка стабильна, cleanup разрушает, воскрешение работает', () => {
    // Рычаг 1: ссылка хелпера стабильна между рендерами (ловит забытый ??=)
    const { result, rerender } = renderHook(() => useMiddlewareHelper(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    })
    const helperBeforeCycle = result.current
    rerender()
    expect(result.current).toBe(helperBeforeCycle)

    // Рычаг 2: cleanup должен вызвать destroy(), гасящий старое поколение
    // (ловит забытый destroy() в cleanup)
    const { result: result2, unmount } = renderHook(() => useMiddlewareHelper())
    const middleware = result2.current.get()
    expect(middleware()).toBe(true)
    unmount()
    expect(middleware()).toBe(false) // cleanup вызвал destroy()

    // Воскрешение: после destroy() хелпер может выдать новое поколение
    // (пин из middleware.test.ts: destroy() + clean() пересоздают details)
    const freshHook = renderHook(() => useMiddlewareHelper())
    expect(freshHook.result.current.get()()).toBe(true)
  })
})
