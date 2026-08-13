// Кэш первых кадров: у lottie/webm бэк растрового превью не отдаёт, поэтому
// нижний слой следующего показа — кадр, сохранённый этим кэшем. Пропадёт кэш —
// вернётся пустая ячейка до первого декодированного кадра.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getStickerThumb,
  isSavingStickerThumb,
  resetStickerThumbs,
  saveStickerThumb,
  saveStickerThumbFromPlayer,
} from './stickerThumbs'
import type LottiePlayer from '@lib/lottie/lottiePlayer'

/** happy-dom не рисует — canvas подменяем объектом с нужной формой. */
function fakeCanvas(width: number, height: number, blob: Blob | null = new Blob(['x'])) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.toBlob = (cb: BlobCallback) => cb(blob)
  return canvas
}

let created = 0
beforeEach(() => {
  resetStickerThumbs()
  created = 0
  URL.createObjectURL = vi.fn(() => `blob:thumb-${++created}`) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
})

describe('stickerThumbs', () => {
  it('сохранённый кадр отдаётся следующему показу', async () => {
    expect(getStickerThumb(7)).toBeUndefined()

    await saveStickerThumb(7, fakeCanvas(120, 90))

    expect(getStickerThumb(7)).toEqual({ url: 'blob:thumb-1', w: 120, h: 90 })
  })

  it('кадр меньшего размера не затирает уже сохранённый больший', async () => {
    await saveStickerThumb(7, fakeCanvas(120, 90))
    await saveStickerThumb(7, fakeCanvas(60, 45))

    expect(getStickerThumb(7)?.w).toBe(120)
  })

  it('больший кадр вытесняет меньший и освобождает его objectURL', async () => {
    await saveStickerThumb(7, fakeCanvas(60, 45))
    await saveStickerThumb(7, fakeCanvas(240, 180))

    expect(getStickerThumb(7)).toEqual({ url: 'blob:thumb-2', w: 240, h: 180 })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1')
  })

  it('пустой blob не создаёт битую запись', async () => {
    await saveStickerThumb(7, fakeCanvas(120, 90, null))
    expect(getStickerThumb(7)).toBeUndefined()
  })

  it('offscreen-плеер: кадр выгружается из воркера и закрывается', async () => {
    const frame = { width: 100, height: 100, close: vi.fn() }
    const player = {
      offscreen: 'canvas',
      width: 100,
      height: 100,
      canvas: [],
      exportFrame: vi.fn(async () => ({ frame })),
    } as unknown as LottiePlayer

    await saveStickerThumbFromPlayer(11, player)

    expect(player.exportFrame).toHaveBeenCalled()
    expect(frame.close).toHaveBeenCalled()
    expect(isSavingStickerThumb(11, 100, 100)).toBe(true)
  })

  it('offscreen-плеер: bitmap не выгружается, если кадр уже сохранён', async () => {
    const player = {
      offscreen: 'canvas',
      width: 100,
      height: 100,
      canvas: [],
      exportFrame: vi.fn(),
    } as unknown as LottiePlayer

    await saveStickerThumb(12, fakeCanvas(100, 100))
    await saveStickerThumbFromPlayer(12, player)

    expect(player.exportFrame).not.toHaveBeenCalled()
  })

  it('legacy-плеер: кадр берётся с его canvas без обращения к воркеру', async () => {
    const player = {
      offscreen: false,
      width: 64,
      height: 64,
      canvas: [fakeCanvas(64, 64)],
      exportFrame: vi.fn(),
    } as unknown as LottiePlayer

    await saveStickerThumbFromPlayer(13, player)

    expect(player.exportFrame).not.toHaveBeenCalled()
    expect(getStickerThumb(13)?.w).toBe(64)
  })

  it('упавшая выгрузка кадра не роняет показ', async () => {
    const player = {
      offscreen: 'canvas',
      width: 100,
      height: 100,
      canvas: [],
      exportFrame: vi.fn(async () => {
        throw new Error('worker died')
      }),
    } as unknown as LottiePlayer

    await expect(saveStickerThumbFromPlayer(14, player)).resolves.toBeUndefined()
    expect(getStickerThumb(14)).toBeUndefined()
  })
})
