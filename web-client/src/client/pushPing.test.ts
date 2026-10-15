import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLockStore } from '@stores/lockStore'
import { PING_PUSH_INTERVAL, startPushPing } from './pushPing'

/* Пинг `push-ready` вкладки service worker'у (tweb `webPushApiManager.isAliveNotify`,
 * `PING_PUSH_INTERVAL = 10000`): без него клик по пушу при закрытом приложении
 * (`pendingNotification` в `public/sw.js`) некому отдать. */

let postMessage: ReturnType<typeof vi.fn>
let stop: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  postMessage = vi.fn()
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: { postMessage } } })
  useLockStore.setState({ locked: false })
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'serviceWorker')
  useLockStore.setState({ locked: false })
})

describe('startPushPing', () => {
  it('интервал — 10 секунд, как PING_PUSH_INTERVAL tweb (миллисекунды)', () => {
    expect(PING_PUSH_INTERVAL).toBe(10000)
  })

  it('шлёт push-ready сразу, без условия DNP, и повторяет раз в 10 с', () => {
    stop = startPushPing()
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'push-ready' })

    vi.advanceTimersByTime(PING_PUSH_INTERVAL - 1)
    expect(postMessage).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(postMessage).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(PING_PUSH_INTERVAL * 3)
    expect(postMessage).toHaveBeenCalledTimes(5)
  })

  it('заперто код-паролем — молчит; разблокировка шлёт внеочередной пинг', () => {
    useLockStore.setState({ locked: true })
    stop = startPushPing()
    vi.advanceTimersByTime(PING_PUSH_INTERVAL * 2)
    expect(postMessage).not.toHaveBeenCalled()

    useLockStore.getState().unlock()
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('запирание не шлёт пинг; сброс остановил таймер и подписку', () => {
    stop = startPushPing()
    postMessage.mockClear()
    useLockStore.getState().lock()
    expect(postMessage).not.toHaveBeenCalled()

    stop()
    stop = undefined
    useLockStore.getState().unlock()
    vi.advanceTimersByTime(PING_PUSH_INTERVAL * 2)
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('нет контроллера (SW ещё не управляет страницей) — не падает', () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: null } })
    expect(() => { stop = startPushPing() }).not.toThrow()
  })
})
