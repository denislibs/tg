// Ячейки-заглушки строки набора занимают геометрию сразу (tweb
// sidebarRight/tabs/stickers.tsx:57-64 `renderSet`): div.sticker-set-sticker
// на ровно min(5, count) слотов создаётся для каждой строки, и заполняется
// содержимым, если для этого слота есть превью в `covers`.
//
// Task 2 covered sets поменяла источник превью: раньше строка ждала СВОЙ
// отдельный setBySlug (окно ожидания реально существовало — сеть могла быть
// медленной), теперь covers приезжают ОДНИМ пакетом вместе с самой выдачей
// (featuredSets/searchSets) — как только сет появился в `sets`, его covers
// (если они есть) уже тут же, без отдельного ожидания. Но «пусто» по-прежнему
// возможно НАВСЕГДА — если бэк не прислал covers для конкретного набора
// (map.get(set.id) === undefined) или прислал меньше стикеров, чем count
// («усохший» набор, стикеры удалены после того, как посчитался count).
//
// Отдельный блок — клик по ячейке гасится ВСЕГДА, а не только когда контент
// уже приехал (tweb attachClickEvent:166-172 — findUpClassName ловит клик по
// .sticker-set-sticker независимо от dataset.docId и делает return, так и не
// доходя до showStickersPopup). Иначе клик по навсегда пустому (нет записи в
// covers, либо набор усох ниже count) слоту всплывает на строку и открывает
// StickerSetModal вместо «ничего не происходит».
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import StickersSearchTab from './StickersSearchTab'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { Sticker } from '../../core/managers/stickersManager'

const noop = () => {}

// happy-dom объявляет класс IntersectionObserver, но записей никогда не
// порождает (нет layout-движка) — строки набора ленивые по ФАЙЛАМ превью
// (visible гейтит монтирование StickerMedia, см. StickersSearchTab.tsx), и
// без стаба, который сам отчитывается о пересечении, ни одна строка не
// считалась бы видимой. Этому файлу гейт видимости сам по себе не интересен
// (это заглушки ячеек по данным covers) — здесь достаточно «видимо всё сразу».
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
// slug уникален на тест: StickerSetModal (если строку кликнуть) кэширует свой
// запрос по slug на модуль (как в StickersSearchTab.test.tsx).
const makeSet = (id: number, title: string, count: number) => ({ id, slug: `set_${++slugSeq}`, title, kind: 'sticker' as const, count })
const makeSticker = (id: number): Sticker => ({ id, setId: 1, mediaId: 100 + id, emoji: '🦆', width: 512, height: 512, mime: 'application/json', thumb: '' })

function makeManagers(over: Record<string, unknown> = {}) {
  const fns = {
    mySets: vi.fn().mockResolvedValue([]),
    featuredSets: vi.fn().mockResolvedValue({ sets: [makeSet(1, 'Duck', 3)], covers: new Map() }),
    searchSets: vi.fn().mockResolvedValue({ sets: [], covers: new Map() }),
    // setBySlug строке больше не нужен — используется только StickerSetModal
    // (клик по строке вне превью/кнопки); ни один тест этого файла её не
    // открывает, но менеджер обязан существовать (ManagersProvider).
    setBySlug: vi.fn().mockResolvedValue({ set: makeSet(1, 'Duck', 3), stickers: [] }),
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

describe('StickersSearchTab — ячейки-заглушки строки набора (covers, Task 2)', () => {
  afterEach(cleanup)

  it('covers приехали вместе с выдачей — min(5, count) ячеек сразу с содержимым, без отдельного ожидания', async () => {
    const set = makeSet(1, 'Duck', 3)
    const stickers = [1, 2, 3].map(makeSticker)
    const { managers } = makeManagers({
      featuredSets: vi.fn().mockResolvedValue({ sets: [set], covers: new Map([[set.id, stickers]]) }),
    })
    renderTab(managers)
    await waitFor(() => {
      const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
      expect(cells.length).toBe(3) // min(5, count=3)
      cells.forEach((cell) => expect(cell.querySelector('[data-testid="sticker-media"]')).not.toBeNull())
    })
  })

  it('для набора нет записи в covers (бэк её не прислал) — min(5, count) пустых ячеек, без падений', async () => {
    const { managers, fns } = makeManagers() // featuredSets по умолчанию — covers: new Map(), запись для id=1 отсутствует
    renderTab(managers)
    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalled())
    await waitFor(() => {
      const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
      expect(cells.length).toBe(3) // min(5, count=3)
    })
    // ячейки есть, но содержимого — нет (covers для этого id не приехали)
    expect(document.querySelector('[data-testid="sticker-media"]')).toBeNull()
  })

  it('клик по навсегда пустой ячейке (нет записи в covers) НЕ открывает модалку набора и не шлёт стикер', async () => {
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
    // ячейка пуста — для набора нет записи в covers
    expect(cell.querySelector('[data-testid="sticker-media"]')).toBeNull()
    fireEvent.click(cell)
    expect(document.querySelector('.popup-stickers')).toBeNull()
    expect(onPickSticker).not.toHaveBeenCalled()
  })

  it('count=0 — ячеек нет, ошибок нет', async () => {
    const { managers, fns } = makeManagers({ featuredSets: vi.fn().mockResolvedValue({ sets: [makeSet(1, 'Empty', 0)], covers: new Map() }) })
    renderTab(managers)
    await waitFor(() => expect(fns.featuredSets).toHaveBeenCalled())
    await waitFor(() => expect(document.querySelector('.sticker-set')).not.toBeNull())
    expect(document.querySelectorAll('[data-testid="sticker-set-cell"]').length).toBe(0)
  })

  it('набор усох (count больше числа стикеров в covers) — лишние ячейки остаются пустыми, клик по ним безопасен', async () => {
    const shrunkSet = makeSet(1, 'Shrunk', 5)
    const stickers = [1, 2].map(makeSticker) // covers прислали меньше, чем count
    const { managers } = makeManagers({
      featuredSets: vi.fn().mockResolvedValue({ sets: [shrunkSet], covers: new Map([[shrunkSet.id, stickers]]) }),
    })
    renderTab(managers)
    await waitFor(() => {
      const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
      expect(cells.length).toBe(5) // min(5, count=5)
      const filled = Array.from(cells).filter((c) => c.querySelector('[data-testid="sticker-media"]'))
      expect(filled.length).toBe(2) // ровно столько, сколько реально прислали в covers
    })
    const cells = document.querySelectorAll('[data-testid="sticker-set-cell"]')
    // последняя ячейка — навсегда пустой слот (набор усох ниже count)
    fireEvent.click(cells[4])
    expect(document.querySelector('.popup-stickers')).toBeNull()
  })
})
