// Task 2 covered sets: экран поиска стикеров рисует превью строки из `covers`,
// приехавшего ОДНИМ пакетом вместе с самой выдачей (GET /sticker-sets/featured
// и /sticker-sets/search теперь отдают {sets, covers} — see stickersManager.ts),
// а не отдельным `setBySlug` на каждую строку (было — сорок лишних round-trip'ов
// на экран из сотен наборов, и до их ответа строка была пуста). Этот файл
// пинит ИМЕННО это: превью появляются без единого вызова setBySlug, и что для
// набора без записи в covers строка показывает пустые ячейки-заглушки, а не
// падает (см. также .placeholders.test.tsx — более полный разбор заглушек).
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import StickersSearchTab from './StickersSearchTab'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { Sticker, StickerSet } from '../../core/managers/stickersManager'
import { makeSticker as makeStickerDoc, makeStickerSet } from '../../core/stickers/testSticker'

const noop = () => {}

// happy-dom не порождает записи IntersectionObserver сам — строки ленивые по
// ФАЙЛАМ превью (visible гейтит монтирование StickerMedia), здесь достаточно
// «видимо всё сразу», сама ленивость — предмет .lazy.test.tsx.
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
const makeSet = (id: number, title: string, count: number): StickerSet => makeStickerSet({ id, shortName: `set_${++slugSeq}`, title, count })
const makeSticker = (setId: number, id: number): Sticker => makeStickerDoc({ id: setId * 1000 + id, setId, emoji: '🦆' })

function makeManagers(over: Record<string, unknown> = {}) {
  const fns = {
    mySets: vi.fn().mockResolvedValue([]),
    featuredSets: vi.fn().mockResolvedValue({ sets: [], covers: new Map() }),
    searchSets: vi.fn().mockResolvedValue({ sets: [], covers: new Map() }),
    // setBySlug — только для StickerSetModal (клик по строке); ни один тест
    // этого файла его не открывает намеренно — весь смысл файла в том, что
    // строка рисует превью БЕЗ него.
    setBySlug: vi.fn().mockRejectedValue(new Error('setBySlug не должен звонить строке экрана поиска — covers уже несут превью')),
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

describe('StickersSearchTab — превью строки из covered sets, без setBySlug (Task 2)', () => {
  afterEach(cleanup)

  it('featured: два набора с covers — превью отрисованы сразу, setBySlug ни разу не позван', async () => {
    const withCovers = makeSet(1, 'Duck', 3)
    const noCovers = makeSet(2, 'Empty covers', 4) // набор есть в выдаче, но covers для него бэк не прислал
    const covers = new Map([[withCovers.id, [1, 2, 3].map((i) => makeSticker(withCovers.id, i))]])
    const { managers, fns } = makeManagers({
      featuredSets: vi.fn().mockResolvedValue({ sets: [withCovers, noCovers], covers }),
    })
    renderTab(managers)

    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalledTimes(1))
    const rows = await waitFor(() => {
      const els = document.querySelectorAll('.sticker-set')
      expect(els.length).toBe(2)
      return els
    })

    // набор с covers — сразу 3 заполненные ячейки (min(5, count=3))
    const filledRow = [...rows].find((r) => r.getAttribute('data-title') === 'Duck')!
    const filledCells = filledRow.querySelectorAll('[data-testid="sticker-set-cell"]')
    expect(filledCells.length).toBe(3)
    filledCells.forEach((c) => expect(c.querySelector('[data-testid="sticker-media"]')).not.toBeNull())

    // набор без записи в covers — 4 пустые ячейки-заглушки (min(5, count=4)), не падает
    const emptyRow = [...rows].find((r) => r.getAttribute('data-title') === 'Empty covers')!
    const emptyCells = emptyRow.querySelectorAll('[data-testid="sticker-set-cell"]')
    expect(emptyCells.length).toBe(4)
    emptyCells.forEach((c) => expect(c.querySelector('[data-testid="sticker-media"]')).toBeNull())

    // клик по пустой ячейке безопасен (не открывает StickerSetModal, не шлёт стикер)
    fireEvent.click(emptyCells[0])
    expect(document.querySelector('.popup-stickers')).toBeNull()

    // главный пин: ни при рендере, ни при клике по пустой ячейке строка НЕ
    // сходила за составом набора отдельным запросом
    expect(fns.setBySlug).not.toHaveBeenCalled()
  })

  it('поиск по вводу: covers приезжают вместе с searchSets, тоже без setBySlug', async () => {
    const set = makeSet(9, 'Utya', 2)
    const covers = new Map([[set.id, [1, 2].map((i) => makeSticker(set.id, i))]])
    const { managers, fns } = makeManagers({
      searchSets: vi.fn().mockResolvedValue({ sets: [set], covers }),
    })
    renderTab(managers)

    fireEvent.change(document.querySelector<HTMLInputElement>('.input-search-input')!, { target: { value: 'utya' } })
    await waitFor(() => expect(fns.searchSets).toHaveBeenCalledWith('utya'))

    await waitFor(() => {
      const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
      expect(cells.length).toBe(2)
      cells.forEach((c) => expect(c.querySelector('[data-testid="sticker-media"]')).not.toBeNull())
    })
    expect(fns.setBySlug).not.toHaveBeenCalled()
  })
})
