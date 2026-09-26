import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scaleImageForSend } from './scaleImageForSend'

// Натуральные размеры «картинки» привязаны к File (happy-dom не декодирует).
const naturalSizes = new WeakMap<Blob, { w: number; h: number }>()

function makeFile(name: string, type: string, size: number, w: number, h: number): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  naturalSizes.set(f, { w, h })
  return f
}

let toBlobCalls: Array<{ type?: string; quality?: number }>
let realCreateElement: typeof document.createElement
/** Вес закодированного результата по качеству — по умолчанию крошечный. */
let encodedSize: (quality?: number) => number

beforeEach(() => {
  toBlobCalls = []
  encodedSize = () => 3

  // createImageBitmap: с resizeWidth/Height — отдаёт бокс ресайза, иначе —
  // натуральный размер файла (probe).
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: Blob, opts?: { resizeWidth?: number; resizeHeight?: number }) => {
      if (opts?.resizeWidth != null) return { width: opts.resizeWidth, height: opts.resizeHeight, close: () => {} }
      const nat = naturalSizes.get(file) ?? { w: 0, h: 0 }
      return { width: nat.w, height: nat.h, close: () => {} }
    }),
  )

  // canvas-заглушка: happy-dom не реализует 2d-контекст/toBlob.
  realCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') {
      const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => {
          toBlobCalls.push({ type, quality })
          const out = new File(['out'], 'out', { type })
          Object.defineProperty(out, 'size', { value: encodedSize(quality) })
          cb(out)
        },
      } as unknown as HTMLCanvasElement
    }
    return realCreateElement(tag)
  }) as typeof document.createElement)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('scaleImageForSend', () => {
  it('ресайзит и конвертит в jpeg картинку со стороной > 2560', async () => {
    const file = makeFile('big.png', 'image/png', 500_000, 4000, 2000)
    const out = await scaleImageForSend(file)
    expect(out.width).toBe(2560)
    expect(out.height).toBe(1280)
    expect(out.file.type).toBe('image/jpeg')
    expect(out.file.name).toBe('big.jpg')
    expect(out.file).not.toBe(file)
    // чистый ресайз → near-lossless (quality=1), не 0.9
    expect(toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 1 }])
  })

  it('маленький совместимый jpeg (<2560) возвращает как есть, без перекода', async () => {
    const file = makeFile('small.jpg', 'image/jpeg', 100_000, 800, 600)
    const out = await scaleImageForSend(file)
    expect(out.file).toBe(file)
    expect(out.width).toBe(800)
    expect(out.height).toBe(600)
    expect(toBlobCalls).toHaveLength(0)
  })

  it('тяжёлый png (>2МБ) конвертит в jpeg с quality 0.9 без ресайза', async () => {
    const file = makeFile('heavy.png', 'image/png', 3 * 1024 * 1024, 1000, 1000)
    const out = await scaleImageForSend(file)
    expect(out.width).toBe(1000)
    expect(out.height).toBe(1000)
    expect(out.file.type).toBe('image/jpeg')
    expect(toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 0.9 }])
  })

  // tweb 6af482b82 (newMedia.tsx `PHOTO_MAX_BYTES`): вес исходника предсказывает
  // вес результата только для png/bmp. Детализированный lossy-исходник (webp,
  // heic, avif) мал на диске, а на качестве 1 кодируется в ~12 МБ — сервер
  // отвечает PHOTO_SAVE_FILE_INVALID. Результат взвешивается, и только
  // перевесивший бюджет кодируется второй раз со сжатием.
  it('результат тяжелее 6 МБ кодируется второй раз с quality 0.9', async () => {
    encodedSize = (quality) => (quality === 1 ? 12 * 1024 * 1024 : 2 * 1024 * 1024)
    const file = makeFile('detailed.webp', 'image/webp', 400_000, 2560, 1440)
    const out = await scaleImageForSend(file)
    expect(toBlobCalls).toEqual([
      { type: 'image/jpeg', quality: 1 },
      { type: 'image/jpeg', quality: 0.9 },
    ])
    expect(out.file.type).toBe('image/jpeg')
  })

  it('влезший в бюджет результат второй раз не кодируется', async () => {
    encodedSize = () => 6 * 1024 * 1024
    const file = makeFile('photo.webp', 'image/webp', 400_000, 2000, 1000)
    await scaleImageForSend(file)
    expect(toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 1 }])
  })

  it('тяжёлый png уже сжат с 0.9 — третьего прохода нет, даже если результат большой', async () => {
    encodedSize = () => 8 * 1024 * 1024
    const file = makeFile('heavy.png', 'image/png', 3 * 1024 * 1024, 2000, 2000)
    await scaleImageForSend(file)
    expect(toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 0.9 }])
  })

  it('gif не трогает', async () => {
    const file = makeFile('anim.gif', 'image/gif', 5 * 1024 * 1024, 500, 500)
    const out = await scaleImageForSend(file)
    expect(out.file).toBe(file)
    expect(out.width).toBe(500)
    expect(out.height).toBe(500)
    expect(toBlobCalls).toHaveLength(0)
  })

  it('несовместимый формат (webp) конвертит в jpeg с расширением .jpg', async () => {
    const file = makeFile('sticker.webp', 'image/webp', 100_000, 800, 600)
    const out = await scaleImageForSend(file)
    expect(out.file.type).toBe('image/jpeg')
    expect(out.file.name).toBe('sticker.jpg')
    expect(out.file).not.toBe(file)
    expect(out.width).toBe(800)
    expect(out.height).toBe(600)
    // конвертация без ресайза → near-lossless (quality=1)
    expect(toBlobCalls).toEqual([{ type: 'image/jpeg', quality: 1 }])
  })

  it('битый/недекодируемый файл (HEIC) отдаёт исходный файл, не роняя отправку', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode failed') }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const file = makeFile('photo.heic', 'image/heic', 200_000, 0, 0)
    const out = await scaleImageForSend(file)
    expect(out.file).toBe(file)
    expect(out.width).toBe(0)
    expect(out.height).toBe(0)
    expect(toBlobCalls).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
