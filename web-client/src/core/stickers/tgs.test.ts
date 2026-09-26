import { describe, expect, it } from 'vitest'
import { isLottieMime, readLottie } from './tgs'
import * as tgs from './tgs'

describe('isLottieMime', () => {
  it('признаёт оба mime lottie', () => {
    expect(isLottieMime('application/json')).toBe(true)
    expect(isLottieMime('application/json; charset=utf-8')).toBe(true)
    expect(isLottieMime('application/x-tgsticker')).toBe(true)
  })

  it('не признаёт видео и картинки', () => {
    expect(isLottieMime('video/webm')).toBe(false)
    expect(isLottieMime('image/webp')).toBe(false)
  })
})

describe('readLottie', () => {
  it('читает несжатый json как есть', async () => {
    const res = new Response(JSON.stringify({ tgs: 1, w: 512 }), {
      headers: { 'content-type': 'application/json' },
    })
    expect(await readLottie(res)).toEqual({ tgs: 1, w: 512 })
  })

  it('распаковывает gzip у .tgs', async () => {
    const raw = new Blob([JSON.stringify({ tgs: 1, w: 512 })])
    const gz = new Response(raw.stream().pipeThrough(new CompressionStream('gzip')))
    const res = new Response(await gz.blob(), {
      headers: { 'content-type': 'application/x-tgsticker' },
    })
    expect(await readLottie(res)).toEqual({ tgs: 1, w: 512 })
  })
})

// Порт лимита tweb f3733adc2 («gzipUncompress: cap decompressed size to guard
// against gzip bombs»; `TGS_MAX_DECOMPRESSED_SIZE` поднят до 8 МиБ в 9b5b04bda).
// .tgs приходит из чужого сообщения: без лимита несколько килобайт gzip
// разворачиваются в гигабайты и роняют вкладку по памяти.
const EIGHT_MIB = 8 * 1024 * 1024

async function gzipOf(text: string) {
  const gz = new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')))
  return new Uint8Array(await gz.arrayBuffer())
}

describe('распаковка .tgs ограничена (gzip-бомба)', () => {
  it('readLottie отказывает, когда распакованное больше 8 МиБ', async () => {
    const bomb = await gzipOf('{"a":"' + 'x'.repeat(EIGHT_MIB) + '"}')
    expect(bomb.length).toBeLessThan(64 * 1024) // сжатое — крошечное
    const res = new Response(bomb, { headers: { 'content-type': 'application/x-tgsticker' } })
    await expect(readLottie(res)).rejects.toThrow('GZIP_MAX_SIZE_EXCEEDED')
  })

  it('лимит — 8 МиБ, как у tweb apiFileManager', () => {
    expect(tgs.TGS_MAX_DECOMPRESSED_SIZE).toBe(EIGHT_MIB)
  })

  it('gzipUncompress: ровно maxSize проходит, на байт больше — нет', async () => {
    const payload = 'y'.repeat(1000)
    const gz = await gzipOf(payload)
    const body = () => new Response(gz).body!
    expect(new TextDecoder().decode(await tgs.gzipUncompress(body(), 1000))).toBe(payload)
    await expect(tgs.gzipUncompress(body(), 999)).rejects.toThrow('GZIP_MAX_SIZE_EXCEEDED')
  })
})
