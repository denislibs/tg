import { describe, it, expect, vi } from 'vitest'
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
    onFrame: (cb: (t: string, d: unknown) => void) => { errCb = (d) => cb('file_err', d) },
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

  it('fetchFilePartWithTotal отдаёт байты и total', async () => {
    const fd = newFileDownload(fakeTransport((req, reply) => {
      reply(chunk(req.req_id, req.offset, 42, new Uint8Array([9, 8, 7])))
    }) as never)
    const { bytes, total } = await fd.fetchFilePartWithTotal(5, 0, 512)
    expect(Array.from(bytes)).toEqual([9, 8, 7])
    expect(total).toBe(42)
  })

  it('downloadMedia собирает Blob из нескольких чанков', async () => {
    // Сервер отдаёт короткие чанки (макс. 2 байта за ответ), несмотря на запрошенный
    // limit=CHUNK_SIZE — это заставляет downloadMedia реально проитерировать несколько
    // раз (offset 0→2→4→5), а не получить весь файл за один reply.
    const total = 5
    const bytes = new Uint8Array([10, 20, 30, 40, 50])
    let replies = 0
    const fd = newFileDownload(fakeTransport((req, reply) => {
      replies++
      const end = Math.min(req.offset + 2, total)
      reply(chunk(req.req_id, req.offset, total, bytes.subarray(req.offset, end)))
    }) as never)
    const blob = await fd.downloadMedia(1)
    expect(replies).toBeGreaterThanOrEqual(2)
    expect(blob.size).toBe(5)
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([10, 20, 30, 40, 50])
  })

  it('file_err реджектит fetchFilePart', async () => {
    const fd = newFileDownload(fakeTransport((req, _reply, err) => {
      err(req.req_id, 'forbidden')
    }) as never)
    await expect(fd.fetchFilePart(5, 0, 512)).rejects.toThrow('forbidden')
  })

  it('fetchFilePartWithTotal aborts and drops correlation', async () => {
    // reply не вызывается синхронно — сохраняем req_id/reply, чтобы дёрнуть их
    // ПОСЛЕ abort() и проверить, что поздний file_chunk игнорируется без ошибки.
    let capturedReqId = 0
    let capturedReply: ((c: Uint8Array) => void) | null = null
    const fd = newFileDownload(fakeTransport((req, reply) => {
      capturedReqId = req.req_id
      capturedReply = reply
    }) as never)
    const ac = new AbortController()
    const p = fd.fetchFilePartWithTotal(1, 0, 4096, ac.signal)
    ac.abort()
    await expect(p).rejects.toThrow(/abort/i)
    // поздний ответ на снятую корреляцию — не должен ни зарезолвить, ни кинуть.
    expect(() => capturedReply?.(chunk(capturedReqId, 0, 100, new Uint8Array(10)))).not.toThrow()
  })

  it('таймаут file-запроса снимает abort-листенер (нет утечки при переданном signal)', async () => {
    // Сервер не отвечает вовсе — единственный способ разрешить промис здесь: таймаут
    // FILE_TIMEOUT_MS (30с, см. fileDownload.ts). Фикс-раунд 1: до фикса таймаут-путь
    // реджектил напрямую, минуя pending-обёртку, которая снимает abort-листенер —
    // listener оставался висеть на signal до GC. Проверяем явно через спай на
    // removeEventListener, что таймаут снимает его так же, как resolve/reject/abort.
    vi.useFakeTimers()
    try {
      const fd = newFileDownload(fakeTransport(() => { /* нет ответа — ждём таймаут */ }) as never)
      const ac = new AbortController()
      const removeSpy = vi.spyOn(ac.signal, 'removeEventListener')
      const p = fd.fetchFilePart(1, 0, 4096, ac.signal)
      const expectation = expect(p).rejects.toThrow(/timeout/i)
      await vi.advanceTimersByTimeAsync(30_000)
      await expectation
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    } finally {
      vi.useRealTimers()
    }
  })

  it('fetchFilePart корректно читает кадр со смещённым byteOffset (subarray среза транспорта)', async () => {
    // В проде DnpTransport снимает kind-байт через plain.subarray(1) — итоговый
    // Uint8Array имеет byteOffset===1 в общем ArrayBuffer. Регресс на
    // `new DataView(raw.buffer)` (без byteOffset/byteLength) читал бы не с той
    // позиции — этот тест ловит именно такой регресс.
    const fd = newFileDownload(fakeTransport((req, reply) => {
      const payload = chunk(req.req_id, 0, 3, new Uint8Array([7, 8, 9]))
      const padded = new Uint8Array(1 + payload.length)
      padded[0] = 0xff // паддинг-байт впереди (имитирует снятый kind-байт)
      padded.set(payload, 1)
      reply(padded.subarray(1)) // byteOffset === 1, тот же buffer
    }) as never)
    const part = await fd.fetchFilePart(5, 0, 512)
    expect(Array.from(part)).toEqual([7, 8, 9])
  })
})
