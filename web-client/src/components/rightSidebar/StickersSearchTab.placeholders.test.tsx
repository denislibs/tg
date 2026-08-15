// Ячейки-заглушки строки набора занимают геометрию сразу (tweb
// sidebarRight/tabs/stickers.tsx:57-64 `renderSet`): div.sticker-set-sticker
// на ровно min(5, count) слотов создаётся ДО запроса за составом набора
// (getStickerSet/setBySlug), и уже в них потом вставляются стикеры по мере
// прихода ответа — иначе строка «схлопывается» до ответа и список дёргается
// по мере подгрузки. Тест держит это поведение: до резолва setBySlug ячейки
// уже есть, после — та же численность, но уже с содержимым.
//
// Отдельный блок — клик по ячейке гасится ВСЕГДА, а не только когда контент
// уже приехал (tweb attachClickEvent:166-172 — findUpClassName ловит клик по
// .sticker-set-sticker независимо от dataset.docId и делает return, так и не
// доходя до showStickersPopup). Иначе клик по ещё не наполненному (или
// навсегда пустому — набор усох ниже count) слоту всплывает на строку и
// открывает StickerSetModal вместо «ничего не происходит».
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import StickersSearchTab from './StickersSearchTab'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'

const noop = () => {}

// happy-dom объявляет класс IntersectionObserver, но записей никогда не
// порождает (нет layout-движка) — строки набора ленивые (Task 3,
// useLazyVisibility), и без стаба, который сам отчитывается о пересечении,
// ни одна строка не считалась бы видимой. Этому файлу гейт видимости сам по
// себе не интересен (это заглушки ячеек ДО/ПОСЛЕ ответа setBySlug) — здесь
// достаточно «видимо всё сразу».
beforeAll(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(el: Element) {
        this.cb([{ target: el, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      unobserve() {}
      disconnect() {}
    },
  )
})

// Файл стикера в тестах не грузим (fetch к media) — превью пинится по обёртке
// .sticker-set-sticker; сам StickerMedia покрыт своим StickerMedia.test.tsx.
vi.mock('../StickerMedia', () => ({ default: () => <div data-testid="sticker-media" /> }))

let slugSeq = 0
// slug уникален на тест: кэш стикеров набора в компоненте — модульный, по slug
// (как в StickersSearchTab.test.tsx).
const makeSet = (id: number, title: string, count: number) => ({ id, slug: `set_${++slugSeq}`, title, kind: 'sticker' as const, count })
const makeSticker = (id: number) => ({ id, setId: 1, mediaId: 100 + id, emoji: '🦆', width: 512, height: 512, mime: 'application/json', thumb: '' })

function makeManagers(over: Record<string, unknown> = {}) {
  const fns = {
    mySets: vi.fn().mockResolvedValue([]),
    featuredSets: vi.fn().mockResolvedValue([makeSet(1, 'Duck', 3)]),
    searchSets: vi.fn().mockResolvedValue([]),
    // по умолчанию — зависший запрос состава (эмулирует окно ожидания ответа)
    setBySlug: vi.fn(() => new Promise(() => {})),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
  return { managers: { stickers: fns } as unknown as Managers, fns }
}

function renderTab(managers: Managers) {
  return render(
    <ManagersProvider managers={managers}>
      <StickersSearchTab onClose={noop} />
    </ManagersProvider>,
  )
}

describe('StickersSearchTab — ячейки-заглушки строки набора', () => {
  afterEach(cleanup)

  it('до резолва setBySlug строка уже показывает min(5, count) пустых ячеек фиксированного размера', async () => {
    const { managers, fns } = makeManagers()
    renderTab(managers)
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
    const { managers } = makeManagers({ setBySlug: vi.fn().mockResolvedValue({ set: makeSet(1, 'Duck', 3), stickers }) })
    renderTab(managers)
    await waitFor(() => {
      const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
      expect(cells.length).toBe(3)
      cells.forEach((cell) => expect(cell.querySelector('[data-testid="sticker-media"]')).not.toBeNull())
    })
  })

  it('клик по ещё не наполненной ячейке (setBySlug завис) НЕ открывает модалку набора и не шлёт стикер', async () => {
    const onPickSticker = vi.fn()
    const { managers, fns } = makeManagers()
    render(
      <ManagersProvider managers={managers}>
        <StickersSearchTab onClose={noop} onPickSticker={onPickSticker} />
      </ManagersProvider>,
    )
    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalled())
    let cell!: Element
    await waitFor(() => {
      const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
      expect(cells.length).toBe(3)
      cell = cells[0]
    })
    // ячейка ещё пуста — состав так и не приехал
    expect(cell.querySelector('[data-testid="sticker-media"]')).toBeNull()
    fireEvent.click(cell)
    expect(document.querySelector('.popup-stickers')).toBeNull()
    expect(onPickSticker).not.toHaveBeenCalled()
  })

  it('count=0 — ячеек нет, ошибок нет', async () => {
    const { managers, fns } = makeManagers({ featuredSets: vi.fn().mockResolvedValue([makeSet(1, 'Empty', 0)]) })
    renderTab(managers)
    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalled())
    await waitFor(() => expect(document.querySelector('.sticker-set')).not.toBeNull())
    expect(document.querySelectorAll('[data-testid="sticker-set-cell"]').length).toBe(0)
  })

  it('набор усох (count больше фактически приехавших стикеров) — лишние ячейки остаются пустыми, клик по ним безопасен', async () => {
    const shrunkSet = makeSet(1, 'Shrunk', 5)
    const stickers = [1, 2].map(makeSticker) // приехало меньше, чем count
    const { managers } = makeManagers({
      featuredSets: vi.fn().mockResolvedValue([shrunkSet]),
      setBySlug: vi.fn().mockResolvedValue({ set: shrunkSet, stickers }),
    })
    renderTab(managers)
    await waitFor(() => {
      const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
      expect(cells.length).toBe(5) // min(5, count=5)
      const filled = Array.from(cells).filter((c) => c.querySelector('[data-testid="sticker-media"]'))
      expect(filled.length).toBe(2) // ровно столько, сколько реально приехало
    })
    const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
    // последняя ячейка — навсегда пустой слот (набор усох ниже count)
    fireEvent.click(cells[4])
    expect(document.querySelector('.popup-stickers')).toBeNull()
  })
})
