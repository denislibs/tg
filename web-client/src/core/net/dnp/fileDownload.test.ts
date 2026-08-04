import { describe, it, expect } from 'vitest'
import { newFileDownload } from './fileDownload'

// Собрать бинарный file_chunk payload (как это делает сервер, БЕЗ kind-байта —
// транспорт уже снял 0x01 перед onBinary).
function chunk(reqId: number, offset: number, total: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(24 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, reqId, false)
  dv.setBigUint64(4, BigInt(offset), false)
  dv.setBigUint64(12, BigInt(total), false)
  dv.setUint32(20, data.length, false)
  out.set(data, 24)
  return out
}

function fakeTransport(serve: (req: { req_id: number; media_id: number; offset: number; limit: number }, reply: (c: Uint8Array) => void, err: (reqId: number, msg: string) => void) => void) {
  let binCb: (d: Uint8Array) => void = () => {}
  let errCb: (d: unknown) => void = () => {}
  return {
    isOpen: () => true,
    onBinary: (cb: (d: Uint8Array) => void) => { binCb = cb },
    on: (t: string, cb: (d: unknown) => void) => { if (t === 'file_err') errCb = cb },
    onClose: () => {},
    send: (t: string, d?: unknown) => {
      if (t === 'file_req') serve(d as never, binCb, (reqId, msg) => errCb({ req_id: reqId, error: msg }))
    },
    // неиспользуемые методы Transport — заглушки
    connect: () => {}, close: () => {}, onOpen: () => {}, onError: () => {},
  }
}

describe('fileDownload', () => {
  it('fetchFilePart резолвит байты из бинарного кадра', async () => {
    const fd = newFileDownload(fakeTransport((req, reply) => {
      reply(chunk(req.req_id, 0, 3, new Uint8Array([1, 2, 3])))
    }) as never)
    const part = await fd.fetchFilePart(5, 0, 512)
    expect(Array.from(part)).toEqual([1, 2, 3])
  })

  it('downloadMedia собирает Blob из нескольких чанков', async () => {
    const total = 5
    const bytes = new Uint8Array([10, 20, 30, 40, 50])
    const fd = newFileDownload(fakeTransport((req, reply) => {
      const end = Math.min(req.offset + req.limit, total)
      reply(chunk(req.req_id, req.offset, total, bytes.subarray(req.offset, end)))
    }) as never)
    const blob = await fd.downloadMedia(1)
    expect(blob.size).toBe(5)
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([10, 20, 30, 40, 50])
  })

  it('file_err реджектит fetchFilePart', async () => {
    const fd = newFileDownload(fakeTransport((req, _reply, err) => {
      err(req.req_id, 'forbidden')
    }) as never)
    await expect(fd.fetchFilePart(5, 0, 512)).rejects.toThrow('forbidden')
  })
})
