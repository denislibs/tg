// useStickerViewer — тесты жеста «зажал ЛКМ → стикер увеличивается поверх
// затемнения → отпустил → закрылось, не отправив». Референс — tweb
// components/stickerViewer.ts (см. комментарии в useStickerViewer.ts).
//
// StickerMedia замокан, как и в StickerSetModal.test.tsx: реальный рендер
// стикера (fetch байтов, lottie/webm-декод) — предмет собственных тестов
// StickerMedia.test.tsx, здесь важен только факт «оверлей показывает ТОТ
// стикер», не как он отрисован внутри.
import { render, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useStickerViewer } from './useStickerViewer'
import animationIntersector from '../animationIntersector'
import type { Sticker } from '../../core/managers/stickersManager'

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="sticker-media" data-media={mediaId} />,
}))

const stickers: Sticker[] = [
  { id: 1, setId: 1, mediaId: 101, emoji: '🦆', width: 512, height: 512, mime: 'application/x-tgsticker', thumb: '' },
  { id: 2, setId: 1, mediaId: 102, emoji: '🐸', width: 512, height: 512, mime: 'application/x-tgsticker', thumb: '' },
  { id: 3, setId: 1, mediaId: 103, emoji: '🐱', width: 512, height: 512, mime: 'application/x-tgsticker', thumb: '' },
]

/** Тестовый хост — список из трёх ячеек с `data-sticker-id`. */
function TestHost({ onPick }: { onPick: (st: Sticker) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const overlay = useStickerViewer({
    rootRef,
    findSticker: (el) => {
      const cell = el.closest('[data-sticker-id]') as HTMLElement | null
      if (!cell) return undefined
      const id = Number(cell.dataset.stickerId)
      return stickers.find((st) => st.id === id)
    },
  })

  return (
    <>
      <div ref={rootRef}>
        {stickers.map((st) => (
          <div key={st.id} data-testid={`cell-${st.id}`} data-sticker-id={st.id} onClick={() => onPick(st)}>
            {st.emoji}
          </div>
        ))}
      </div>
      {overlay}
    </>
  )
}

describe('useStickerViewer', () => {
  // В проекте нет глобального автоклинапа testing-library — несколько render()
  // в одном файле без cleanup() оставляют предыдущие DOM-деревья и путают
  // querySelector/getByTestId следующего теста.
  afterEach(cleanup)
  // animationIntersector — модульный синглтон, общий с другими тестовыми
  // файлами (например, StickerSetModal.test.tsx): падение теста ДО mouseup не
  // должно оставлять его залоченным на 'STICKER-VIEWER' для чужих тестов.
  afterEach(() => animationIntersector.setOnlyOnePlayableGroup(''))

  it('зажатие на ячейке открывает предпросмотр', () => {
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })

    const viewer = queryByTestId('sticker-viewer')
    expect(viewer).not.toBeNull()
    expect(viewer!.querySelector('[data-testid="sticker-media"]')?.getAttribute('data-media')).toBe('101')
  })

  it('отпускание закрывает предпросмотр', () => {
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    expect(queryByTestId('sticker-viewer')).not.toBeNull()

    fireEvent.mouseUp(document)
    expect(queryByTestId('sticker-viewer')).toBeNull()
  })

  it('правая кнопка не открывает предпросмотр', () => {
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 2 })

    expect(queryByTestId('sticker-viewer')).toBeNull()
  })

  // Глушение зависит от длительности удержания (HOLD_THRESHOLD_MS) — без этого
  // порога глушился бы КАЖДЫЙ клик (обычный клик — те же mousedown→mouseup,
  // которыми браузер и порождает сам click), и отправка/открытие модалки
  // стикера кликом отказывали бы всегда. Порог — реальное время (`Date.now()`),
  // поэтому тест продвигает часы фейковым таймером между mousedown и mouseup,
  // а не полагается на то, сколько реального времени займёт сам fireEvent.
  it('клик после НАСТОЯЩЕГО удержания (дольше порога) проглатывается', () => {
    vi.useFakeTimers()
    try {
      const onPick = vi.fn()
      const { getByTestId } = render(<TestHost onPick={onPick} />)

      fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
      vi.advanceTimersByTime(200)
      fireEvent.mouseUp(document)
      fireEvent.click(getByTestId('cell-1'))

      expect(onPick).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('обычный клик без удержания стикер отправляет', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.click(getByTestId('cell-1'))

    expect(onPick).toHaveBeenCalledWith(stickers[0])
  })

  // Регрессия найдена при подключении хука к реальным хостам (Task 2): реальный
  // клик мышью — это ФИЗИЧЕСКИ та же пара mousedown→mouseup, что и удержание.
  // Без порога на длительность (см. HOLD_THRESHOLD_MS) быстрый клик глушился
  // бы точно так же, как настоящий hold, — отправка стикера кликом была бы
  // сломана целиком, во всех хостах разом.
  it('быстрый клик (mousedown→mouseup без реальной задержки, затем click) НЕ глушится', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    fireEvent.mouseUp(document)
    fireEvent.click(getByTestId('cell-1'))

    expect(onPick).toHaveBeenCalledWith(stickers[0])
  })

  it('движение мыши над другой ячейкой переключает предпросмотр, не отпуская кнопку', () => {
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    fireEvent.mouseMove(getByTestId('cell-3'))

    const viewer = queryByTestId('sticker-viewer')
    expect(viewer).not.toBeNull()
    expect(viewer!.querySelector('[data-testid="sticker-media"]')?.getAttribute('data-media')).toBe('103')
  })

  // tweb stickerViewer.ts:198-201,372-373 — на время предпросмотра играет
  // ТОЛЬКО его группа (фон замирает), а на закрытии возвращается ИМЕННО
  // прежняя группа (не жёсткий сброс) — предпросмотр мог открыться поверх
  // уже запертого экрана.
  it('на время удержания играет только группа STICKER-VIEWER', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })

    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('STICKER-VIEWER')
  })

  it('на отпускание возвращается прежняя группа animationIntersector, а не пустая', () => {
    const onPick = vi.fn()
    animationIntersector.setOnlyOnePlayableGroup('chat')
    const { getByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('STICKER-VIEWER')

    fireEvent.mouseUp(document)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('chat')
  })

  it('размонтирование во время удержания тоже возвращает прежнюю группу', () => {
    const onPick = vi.fn()
    animationIntersector.setOnlyOnePlayableGroup('chat')
    const { getByTestId, unmount } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('STICKER-VIEWER')

    unmount()
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('chat')
  })
})
