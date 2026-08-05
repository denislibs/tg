import { describe, it, expect, vi } from 'vitest'
import { attachStreamBridge, type PartSource } from './streamBridge'

// Пара связанных портов: a.postMessage → b.onmessage (и наоборот), асинхронно.
function portPair() {
  const a: any = { onmessage: null, postMessage: (msg: unknown, _t?: Transferable[]) => queueMicrotask(() => b.onmessage?.({ data: msg } as MessageEvent)) }
  const b: any = { onmessage: null, postMessage: (msg: unknown, _t?: Transferable[]) => queueMicrotask(() => a.onmessage?.({ data: msg } as MessageEvent)) }
  return { a, b }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('attachStreamBridge', () => {
  it('file_part → file_part_ok с байтами и total', async () => {
    const { a: swSide, b: workerSide } = portPair()
    const src: PartSource = { fetchFilePartWithTotal: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), total: 99 }) }
    attachStreamBridge(workerSide, src)
    const got: unknown[] = []
    swSide.onmessage = (e: MessageEvent) => got.push(e.data)
    swSide.postMessage({ t: 'file_part', reqId: 7, mediaId: 5, offset: 0, limit: 512 })
    await flush()
    expect(src.fetchFilePartWithTotal).toHaveBeenCalledWith(5, 0, 512, expect.any(AbortSignal))
    const ok = got[0] as { t: string; reqId: number; bytes: Uint8Array; total: number }
    expect(ok.t).toBe('file_part_ok'); expect(ok.reqId).toBe(7)
    expect(Array.from(ok.bytes)).toEqual([1, 2, 3]); expect(ok.total).toBe(99)
  })

  it('ошибка источника → file_part_err', async () => {
    const { a: swSide, b: workerSide } = portPair()
    const src: PartSource = { fetchFilePartWithTotal: vi.fn().mockRejectedValue(new Error('forbidden')) }
    attachStreamBridge(workerSide, src)
    const got: any[] = []
    swSide.onmessage = (e: MessageEvent) => got.push(e.data)
    swSide.postMessage({ t: 'file_part', reqId: 3, mediaId: 5, offset: 0, limit: 512 })
    await flush()
    expect(got[0].t).toBe('file_part_err'); expect(got[0].reqId).toBe(3); expect(got[0].error).toBe('forbidden')
  })

  it('file_part_cancel aborts the in-flight fetch signal', async () => {
    let capturedSignal: AbortSignal | undefined
    const src = {
      fetchFilePartWithTotal: (_id: number, _o: number, _l: number, signal?: AbortSignal) => {
        capturedSignal = signal
        return new Promise<{ bytes: Uint8Array; total: number }>(() => {}) // виснет — ждём отмены
      },
    }
    const port: any = { postMessage: vi.fn(), onmessage: null }
    attachStreamBridge(port, src as any)
    port.onmessage({ data: { t: 'file_part', reqId: 7, mediaId: 1, offset: 0, limit: 4096 } })
    expect(capturedSignal?.aborted).toBe(false)
    port.onmessage({ data: { t: 'file_part_cancel', reqId: 7 } })
    expect(capturedSignal?.aborted).toBe(true)
  })
})
