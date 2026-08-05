/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function loadStream() {
  const rel = '../../../../public/sw-stream.js'
  const path = fileURLToPath(new URL(rel, import.meta.url))
  const code = readFileSync(path, 'utf8')
  const fakeSelf: any = { Response: globalThis.Response }
  new Function('self', code)(fakeSelf)
  return fakeSelf.dnpStream
}

describe('sw-stream range math', () => {
  const s = loadStream()
  it('parseRange: закрытый/открытый/пустой', () => {
    expect(s.parseRange('bytes=0-1023')).toEqual([0, 1023])
    expect(s.parseRange('bytes=512-')).toEqual([512, 0])
    expect(s.parseRange('')).toEqual([0, 0])
    expect(s.parseRange(null)).toEqual([0, 0])
  })
  it('alignOffset выравнивает вниз к базе', () => {
    expect(s.alignOffset(5000, 4096)).toBe(4096)
    expect(s.alignOffset(4096, 4096)).toBe(4096)
    expect(s.alignOffset(100, 4096)).toBe(0)
  })
  it('alignLimit — следующая степень двойки', () => {
    expect(s.alignLimit(1)).toBe(1)
    expect(s.alignLimit(1000)).toBe(1024)
    expect(s.alignLimit(1024)).toBe(1024)
    expect(s.alignLimit(1025)).toBe(2048)
  })
  it('Safari [0,1] → сфабрикованный 2-байтный 206', async () => {
    const r = s.responseForSafariFirstRange([0, 1], 'video/mp4', 5000)
    expect(r).toBeTruthy()
    expect(r.status).toBe(206)
    expect(r.headers.get('Content-Range')).toBe('bytes 0-1/5000')
    expect(r.headers.get('Content-Type')).toBe('video/mp4')
    expect((await r.arrayBuffer()).byteLength).toBe(2)
    expect(s.responseForSafariFirstRange([0, 100], 'video/mp4', 5000)).toBeNull()
  })
})

describe('sw-stream handleStreamFetch', () => {
  const s = loadStream()
  // Источник: файл 0..99 (байт i = i&0xff); requestPart отдаёт срез [offset, offset+limit).
  const OBJ = new Uint8Array(100).map((_, i) => i & 0xff)
  const requestPart = async (mediaId: number, offset: number, limit: number) => ({
    bytes: OBJ.subarray(offset, Math.min(offset + limit, OBJ.length)),
    total: OBJ.length,
  })
  const handler = s.createStreamHandler(requestPart)
  const makeReq = (range: string) =>
    new Request('https://x/dnp-stream/7?size=100&mime=video/mp4', { headers: { Range: range } })

  it('206 с корректным Content-Range и телом (закрытый диапазон)', async () => {
    const r = await handler.handleStreamFetch(makeReq('bytes=10-19'))
    expect(r.status).toBe(206)
    expect(r.headers.get('Content-Type')).toBe('video/mp4')
    expect(r.headers.get('Accept-Ranges')).toBe('bytes')
    const body = new Uint8Array(await r.arrayBuffer())
    expect(Array.from(body)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(r.headers.get('Content-Range')).toBe('bytes 10-19/100')
    expect(r.headers.get('Content-Length')).toBe('10')
  })

  it('открытый диапазон (bytes=0-) отдаёт от offset до чанка', async () => {
    const r = await handler.handleStreamFetch(makeReq('bytes=0-'))
    expect(r.status).toBe(206)
    const body = new Uint8Array(await r.arrayBuffer())
    expect(body[0]).toBe(0)
    expect(r.headers.get('Content-Range')).toMatch(/^bytes 0-\d+\/100$/)
  })

  it('Safari [0,1] короткозамкнут (2 байта, без requestPart)', async () => {
    let called = 0
    const h = s.createStreamHandler(async () => { called++; return { bytes: new Uint8Array(), total: 0 } })
    const r = await h.handleStreamFetch(makeReq('bytes=0-1'))
    expect((await r.arrayBuffer()).byteLength).toBe(2)
    expect(called).toBe(0)
  })
})

describe('sw-stream tryPatchMp4', () => {
  const s = loadStream()
  const fromHex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)))

  it('нет esds → false, не бросает', () => {
    expect(s.tryPatchMp4(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(false)
  })

  it('битый AAC-esds → патчится в FIXED_ESDS', () => {
    // Собираем минимальный mp4a-бокс с esds, чей DecoderConfigDescriptor несёт BROKEN_DSCI.
    // esds payload (ES_Descriptor): 03 <len> [ES_ID:2][flags:1] 04 <len>[oti+flags+3+4+4=13 байт] 05 <len:2>[13 88]
    const FIXED = fromHex('0327000100041940150000000001f4000000bb750507138856e5a5') // 27 байт
    const dsci = fromHex('1388')                              // BROKEN_DSCI
    const dcd = new Uint8Array([0x04, 0x15, /*13 config bytes:*/ 0x40,0,0,0,0,0,0,0,0,0,0,0,0, /*DSI:*/ 0x05, 0x02, dsci[0], dsci[1]])
    // Хвостовой паддинг esdPayload — parseES_Descriptor его не читает (останавливается
    // на DSI), а found.size (сырой байт-размер esds-бокса) должен быть >= FIXED_ESDS.length
    // (27), иначе fixMp4ForChromium бросит 'ESDS Size not enough'.
    const esdPayload = new Uint8Array([0x03, dcd.length + 3, 0x00, 0x01, 0x00, ...dcd, 0, 0, 0, 0])
    // esds mp4-бокс: [size u32][type 'esds'][4 version/flags][esdPayload]; found.offset=esdsOffset+8, size=esdsSize-12
    const esdsType = new TextEncoder().encode('esds')
    const boxInner = new Uint8Array([0,0,0,0, ...esdPayload])  // 4 version/flags + payload
    const esdsSize = 8 + boxInner.length                       // size(4)+type(4)+inner
    const esdsBox = new Uint8Array(esdsSize)
    new DataView(esdsBox.buffer).setUint32(0, esdsSize)
    esdsBox.set(esdsType, 4); esdsBox.set(boxInner, 8)
    // mp4a рядом (в пределах 100 байт до esds); + хвостовой паддинг буфера — граничная
    // проверка в fixMp4ForChromium (esdsOffset + esdsSize <= u8.length, где esdsOffset —
    // это смещение ТЕКСТА 'esds', а не начала бокса) требует запас после бокса.
    const mp4a = new TextEncoder().encode('mp4a')
    const padding = new Uint8Array(8)
    const buf = new Uint8Array(mp4a.length + esdsBox.length + padding.length)
    buf.set(mp4a, 0); buf.set(esdsBox, mp4a.length); buf.set(padding, mp4a.length + esdsBox.length)

    const ok = s.tryPatchMp4(buf)
    expect(ok).toBe(true)
    // esdsOffset (в терминах алгоритма) — смещение текста 'esds', т.е. после
    // 4-байтного size-поля бокса; found.offset = esdsOffset + 8, там и лежит FIXED_ESDS.
    const esdsOffset = mp4a.length + 4
    const patchedAt = esdsOffset + 8
    expect(Array.from(buf.subarray(patchedAt, patchedAt + FIXED.length))).toEqual(Array.from(FIXED))
  })
})
