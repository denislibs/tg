// Структурные пины эмодзи-дропдауна по живым дампам tweb
// (docs/research/tweb-dom/19-emoticons-01..07*.json) и исходникам
// emoticonsDropdown/{index.ts,tab.ts,search.tsx,category.ts}:
//   • .tabs-container[data-animation="tabs"] + классы слайда Transition;
//   • id контента вкладок (#content-emoji / #content-stickers);
//   • заголовок локальной категории: .category-title.disable-hover > span.i18n;
//   • сентинел sticky_sentinel--top в каждой категории (StickyIntersector);
//   • поле поиска: классы инпута, порядок узлов, стрелка сброса группы;
//   • нативный рендер эмодзи span.emoji.emoji-native при IS_EMOJI_SUPPORTED;
//   • крестик «очистить недавние» у Recent-стикеров с реальной очисткой.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import EmojiDropdown from './EmojiDropdown'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { Sticker } from '../../core/managers/stickersManager'

// дампы сняты на macOS — рендер нативный (tweb IS_EMOJI_SUPPORTED)
vi.mock('@environment/emojiSupport', () => ({ default: true }))
// стикеры-медиа не относятся к структуре дропдауна
vi.mock('../StickerMedia', () => ({ default: () => null }))

const stk = (id: number): Sticker => ({
  id,
  setId: 1,
  mediaId: 100 + id,
  emoji: '😀',
  width: 512,
  height: 512,
  mime: 'image/webp',
  thumb: '',
})

function makeManagers(recent: Sticker[] = []) {
  const stickers = {
    recent: vi.fn(async () => recent),
    faved: vi.fn(async (): Promise<Sticker[]> => []),
    mySets: vi.fn(async () => []),
    setBySlug: vi.fn(async () => Promise.reject(new Error('no set'))),
    clearRecent: vi.fn(async () => {}),
    fave: vi.fn(async () => {}),
    unfave: vi.fn(async () => {}),
  }
  return { managers: { stickers } as unknown as Managers, stickers }
}

// IO-стаб: каждый наблюдаемый элемент сразу «в вьюпорте» — категории рендерят
// ячейки, StickyIntersector получает валидные rect'ы.
class IOStub {
  private cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
  }
  observe(el: Element) {
    this.cb(
      [{
        target: el,
        isIntersecting: true,
        boundingClientRect: { top: 10, bottom: 20 } as DOMRectReadOnly,
        rootBounds: { top: 0 } as DOMRectReadOnly,
      } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IOStub)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const noop = () => {}

function renderDropdown(managers: Managers, props: Partial<Parameters<typeof EmojiDropdown>[0]> = {}) {
  return render(
    <ManagersProvider managers={managers}>
      <EmojiDropdown open onPick={noop} onClose={noop} {...props} />
    </ManagersProvider>,
  )
}

describe('EmojiDropdown — структура вкладки Emoji (дамп 19-emoticons-01)', () => {
  it('tabs-container несёт data-animation="tabs", контент вкладки — #content-emoji', () => {
    const { managers } = makeManagers()
    renderDropdown(managers)

    const tabsContainer = document.querySelector('.emoji-container > .tabs-container')!
    expect(tabsContainer.getAttribute('data-animation')).toBe('tabs')

    const content = document.querySelector('.emoticons-content')!
    expect(content.id).toBe('content-emoji')
  })

  it('нижняя полоса: кнопки несут data-tab (search/delete −1, emoji 0, stickers 1, gifs 2)', () => {
    const { managers } = makeManagers()
    renderDropdown(managers, { onPickSticker: noop, onPickGif: noop })
    const bar = document.querySelector('.emoji-tabs')!
    const get = (cls: string) => bar.querySelector(`.${cls}`)!.getAttribute('data-tab')
    expect(get('emoji-tabs-search')).toBe('-1')
    expect(get('emoji-tabs-emoji')).toBe('0')
    expect(get('emoji-tabs-stickers')).toBe('1')
    expect(get('emoji-tabs-gifs')).toBe('2')
    expect(get('emoji-tabs-delete')).toBe('-1')
  })

  it('лента категорий: nav.menu-horizontal-div.no-stripe.justify-start.emoticons-menu', () => {
    const { managers } = makeManagers()
    renderDropdown(managers)
    const nav = document.querySelector('nav.menu-horizontal-div')!
    for (const cls of ['no-stripe', 'justify-start', 'emoticons-menu']) {
      expect(nav.classList.contains(cls)).toBe(true)
    }
  })

  it('заголовок локальной категории — .category-title.disable-hover > span.i18n', () => {
    const { managers } = makeManagers()
    renderDropdown(managers)
    const title = document.querySelector('.emoji-category .category-title')!
    expect(title.classList.contains('disable-hover')).toBe(true)
    const span = title.firstElementChild!
    expect(span.tagName).toBe('SPAN')
    expect(span.classList.contains('i18n')).toBe(true)
    expect(span.textContent).toBe('Frequently Used')
  })

  it('в каждой категории — div.sticky_sentinel.sticky_sentinel--top (StickyIntersector)', () => {
    const { managers } = makeManagers()
    renderDropdown(managers)
    const cats = [...document.querySelectorAll('.emoji-category')]
    expect(cats.length).toBeGreaterThan(0)
    for (const cat of cats) {
      const sentinel = cat.querySelector(':scope > .sticky_sentinel')
      expect(sentinel, 'sticky sentinel в категории').not.toBeNull()
      expect(sentinel!.classList.contains('sticky_sentinel--top')).toBe(true)
    }
  })

  it('эмодзи — нативный span.emoji.emoji-native, не img (IS_EMOJI_SUPPORTED)', () => {
    const { managers } = makeManagers()
    renderDropdown(managers)
    const cell = document.querySelector('.super-emoji.super-emoji-regular')!
    const inner = cell.firstElementChild!
    expect(inner.tagName).toBe('SPAN')
    expect(inner.classList.contains('emoji')).toBe(true)
    expect(inner.classList.contains('emoji-native')).toBe(true)
    expect(cell.querySelector('img')).toBeNull()
  })
})

describe('EmojiDropdown — поле поиска (tweb search.tsx, дамп 19-emoticons-01/07)', () => {
  it('инпут: input-field-input.is-empty.input-search-input.emoticons-search-input, без рамки и фокус-эффекта', () => {
    const { managers } = makeManagers()
    renderDropdown(managers)
    const search = document.querySelector('#content-emoji .input-search')!
    expect(search.classList.contains('emoticons-search-input-container')).toBe(true)

    const input = search.querySelector('input')!
    for (const cls of ['input-field-input', 'is-empty', 'input-search-input', 'emoticons-search-input']) {
      expect(input.classList.contains(cls), cls).toBe(true)
    }
    expect(input.classList.contains('with-focus-effect')).toBe(false)
    expect(search.querySelector('.input-field-border')).toBeNull()
  })

  it('порядок узлов: input → scrollable → лупа.will-animate → стрелка.is-hiding → крестик', () => {
    const { managers } = makeManagers()
    renderDropdown(managers)
    const search = document.querySelector('#content-emoji .input-search')!

    const input = search.querySelector('input')!
    const scrollable = input.nextElementSibling!
    expect(scrollable.classList.contains('emoticons-search-input-scrollable')).toBe(true)
    expect(scrollable.querySelector('.input-search-placeholder')).not.toBeNull()
    expect(scrollable.querySelector('.emoticons-search-input-categories')).not.toBeNull()

    const icon = scrollable.nextElementSibling!
    expect(icon.classList.contains('input-search-icon')).toBe(true)
    expect(icon.classList.contains('will-animate')).toBe(true)

    const arrow = icon.nextElementSibling!
    expect(arrow.tagName).toBe('BUTTON')
    for (const cls of ['btn-icon', 'will-animate', 'emoticons-search-input-arrow', 'input-search-part', 'input-search-button', 'is-hiding']) {
      expect(arrow.classList.contains(cls), cls).toBe(true)
    }

    const clear = arrow.nextElementSibling!
    for (const cls of ['btn-icon', 'input-search-clear', 'input-search-part', 'input-search-button']) {
      expect(clear.classList.contains(cls), cls).toBe(true)
    }
  })

  it('выбор emoji-группы гасит лупу и показывает стрелку; стрелка сбрасывает группу', () => {
    const { managers } = makeManagers()
    renderDropdown(managers)
    const search = document.querySelector('#content-emoji .input-search')!
    const icon = search.querySelector('.input-search-icon')!
    const arrow = search.querySelector('.emoticons-search-input-arrow')!

    const chip = search.querySelector('.emoticons-search-input-category')!
    fireEvent.click(chip)
    expect(arrow.classList.contains('is-hiding')).toBe(false)
    expect(icon.classList.contains('is-hiding')).toBe(true)

    fireEvent.click(arrow)
    expect(arrow.classList.contains('is-hiding')).toBe(true)
    expect(icon.classList.contains('is-hiding')).toBe(false)
  })
})

describe('EmojiDropdown — слайд смены вкладок (порт TransitionSlider "tabs")', () => {
  it('переключение вешает animating/from/to и снимает их по фолбэк-таймеру, оставляя data-transition-timeout', () => {
    vi.useFakeTimers()
    const { managers } = makeManagers()
    renderDropdown(managers, { onPickSticker: noop })

    const container = document.querySelector('.tabs-container')!
    const [emojiTab, stickersTab] = [...container.children] as HTMLElement[]
    expect(emojiTab.classList.contains('active')).toBe(true)

    const stickersBtn = document.querySelector('.emoji-tabs-stickers')!
    act(() => {
      fireEvent.click(stickersBtn)
    })

    // transition.ts:300-322 — оба кадра активны, уходящий .from, приходящий .to
    expect(container.classList.contains('animating')).toBe(true)
    expect(emojiTab.classList.contains('from')).toBe(true)
    expect(emojiTab.classList.contains('active')).toBe(true)
    expect(stickersTab.classList.contains('to')).toBe(true)
    expect(stickersTab.classList.contains('active')).toBe(true)

    // фолбэк transitionTime + 100 (transition.ts:349)
    act(() => {
      vi.advanceTimersByTime(301)
    })
    expect(container.classList.contains('animating')).toBe(false)
    expect(emojiTab.classList.contains('active')).toBe(false)
    expect(emojiTab.classList.contains('from')).toBe(false)
    expect(stickersTab.classList.contains('to')).toBe(false)
    expect(stickersTab.classList.contains('active')).toBe(true)
    // tweb transition.ts:360 пишет id таймера и не удаляет его
    expect(emojiTab.hasAttribute('data-transition-timeout')).toBe(true)
  })

  it('вкладка наполняется только по окончании слайда (tweb onTransitionEnd → tab.init)', () => {
    vi.useFakeTimers()
    const { managers, stickers } = makeManagers()
    renderDropdown(managers, { onPickSticker: noop })

    act(() => {
      fireEvent.click(document.querySelector('.emoji-tabs-stickers')!)
    })
    // слайд ещё играет — вкладка пустая, за данными не ходили: иначе построение
    // ленты стикеров съедает первые кадры и первый переход виден рывком
    expect(stickers.recent).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(301)
    })
    expect(stickers.recent).toHaveBeenCalled()
  })
})

describe('StickersTab — Recent с крестиком очистки (tweb stickers.ts:193-213)', () => {
  it('заголовок Recent: span.i18n + disable-hover + btn-icon; подтверждение зовёт clearRecent и убирает секцию', async () => {
    const { managers, stickers } = makeManagers([stk(1), stk(2)])
    renderDropdown(managers, { onPickSticker: noop })

    fireEvent.click(document.querySelector('.emoji-tabs-stickers')!)

    // панель стикеров грузится лениво после выбора вкладки
    await waitFor(() => {
      expect(document.querySelector('#content-stickers .category-title')).not.toBeNull()
    })

    const title = document.querySelector('#content-stickers .category-title')!
    expect(title.classList.contains('disable-hover')).toBe(true)
    expect(title.querySelector('span.i18n')).not.toBeNull()
    const clearBtn = title.querySelector('button.btn-icon')!
    expect(clearBtn).not.toBeNull()

    // клик → confirmationPopup (tweb ClearRecentStickersAlert*)
    fireEvent.click(clearBtn)
    const popup = document.querySelector('.popup')!
    expect(popup).not.toBeNull()

    const confirm = [...popup.querySelectorAll('button')].find((b) => b.textContent === 'Clear')!
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(stickers.clearRecent).toHaveBeenCalledTimes(1)
    })
    // секция recent схлопнулась (локальное зеркало очистки)
    await waitFor(() => {
      expect(document.querySelector('#content-stickers .category-title')).toBeNull()
    })
  })
})

describe('EmojiDropdown — кнопка-лупа футера открывает экраны правой колонки (tweb index.ts:295-303)', () => {
  // Экраны сами дёргают менеджеры при монтировании — стабы поверх базовых
  // (плюс savedGifs/media.meta: GIF-вкладка дропдауна монтируется при клике).
  function searchManagers() {
    const { managers, stickers } = makeManagers()
    Object.assign(stickers, {
      featuredSets: vi.fn(async () => []),
      searchSets: vi.fn(async () => []),
      searchGifs: vi.fn(async () => ({ gifs: [], next: '' })),
      savedGifs: vi.fn(async () => []),
    })
    ;(managers as unknown as { media: object }).media = { meta: vi.fn(async () => null) }
    return managers
  }
  const popupApi = { open: true, requestClose: () => {}, onExitComplete: () => {}, destroy: () => {} }

  it('вкладка стикеров: клик по лупе кладёт попап kind=right-search с экраном поиска наборов', async () => {
    const managers = searchManagers()
    renderDropdown(managers, { onPickSticker: () => {}, onPickGif: () => {} })
    fireEvent.click(document.querySelector('.emoji-tabs-stickers')!)
    fireEvent.click(document.querySelector('.emoji-tabs-search')!)

    const { usePopupStore } = await import('../../stores/popupStore')
    const popups = usePopupStore.getState().popups
    const entry = popups[popups.length - 1]
    // литерал, не импортированная константа — иначе мутация kind не краснеет
    expect(entry.kind).toBe('right-search')
    render(<ManagersProvider managers={managers}>{entry.render(popupApi)}</ManagersProvider>)
    expect(document.getElementById('stickers-container')).not.toBeNull()
    usePopupStore.getState().clear()
  })

  it('вкладка GIF: клик по лупе открывает экран поиска GIF (ветка else, как в tweb)', async () => {
    const managers = searchManagers()
    renderDropdown(managers, { onPickSticker: () => {}, onPickGif: () => {} })
    fireEvent.click(document.querySelector('.emoji-tabs-gifs')!)
    fireEvent.click(document.querySelector('.emoji-tabs-search')!)

    const { usePopupStore } = await import('../../stores/popupStore')
    const popups = usePopupStore.getState().popups
    const entry = popups[popups.length - 1]
    expect(entry.kind).toBe('right-search')
    render(<ManagersProvider managers={managers}>{entry.render(popupApi)}</ManagersProvider>)
    expect(document.getElementById('search-gifs-container')).not.toBeNull()
    usePopupStore.getState().clear()
  })
})
