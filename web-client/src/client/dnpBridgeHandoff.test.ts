import { describe, it, expect, vi } from 'vitest'
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
