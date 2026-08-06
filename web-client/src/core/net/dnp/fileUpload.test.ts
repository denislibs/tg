import { describe, it, expect } from 'vitest'
import { newFileUpload } from './fileUpload'

// фейк transport: копит sendBinary-кадры, позволяет вручную «прислать» file_up_ok по req_id.
function fakeTransport() {
  const okCbs: Array<(d: unknown) => void> = []
  const errCbs: Array<(d: unknown) => void> = []
  const closeCbs: Array<() => void> = []
  const frames: Uint8Array[] = []
  return {
    isOpen: () => true,
    sendBinary: (d: Uint8Array) => frames.push(d),
    on: (t: string, cb: (d: unknown) => void) => { if (t === 'file_up_ok') okCbs.push(cb); else if (t === 'file_up_err') errCbs.push(cb) },
    onClose: (cb: () => void) => closeCbs.push(cb),
    onBinary: () => {}, onOpen: () => {}, onError: () => {}, connect: () => {}, close: () => {}, send: () => {},
    // helpers
    frames, ackOk: (reqId: number) => okCbs.forEach((cb) => cb({ req_id: reqId })),
    ackErr: (reqId: number, error: string) => errCbs.forEach((cb) => cb({ req_id: reqId, error })),
    fireClose: () => closeCbs.forEach((cb) => cb()),
  }
}

// прочитать заголовок кадра (28Б BE): req_id, media_id, offset, total
function parseFrame(f: Uint8Array) {
  const dv = new DataView(f.buffer, f.byteOffset, f.byteLength)
  return { reqId: dv.getUint32(0, false), mediaId: Number(dv.getBigUint64(4, false)), offset: Number(dv.getBigUint64(12, false)), total: Number(dv.getBigUint64(20, false)), len: f.byteLength - 28 }
}

describe('fileUpload', () => {
  it('uploadStream шлёт чанки по offset, stop-and-wait, прогресс (один чанк)', async () => {
    const t = fakeTransport()
    const fu = newFileUpload(t as never)
    const blob = new Blob([new Uint8Array(10)]) // 10 байт; UPLOAD_CHUNK (512КБ) — весь файл влезает в один чанк
    const prog: Array<[number, number]> = []
    const p = fu.uploadStream(5, blob, 10, (l, tot) => prog.push([l, tot]))
    // stop-and-wait: должен уйти РОВНО один кадр (offset 0), ждёт ack
    await Promise.resolve()
    expect(t.frames.length).toBe(1)
    const f0 = parseFrame(t.frames[0]); expect(f0.mediaId).toBe(5); expect(f0.offset).toBe(0); expect(f0.total).toBe(10)
    t.ackOk(f0.reqId)
    await Promise.resolve(); await Promise.resolve()
    await p
    expect(prog[prog.length - 1]).toEqual([10, 10])
  })

  it('uploadStream режет на несколько чанков (chunk=4, total=10) — stop-and-wait по offset', async () => {
    const t = fakeTransport()
    const fu = newFileUpload(t as never, 4)
    const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])])
    const prog: Array<[number, number]> = []
    const p = fu.uploadStream(5, blob, 10, (l, tot) => prog.push([l, tot]))

    await Promise.resolve()
    expect(t.frames.length).toBe(1)
    let f = parseFrame(t.frames[0])
    expect(f.offset).toBe(0); expect(f.len).toBe(4); expect(f.total).toBe(10)
    t.ackOk(f.reqId)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()

    expect(t.frames.length).toBe(2)
    f = parseFrame(t.frames[1])
    expect(f.offset).toBe(4); expect(f.len).toBe(4)
    t.ackOk(f.reqId)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()

    expect(t.frames.length).toBe(3)
    f = parseFrame(t.frames[2])
    expect(f.offset).toBe(8); expect(f.len).toBe(2)
    t.ackOk(f.reqId)

    await p
    expect(prog).toEqual([[4, 10], [8, 10], [10, 10]])
  })

  it('file_up_err реджектит uploadStream', async () => {
    const t = fakeTransport(); const fu = newFileUpload(t as never, 4)
    const p = fu.uploadStream(5, new Blob([new Uint8Array(10)]), 10)
    await Promise.resolve()
    const f0 = parseFrame(t.frames[0]); t.ackErr(f0.reqId, 'forbidden')
    await expect(p).rejects.toThrow(/forbidden/i)
  })

  it('onClose реджектит in-flight uploadStream', async () => {
    const t = fakeTransport(); const fu = newFileUpload(t as never, 4)
    const p = fu.uploadStream(5, new Blob([new Uint8Array(10)]), 10)
    await Promise.resolve()
    t.fireClose()
    await expect(p).rejects.toThrow()
  })

  it('isReady отражает transport.isOpen', () => {
    const t = fakeTransport()
    const fu = newFileUpload(t as never)
    expect(fu.isReady()).toBe(true)
  })
})
