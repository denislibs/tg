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
