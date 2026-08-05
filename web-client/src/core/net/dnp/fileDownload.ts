import type { Transport } from '../transport'

const CHUNK_SIZE = 512 * 1024
const FILE_TIMEOUT_MS = 30_000

interface Pending {
  resolve: (v: { offset: number; total: number; data: Uint8Array }) => void
  reject: (e: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

// newFileDownload — скачивание медиа чанками через DNP-канал. Зеркалит ChannelRpc:
// file_req (JSON) → file_chunk (бинарь), корреляция по u32 req_id. Активен только
// при DNP-ON (RestClient/mediaManager зовут лишь при isReady). Один консюмер — изображения.
export function newFileDownload(transport: Transport) {
  const pending = new Map<number, Pending>()
  let seq = 0

  transport.onBinary((raw) => {
    if (raw.length < 24) return
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    const reqId = dv.getUint32(0, false)
    const offset = Number(dv.getBigUint64(4, false))
    const total = Number(dv.getBigUint64(12, false))
    const len = dv.getUint32(20, false)
    const p = pending.get(reqId)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(reqId)
    p.resolve({ offset, total, data: raw.subarray(24, 24 + len) })
  })

  // Ошибка чанк-запроса: сервер шлёт file_err{req_id,error} — реджектим по req_id.
  transport.on('file_err', (d) => {
    const r = d as { req_id?: number; error?: string }
    if (typeof r?.req_id !== 'number') return
    const p = pending.get(r.req_id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(r.req_id)
    p.reject(new Error(r.error ?? 'file error'))
  })

  // Обрыв канала → все in-flight реджектятся.
  transport.onClose(() => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('channel closed')) }
    pending.clear()
  })

  // requestPart возвращает {data, total}: один чанк (до limit байт с offset).
  function requestPart(mediaId: number, offset: number, limit: number): Promise<{ data: Uint8Array; total: number }> {
    const reqId = (seq = (seq + 1) >>> 0) // u32-счётчик с обёрткой
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(reqId); reject(new Error('file timeout')) }, FILE_TIMEOUT_MS)
      pending.set(reqId, { resolve: (v) => resolve({ data: v.data, total: v.total }), reject, timer })
      transport.send('file_req', { req_id: reqId, media_id: mediaId, offset, limit })
    })
  }

  return {
    isReady(): boolean { return transport.isOpen() },
    // Публичный примитив: один чанк (байты). Обёртка над requestPart без total.
    async fetchFilePart(mediaId: number, offset: number, limit: number): Promise<Uint8Array> {
      const { data } = await requestPart(mediaId, offset, limit)
      return data
    },
    // downloadMedia тянет весь файл чанками CHUNK_SIZE и собирает Blob.
    async downloadMedia(mediaId: number): Promise<Blob> {
      const parts: Uint8Array[] = []
      let offset = 0
      // первый чанк даёт total; дальше — до EOF (offset >= total).
      for (;;) {
        const { data, total } = await requestPart(mediaId, offset, CHUNK_SIZE)
        parts.push(data)
        offset += data.length
        if (data.length === 0 || offset >= total) break
      }
      return new Blob(parts as BlobPart[])
    },
  }
}

export type FileDownload = ReturnType<typeof newFileDownload>
