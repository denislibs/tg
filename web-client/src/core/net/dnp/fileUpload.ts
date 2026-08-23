import type { Transport } from '../transport'

export const UPLOAD_CHUNK = 512 * 1024
const UPLOAD_TIMEOUT_MS = 30_000

interface Pending { resolve: () => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }

// buildFileUpFrame — 28Б BE заголовок + data (зеркало сервера parseFileUp).
function buildFileUpFrame(reqId: number, mediaId: number, offset: number, total: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(28 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, reqId, false)
  dv.setBigUint64(4, BigInt(mediaId), false)
  dv.setBigUint64(12, BigInt(offset), false)
  dv.setBigUint64(20, BigInt(total), false)
  out.set(data, 28)
  return out
}

// newFileUpload — загрузка медиа стримом чанков через DNP-канал (зеркало fileDownload).
// file_up (бинарь kind 0x02) → ack file_up_ok/file_up_err по req_id. Активен только при DNP-ON.
export function newFileUpload(transport: Transport, chunk: number = UPLOAD_CHUNK) {
  const pending = new Map<number, Pending>()
  let seq = 0

  // Оба кадра — транспортные (решение Р6): апдейтами они не становятся, поэтому
  // и опознаются типом конверта, а не конструктором.
  transport.onFrame((t, d) => {
    if (t === 'file_up_ok') {
      const r = d as { req_id?: number }
      if (typeof r?.req_id !== 'number') return
      const p = pending.get(r.req_id); if (!p) return
      clearTimeout(p.timer); pending.delete(r.req_id); p.resolve()
      return
    }
    if (t === 'file_up_err') {
      const r = d as { req_id?: number; error?: string }
      if (typeof r?.req_id !== 'number') return
      const p = pending.get(r.req_id); if (!p) return
      clearTimeout(p.timer); pending.delete(r.req_id); p.reject(new Error(r.error ?? 'file_up error'))
    }
  })
  transport.onClose(() => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('channel closed')) }
    pending.clear()
  })

  function sendChunk(mediaId: number, offset: number, total: number, data: Uint8Array): Promise<void> {
    const reqId = (seq = (seq + 1) >>> 0)
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(reqId); reject(new Error('file_up timeout')) }, UPLOAD_TIMEOUT_MS)
      pending.set(reqId, { resolve, reject, timer })
      transport.sendBinary(buildFileUpFrame(reqId, mediaId, offset, total, data))
    })
  }

  return {
    isReady(): boolean { return transport.isOpen() },
    // uploadStream — режет blob на чанки chunk, шлёт по порядку offset (stop-and-wait: ждёт ack).
    async uploadStream(mediaId: number, blob: Blob, total: number, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
      let offset = 0
      while (offset < total) {
        if (signal?.aborted) throw new Error('aborted')
        const end = Math.min(offset + chunk, total)
        const data = new Uint8Array(await blob.slice(offset, end).arrayBuffer())
        await sendChunk(mediaId, offset, total, data)
        offset = end
        onProgress?.(offset, total)
      }
    },
  }
}

export type FileUpload = ReturnType<typeof newFileUpload>
