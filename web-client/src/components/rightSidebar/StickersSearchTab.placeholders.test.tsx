// Ячейки-заглушки строки набора занимают геометрию сразу (tweb
// sidebarRight/tabs/stickers.tsx:57-64 `renderSet`): div.sticker-set-sticker
// на ровно min(5, count) слотов создаётся ДО запроса за составом набора
// (getStickerSet/setBySlug), и уже в них потом вставляются стикеры по мере
// прихода ответа — иначе строка «схлопывается» до ответа и список дёргается
// по мере подгрузки. Тест держит это поведение: до резолва setBySlug ячейки
// уже есть, после — та же численность, но уже с содержимым.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import StickersSearchTab from './StickersSearchTab'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'

const noop = () => {}

// Файл стикера в тестах не грузим (fetch к media) — превью пинится по обёртке
// .sticker-set-sticker; сам StickerMedia покрыт своим StickerMedia.test.tsx.
vi.mock('../StickerMedia', () => ({ default: () => <div data-testid="sticker-media" /> }))

let slugSeq = 0
// slug уникален на тест: кэш стикеров набора в компоненте — модульный, по slug
// (как в StickersSearchTab.test.tsx).
const makeSet = (id: number, title: string, count: number) => ({ id, slug: `set_${++slugSeq}`, title, kind: 'sticker' as const, count })
const makeSticker = (id: number) => ({ id, setId: 1, mediaId: 100 + id, emoji: '🦆', width: 512, height: 512, mime: 'application/json', thumb: '' })

function makeManagers(setBySlug: ReturnType<typeof vi.fn>) {
  const fns = {
    mySets: vi.fn().mockResolvedValue([]),
    featuredSets: vi.fn().mockResolvedValue([makeSet(1, 'Duck', 3)]),
    searchSets: vi.fn().mockResolvedValue([]),
    setBySlug,
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
  }
  return { managers: { stickers: fns } as unknown as Managers, fns }
}

describe('StickersSearchTab — ячейки-заглушки строки набора', () => {
  afterEach(cleanup)

  it('до резолва setBySlug строка уже показывает min(5, count) пустых ячеек фиксированного размера', async () => {
    // Промис состава набора держим нерезолвленным — эмулирует окно ожидания ответа.
    const { managers, fns } = makeManagers(vi.fn(() => new Promise(() => {})))
    render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )
    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalled())
    await waitFor(() => {
      const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
      expect(cells.length).toBe(3) // min(5, count=3)
    })
    // ячейки есть, но содержимого — ещё нет (состав не приехал)
    expect(document.querySelector('[data-testid="sticker-media"]')).toBeNull()
  })

  it('после резолва setBySlug — та же численность ячеек, уже с содержимым', async () => {
    const stickers = [1, 2, 3].map(makeSticker)
    const { managers } = makeManagers(vi.fn().mockResolvedValue({ set: makeSet(1, 'Duck', 3), stickers }))
    render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} />
      </ManagersProvider>,
    )
    await waitFor(() => {
      const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
      expect(cells.length).toBe(3)
      cells.forEach((cell) => expect(cell.querySelector('[data-testid="sticker-media"]')).not.toBeNull())
    })
  })
})
