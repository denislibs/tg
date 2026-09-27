// Круговое раскрытие темы ждёт перерисовки обоев — порт tweb
// `themeController.ts:386-395`: колбэк `startViewTransition` применяет тему
// (она рассылает `theme_changed`, фон перерисовывает обои асинхронно) и ждёт
// `appChatBackground.getReadyPromise()`, но не дольше 500 мс.
import { afterEach, describe, expect, it, vi } from 'vitest'

const ready = vi.hoisted(() => ({ promise: Promise.resolve() }))
vi.mock('@components/chat/bubbles/chatBackground.solid', () => ({
  default: { getReadyPromise: () => ready.promise },
}))

import { switchThemeWithTransition } from './themeTransition'

// у DOM-типов свой `startViewTransition`; тесту нужна подмена попроще
const doc = document as unknown as { startViewTransition?: (cb: () => void | Promise<void>) => unknown }

afterEach(() => {
  delete doc.startViewTransition
  vi.useRealTimers()
})

function captureTransition() {
  let callback!: () => void | Promise<void>
  doc.startViewTransition = (cb) => {
    callback = cb
    return { ready: new Promise(() => {}), finished: new Promise(() => {}) }
  }
  return () => callback
}

describe('switchThemeWithTransition — снимок ждёт обоев', () => {
  it('колбэк применяет тему и решается только когда фон на экране', async() => {
    let resolveReady!: () => void
    const apply = vi.fn(() => {
      // так `setTheme` → `theme_changed` → `setBackground` заводят новое обещание
      ready.promise = new Promise<void>((resolve) => resolveReady = resolve)
    })
    const callback = captureTransition()

    switchThemeWithTransition(apply, { x: 1, y: 1 }, false)
    let settled = false
    void Promise.resolve(callback()()).then(() => { settled = true })

    expect(apply).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveReady()
    await vi.waitFor(() => expect(settled).toBe(true))
  })

  it('медленные обои не держат переключение дольше 500 мс', async() => {
    vi.useFakeTimers()
    const apply = vi.fn(() => { ready.promise = new Promise<void>(() => {}) })
    const callback = captureTransition()

    switchThemeWithTransition(apply, { x: 1, y: 1 }, true)
    let settled = false
    void Promise.resolve(callback()()).then(() => { settled = true })

    await vi.advanceTimersByTimeAsync(499)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
  })
})
