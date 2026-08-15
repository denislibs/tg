// Task 2 (подключение useStickerViewer к StickersHelper) — tweb
// stickersHelper.ts:118 (attachStickerViewerListeners({listenTo: this.container, ...})).
// Пустое имя файла StickersHelper.test.tsx уже занято под чистую функцию-гейт
// (StickersHelper.suggest.test.ts) — здесь только рендер-поведение предпросмотра.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import StickersHelper from './StickersHelper'
import { ManagersProvider } from '../core/hooks/useManagers'
import type { Managers } from '../client/bootstrap'
import type { Sticker } from '../core/managers/stickersManager'

// Реальный рендер стикера (fetch/декод) — предмет StickerMedia.test.tsx, здесь
// важен только факт «ячейка есть и предпросмотр её подхватывает».
vi.mock('./StickerMedia', () => ({ default: () => <div data-testid="sticker-media" /> }))

const stk = (id: number): Sticker => ({
  id,
  setId: 1,
  mediaId: 100 + id,
  emoji: '🦆',
  width: 512,
  height: 512,
  mime: 'application/x-tgsticker',
  thumb: '',
})

function makeManagers(result: Sticker[]) {
  const stickers = { searchByEmoji: vi.fn().mockResolvedValue(result) }
  return { managers: { stickers } as unknown as Managers }
}

describe('StickersHelper — предпросмотр по зажатию ЛКМ (useStickerViewer)', () => {
  afterEach(cleanup)

  it('долгое зажатие ЛКМ на ячейке стикера открывает предпросмотр, отпускание закрывает его', async () => {
    const { managers } = makeManagers([stk(1), stk(2)])
    render(
      <ManagersProvider managers={managers}>
        <StickersHelper emoji="🦆" onPick={() => {}} />
      </ManagersProvider>,
    )
    const cell = await waitFor(() => {
      const el = document.querySelector('.grid-item.super-sticker')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })

    fireEvent.mouseDown(cell, { button: 0 })
    expect(document.querySelector('[data-testid="sticker-viewer"]')).not.toBeNull()

    fireEvent.mouseUp(document)
    expect(document.querySelector('[data-testid="sticker-viewer"]')).toBeNull()
  })

  it('обычный клик по ячейке (без удержания) по-прежнему отправляет стикер', async () => {
    const onPick = vi.fn()
    const { managers } = makeManagers([stk(1)])
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

    fireEvent.click(cell)
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0].id).toBe(1)
  })
})
