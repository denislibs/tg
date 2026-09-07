// Пины полосы вкладок (`components/horizontalMenu.ts`, порт
// `tweb/src/components/horizontalMenu.ts`).
//
// Что здесь проверяется РЕЗУЛЬТАТОМ, а не фактом вызова:
//  • какая вкладка помечена `active` в DOM после клика/программного вызова;
//  • куда физически уехал `scrollLeft` горизонтального скроллера (число);
//  • какие инлайновые `transform`/`width` и класс `animate` оказались на
//    подчёркивании в КАЖДОМ из двух кадров переезда полоски.
//
// Единственное место, где пин смотрит на проводку, — `onTransitionEnd`: у
// полосы нет своего перехода, она обязана отдать колбэк слайдеру содержимого
// (`tweb:141-147`), поэтому дублёр слайдера здесь настоящий (переключает
// содержимое и по `transitionTime` зовёт конец перехода), а пин ловит
// наблюдаемое следствие — потребитель дождался конца перехода.
//
// `fastSmoothScroll` подменён СПАЙОМ ПОВЕРХ НАСТОЯЩЕЙ реализации: числа
// скролла считает боевой код, а счётчик вызовов нужен для оптимизаций
// `tweb:64-79` («полоса не переполнена» / «выбрана первая при scrollLeft 0»).
// Обе экономят рейс до rAF, а не меняют итоговый scrollLeft — сам скроллер в
// этих случаях всё равно упирается в ноль, — так что наблюдаемое различие
// ровно одно: скроллер не трогают вовсе.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import fastSmoothScroll from '@helpers/fastSmoothScroll'
import { horizontalMenu, type CreateSelectTab, type SelectTab } from '@components/horizontalMenu'

vi.mock('@helpers/fastSmoothScroll', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@helpers/fastSmoothScroll')>()
  return { ...mod, default: vi.fn(mod.default) }
})

const scrollSpy = fastSmoothScroll as unknown as Mock

/** Кадры анимации под ручным управлением: `fastRaf` берёт rAF из глобала. */
let frames: FrameRequestCallback[] = []

function flushFrame() {
  const current = frames
  frames = []
  current.forEach((cb) => cb(0))
}

const stub = (el: HTMLElement, prop: string, value: number) =>
  Object.defineProperty(el, prop, { value, configurable: true })

/**
 * Полоса вкладок и контейнер содержимого — разметка `appSearchSuper.ts:461-499`:
 * `nav.menu-horizontal-div` → `div.menu-horizontal-div-item` →
 * `i.menu-horizontal-div-item-background` + `span.menu-horizontal-div-item-span`
 * (порядок узлов — `appSearchSuper.ts:483`, полоска первая).
 */
function build(count: number) {
  const tabs = document.createElement('nav')
  tabs.className = 'search-super-tabs menu-horizontal-div'

  const content = document.createElement('div')
  content.className = 'search-super-tabs-container tabs-container'

  for (let i = 0; i < count; ++i) {
    const item = document.createElement('div')
    item.className = 'menu-horizontal-div-item'
    const indicator = document.createElement('i')
    indicator.className = 'menu-horizontal-div-item-background'
    const span = document.createElement('span')
    span.className = 'menu-horizontal-div-item-span'
    span.textContent = `вкладка ${i}`
    item.append(indicator, span)
    tabs.append(item)

    const tab = document.createElement('div')
    tab.className = 'search-super-tab-container tabs-tab'
    content.append(tab)
  }

  document.body.append(tabs, content)
  return { tabs, content }
}

const items = (tabs: HTMLElement) => Array.from(tabs.children) as HTMLElement[]
const activeIndex = (el: HTMLElement) => items(el).findIndex((c) => c.classList.contains('active'))
const indicatorOf = (item: HTMLElement) => item.querySelector<HTMLElement>('.menu-horizontal-div-item-background')!

/**
 * Дублёр слайдера содержимого (задача 3 делает настоящий `TransitionSlider`).
 * Ведёт себя как оригинал в наблюдаемой части: помнит предыдущий индекс
 * (`tweb transition.ts:381`), переносит `active` на нужную вкладку содержимого
 * и по `transitionTime` объявляет конец перехода.
 */
function createSlider(): { create: CreateSelectTab, transitionEnds: number[] } {
  const transitionEnds: number[] = []

  const create: CreateSelectTab = (options) => {
    let prev = -1

    const selectTab = ((id, animate = true) => {
      const index = typeof id === 'number' ? id : Array.prototype.indexOf.call(options.content.children, id)
      Array.from(options.content.children).forEach((child, i) => child.classList.toggle('active', i === index))
      prev = index
      void animate
      setTimeout(() => {
        transitionEnds.push(index)
        options.onTransitionEnd?.()
      }, options.transitionTime)
    }) as SelectTab
    selectTab.prevId = () => prev

    return selectTab
  }

  return { create, transitionEnds }
}

/** Клик приходит по подписи внутри вкладки — как у живого пользователя. */
function clickTab(tabs: HTMLElement, index: number) {
  const span = items(tabs)[index].querySelector('span')!
  span.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
  scrollSpy.mockClear()
})

afterEach(() => {
  // Очередь `fastRaf` — модульная и освобождается только когда её кадр реально
  // отыгран. Недоигранный кадр одного теста иначе съел бы все `fastRaf`
  // следующего: они бы дописывались в осиротевшую очередь, а нового кадра никто
  // бы не заказал.
  for (let guard = 10; frames.length && guard; --guard) flushFrame()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('полоса вкладок: выбор вкладки', () => {
  it('клик переносит `active` на выбранную вкладку и снимает с прежней', () => {
    const { tabs, content } = build(3)
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create })

    selectTab(0)
    flushFrame()
    expect(activeIndex(tabs)).toBe(0)
    expect(activeIndex(content)).toBe(0)

    clickTab(tabs, 2)
    flushFrame()
    flushFrame()

    expect(activeIndex(tabs)).toBe(2)
    expect(activeIndex(content)).toBe(2)
  })

  it('`onClick` получает индекс вкладки и её узел содержимого', () => {
    const { tabs, content } = build(3)
    const { create } = createSlider()
    const seen: Array<{ id: number, tabContent: HTMLElement }> = []
    const selectTab = horizontalMenu({
      tabs,
      content,
      createSelectTab: create,
      onClick: (id, tabContent) => void seen.push({ id, tabContent }),
    })

    selectTab(0)
    flushFrame()
    clickTab(tabs, 1)
    flushFrame()

    expect(seen.map((s) => s.id)).toEqual([0, 1])
    expect(seen[1].tabContent).toBe(content.children[1])
  })

  it('`onClick`, вернувший false, оставляет и полосу, и содержимое на прежней вкладке', () => {
    const { tabs, content } = build(3)
    const { create } = createSlider()
    const selectTab = horizontalMenu({
      tabs,
      content,
      createSelectTab: create,
      // Вкладка 2 «занята»: оригинал отменяет переключение (`tweb:56-62`).
      onClick: (id) => id !== 2,
    })

    selectTab(0)
    flushFrame()
    clickTab(tabs, 2)
    flushFrame()
    flushFrame()

    expect(activeIndex(tabs)).toBe(0)
    expect(activeIndex(content)).toBe(0)
  })

  it('вкладка с `data-tab="-1"` не переключает ничего', () => {
    const { tabs, content } = build(3)
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create })

    selectTab(0)
    flushFrame()
    items(tabs)[2].dataset.tab = '-1'
    clickTab(tabs, 2)
    flushFrame()
    flushFrame()

    expect(activeIndex(tabs)).toBe(0)
    expect(activeIndex(content)).toBe(0)
  })

  it('вкладка адресуется атрибутом `data-tab`, а не только порядком в полосе', () => {
    const { tabs, content } = build(3)
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create })
    // Порядок узлов обратный номерам вкладок — как только полоса сортируется
    // не по индексу, адресация обязана идти по `data-tab` (`tweb:180`).
    items(tabs).forEach((item, i) => (item.dataset.tab = '' + (2 - i)))

    selectTab(2)
    flushFrame()

    expect(activeIndex(tabs)).toBe(0)
  })

  it('через прокси видна ручка `prevId` слайдера — ею пользуется правая колонка', () => {
    const { tabs, content } = build(3)
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create })

    expect(selectTab.prevId()).toBe(-1)
    selectTab(1)
    flushFrame()
    expect(selectTab.prevId()).toBe(1)
  })

  it('конец перехода содержимого доходит до потребителя полосы', async () => {
    const { tabs, content } = build(3)
    const { create, transitionEnds } = createSlider()
    const ended: number[] = []
    const selectTab = horizontalMenu({
      tabs,
      content,
      createSelectTab: create,
      transitionTime: 1,
      onTransitionEnd: () => ended.push(transitionEnds[transitionEnds.length - 1]),
    })

    selectTab(0)
    flushFrame()
    clickTab(tabs, 2)
    flushFrame()
    flushFrame()

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(ended).toEqual([0, 2])
  })
})

/**
 * Полоса шире своего окна — сценарий правой колонки с семью вкладками.
 * Числа выбраны так, чтобы центрирование давало ровное значение:
 * окно 300, вкладки по 200, вкладка №2 занимает 400…600, её центр 500 должен
 * встать в центр окна (150) → `scrollLeft = 350`.
 */
function buildScrollable(tabWidth: number, viewport: number, count: number) {
  const { tabs, content } = build(count)

  const container = document.createElement('div')
  container.className = 'scrollable scrollable-x'
  tabs.replaceWith(container)
  container.append(tabs)

  stub(container, 'clientWidth', viewport)
  stub(container, 'scrollWidth', tabWidth * count)
  container.getBoundingClientRect = () =>
    ({ left: 0, right: viewport, width: viewport, top: 0, bottom: 0, height: 0 }) as DOMRect

  items(tabs).forEach((item, i) => {
    stub(item, 'offsetWidth', tabWidth)
    item.getBoundingClientRect = () => {
      const left = i * tabWidth - container.scrollLeft
      return { left, right: left + tabWidth, width: tabWidth, top: 0, bottom: 0, height: 0 } as DOMRect
    }
  })

  return { tabs, content, container }
}

describe('полоса вкладок: автоцентрирование выбранной', () => {
  it('вкладка, не влезающая в окно полосы, доезжает в центр — scrollLeft 350', () => {
    const { tabs, content, container } = buildScrollable(200, 300, 5)
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create, scrollableX: { container } })

    // Без анимации скролл считается синхронно (`FocusDirection.Static`).
    selectTab(2, false)

    expect(container.scrollLeft).toBe(350)
  })

  it('полоса без переполнения не трогает скроллер вовсе', () => {
    const { tabs, content, container } = buildScrollable(100, 300, 3)
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create, scrollableX: { container } })

    selectTab(2, false)

    expect(scrollSpy).not.toHaveBeenCalled()
    expect(container.scrollLeft).toBe(0)
  })

  it('первая вкладка при scrollLeft 0 не запускает скролл, а вторая — запускает', () => {
    const { tabs, content, container } = buildScrollable(200, 300, 5)
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create, scrollableX: { container } })

    selectTab(0, false)
    expect(scrollSpy).not.toHaveBeenCalled()
    expect(container.scrollLeft).toBe(0)

    selectTab(1, false)
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(container.scrollLeft).toBe(150)
  })
})

/**
 * Подчёркивание. Геометрия задана числами: вкладки стоят на 0/120/240,
 * ширины подчёркиваний 100/90/80.
 */
function buildIndicators() {
  const { tabs, content } = build(3)
  const offsets = [0, 120, 240]
  const widths = [100, 90, 80]
  items(tabs).forEach((item, i) => {
    stub(item, 'offsetLeft', offsets[i])
    stub(indicatorOf(item), 'clientWidth', widths[i])
  })
  return { tabs, content }
}

describe('полоса вкладок: переезд подчёркивания', () => {
  it('первым кадром подчёркивание новой вкладки встаёт на место прежнего, вторым — едет к себе', () => {
    const { tabs, content } = buildIndicators()
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create })

    selectTab(0)
    flushFrame()

    const to = indicatorOf(items(tabs)[2])
    selectTab(2)
    flushFrame()

    // Прыжок к прежней вкладке: сдвиг = 0 − 240 (влево, к вкладке 0),
    // ширина = ширина прежнего подчёркивания (100), а не своя (80).
    expect(to.style.transform).toBe('translate3d(-240px, 0, 0)')
    expect(to.style.width).toBe('100px')
    expect(to.classList.contains('animate')).toBe(false)

    flushFrame()

    // Возврат к своим месту и ширине — уже переходом (класс `animate`).
    expect(to.classList.contains('animate')).toBe(true)
    expect(to.style.transform).toBe('none')
    expect(to.style.width).toBe('')
  })

  it('переезд справа налево берёт положительный сдвиг', () => {
    const { tabs, content } = buildIndicators()
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create })

    selectTab(2)
    flushFrame()
    flushFrame()

    const to = indicatorOf(items(tabs)[0])
    selectTab(0)
    flushFrame()

    // Идём с 240 на 0: подчёркивание вкладки 0 сначала прыгает вправо на +240
    // и берёт ширину 80 (ширина подчёркивания вкладки 2).
    expect(to.style.transform).toBe('translate3d(240px, 0, 0)')
    expect(to.style.width).toBe('80px')
  })

  it('первый показ полосы не двигает подчёркивание — ехать неоткуда', () => {
    const { tabs, content } = buildIndicators()
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create })

    selectTab(1)
    flushFrame()
    flushFrame()

    const to = indicatorOf(items(tabs)[1])
    expect(to.style.transform).toBe('')
    expect(to.style.width).toBe('')
    expect(to.classList.contains('animate')).toBe(false)
    expect(activeIndex(tabs)).toBe(1)
  })

  it('без анимации подчёркивание не ездит, а активность переносится в том же кадре', () => {
    const { tabs, content } = buildIndicators()
    const { create } = createSlider()
    const selectTab = horizontalMenu({ tabs, content, createSelectTab: create })

    selectTab(0)
    flushFrame()

    selectTab(2, false)

    // Ни одного отложенного кадра: `mutateCallback` при `animate: false` —
    // прямой вызов (`tweb:93`).
    expect(activeIndex(tabs)).toBe(2)
    expect(indicatorOf(items(tabs)[2]).style.transform).toBe('')
  })

  it('повторный выбор той же вкладки не перезапускает переезд', () => {
    const { tabs, content } = buildIndicators()
    const { create } = createSlider()
    const changes: Array<{ index: number, active: boolean }> = []
    const selectTab = horizontalMenu({
      tabs,
      content,
      createSelectTab: create,
      onChange: ({ element, active }) => changes.push({ index: items(tabs).indexOf(element), active }),
    })

    selectTab(1)
    flushFrame()
    flushFrame()
    const before = changes.length

    clickTab(tabs, 1)
    flushFrame()
    flushFrame()

    expect(changes.length).toBe(before)
    expect(indicatorOf(items(tabs)[1]).style.transform).toBe('')
  })
})

/**
 * СТЫК с настоящим слайдером содержимого. Выше слайдер — дублёр: он проверяет
 * полосу в отрыве от бухгалтерии классов `TransitionSlider` (у неё свой файл
 * пинов, `components/transition.test.ts`). Здесь наоборот — дублёра нет вовсе,
 * `createSelectTab` не передан, то есть работает дефолт (`TransitionSlider`,
 * `tweb horizontalMenu.ts:141-147`), и пин ловит ровно то, что ломается на шве:
 * одно переключение обязано сдвинуть И содержимое, И подчёркивание, причём
 * подчёркивание едет от вкладки, которую слайдер считает текущей
 * (`prevId()` — `tweb transition.ts:376`).
 */
describe('полоса вкладок поверх настоящего TransitionSlider', () => {
  const WIDTH = 400

  function buildWired() {
    const { tabs, content } = build(3)
    // happy-dom не считает layout: геометрия полосы и ширина вкладки — моками.
    const offsets = [0, 120, 240]
    const widths = [100, 90, 80]
    items(tabs).forEach((item, i) => {
      stub(item, 'offsetLeft', offsets[i])
      stub(indicatorOf(item), 'clientWidth', widths[i])
    })
    Array.from(content.children).forEach((child) => {
      ;(child as HTMLElement).getBoundingClientRect = () => ({ width: WIDTH }) as DOMRect
    })
    return { tabs, content }
  }

  it('одно переключение двигает и содержимое, и подчёркивание', () => {
    const { tabs, content } = buildWired()
    const selectTab = horizontalMenu({ tabs, content, transitionTime: 200 })

    selectTab(0)
    flushFrame()
    expect(activeIndex(tabs)).toBe(0)
    expect(activeIndex(content)).toBe(0)
    // Первый показ — мгновенный: сдвига нет (tweb `animateFirst: false`).
    expect((content.children[0] as HTMLElement).style.transform).toBe('')

    selectTab(2)

    // Содержимое поехало сразу, в том же кадре: `selectTab` слайдера зовётся
    // синхронно, вне `fastRaf` (`tweb horizontalMenu.ts:129`).
    expect(content.classList.contains('animating')).toBe(true)
    expect(content.classList.contains('backwards')).toBe(false)
    expect((content.children[0] as HTMLElement).style.transform).toBe(`translate3d(${-WIDTH}px, 0px, 0)`)
    expect(content.children[0].classList.contains('from')).toBe(true)
    expect(content.children[2].classList.contains('active')).toBe(true)
    expect(content.children[2].classList.contains('to')).toBe(true)

    // Подчёркивание — следующим кадром, и ОТ вкладки 0: слайдер отдал полосе
    // `prevId() === 0` ДО переключения, иначе сдвиг считался бы от самой себя.
    flushFrame()
    const to = indicatorOf(items(tabs)[2])
    expect(activeIndex(tabs)).toBe(2)
    expect(to.style.transform).toBe('translate3d(-240px, 0, 0)')
    expect(to.style.width).toBe('100px')

    flushFrame()
    expect(to.classList.contains('animate')).toBe(true)
    expect(to.style.transform).toBe('none')
  })

  it('возврат назад: содержимому `backwards`, подчёркиванию — положительный сдвиг', () => {
    const { tabs, content } = buildWired()
    const selectTab = horizontalMenu({ tabs, content, transitionTime: 200 })

    selectTab(2)
    flushFrame()
    flushFrame()
    // Настоящий конец CSS-перехода — иначе слайдер держит `animating`.
    for (const el of [content.children[2], content.children[0]]) {
      el.dispatchEvent(new Event('transitionend', { bubbles: true }))
    }

    selectTab(0)
    flushFrame()

    expect(content.classList.contains('backwards')).toBe(true)
    expect((content.children[2] as HTMLElement).style.transform).toBe(`translate3d(${WIDTH}px, 0px, 0)`)
    expect(indicatorOf(items(tabs)[0]).style.transform).toBe('translate3d(240px, 0, 0)')
    expect(activeIndex(tabs)).toBe(0)
  })

  it('содержимое вкладки переживает переключение туда-обратно: тот же узел и `scrollTop`', () => {
    const { tabs, content } = buildWired()
    const list = document.createElement('div')
    list.className = 'inner-list'
    content.children[0].append(list)
    const selectTab = horizontalMenu({ tabs, content, transitionTime: 200 })

    selectTab(0)
    flushFrame()
    list.scrollTop = 137

    selectTab(1)
    flushFrame()
    flushFrame()
    selectTab(0)
    flushFrame()
    flushFrame()

    expect(content.children[0].querySelector('.inner-list')).toBe(list)
    expect(list.scrollTop).toBe(137)
  })
})
