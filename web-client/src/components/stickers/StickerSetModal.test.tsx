import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StickerSetModal from './StickerSetModal'
import animationIntersector from '../animationIntersector'

// Сетка попапа ленивая (tweb LazyLoadQueue): медиа монтируется только видимой
// ячейке. happy-dom класс IntersectionObserver определяет, но записей никогда
// не порождает — поэтому здесь стаб, который объявляет видимыми первые
// `ioVisibleLimit` наблюдаемых ячеек.
let ioVisibleLimit = Infinity
let ioObserved = 0
class TestIntersectionObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) {
    if (ioObserved++ >= ioVisibleLimit) return
    this.cb([{ target: el, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)

const set = { id: 7, slug: 'utyaduck', title: 'Duck', kind: 'sticker' as const, count: 40 }
const stickers = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1, setId: 7, mediaId: 100 + i, emoji: '🦆', position: i,
  width: 512, height: 512, mime: 'application/x-tgsticker',
}))

const install = vi.fn().mockResolvedValue(undefined)
const uninstall = vi.fn().mockResolvedValue(undefined)
let installed: typeof set[] = []

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="sticker" data-media={mediaId} />,
}))
vi.mock('../../core/hooks/useManagers', () => ({
  useManagers: () => ({
    stickers: {
      setBySlug: async () => ({ set, stickers }),
      mySets: async () => installed,
      install,
      uninstall,
    },
  }),
}))

describe('StickerSetModal', () => {
  // В проекте нет глобального автоклинапа testing-library — несколько
  // render() в одном файле без cleanup() оставляют предыдущие DOM-деревья и
  // ломают getByRole/getByText следующего теста.
  afterEach(cleanup)

  beforeEach(() => {
    installed = []
    install.mockClear()
    uninstall.mockClear()
    ioVisibleLimit = Infinity
    ioObserved = 0
  })

  it('показывает заголовок набора и кнопку с числом стикеров', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())
    expect(screen.getByRole('button', { name: /добавить 40 стикеров/i })).toBeTruthy()
  })

  it('рисует все стикеры набора', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    await waitFor(() => expect(screen.getAllByTestId('sticker')).toHaveLength(40))
  })

  // Регрессия: сетка рендерила StickerMedia сразу всем стикерам набора, а он
  // фетчит файл на маунте — открытие набора на 120 стикеров запускало 120
  // параллельных загрузок и декодов. tweb на этом же попапе заводит
  // LazyLoadQueue (popups/stickers.tsx:196) и отдаёт её каждому wrapSticker.
  it('медиа грузят только видимые ячейки; сами ячейки сетки на месте все', async () => {
    ioVisibleLimit = 3
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)

    await waitFor(() => expect(document.querySelectorAll('.sticker-set-sticker')).toHaveLength(40))
    expect(screen.getAllByTestId('sticker')).toHaveLength(3)
  })

  // Пока набор грузится, tweb кладёт в тело попапа putPreloader
  // (popups/stickers.tsx:339-342) — у попапа уже есть свои заголовок и кнопка,
  // и «скелет набора» дорисовывал бы фантомную вторую пару.
  it('на время загрузки — прелоадер tweb в теле .is-loading, без заглушки набора', () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    const body = document.querySelector('.popup-body')!
    expect(body.classList.contains('is-loading')).toBe(true)
    expect(body.querySelector(':scope > .preloader > svg.preloader-circular')).not.toBeNull()
    expect(document.querySelector('[data-testid="sticker-set-skeleton"]')).toBeNull()
  })

  it('добавляет набор по клику на кнопку', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    const button = await screen.findByRole('button', { name: /добавить 40 стикеров/i })
    fireEvent.click(button)
    expect(install).toHaveBeenCalledWith(7)
  })

  it('у установленного набора кнопка удаляет набор — с числом и падежом, как в tweb', async () => {
    installed = [set]
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    const button = await screen.findByRole('button', { name: /удалить 40 стикеров/i })
    fireEvent.click(button)
    expect(uninstall).toHaveBeenCalledWith(7)
    expect(install).not.toHaveBeenCalled()
  })

  // mousedown→mouseup→click (не голый click) — та же связка, которой браузер
  // физически рождает обычный клик; после подключения useStickerViewer (Task 2)
  // именно она проходит через хук предпросмотра первой (см. «долгое зажатие...»
  // ниже) — голый fireEvent.click эту связку не проверяет (ревью V2).
  it('клик по стикеру (mousedown→mouseup→click) шлёт его через onPickSticker и закрывает попап (tweb onStickersClick)', async () => {
    const onPickSticker = vi.fn()
    const onClose = vi.fn()
    render(<StickerSetModal slug="utyaduck" onClose={onClose} onPickSticker={onPickSticker} />)
    await waitFor(() => expect(screen.getAllByTestId('sticker')).toHaveLength(40))
    // сетка кликабельна — без is-read-only, когда есть колбэк отправки
    expect(document.querySelector('.sticker-set-stickers')!.classList.contains('is-read-only')).toBe(false)
    const cell = document.querySelector('.sticker-set-sticker')!
    fireEvent.mouseDown(cell, { button: 0 })
    fireEvent.mouseUp(document)
    expect(screen.queryByTestId('sticker-viewer')).toBeNull() // не мелькнул
    fireEvent.click(cell)
    expect(onPickSticker).toHaveBeenCalledTimes(1)
    expect(onPickSticker.mock.calls[0][0].mediaId).toBe(100)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('без onPickSticker сетка помечена is-read-only и клик по стикеру ничего не делает', async () => {
    const onClose = vi.fn()
    render(<StickerSetModal slug="utyaduck" onClose={onClose} />)
    await waitFor(() => expect(screen.getAllByTestId('sticker')).toHaveLength(40))
    expect(document.querySelector('.sticker-set-stickers')!.classList.contains('is-read-only')).toBe(true)
    fireEvent.click(document.querySelector('.sticker-set-sticker')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  // Task 2 (подключение useStickerViewer): tweb popups/stickers.tsx:310 —
  // attachStickerViewerListeners на том же скроллере, что и сетка. Обычный
  // клик (короче порога показа) уже проверен тестом выше («клик по стикеру
  // (mousedown→mouseup→click)...») — здесь именно жест удержания, дольше
  // HOLD_THRESHOLD_MS (useStickerViewer.ts) — фейковые часы продвигают
  // реальное время, поэтому оверлей успевает открыться.
  it('долгое зажатие ЛКМ на стикере открывает предпросмотр (tweb popups/stickers.tsx:310), отпускание закрывает его; клик после такого удержания стикер НЕ отправляет', async () => {
    const onPickSticker = vi.fn()
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} onPickSticker={onPickSticker} />)
    await waitFor(() => expect(screen.getAllByTestId('sticker')).toHaveLength(40))

    // Фейковые часы включаем ПОСЛЕ waitFor выше — он сам опирается на реальные
    // таймеры для поллинга.
    vi.useFakeTimers()
    try {
      const cell = document.querySelector('.sticker-set-sticker')!
      fireEvent.mouseDown(cell, { button: 0 })
      expect(screen.queryByTestId('sticker-viewer')).toBeNull() // порог ещё не истёк
      void act(() => vi.advanceTimersByTime(150))
      expect(screen.getByTestId('sticker-viewer')).toBeTruthy()

      fireEvent.mouseUp(document)
      expect(screen.queryByTestId('sticker-viewer')).toBeNull()

      fireEvent.click(cell)
      expect(onPickSticker).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('пока попап открыт, играет только его группа animationIntersector; на закрытии — сброс', async () => {
    const spy = vi.spyOn(animationIntersector, 'setOnlyOnePlayableGroup')
    const { unmount } = render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())
    expect(spy).toHaveBeenCalledWith('STICKERS-POPUP')
    unmount()
    expect(spy).toHaveBeenLastCalledWith()
    spy.mockRestore()
  })
})
