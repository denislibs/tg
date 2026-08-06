import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handoffBridgePort } from './dnpBridgeHandoff'

describe('handoffBridgePort', () => {
  it('раздаёт концы MessageChannel: SW (event.data.type) и SharedWorker (event.data.t) — разные ключи у приёмников', () => {
    const controller = { postMessage: vi.fn() }
    const ep = { postMessage: vi.fn() }
    handoffBridgePort(controller, ep)
    expect(controller.postMessage).toHaveBeenCalledTimes(1)
    expect(ep.postMessage).toHaveBeenCalledTimes(1)
    // control-кадр + ровно один transferable-порт на каждый конец
    const [cMsg, cTransfer] = controller.postMessage.mock.calls[0]
    const [eMsg, eTransfer] = ep.postMessage.mock.calls[0]
    // sw.js (message-хэндлер) читает event.data.type
    expect((cMsg as { type: string }).type).toBe('dnp-bridge-port')
    // worker.ts (bind, raw-слушатель) читает ev.data.t
    expect((eMsg as { t: string }).t).toBe('dnp-bridge-port')
    expect(cTransfer).toHaveLength(1)
    expect(eTransfer).toHaveLength(1)
    // два разных конца одного канала
    expect(cTransfer[0]).not.toBe(eTransfer[0])
  })
})

describe('installBridgeHandoff', () => {
  const originalNavigator = globalThis.navigator
  const originalDocument = globalThis.document

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true })
    Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true })
  })

  it('SW dnp-request-port triggers handoff to controller and ep', async () => {
    vi.doMock('../config/app', () => ({ AppConfig: { dnp: { enabled: true } } }))
    const ctrlPost = vi.fn()
    const swListeners: Record<string, (e: { data: unknown }) => void> = {}
    const controller = { postMessage: ctrlPost }
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          controller,
          ready: Promise.resolve(),
          addEventListener: (t: string, cb: (e: { data: unknown }) => void) => {
            swListeners[t] = cb
          },
        },
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, 'document', {
      value: { visibilityState: 'visible', addEventListener: vi.fn() },
      configurable: true,
    })
    const ep = { postMessage: vi.fn() }
    const { installBridgeHandoff } = await import('./dnpBridgeHandoff')
    installBridgeHandoff(ep)
    await Promise.resolve() // дать ready.then отработать
    // boot-пинг ушёл
    expect(ctrlPost).toHaveBeenCalledWith({ type: 'dnp-ping' })
    // эмулируем ответ SW: request-port
    swListeners['message']({ data: { type: 'dnp-request-port' } })
    // handoff: контроллеру ушёл dnp-bridge-port c портом, ep — тоже
    expect(ctrlPost).toHaveBeenCalledWith(expect.objectContaining({ type: 'dnp-bridge-port' }), expect.any(Array))
    expect(ep.postMessage).toHaveBeenCalledWith(expect.objectContaining({ t: 'dnp-bridge-port' }), expect.any(Array))
  })

  it('DNP-off: no-op — ни пингов, ни слушателей', async () => {
    vi.doMock('../config/app', () => ({ AppConfig: { dnp: { enabled: false } } }))
    const ctrlPost = vi.fn()
    const swAddEventListener = vi.fn()
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          controller: { postMessage: ctrlPost },
          ready: Promise.resolve(),
          addEventListener: swAddEventListener,
        },
      },
      configurable: true,
    })
    const docAddEventListener = vi.fn()
    Object.defineProperty(globalThis, 'document', {
      value: { visibilityState: 'visible', addEventListener: docAddEventListener },
      configurable: true,
    })
    const ep = { postMessage: vi.fn() }
    const { installBridgeHandoff } = await import('./dnpBridgeHandoff')
    installBridgeHandoff(ep)
    await Promise.resolve()
    await Promise.resolve()
    expect(ctrlPost).not.toHaveBeenCalled()
    expect(swAddEventListener).not.toHaveBeenCalled()
    expect(docAddEventListener).not.toHaveBeenCalled()
  })

  it('visibilitychange→visible шлёт повторный пинг контроллеру', async () => {
    vi.doMock('../config/app', () => ({ AppConfig: { dnp: { enabled: true } } }))
    const ctrlPost = vi.fn()
    const swListeners: Record<string, (e: { data: unknown }) => void> = {}
    const controller = { postMessage: ctrlPost }
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          controller,
          ready: Promise.resolve(),
          addEventListener: (t: string, cb: (e: { data: unknown }) => void) => {
            swListeners[t] = cb
          },
        },
      },
      configurable: true,
    })
    const docListeners: Record<string, () => void> = {}
    const docState = { visibilityState: 'visible' as string }
    Object.defineProperty(globalThis, 'document', {
      value: {
        get visibilityState() {
          return docState.visibilityState
        },
        addEventListener: (t: string, cb: () => void) => {
          docListeners[t] = cb
        },
      },
      configurable: true,
    })
    const ep = { postMessage: vi.fn() }
    const { installBridgeHandoff } = await import('./dnpBridgeHandoff')
    installBridgeHandoff(ep)
    await Promise.resolve()
    expect(ctrlPost).toHaveBeenCalledTimes(1) // boot-пинг

    docState.visibilityState = 'hidden'
    docListeners['visibilitychange']()
    expect(ctrlPost).toHaveBeenCalledTimes(1) // hidden — без пинга

    docState.visibilityState = 'visible'
    docListeners['visibilitychange']()
    expect(ctrlPost).toHaveBeenCalledTimes(2) // visible — повторный пинг
    expect(ctrlPost).toHaveBeenNthCalledWith(2, { type: 'dnp-ping' })
  })
})
