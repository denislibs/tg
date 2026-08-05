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
