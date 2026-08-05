import { describe, it, expect } from 'vitest'
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
  return fakeSelf.createDnpBridge as () => { setPort(p: unknown): void; requestPart(m: number, o: number, l: number): Promise<{ bytes: Uint8Array; total: number }> }
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
})
