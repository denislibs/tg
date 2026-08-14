// Пин DOM-структуры экрана «Поиск GIF» правой колонки по живому дампу tweb
// (`docs/research/tweb-dom/19-emoticons-04-gif-search-right.json`,
//  `…-05-gif-search-results.json`):
//   div.sidebar-content.sidebar-slider.tabs-container [data-animation=navigation]
//     div.tabs-tab.sidebar-slider-item.scrolled-start.scrolled-end
//         .scrollable-y-bordered.active#search-gifs-container
//       div.sidebar-header > button.btn-icon.sidebar-close-button > span.tgico.button-icon
//         + div.input-search (плейсхолдер "Search GIFs")
//       div.sidebar-content > div.scrollable.scrollable-y
//         div.gifs-masonry > div.gif.grid-item.media-gif-wrapper.media-container
// Поведение: тренды при открытии (searchGifs('','')), дебаунс-поиск по вводу,
// клик по ячейке — onPick; открытие извне — openGifsSearchTab (popupStore,
// kind right-search).
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import GifsSearchTab, { openGifsSearchTab } from './GifsSearchTab'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { usePopupStore } from '../../stores/popupStore'
import type { Managers } from '../../client/bootstrap'

const noop = () => {}

// happy-dom не реализует IntersectionObserver — заглушка для ленивой кладки.
beforeAll(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

const gif = (id: string) => ({ id, mp4Url: `https://t/${id}.mp4`, gifUrl: '', previewUrl: `https://t/${id}.jpg`, width: 420, height: 315 })

function makeManagers(searchGifs = vi.fn().mockResolvedValue({ gifs: [gif('a'), gif('b')], next: 'CUR' })) {
  return { managers: { stickers: { searchGifs } } as unknown as Managers, searchGifs }
}

function renderTab(props: Partial<Parameters<typeof GifsSearchTab>[0]> = {}, managers = makeManagers().managers) {
  return render(
    <ManagersProvider managers={managers}>
      <GifsSearchTab onClose={noop} {...props} />
    </ManagersProvider>,
  )
}

describe('GifsSearchTab — разметка tweb', () => {
  afterEach(cleanup)

  it('контейнер #search-gifs-container: tabs-tab sidebar-slider-item scrolled-start scrolled-end scrollable-y-bordered active внутри sidebar-slider', () => {
    renderTab()
    const container = document.getElementById('search-gifs-container')!
    for (const cls of ['tabs-tab', 'sidebar-slider-item', 'scrolled-start', 'scrolled-end', 'scrollable-y-bordered', 'active']) {
      expect(container.classList.contains(cls), cls).toBe(true)
    }
    const slider = container.parentElement!
    for (const cls of ['sidebar-content', 'sidebar-slider', 'tabs-container']) {
      expect(slider.classList.contains(cls), cls).toBe(true)
    }
    expect(slider.getAttribute('data-animation')).toBe('navigation')
  })

  it('шапка: sidebar-close-button (btn-icon, span.tgico.button-icon, без ripple — tweb sliderTab.ts:57) + input-search "Search GIFs"', () => {
    renderTab()
    const header = document.querySelector('#search-gifs-container > .sidebar-header')!
    const close = header.querySelector(':scope > button.sidebar-close-button')!
    expect(close.classList.contains('btn-icon')).toBe(true)
    expect(close.querySelector('span.tgico.button-icon')).not.toBeNull()
    expect(close.querySelector('.c-ripple')).toBeNull() // ButtonIcon(…, {noRipple: true})
    const search = header.querySelector(':scope > .input-search')!
    expect(search.querySelector('input.input-field-input.input-search-input')).not.toBeNull()
    expect(search.querySelector('.input-search-placeholder')!.textContent).toBe('Search GIFs')
  })

  it('тело: sidebar-content > scrollable.scrollable-y > gifs-masonry; тренды при открытии — searchGifs("", "")', async () => {
    const { managers, searchGifs } = makeManagers()
    renderTab({}, managers)
    expect(searchGifs).toHaveBeenCalledWith('', '')
    const scrollable = document.querySelector('#search-gifs-container > .sidebar-content > .scrollable.scrollable-y')!
    await waitFor(() => {
      const cells = scrollable.querySelectorAll('.gifs-masonry > .gif.grid-item.media-gif-wrapper.media-container')
      expect(cells.length).toBe(2)
    })
  })

  it('ввод запроса дебаунсится и уходит новым поиском; клик по ячейке — onPick', async () => {
    const { managers, searchGifs } = makeManagers()
    const onPick = vi.fn()
    renderTab({ onPick }, managers)
    const input = document.querySelector<HTMLInputElement>('.input-search-input')!
    fireEvent.change(input, { target: { value: 'cat' } })
    await waitFor(() => expect(searchGifs).toHaveBeenCalledWith('cat', ''))
    await waitFor(() => expect(document.querySelectorAll('.gif').length).toBe(2))
    fireEvent.click(document.querySelector('.gif')!)
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0].key).toBe('t-a')
  })

  it('openGifsSearchTab — публичный путь открытия: попап kind=right-search, рендер даёт этот экран', () => {
    openGifsSearchTab({})
    const popups = usePopupStore.getState().popups
    const entry = popups[popups.length - 1]
    // литерал, не константа компонента — иначе тест тавтологичен и мутация kind не краснеет
    expect(entry.kind).toBe('right-search')
    render(
      <ManagersProvider managers={makeManagers().managers}>
        {entry.render({ open: true, requestClose: noop, onExitComplete: noop, destroy: noop })}
      </ManagersProvider>,
    )
    expect(document.getElementById('search-gifs-container')).not.toBeNull()
    usePopupStore.getState().clear()
  })
})
