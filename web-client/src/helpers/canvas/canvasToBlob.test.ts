// Порт tweb `src/tests/canvasToBlob.test.ts` (812502980, 508acd4f5).
import { describe, expect, it } from 'vitest'
import canvasToBlob from './canvasToBlob'

describe('canvasToBlob', () => {
  it('отдаёт закодированный blob', async() => {
    const blob = new Blob(['image'], { type: 'image/png' })
    const canvas = {
      toBlob: (callback: BlobCallback) => callback(blob),
    } as HTMLCanvasElement

    await expect(canvasToBlob(canvas, 'image/png')).resolves.toBe(blob)
  })

  it('отклоняется, если кодирование не удалось', async() => {
    const canvas = {
      toBlob: (callback: BlobCallback) => callback(null),
    } as HTMLCanvasElement

    await expect(canvasToBlob(canvas, 'image/png')).rejects.toThrow('Failed to encode canvas')
  })
})
