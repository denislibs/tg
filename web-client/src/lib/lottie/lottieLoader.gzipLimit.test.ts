// Порт лимита tweb f3733adc2 (`gzipUncompress` с `maxSize`) для второй точки
// распаковки .tgs — `lottieLoader.loadAnimationDataFromURL` (gzip снимается там,
// где сервер отвечает application/octet-stream). Лимит тот же, что у
// `core/stickers/tgs.ts` — `TGS_MAX_DECOMPRESSED_SIZE`.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@environment/webAssemblySimdSupport', () => ({ default: true }))

const { default: lottieLoader } = await import('./lottieLoader')

async function gzipOf(text: string) {
  const gz = new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')))
  return new Uint8Array(await gz.arrayBuffer())
}

function serveGzip(bytes: Uint8Array<ArrayBuffer>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, {
    headers: { 'content-type': 'application/octet-stream' },
  })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lottieLoader.loadAnimationDataFromURL — распаковка gzip ограничена', () => {
  it('gzip-бомба (> 8 МиБ распакованного) отвергается', async () => {
    serveGzip(await gzipOf('{"a":"' + 'x'.repeat(8 * 1024 * 1024) + '"}'))
    await expect(lottieLoader.loadAnimationDataFromURL('assets/tgs/bomb.json', 'json'))
      .rejects.toThrow('GZIP_MAX_SIZE_EXCEEDED')
    await expect(lottieLoader.loadAnimationDataFromURL('assets/tgs/bomb.json'))
      .rejects.toThrow('GZIP_MAX_SIZE_EXCEEDED')
  })

  it('обычный .tgs распаковывается: json и blob', async () => {
    const gz = await gzipOf('{"tgs":1,"w":512}')
    serveGzip(gz)
    expect(await lottieLoader.loadAnimationDataFromURL('assets/tgs/ok.json', 'json')).toEqual({ tgs: 1, w: 512 })
    serveGzip(gz)
    const blob = await lottieLoader.loadAnimationDataFromURL('assets/tgs/ok.json')
    expect(await blob.text()).toBe('{"tgs":1,"w":512}')
  })
})
