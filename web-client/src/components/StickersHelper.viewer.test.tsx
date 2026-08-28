// Task 2 (подключение useStickerViewer к StickersHelper) — tweb
// chat/stickersHelper.ts:118 (attachStickerViewerListeners({listenTo: this.container, ...})).
// Пустое имя файла StickersHelper.test.tsx уже занято под чистую функцию-гейт
// (StickersHelper.suggest.test.ts) — здесь только рендер-поведение предпросмотра.
//
// Порог показа (HOLD_THRESHOLD_MS, useStickerViewer.ts) — реальные 125мс:
// «удержание» продвигает фейковые часы, «обычный клик» бьёт полную связку
// mousedown→mouseup→click БЕЗ продвижения часов (синхронный fireEvent занимает
// ~0мс реального времени — короче порога, как и физический быстрый клик).
// Голый fireEvent.click(cell) без предшествующих mousedown/mouseup не ловит
// регрессию глушения — ревью V2 на подключении хука к хостам.
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import StickersHelper from './StickersHelper'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'
import type { Sticker } from '../core/managers/stickersManager'
import { makeSticker } from '../core/stickers/testSticker'

// Реальный рендер стикера (fetch/декод) — предмет StickerMedia.test.tsx, здесь
// важен только факт «ячейка есть и предпросмотр её подхватывает».
vi.mock('./StickerMedia', () => ({ default: () => <div data-testid="sticker-media" /> }))

const stk = (id: number): Sticker => makeSticker({ id, setId: 1, emoji: '🦆', mime: 'application/x-tgsticker' })

function makeManagers(result: Sticker[]) {
  const stickers = { searchByEmoji: vi.fn().mockResolvedValue(result) }
  return { managers: { stickers } as unknown as Managers }
}

async function renderWithCell(onPick: (st: Sticker) => void, result: Sticker[]) {
  const { managers } = makeManagers(result)
  render(
    <ManagersProvider managers={managers}>
      <StickersHelper emoji="🦆" onPick={onPick} />
    </ManagersProvider>,
  )
  const cell = await waitFor(() => {
    const el = document.querySelector('.grid-item.super-sticker')
    expect(el).not.toBeNull()
    return el as HTMLElement
  })
  return cell
}

describe('StickersHelper — предпросмотр по зажатию ЛКМ (useStickerViewer)', () => {
  afterEach(cleanup)
  afterEach(() => vi.useRealTimers())

  it('долгое зажатие ЛКМ на ячейке стикера открывает предпросмотр, отпускание закрывает его; клик после такого удержания стикер НЕ отправляет', async () => {
    const onPick = vi.fn()
    const cell = await renderWithCell(onPick, [stk(1), stk(2)])

    // Фейковые часы включаем ПОСЛЕ waitFor выше — он сам опирается на реальные
    // таймеры (300мс-дебаунс useStickersByEmoji) для поллинга.
    vi.useFakeTimers()
    fireEvent.mouseDown(cell, { button: 0 })
    expect(document.querySelector('[data-testid="sticker-viewer"]')).toBeNull() // порог ещё не истёк
    void act(() => vi.advanceTimersByTime(150))
    expect(document.querySelector('[data-testid="sticker-viewer"]')).not.toBeNull()

    fireEvent.mouseUp(document)
    expect(document.querySelector('[data-testid="sticker-viewer"]')).toBeNull()

    fireEvent.click(cell)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('обычный клик по ячейке (mousedown→mouseup→click короче порога) по-прежнему отправляет стикер', async () => {
    const onPick = vi.fn()
    const cell = await renderWithCell(onPick, [stk(1)])

    fireEvent.mouseDown(cell, { button: 0 })
    fireEvent.mouseUp(document)
    expect(document.querySelector('[data-testid="sticker-viewer"]')).toBeNull() // не мелькнул
    fireEvent.click(cell)

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0].id).toBe(1)
  })
})
