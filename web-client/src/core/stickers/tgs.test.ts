import { describe, expect, it } from 'vitest'
import { isLottieMime, readLottie } from './tgs'

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
