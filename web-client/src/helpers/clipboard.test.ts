// Порт tweb `src/tests/clipboard.test.ts` (812502980, 508acd4f5) в части
// записи `ClipboardItem`. Третий кейс оригинала («тот же писатель для HTML-
// текста») не переносится: html-варианта `copyTextToClipboard` у нас нет
// (шапка `clipboard.ts`).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canWriteClipboardItem, writeClipboardItem } from './clipboard'

class ClipboardItemMock {
  public static supports = vi.fn(() => true)

  constructor(public items: Record<string, Blob | Promise<Blob>>) {}
}

describe('запись ClipboardItem', () => {
  let write: ReturnType<typeof vi.fn>

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
  })

  it('перед предложением записи спрашивает поддержку mime', () => {
    expect(canWriteClipboardItem('image/png')).toBe(true)

    ClipboardItemMock.supports.mockReturnValueOnce(false)
    expect(canWriteClipboardItem('image/png')).toBe(false)
  })

  it('без ClipboardItem у окна записи нет', () => {
    Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: undefined })

    expect(canWriteClipboardItem('image/png')).toBe(false)
    expect(() => writeClipboardItem({ 'image/png': new Blob() })).toThrow('Clipboard item writing is not supported')
  })

  it('запись ожидающего blob начинается в том же тике пользовательского жеста', async() => {
    const blob = new Blob(['image'], { type: 'image/png' })
    const blobPromise = Promise.resolve(blob)

    const result = writeClipboardItem({ 'image/png': blobPromise })

    expect(write).toHaveBeenCalledOnce()
    expect((write.mock.calls[0][0] as ClipboardItemMock[])[0].items['image/png']).toBe(blobPromise)
    await expect(result).resolves.toBe(blob)
  })
})
