// ГЛАВНЫЙ ПИН ЗАДАЧИ: память позиции скролла между вкладками
// (`appSearchSuper.ts`, порт tweb `src/components/appSearchSuper.ts:624-708`).
//
// Механика, которую проверяем (`docs/tweb/shared-media.md` § 1.4):
//   1. при уходе с вкладки её позиция ЗАПОМИНАЕТСЯ (`tweb:651`);
//   2. если скролл стоит ВЫШЕ верха подсистемы, запоминается не он, а верх
//      подсистемы, и заодно скролл везётся в начало (`tweb:646-649`);
//   3. на время анимации приходящая вкладка сдвигается инлайновым
//      `translateY(diff)` — физически скролл ещё стоит там, где его оставила
//      уходящая, и без этого сдвига содержимое дёрнулось бы (`tweb:673`);
//   4. по КОНЦУ перехода инлайн снимается и выставляется настоящий
//      `scrollPosition` (`tweb:693-707`).
//
// Зависимости настоящие: живой `Scrollable` (он и владеет `scrollTop`), живая
// `horizontalMenu` и внутри неё живой `TransitionSlider` — конец перехода
// приходит НАСТОЯЩИМ событием `transitionend`, а не вызовом колбэка руками.
// Подменить слайдер дублёром здесь нельзя: половина проверяемого поведения —
// это то, КОГДА слайдер зовёт `onTransitionEnd`.
//
// happy-dom не считает layout, поэтому геометрия задаётся явно: `scrollHeight`,
// `offsetTop` и `getBoundingClientRect` — подменены ЗНАЧЕНИЯМИ, а не поведением.
// По той же причине подменена ровно одна функция скроллера —
// `scrollIntoViewNew`: за ней стоит `fastSmoothScroll`, который считает путь по
// настоящим прямоугольникам, а в happy-dom их нет (получился бы `NaN` в
// `scrollTop`). Проверяем ФАКТ и АРГУМЕНТЫ вызова — то единственное, что
// `scrollToStart` про себя утверждает (`appSearchSuper.ts`, порт `tweb:800-807`).
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import type { ScrollOptions } from '@helpers/fastSmoothScroll'
import { fastRaf } from '@helpers/schedulers'
import type { LangPackKey } from '@lib/langPack'

/** высота содержимого профиля, которую happy-dom сам не посчитает */
const SCROLL_HEIGHT = 4000
/** верх подсистемы относительно верха `.profile-content` */
const SUPER_OFFSET_FROM_PARENT = 50

function makeMediaTabs(): SearchSuperMediaTab[] {
  return [
    { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
    { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
    { type: 'links', inputFilter: 'inputMessagesFilterUrl', name: 'SharedLinksTab2' as LangPackKey },
  ]
}

/**
 * Ядро в сеть не ходит: эти тесты про разметку и скролл, и загрузку они не
 * запускают вовсе. Ручки — обязательные (`AppSearchSuperOptions`), поэтому
 * стоят заглушки, которые обязаны остаться НЕПОЗВАННЫМИ.
 */
const IDLE_MANAGERS = {
  messages: {
    mediaHistory: () => { throw new Error('ядро не грузит данные') },
    searchCounters: () => { throw new Error('ядро не грузит данные') },
  },
} as unknown as SearchSuperManagers

let scrollable: Scrollable
/** аргументы каждого `scrollToStart` — см. докблок файла */
let scrollIntoViewCalls: Omit<ScrollOptions, 'container'>[]
/** сколько раз подсистема просила скроллер пересчитаться */
let onScrollCalls: number

function build(options?: { scrollOffset?: number }) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  scrollable = new Scrollable(scrollableEl)
  Object.defineProperty(scrollable.container, 'scrollHeight', { value: SCROLL_HEIGHT, configurable: true })

  scrollIntoViewCalls = []
  scrollable.scrollIntoViewNew = (opts) => {
    scrollIntoViewCalls.push(opts)
    return Promise.resolve()
  }

  onScrollCalls = 0
  const realOnScroll = scrollable.onScroll
  scrollable.onScroll = () => {
    ++onScrollCalls
    realOnScroll()
  }

  const host = document.createElement('div')
  host.className = 'profile-content'
  host.getBoundingClientRect = () => ({ y: 0 }) as DOMRect
  scrollable.container.append(host)

  const searchSuper = new AppSearchSuper({ mediaTabs: makeMediaTabs(), scrollable, managers: IDLE_MANAGERS, ...options })
  searchSuper.container.getBoundingClientRect = () => ({ y: SUPER_OFFSET_FROM_PARENT }) as DOMRect
  host.append(searchSuper.container)

  // ширина вкладки нужна самой анимации `slideTabs` (`transition.ts:45-95`)
  Array.from(searchSuper.tabsContainer.children).forEach((tab) => {
    ;(tab as HTMLElement).getBoundingClientRect = () => ({ width: 400 }) as DOMRect
  })

  return searchSuper
}

/**
 * `container.offsetTop` — «верх подсистемы внутри прокручиваемого содержимого»
 * (`tweb:644`). happy-dom его не считает и всегда отдаёт 0.
 */
function setSuperOffsetTop(searchSuper: AppSearchSuper, value: number) {
  Object.defineProperty(searchSuper.container, 'offsetTop', { value, configurable: true })
}

// Кадры анимации под ручным управлением: полоса вкладок переставляет `active`
// и подчёркивание через `fastRaf` (`horizontalMenu.ts`), а happy-dom сам кадры
// не прокручивает. Без прокрутки второе переключение упирается в проверку
// «эта вкладка уже активна» и не доходит до слайдера — в браузере кадр
// проходит задолго до конца перехода.
let frames: FrameRequestCallback[] = []
const realRaf = globalThis.requestAnimationFrame

beforeEach(() => {
  frames = []
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => frames.push(cb)) as typeof requestAnimationFrame

  // ЗАТРАВКА: очередь `fastRaf` прокручивается и ПЕРЕД тестом, не только после.
  // Очередь модульная (`helpers/schedulers.ts:22-34`), а модуль общий на весь
  // воркер: файл, отработавший до нас в этом же воркере и оставивший
  // `fastRafCallbacks` непустыми, забрал бы себе все наши `fastRaf` — новый
  // кадр не планируется, пока очередь не пуста, и колбэки полосы вкладок не
  // сыграли бы НИКОГДА. Отказ был бы немой и не воспроизводимый в одиночном
  // прогоне файла, поэтому проверяем прямо: кладём метку и требуем, чтобы она
  // прокрутилась здесь и сейчас.
  let primed = false
  fastRaf(() => {
    primed = true
  })
  flushFrames()
  if(!primed) {
    throw new Error('очередь fastRaf досталась этому файлу непрокрученной — её держит другой файл прогона')
  }
})

function flushFrames() {
  while(frames.length) {
    const current = frames
    frames = []
    current.forEach((cb) => cb(0))
  }
}

/**
 * Настоящий конец CSS-перехода — событие на ПРИХОДЯЩЕЙ вкладке: слайдер зовёт
 * `onTransitionEnd` только по ней (`transition.ts`, ветка `e.target !== from`),
 * а `active` во время перехода висит на обеих сразу. Индекс приходящей —
 * `selectTab.prevId()` (`transition.ts:376`, «активная прямо сейчас»).
 */
function finishTransition(searchSuper: AppSearchSuper) {
  flushFrames()
  const incoming = searchSuper.tabsContainer.children[searchSuper.selectTab.prevId()]
  incoming.dispatchEvent(new Event('transitionend', { bubbles: true }))
}

afterEach(() => {
  // Обязательно докрутить кадры до конца теста: `fastRaf` держит МОДУЛЬНУЮ
  // очередь (`helpers/schedulers.ts:22-34`) и планирует настоящий кадр только
  // когда она пуста. Брошенная непрокрученной очередь пережила бы тест и
  // проглотила бы `fastRaf` следующего.
  flushFrames()
  globalThis.requestAnimationFrame = realRaf
  document.body.replaceChildren()
})

describe('AppSearchSuper: память позиции скролла между вкладками', () => {
  it('уходящая запоминает позицию, приходящая на время перехода сдвинута на разницу', () => {
    const searchSuper = build()
    const [media, files] = searchSuper.mediaTabs

    searchSuper.selectTab(0, false)
    scrollable.scrollPosition = 300

    searchSuper.selectTab(1)

    // 1. позиция уходящей запомнена вместе с высотой содержимого (`tweb:651`)
    expect(media.scroll).toEqual({ scrollTop: 300, scrollHeight: SCROLL_HEIGHT })
    // 2. приходящая первый раз: её позиция — верх подсистемы (`tweb:653-661`)
    expect(files.scroll).toEqual({ scrollTop: SUPER_OFFSET_FROM_PARENT, scrollHeight: 0 })
    // 3. и на время анимации она сдвинута ровно на разницу (`tweb:673`)
    expect(files.contentTab!.style.transform).toBe(`translateY(${300 - SUPER_OFFSET_FROM_PARENT}px)`)
    // физически скролл ещё НЕ переехал — он переедет по концу перехода
    expect(scrollable.scrollPosition).toBe(300)
  })

  it('по концу перехода сдвиг снят, а scrollPosition выставлен настоящий (tweb :693-707)', () => {
    const searchSuper = build()
    const files = searchSuper.mediaTabs[1]

    searchSuper.selectTab(0, false)
    scrollable.scrollPosition = 300
    searchSuper.selectTab(1)

    finishTransition(searchSuper)

    expect(files.contentTab!.style.transform).toBe('')
    expect(scrollable.scrollPosition).toBe(SUPER_OFFSET_FROM_PARENT)
  })

  it('конец перехода пересчитывает скроллер (tweb :693)', () => {
    const searchSuper = build()

    searchSuper.selectTab(0, false)
    scrollable.scrollPosition = 300
    searchSuper.selectTab(1)

    const before = onScrollCalls
    finishTransition(searchSuper)

    // высота содержимого сменилась вместе с вкладкой — не пересчитать скроллер
    // значит оставить ему прежние размеры и сорвать догрузку по достижению низа
    expect(onScrollCalls).toBe(before + 1)
  })

  it('возврат на вкладку восстанавливает её позицию — прокрутили A, ушли на B, вернулись', () => {
    const searchSuper = build()
    const [media, files] = searchSuper.mediaTabs

    searchSuper.selectTab(0, false)
    scrollable.scrollPosition = 300

    searchSuper.selectTab(1)
    finishTransition(searchSuper)
    expect(scrollable.scrollPosition).toBe(SUPER_OFFSET_FROM_PARENT)

    // на вкладке B ещё немного прокрутили
    scrollable.scrollPosition = 120

    searchSuper.selectTab(0)
    // приходящая A знает свою позицию (300), уходящая B запомнила свою (120)
    expect(files.scroll).toEqual({ scrollTop: 120, scrollHeight: SCROLL_HEIGHT })
    expect(media.contentTab!.style.transform).toBe(`translateY(${120 - 300}px)`)

    finishTransition(searchSuper)

    expect(media.contentTab!.style.transform).toBe('')
    expect(scrollable.scrollPosition).toBe(300)
  })

  it('вкладка не размонтируется: её поддерево и содержимое переживают переключение', () => {
    const searchSuper = build()
    const media = searchSuper.mediaTabs[0]

    searchSuper.selectTab(0, false)
    const item = document.createElement('div')
    item.className = 'search-super-item'
    media.itemsTab!.append(item)

    searchSuper.selectTab(1)
    finishTransition(searchSuper)

    expect(media.itemsTab!.contains(item)).toBe(true)
    expect(document.body.contains(item)).toBe(true)
  })

  it('переход помечает подсистему классом sliding и снимает его по концу (tweb :809-815)', () => {
    const searchSuper = build()

    searchSuper.selectTab(0, false)
    searchSuper.selectTab(1)

    expect(searchSuper.container.classList.contains('sliding')).toBe(true)

    finishTransition(searchSuper)

    expect(searchSuper.container.classList.contains('sliding')).toBe(false)
  })

  it('без анимации sliding не появляется ВОВСЕ (tweb :637)', () => {
    const searchSuper = build()
    searchSuper.selectTab(0, false)

    // `sliding` снимает с подсистемы `max-height` (`_searchSuper.scss`), а сразу
    // после `onTransitionStart` класс читает геометрию (`offsetTop`,
    // `getBoundingClientRect`) — то есть лишний `sliding` мерил бы РАЗВЁРНУТУЮ
    // подсистему. При `animate = false` слайдер зовёт `onTransitionEnd`
    // синхронно (`transition.ts:241-263`), и класс успел бы сняться в том же
    // вызове: снаружи его не увидеть иначе как наблюдателем мутаций.
    const observer = new MutationObserver(() => {})
    observer.observe(searchSuper.container, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    })

    searchSuper.selectTab(1, false)

    const records = observer.takeRecords()
    observer.disconnect()

    expect(searchSuper.mediaTab).toBe(searchSuper.mediaTabs[1])
    expect(records.some((record) => record.oldValue?.includes('sliding'))).toBe(false)
    expect(searchSuper.container.classList.contains('sliding')).toBe(false)
  })

  it('cleanScrollPositions забывает все позиции — следующий заход считает их заново', () => {
    const searchSuper = build()
    const [media, files] = searchSuper.mediaTabs

    searchSuper.selectTab(0, false)
    scrollable.scrollPosition = 300
    searchSuper.selectTab(1)
    finishTransition(searchSuper)

    searchSuper.cleanScrollPositions()

    expect(media.scroll).toBeUndefined()
    expect(files.scroll).toBeUndefined()
  })

  it('повторный клик по активной вкладке не трогает память, а везёт скролл в начало (tweb :625-628)', () => {
    const searchSuper = build()
    const media = searchSuper.mediaTabs[0]

    searchSuper.selectTab(0, false)
    scrollable.scrollPosition = 300
    const remembered = media.scroll
    scrollIntoViewCalls.length = 0

    // тот же id — `horizontalMenu` зовёт `onClick` и на нём тоже
    searchSuper.selectTab(0)

    expect(media.scroll).toBe(remembered)
    expect(media.contentTab!.style.transform).toBe('')

    // вторая половина поведения: скролл ВЕЗЁТСЯ В НАЧАЛО подсистемы
    expect(scrollIntoViewCalls).toHaveLength(1)
    expect(scrollIntoViewCalls[0].element).toBe(searchSuper.container)
    expect(scrollIntoViewCalls[0].position).toBe('start')
  })
})

describe('AppSearchSuper: подсистема выше видимой области', () => {
  it('скролл выше верха подсистемы — везём в начало и запоминаем верх, а не текущую позицию (tweb :646-649)', () => {
    const searchSuper = build()
    const [media, files] = searchSuper.mediaTabs
    setSuperOffsetTop(searchSuper, 200)

    searchSuper.selectTab(0, false)
    scrollable.scrollPosition = 30 // подсистема ещё не доехала до верха экрана
    scrollIntoViewCalls.length = 0

    searchSuper.selectTab(1)

    expect(scrollIntoViewCalls).toHaveLength(1)
    expect(scrollIntoViewCalls[0].element).toBe(searchSuper.container)
    expect(scrollIntoViewCalls[0].position).toBe('start')

    // уходящая запоминает НЕ 30, а верх подсистемы: скролл уже едет туда
    expect(media.scroll).toEqual({ scrollTop: 200, scrollHeight: SCROLL_HEIGHT })
    expect(files.scroll).toEqual({ scrollTop: SUPER_OFFSET_FROM_PARENT, scrollHeight: 0 })
    expect(files.contentTab!.style.transform).toBe(`translateY(${200 - SUPER_OFFSET_FROM_PARENT}px)`)
  })

  it('scrollOffset поднимает порог «выше подсистемы» на свою величину (tweb :644)', () => {
    const searchSuper = build({ scrollOffset: 16 })
    const media = searchSuper.mediaTabs[0]
    setSuperOffsetTop(searchSuper, 200)

    searchSuper.selectTab(0, false)
    // 190 ниже порога `200 - 16 = 184` — доводить нечего
    scrollable.scrollPosition = 190
    scrollIntoViewCalls.length = 0

    searchSuper.selectTab(1)

    expect(scrollIntoViewCalls).toHaveLength(0)
    expect(media.scroll).toEqual({ scrollTop: 190, scrollHeight: SCROLL_HEIGHT })
  })

  it('первый заход НЕ запоминает позицию, если скролл ровно на верху подсистемы (tweb :658)', () => {
    const searchSuper = build()
    const [media, files] = searchSuper.mediaTabs

    searchSuper.selectTab(0, false)
    // ровно верх подсистемы: сравнение строгое, запоминать нечего
    scrollable.scrollPosition = SUPER_OFFSET_FROM_PARENT

    searchSuper.selectTab(1)

    expect(media.scroll).toEqual({ scrollTop: SUPER_OFFSET_FROM_PARENT, scrollHeight: SCROLL_HEIGHT })
    expect(files.scroll).toBeUndefined()
    // без запомненной позиции приходящую не сдвигают вовсе
    expect(files.contentTab!.style.transform).toBe('')

    finishTransition(searchSuper)

    // и по концу перехода скролл остаётся там, где стоял
    expect(scrollable.scrollPosition).toBe(SUPER_OFFSET_FROM_PARENT)
  })
})
