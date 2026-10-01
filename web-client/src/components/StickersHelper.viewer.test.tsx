// Предпросмотр по зажатию в подсказках стикеров — tweb chat/stickersHelper.ts:117-118
// (`attachStickerViewerListeners({listenTo: this.container, listenerSetter})`).
// Механика самого жеста — `stickerViewer.test.ts`; здесь — что хелпер его
// подключил к своему контейнеру и ячейки находятся селектором tweb.
//
// «Удержание» продвигает фейковые часы за порог 125 мс; «обычный клик» бьёт
// полную связку mousedown→mouseup→click без продвижения часов.
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
// Документ по `data-doc-id` — реестр воркера (`managers.docs.getDoc`); фикстуры
// проходят `saveDocument`, поэтому та же функция модуля их и находит.
vi.mock('@/client/bootstrap', async () => {
  const { getDoc } = await import('../core/media/messageMedia')
  return { startClient: () => ({ managers: { docs: { getDoc: async (id: number) => getDoc(id) } } }) }
})
vi.mock('@components/wrappers/sticker', () => ({
  default: (o: { div: HTMLElement }) => {
    const img = document.createElement('img')
    o.div.append(img)
    return { render: Promise.resolve(img), width: 0, height: 0, destroy: () => {} }
  },
}))

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

describe('StickersHelper — предпросмотр по зажатию ЛКМ (attachStickerViewerListeners)', () => {
  afterEach(cleanup)
  afterEach(() => vi.useRealTimers())

  it('долгое зажатие ЛКМ на ячейке стикера открывает предпросмотр, отпускание закрывает его; клик после такого удержания стикер НЕ отправляет', async () => {
    const onPick = vi.fn()
    const cell = await renderWithCell(onPick, [stk(1), stk(2)])

    // Фейковые часы включаем ПОСЛЕ waitFor выше — он сам опирается на реальные
    // таймеры (300мс-дебаунс useStickersByEmoji) для поллинга.
    vi.useFakeTimers()
    fireEvent.mouseDown(cell, { button: 0 })
    expect(document.querySelector('.sticker-viewer')).toBeNull() // порог ещё не истёк
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(document.querySelector('.sticker-viewer.is-visible')).not.toBeNull()

    fireEvent.mouseUp(document)
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(document.querySelector('.sticker-viewer')).toBeNull()

    fireEvent.click(cell)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('обычный клик по ячейке (mousedown→mouseup→click короче порога) по-прежнему отправляет стикер', async () => {
    const onPick = vi.fn()
    const cell = await renderWithCell(onPick, [stk(1)])

    fireEvent.mouseDown(cell, { button: 0 })
    fireEvent.mouseUp(document)
    expect(document.querySelector('.sticker-viewer')).toBeNull() // не мелькнул
    fireEvent.click(cell)

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0].id).toBe(1)
  })
})
