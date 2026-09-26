// Порт tweb `src/tests/copyMediaToClipboard.test.ts` (812502980, 508acd4f5).
// Скачивание — через `ensureMediaUrl` + `fetch` (адаптация в шапке
// `copyMediaToClipboard.ts`), поэтому подменены они, а не `appDownloadManager`.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureMediaUrl: vi.fn<(id: number, opts?: { thumb?: boolean }) => Promise<string>>(),
}))

vi.mock('@core/media/ensureMediaUrl', () => ({ ensureMediaUrl: mocks.ensureMediaUrl }))

vi.mock('@environment/imageMimeTypesSupport', () => ({
  default: new Set(['image/jpeg', 'image/png', 'image/bmp', 'image/webp']),
}))

import copyMediaToClipboard, { canCopyMediaToClipboard } from './copyMediaToClipboard'
import type { MyDocument, MyPhoto } from '@core/media/messageMedia'

class ClipboardItemMock {
  public static supports = vi.fn(() => true)

  constructor(public items: Record<string, Blob | Promise<Blob>>) {}
}

const doc = (id: number, mime_type: string) =>
  ({ _: 'document', id, mime_type, size: 1, attributes: [] }) satisfies MyDocument

describe('copyMediaToClipboard', () => {
  let write: ReturnType<typeof vi.fn>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    write = vi.fn((items: ClipboardItemMock[]) => items[0].items['image/png'])
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: ClipboardItemMock,
    })
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { write },
    })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mocks.ensureMediaUrl.mockResolvedValue('blob:full')
  })

  it('запись в буфер начинается раньше, чем докачается полный файл', async() => {
    let resolveDownload!: (blob: Blob) => void
    fetchMock.mockReturnValue(new Promise<{ blob: () => Promise<Blob> }>((resolve) => {
      resolveDownload = (blob) => resolve({ blob: () => Promise.resolve(blob) })
    }))

    const result = copyMediaToClipboard(doc(1, 'image/png'))

    expect(write).toHaveBeenCalledOnce()
    expect((write.mock.calls[0][0] as ClipboardItemMock[])[0].items['image/png']).toBeInstanceOf(Promise)

    const blob = new Blob(['full-size'], { type: 'image/png' })
    resolveDownload(blob)
    await expect(result).resolves.toBe(blob)
  })

  it('качает ПОЛНЫЙ файл фото, а не превью', async() => {
    const media = { _: 'photo', id: 2, sizes: [] } satisfies MyPhoto
    const blob = new Blob(['full-size'], { type: 'image/png' })
    fetchMock.mockResolvedValue({ blob: () => Promise.resolve(blob) })

    await copyMediaToClipboard(media)

    expect(mocks.ensureMediaUrl).toHaveBeenCalledWith(2)
    expect(fetchMock).toHaveBeenCalledWith('blob:full')
  })

  it('сбой старта загрузки отклоняет результат, а не бросает синхронно', async() => {
    const error = new Error('download failed')
    mocks.ensureMediaUrl.mockImplementationOnce(() => {
      throw error
    })

    const result = copyMediaToClipboard(doc(3, 'image/png'))

    expect(write).toHaveBeenCalledOnce()
    await expect(result).rejects.toBe(error)
  })

  it('предлагает только то, что пишется в буфер картинкой', () => {
    expect(canCopyMediaToClipboard(doc(4, 'video/mp4'))).toBe(false)
    expect(canCopyMediaToClipboard({ _: 'photo', id: 5, sizes: [] })).toBe(true)

    ClipboardItemMock.supports.mockReturnValueOnce(false)
    expect(canCopyMediaToClipboard(doc(6, 'image/png'))).toBe(false)
  })
})
