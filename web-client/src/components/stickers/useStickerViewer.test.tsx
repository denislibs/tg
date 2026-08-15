// useStickerViewer — тесты жеста «зажал ЛКМ дольше порога → стикер увеличивается
// поверх затемнения → отпустил → закрылось, не отправив; отпустил РАНЬШЕ порога —
// обычный быстрый клик, оверлей ни разу не показывается». Референс — tweb
// components/stickerViewer.ts (см. комментарии в useStickerViewer.ts).
//
// Все сценарии, где важно «прошёл ли порог», используют `vi.useFakeTimers()` +
// `vi.advanceTimersByTime` — реальный hold в браузере занимает секунды, а показ
// в хуке отложен ровно на HOLD_THRESHOLD_MS (125мс, см. константу в хуке).
// Продвигаем на 130мс (чуть больше порога), чтобы не зависеть от того, что
// внутренний таймер выставлен ровно в 125, а не «примерно столько же».
//
// StickerMedia замокан, как и в StickerSetModal.test.tsx: реальный рендер
// стикера (fetch байтов, lottie/webm-декод) — предмет собственных тестов
// StickerMedia.test.tsx, здесь важен только факт «оверлей показывает ТОТ
// стикер», не как он отрисован внутри.
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useStickerViewer } from './useStickerViewer'
import animationIntersector from '../animationIntersector'
import type { Sticker } from '../../core/managers/stickersManager'

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="sticker-media" data-media={mediaId} />,
}))

const PAST_THRESHOLD_MS = 130

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
  // На случай теста, упавшего между `vi.useFakeTimers()` и `vi.useRealTimers()`.
  afterEach(() => vi.useRealTimers())

  it('зажатие дольше порога открывает предпросмотр', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    expect(queryByTestId('sticker-viewer')).toBeNull() // порог ещё не истёк
    void act(() => vi.advanceTimersByTime(PAST_THRESHOLD_MS))

    const viewer = queryByTestId('sticker-viewer')
    expect(viewer).not.toBeNull()
    expect(viewer!.querySelector('[data-testid="sticker-media"]')?.getAttribute('data-media')).toBe('101')
  })

  // tweb stickerViewer.ts:243 — показ ОТЛОЖЕН порогом, а не мгновенный: это и
  // есть механизм, которым обычный клик отличается от намеренного удержания
  // (до ревью V2 хук показывал оверлей сразу на mousedown — StickerMedia
  // 360×360 монтировался и тут же размонтировался на КАЖДОМ клике по стикеру).
  it('отпускание раньше порога закрывает без единого показа оверлея', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    fireEvent.mouseUp(document)
    expect(queryByTestId('sticker-viewer')).toBeNull()

    // Даже если после отпускания дать таймерам поработать — открытие уже
    // отменено в onMouseUp, оверлей не появится задним числом.
    void act(() => vi.advanceTimersByTime(PAST_THRESHOLD_MS))
    expect(queryByTestId('sticker-viewer')).toBeNull()
  })

  it('отпускание ПОСЛЕ открытия закрывает предпросмотр', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    void act(() => vi.advanceTimersByTime(PAST_THRESHOLD_MS))
    expect(queryByTestId('sticker-viewer')).not.toBeNull()

    fireEvent.mouseUp(document)
    expect(queryByTestId('sticker-viewer')).toBeNull()
  })

  it('правая кнопка не открывает предпросмотр', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 2 })
    void act(() => vi.advanceTimersByTime(PAST_THRESHOLD_MS))

    expect(queryByTestId('sticker-viewer')).toBeNull()
  })

  // Критерий глушения — «оверлей реально был показан» (tweb `if(container)`),
  // а не отдельно отсчитанная длительность удержания: продвигаем таймеры за
  // порог, ЧТОБЫ оверлей успел открыться, — глушение следует из этого факта.
  it('клик после НАСТОЯЩЕГО удержания (оверлей успел открыться) проглатывается', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    const { getByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    void act(() => vi.advanceTimersByTime(PAST_THRESHOLD_MS))
    fireEvent.mouseUp(document)
    fireEvent.click(getByTestId('cell-1'))

    expect(onPick).not.toHaveBeenCalled()
  })

  it('обычный клик без удержания стикер отправляет', () => {
    const onPick = vi.fn()
    const { getByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.click(getByTestId('cell-1'))

    expect(onPick).toHaveBeenCalledWith(stickers[0])
  })

  // Регрессия найдена при подключении хука к реальным хостам (Task 2): реальный
  // клик мышью — это ФИЗИЧЕСКИ та же пара mousedown→mouseup, что и удержание,
  // и притом короче порога (60-100мс < 125мс). Оверлей поэтому не должен успеть
  // открыться вовсе, а не просто «открыться и не глушить click».
  it('быстрый клик (mousedown→mouseup раньше порога, затем click) НЕ глушится', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    fireEvent.mouseUp(document)
    expect(queryByTestId('sticker-viewer')).toBeNull() // не мелькнул
    fireEvent.click(getByTestId('cell-1'))

    expect(onPick).toHaveBeenCalledWith(stickers[0])
  })

  it('движение мыши ДО открытия (порог не истёк) не переключает и не открывает предпросмотр', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    fireEvent.mouseMove(getByTestId('cell-3'))

    expect(queryByTestId('sticker-viewer')).toBeNull()
  })

  it('движение мыши над другой ячейкой переключает предпросмотр, не отпуская кнопку', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    const { getByTestId, queryByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    void act(() => vi.advanceTimersByTime(PAST_THRESHOLD_MS))
    fireEvent.mouseMove(getByTestId('cell-3'))

    const viewer = queryByTestId('sticker-viewer')
    expect(viewer).not.toBeNull()
    expect(viewer!.querySelector('[data-testid="sticker-media"]')?.getAttribute('data-media')).toBe('103')
  })

  // tweb stickerViewer.ts:198-201,372-373 — на время предпросмотра играет
  // ТОЛЬКО его группа (фон замирает), а на закрытии возвращается ИМЕННО
  // прежняя группа (не жёсткий сброс) — предпросмотр мог открыться поверх
  // уже запертого экрана.
  it('на время показа играет только группа STICKER-VIEWER', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    const { getByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    void act(() => vi.advanceTimersByTime(PAST_THRESHOLD_MS))

    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('STICKER-VIEWER')
  })

  // Обычный быстрый клик не должен трогать лок анимаций вообще — раньше
  // (до ревью V2) он ставился на mousedown безусловно, то есть на каждом клике
  // фон ленты/панели на мгновение замирал и тут же размораживался.
  it('лок анимаций НЕ трогается, если отпустили раньше порога', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    animationIntersector.setOnlyOnePlayableGroup('chat')
    const { getByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    fireEvent.mouseUp(document)

    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('chat')
  })

  it('на отпускание после открытия возвращается прежняя группа animationIntersector, а не пустая', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    animationIntersector.setOnlyOnePlayableGroup('chat')
    const { getByTestId } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    void act(() => vi.advanceTimersByTime(PAST_THRESHOLD_MS))
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('STICKER-VIEWER')

    fireEvent.mouseUp(document)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('chat')
  })

  it('размонтирование во время показа возвращает прежнюю группу', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    animationIntersector.setOnlyOnePlayableGroup('chat')
    const { getByTestId, unmount } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    void act(() => vi.advanceTimersByTime(PAST_THRESHOLD_MS))
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('STICKER-VIEWER')

    unmount()
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('chat')
  })

  // Размонтирование ДО истечения порога — таймер открытия должен сняться в
  // cleanup эффекта, иначе он выстрелил бы после того, как компонент уже
  // размонтирован (сеттеры уже отвязанного стейта).
  it('размонтирование ДО открытия снимает отложенный таймер, не трогая лок анимаций', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()
    animationIntersector.setOnlyOnePlayableGroup('chat')
    const { getByTestId, unmount } = render(<TestHost onPick={onPick} />)

    fireEvent.mouseDown(getByTestId('cell-1'), { button: 0 })
    unmount()

    void act(() => vi.advanceTimersByTime(PAST_THRESHOLD_MS))
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('chat')
  })
})
