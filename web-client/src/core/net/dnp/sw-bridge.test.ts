/// <reference types="node" />
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Загрузка classic-скрипта sw-bridge.js в изолированный self (как SW importScripts).
// Путь через промежуточную переменную: литерал прямо в `new URL(..., import.meta.url)`
// перехватывается Vite как asset/worker-ссылка (см. new Worker(new URL(...)) в
// bootstrap.ts) и переписывается в dev-server URL — ломая обычное файловое чтение.
function loadBridge() {
  const rel = '../../../../public/sw-bridge.js'
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const code = readFileSync(path, 'utf8')
  const fakeSelf: any = {}
  new Function('self', code)(fakeSelf)
  return fakeSelf.createDnpBridge as () => {
    hasPort(): boolean
    setPort(p: unknown): void
    requestPart(m: number, o: number, l: number): Promise<{ bytes: Uint8Array; total: number }>
  }
}

// Fake worker-порт: на file_part зовёт serve(), который отвечает через port.onmessage.
function workerFakePort(serve: (req: any, reply: (msg: any) => void) => void) {
  const port: any = {
    onmessage: null,
    postMessage: (msg: any) => queueMicrotask(() => serve(msg, (resp) => port.onmessage?.({ data: resp } as MessageEvent))),
  }
  return port
}

describe('sw-bridge createDnpBridge', () => {
  it('requestPart шлёт file_part и резолвит bytes+total', async () => {
    const createDnpBridge = loadBridge()
    const bridge = createDnpBridge()
    const port = workerFakePort((req, reply) => {
      expect(req.t).toBe('file_part'); expect(req.mediaId).toBe(5)
      reply({ t: 'file_part_ok', reqId: req.reqId, bytes: new Uint8Array([4, 5, 6]), total: 77 })
    })
    bridge.setPort(port)
    const { bytes, total } = await bridge.requestPart(5, 128, 512)
    expect(Array.from(bytes)).toEqual([4, 5, 6]); expect(total).toBe(77)
  })

  it('file_part_err → reject', async () => {
    const createDnpBridge = loadBridge()
    const bridge = createDnpBridge()
    bridge.setPort(workerFakePort((req, reply) => reply({ t: 'file_part_err', reqId: req.reqId, error: 'nope' })))
    await expect(bridge.requestPart(5, 0, 512)).rejects.toThrow('nope')
  })

  it('hasPort reflects port presence', () => {
    const createDnpBridge = loadBridge()
    const bridge = createDnpBridge()
    expect(bridge.hasPort()).toBe(false)
    const { port1 } = new MessageChannel()
    bridge.setPort(port1)
    expect(bridge.hasPort()).toBe(true)
  })

  it('setPort closes the superseded port', () => {
    const createDnpBridge = loadBridge()
    const bridge = createDnpBridge()
    const a = new MessageChannel()
    const b = new MessageChannel()
    const closeA = vi.spyOn(a.port1, 'close')
    bridge.setPort(a.port1)
    bridge.setPort(b.port1) // вытесняет a.port1
    expect(closeA).toHaveBeenCalledTimes(1)
  })

  it('requestPart timeout posts file_part_cancel', () => {
    vi.useFakeTimers()
    const createDnpBridge = loadBridge()
    const bridge = createDnpBridge()
    const ch = new MessageChannel()
    const posted: any[] = []
    // перехватываем исходящие на порт: подменяем postMessage на конце SW
    ch.port1.postMessage = (msg: any) => { posted.push(msg) }
    bridge.setPort(ch.port1)
    const p = bridge.requestPart(1, 0, 4096)
    p.catch(() => {}) // подавляем unhandled
    vi.advanceTimersByTime(45000)
    expect(posted.some((m) => m.t === 'file_part_cancel')).toBe(true)
    vi.useRealTimers()
  })
})
