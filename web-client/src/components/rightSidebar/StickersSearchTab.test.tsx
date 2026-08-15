// Пин DOM-структуры экрана «Поиск стикеров» правой колонки по живому дампу tweb
// (`docs/research/tweb-dom/19-emoticons-06-sticker-search-right.json`):
//   div#stickers-container.tabs-tab.sidebar-slider-item….chatlist-container.active
//     div.sidebar-header (sidebar-close-button + input-search "Search Stickers")
//     div.sidebar-content > div.scrollable.scrollable-y > div.sticker-sets
//       div.sticker-set [data-sticker-set data-title]
//         div.sticker-set-header
//           div.sticker-set-details > .sticker-set-name + .sticker-set-count > span.i18n
//           button.btn-primary.btn-color-primary.sticker-set-button > span.i18n "Add"/"Added"
//         div.sticker-set-stickers > ровно 5 × div.sticker-set-sticker.media-sticker-wrapper
// Поведение: featured при пустом запросе, searchSets по вводу (дебаунс),
// Add → install (кнопка disabled на время запроса, потом "Added"+gray),
// клик по превью — onPickSticker; открытие извне — openStickersSearchTab.
// Превью строки (Task 2 covered sets) идёт из carты `covers`, приехавшей
// ОДНИМ пакетом с самой выдачей (featuredSets/searchSets) — не отдельным
// setBySlug на строку; setBySlug в моках ниже остаётся только ради
// StickerSetModal (клик по строке вне превью/кнопки её открывает).
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import StickersSearchTab, { openStickersSearchTab } from './StickersSearchTab'
import { openGifsSearchTab } from './GifsSearchTab'
import PopupHost from '../PopupHost'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { usePopupStore } from '../../stores/popupStore'
import type { Managers } from '../../client/bootstrap'

const noop = () => {}

// happy-dom объявляет класс IntersectionObserver, но записей никогда не
// порождает (нет layout-движка) — реальный класс молча ничего бы не сделал.
// Строки набора ленивые по ФАЙЛАМ превью (useLazyVisibility гейтит монтирование
// StickerMedia, см. StickersSearchTab.tsx): без стаба, который сам отчитывается
// о пересечении, ни одна строка не считалась бы видимой и StickerMedia не
// смонтировался бы вовсе. Здесь достаточно «видимо всё сразу» — сама
// ленивость (кто видим, кто нет) пином не тестов этого файла, а
// StickersSearchTab.lazy.test.tsx.
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
// slug уникален на тест: StickerSetModal, открытый кликом по строке, кэширует
// свой запрос по slug на модуль.
const makeSet = (id: number, title: string, count = 40) => ({ id, slug: `set_${++slugSeq}`, title, kind: 'sticker' as const, count })
const makeSticker = (id: number) => ({ id, setId: 1, mediaId: 100 + id, emoji: '🦆', width: 512, height: 512, mime: 'application/json', thumb: '' })

function makeManagers(over: Record<string, unknown> = {}) {
  const duck = makeSet(1, 'Duck')
  const fns = {
    mySets: vi.fn().mockResolvedValue([]),
    // covers — превью строки, приезжает ОДНИМ пакетом с самой выдачей
    // (Task 2): семь стикеров набора, строка покажет первые min(5, count).
    featuredSets: vi.fn().mockResolvedValue({ sets: [duck], covers: new Map([[duck.id, [1, 2, 3, 4, 5, 6, 7].map(makeSticker)]]) }),
    searchSets: vi.fn().mockResolvedValue({ sets: [], covers: new Map() }),
    // setBySlug строке больше не нужен (превью — из covers) — используется
    // только StickerSetModal, когда клик по строке открывает полный набор.
    setBySlug: vi.fn().mockResolvedValue({ set: duck, stickers: [1, 2, 3, 4, 5, 6, 7].map(makeSticker) }),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    // экран GIF (kind-тест ниже рендерит оба экрана через PopupHost)
    searchGifs: vi.fn().mockResolvedValue({ gifs: [], next: '' }),
    ...over,
  }
  return { managers: { stickers: fns } as unknown as Managers, fns }
}

function renderTab(props: Partial<Parameters<typeof StickersSearchTab>[0]> = {}, managers = makeManagers().managers) {
  return render(
    <ManagersProvider managers={managers}>
      <StickersSearchTab onClose={noop} {...props} />
    </ManagersProvider>,
  )
}

describe('StickersSearchTab — разметка tweb', () => {
  afterEach(cleanup)

  it('контейнер #stickers-container: классы слайдер-вкладки + chatlist-container (tweb stickers.tsx:148-149), placeholder "Search Stickers"', () => {
    renderTab()
    const container = document.getElementById('stickers-container')!
    for (const cls of ['tabs-tab', 'sidebar-slider-item', 'scrolled-start', 'scrolled-end', 'scrollable-y-bordered', 'chatlist-container', 'active']) {
      expect(container.classList.contains(cls), cls).toBe(true)
    }
    expect(container.querySelector('.sidebar-header > button.sidebar-close-button')).not.toBeNull()
    expect(container.querySelector('.sidebar-header .input-search-placeholder')!.textContent).toBe('Search Stickers')
    expect(container.querySelector('.sidebar-content > .scrollable.scrollable-y > .sticker-sets')).not.toBeNull()
  })

  it('пустой запрос — featured; строка набора: header/details/name/count и ровно 5 превью из выдачи набора', async () => {
    const { managers, fns } = makeManagers()
    renderTab({}, managers)
    expect(fns.featuredSets).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.querySelector('.sticker-set')).not.toBeNull())
    const row = document.querySelector('.sticker-set')!
    expect(row.getAttribute('data-title')).toBe('Duck')
    expect(row.getAttribute('data-sticker-set')).toBe('1')
    const details = row.querySelector('.sticker-set-header > .sticker-set-details')!
    expect(details.querySelector('.sticker-set-name')!.textContent).toBe('Duck')
    expect(details.querySelector('.sticker-set-count > span.i18n')!.textContent).toBe('40 stickers')
    // tweb stickers.tsx:58 — min(5, count) превью, даже если в наборе больше
    await waitFor(() => {
      const cells = row.querySelectorAll('.sticker-set-stickers > .sticker-set-sticker.media-sticker-wrapper')
      expect(cells.length).toBe(5)
    })
  })

  // Task 2 (подключение useStickerViewer) — tweb sidebarRight/tabs/stickers.tsx:164
  // (attachStickerViewerListeners на том же диве, что рисует все строки). Обычный
  // клик по превью (короче порога показа) уже проверен тестом ниже («ввод
  // запроса...»). Порог (HOLD_THRESHOLD_MS, useStickerViewer.ts) — реальные
  // 125мс, поэтому здесь фейковые часы продвигают время удержания.
  it('долгое зажатие ЛКМ на превью-стикере строки открывает предпросмотр, отпускание закрывает его; клик после такого удержания стикер НЕ отправляет', async () => {
    const onPickSticker = vi.fn()
    const { managers } = makeManagers()
    renderTab({ onPickSticker }, managers)
    await waitFor(() => expect(document.querySelector('.sticker-set-sticker')).not.toBeNull())

    // Фейковые часы включаем ПОСЛЕ waitFor выше — он сам опирается на реальные
    // таймеры для поллинга.
    vi.useFakeTimers()
    try {
      const cell = document.querySelector('.sticker-set-sticker')!
      fireEvent.mouseDown(cell, { button: 0 })
      expect(document.querySelector('[data-testid="sticker-viewer"]')).toBeNull() // порог ещё не истёк
      void act(() => vi.advanceTimersByTime(150))
      expect(document.querySelector('[data-testid="sticker-viewer"]')).not.toBeNull()

      fireEvent.mouseUp(document)
      expect(document.querySelector('[data-testid="sticker-viewer"]')).toBeNull()

      fireEvent.click(cell)
      expect(onPickSticker).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('клик по строке набора (не по кнопке/превью) открывает StickerSetModal с её слагом (tweb showStickersPopup)', async () => {
    const { managers, fns } = makeManagers()
    renderTab({}, managers)
    await waitFor(() => expect(document.querySelector('.sticker-set')).not.toBeNull())
    expect(document.querySelector('.popup-stickers')).toBeNull()
    fireEvent.click(document.querySelector('.sticker-set')!)
    await waitFor(() => expect(document.querySelector('.popup-stickers')).not.toBeNull())
    expect(fns.setBySlug).toHaveBeenCalled()
  })

  it('клик по кнопке Add или превью-стикеру НЕ открывает StickerSetModal (stopPropagation, tweb attachClickEvent)', async () => {
    const { managers } = makeManagers()
    renderTab({}, managers)
    await waitFor(() => expect(document.querySelector('.sticker-set-button')).not.toBeNull())
    fireEvent.click(document.querySelector('.sticker-set-button')!)
    await waitFor(() => expect(document.querySelector('.sticker-set-sticker')).not.toBeNull())
    fireEvent.click(document.querySelector('.sticker-set-sticker')!)
    expect(document.querySelector('.popup-stickers')).toBeNull()
  })

  it('кнопка: не установлен — "Add"; клик — install, после ответа "Added" + класс gray (tweb toggleStickerSet)', async () => {
    const { managers, fns } = makeManagers()
    renderTab({}, managers)
    await waitFor(() => expect(document.querySelector('.sticker-set-button')).not.toBeNull())
    const button = document.querySelector<HTMLButtonElement>('button.btn-primary.btn-color-primary.sticker-set-button')!
    expect(button.textContent).toBe('Add')
    expect(button.classList.contains('gray')).toBe(false)
    fireEvent.click(button)
    expect(fns.install).toHaveBeenCalledWith(1)
    await waitFor(() => expect(button.textContent).toBe('Added'))
    expect(button.classList.contains('gray')).toBe(true)
  })

  it('уже установленный набор (mySets) сразу "Added"+gray; клик — uninstall', async () => {
    const { managers, fns } = makeManagers({ mySets: vi.fn().mockResolvedValue([makeSet(1, 'Duck')]) })
    renderTab({}, managers)
    await waitFor(() => {
      const b = document.querySelector('.sticker-set-button')
      expect(b?.textContent).toBe('Added')
      expect(b?.classList.contains('gray')).toBe(true)
    })
    fireEvent.click(document.querySelector('.sticker-set-button')!)
    expect(fns.uninstall).toHaveBeenCalledWith(1)
  })

  // mousedown→mouseup→click (не голый click) — та же связка, которой браузер
  // физически рождает обычный клик; проходит через хук предпросмотра первой
  // (см. «долгое зажатие...» выше) — голый fireEvent.click эту связку не
  // проверяет (ревью V2).
  it('ввод запроса — searchSets (дебаунс); клик по превью (mousedown→mouseup→click) — onPickSticker', async () => {
    const searched = makeSet(9, 'Utya', 27)
    const { managers, fns } = makeManagers({
      searchSets: vi.fn().mockResolvedValue({ sets: [searched], covers: new Map([[searched.id, [makeSticker(1)]]]) }),
    })
    const onPickSticker = vi.fn()
    renderTab({ onPickSticker }, managers)
    fireEvent.change(document.querySelector<HTMLInputElement>('.input-search-input')!, { target: { value: 'duck' } })
    await waitFor(() => expect(fns.searchSets).toHaveBeenCalledWith('duck'))
    await waitFor(() => expect(document.querySelector('.sticker-set-sticker')).not.toBeNull())
    const cell = document.querySelector('.sticker-set-sticker')!
    fireEvent.mouseDown(cell, { button: 0 })
    fireEvent.mouseUp(document)
    expect(document.querySelector('[data-testid="sticker-viewer"]')).toBeNull() // не мелькнул
    fireEvent.click(cell)
    expect(onPickSticker).toHaveBeenCalledTimes(1)
    expect(onPickSticker.mock.calls[0][0].mediaId).toBe(101)
  })

  it('openStickersSearchTab — публичный путь открытия: попап kind=right-search, рендер даёт этот экран', () => {
    openStickersSearchTab({})
    const popups = usePopupStore.getState().popups
    const entry = popups[popups.length - 1]
    // литерал, не константа компонента — иначе тест тавтологичен и мутация kind не краснеет
    expect(entry.kind).toBe('right-search')
    render(
      <ManagersProvider managers={makeManagers().managers}>
        {entry.render({ open: true, requestClose: noop, onExitComplete: noop, destroy: noop })}
      </ManagersProvider>,
    )
    expect(document.getElementById('stickers-container')).not.toBeNull()
    usePopupStore.getState().clear()
  })

  it('kind-замена: открытие экрана стикеров закрывает открытый экран GIF (замена вкладки слайдера tweb)', async () => {
    render(
      <ManagersProvider managers={makeManagers().managers}>
        <PopupHost />
      </ManagersProvider>,
    )
    openGifsSearchTab({})
    await waitFor(() => expect(document.getElementById('search-gifs-container')).not.toBeNull())
    openStickersSearchTab({})
    await waitFor(() => {
      expect(document.getElementById('search-gifs-container')).toBeNull()
      expect(document.getElementById('stickers-container')).not.toBeNull()
    })
    usePopupStore.getState().clear()
  })
})
