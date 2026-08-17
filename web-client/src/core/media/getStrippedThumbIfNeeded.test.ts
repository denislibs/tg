// Порт tweb getStrippedThumbIfNeeded/getImageFromStrippedThumb: решение «нужно
// ли превью» и сам узел. Пиним три ветки оригинала, которые легко потерять при
// упрощении под нашу модель медиа ({thumb:boolean} вместо лестницы PhotoSize):
// скачанное медиа превью не получает, ВИДЕО получает даже скачанным, а
// отсутствие stripped-байтов — это null, а не пустой канвас.
//
// blur грузит Image из data:-URI — happy-dom onload не гарантирует; мок
// сохраняет контракт (канвас .canvas-thumbnail + промис готовности), как в
// components/mediaViewer/base.open.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import getMediaThumbIfNeeded, { getImageFromStrippedThumb } from './getStrippedThumbIfNeeded'

beforeEach(() => {
  // happy-dom не умеет decode() — стаб «декодировано мгновенно» (тот же приём,
  // что в components/mediaViewer/base.open.test.ts)
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true, writable: true, value: () => Promise.resolve(),
  })
})

vi.mock('@helpers/blur', () => ({
  default: vi.fn((dataUri: string) => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    canvas.dataset.uri = dataUri
    return { canvas, promise: Promise.resolve() }
  }),
}))

const STRIPPED = 'AAECAwQ='

describe('getMediaThumbIfNeeded', () => {
  it('без stripped-превью — пусто (строить не из чего)', () => {
    expect(getMediaThumbIfNeeded({ strippedThumb: undefined, useBlur: true })).toBeNull()
    expect(getMediaThumbIfNeeded({ strippedThumb: '', useBlur: true })).toBeNull()
  })

  it('с превью — узел .thumbnail и промис готовности', async () => {
    const got = getMediaThumbIfNeeded({ strippedThumb: STRIPPED, useBlur: true })

    expect(got).not.toBeNull()
    expect(got!.image.classList.contains('thumbnail')).toBe(true)
    // media-photo вешает враппер (tweb photo.ts:157) — не этот модуль
    expect(got!.image.classList.contains('media-photo')).toBe(false)
    await expect(got!.loadPromise).resolves.toBeUndefined()
  })

  it('медиа уже скачано — превью не нужно (аналог cacheContext.downloaded)', () => {
    expect(getMediaThumbIfNeeded({ strippedThumb: STRIPPED, downloaded: true, useBlur: true })).toBeNull()
  })

  it('видео получает превью даже скачанным: «скачано» относится к файлу, а не к первому кадру', () => {
    const got = getMediaThumbIfNeeded({ strippedThumb: STRIPPED, downloaded: true, isVideo: true, useBlur: true })
    expect(got).not.toBeNull()
  })

  it('ignoreCache перебивает downloaded', () => {
    const got = getMediaThumbIfNeeded({ strippedThumb: STRIPPED, downloaded: true, ignoreCache: true, useBlur: true })
    expect(got).not.toBeNull()
  })

  it('useBlur:false — обычный <img> с data:-URI вместо канваса', () => {
    const got = getMediaThumbIfNeeded({ strippedThumb: STRIPPED, useBlur: false })
    expect(got!.image).toBeInstanceOf(HTMLImageElement)
    expect((got!.image as HTMLImageElement).src).toBe(`data:image/jpeg;base64,${STRIPPED}`)
  })

  it('useBlur:true — канвас блюра по тому же data:-URI', () => {
    const { image } = getImageFromStrippedThumb(STRIPPED, true)
    expect(image).toBeInstanceOf(HTMLCanvasElement)
    expect((image as HTMLCanvasElement).dataset.uri).toBe(`data:image/jpeg;base64,${STRIPPED}`)
  })
})
