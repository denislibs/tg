// Пины СВАЙПА между вкладками подсистемы: порог жеста
// (`helpers/dom/handleTabSwipe.ts`, порт tweb `helpers/dom/handleTabSwipe.ts`),
// замок прокрутки на время перехода (`helpers/dom/lockTouchScroll.ts`, порт
// tweb `helpers/dom/lockTouchScroll.ts`) и их связка в `AppSearchSuper`
// (`appSearchSuper.ts`, порт tweb `src/components/appSearchSuper.ts:498-542`).
//
// ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ. `IS_TOUCH_SUPPORTED` (`environment/touchSupport.ts`)
// вычисляется на уровне модуля при импорте и в happy-dom всегда ложен, поэтому
// `AppSearchSuper` обработчик свайпа просто не заводит, а `SwipeHandler`
// слушает мышь вместо касаний. Флаг поднимается тем же приёмом, каким это уже
// сделано для самого `SwipeHandler` (`core/dom/swipeHandler.test.ts:1-15`):
// `vi.resetModules()` + `vi.doMock` + динамический импорт. Подменяется ОДНА
// булева константа среды — весь остальной код (жест, порог, замок, полоса
// вкладок, слайдер) работает настоящий.
//
// happy-dom не даёт выставить `touches`/`clientX` через конструктор `TouchEvent`,
// поэтому события собираются как базовый `Event` с дописанными полями — ровно
// так же, как в `core/dom/swipeHandler.test.ts:17-33`; код хендлера читает их
// как поля.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LangPackKey } from '@lib/langPack'
import type { SearchSuperManagers, SearchSuperMediaTab } from '@components/appSearchSuper'

function makeEvent(type: string, props: Record<string, unknown> = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  for(const [key, value] of Object.entries(props)) {
    Object.defineProperty(e, key, { value, configurable: true })
  }
  return e
}

function touchPoint(x: number, y: number, target: EventTarget) {
  return { clientX: x, clientY: y, pageX: x, pageY: y, target }
}

/**
 * Свайп в сеть не ходит: ручки обязательны (`AppSearchSuperOptions`), поэтому
 * стоят заглушки, которые обязаны остаться НЕПОЗВАННЫМИ.
 */
const IDLE_MANAGERS = {
  messages: {
    mediaHistory: () => { throw new Error('свайп не грузит данные') },
    searchCounters: () => { throw new Error('свайп не грузит данные') },
  },
} as unknown as SearchSuperManagers

async function loadWithTouch() {
  vi.resetModules()
  vi.doMock('@environment/touchSupport', () => ({ default: true }))
  // `vi.resetModules()` роняет и ядро локализации: общий сетап наполняет его
  // один раз на файл (`src/test/setup.ts:87-89`), а после сброса подписи
  // строились бы на пустом ядре и в DOM поехали бы имена ключей (пин
  // `src/test/domKeyLeak.ts`). Наполняем заново тем же входом, что и сетап.
  await import('@/test/lang')
  const handleTabSwipe = (await import('@helpers/dom/handleTabSwipe')).default
  const lockTouchScroll = (await import('@helpers/dom/lockTouchScroll')).default
  const AppSearchSuper = (await import('@components/appSearchSuper')).default
  const Scrollable = (await import('@components/scrollable')).default
  return { handleTabSwipe, lockTouchScroll, AppSearchSuper, Scrollable }
}

afterEach(() => {
  vi.doUnmock('@environment/touchSupport')
  vi.resetModules()
  document.body.replaceChildren()
})

describe('handleTabSwipe: порог жеста', () => {
  it('жест доводится до потребителя только когда палец прошёл БОЛЬШЕ 50px по X (tweb `handleTabSwipe.ts:11`)', async() => {
    const { handleTabSwipe } = await loadWithTouch()

    const element = document.createElement('div')
    document.body.append(element)

    const swipes: number[] = []
    const handler = handleTabSwipe({
      element,
      onSwipe: (xDiff) => {
        swipes.push(xDiff)
      },
    })

    element.dispatchEvent(makeEvent('touchstart', { touches: [touchPoint(300, 100, element)] }))
    await Promise.resolve() // handleStart асинхронный

    // ровно 50 — порог строгий, жест ещё не свайп
    document.dispatchEvent(makeEvent('touchmove', { touches: [touchPoint(250, 100, element)] }))
    expect(swipes).toEqual([])

    // 51 — уже свайп; знак отрицательный: три инверсии подряд
    // (`handleHorizontalSwipe` → `handleTabSwipe` → потребитель), палец влево
    document.dispatchEvent(makeEvent('touchmove', { touches: [touchPoint(249, 100, element)] }))
    expect(swipes).toEqual([-51])

    handler.removeListeners()
  })

  it('палец вправо даёт потребителю положительный xDiff', async() => {
    const { handleTabSwipe } = await loadWithTouch()

    const element = document.createElement('div')
    document.body.append(element)

    const swipes: number[] = []
    const handler = handleTabSwipe({
      element,
      onSwipe: (xDiff) => {
        swipes.push(xDiff)
      },
    })

    element.dispatchEvent(makeEvent('touchstart', { touches: [touchPoint(100, 100, element)] }))
    await Promise.resolve()
    document.dispatchEvent(makeEvent('touchmove', { touches: [touchPoint(180, 100, element)] }))

    expect(swipes).toEqual([80])

    handler.removeListeners()
  })
})

describe('lockTouchScroll: два замка на один вызов', () => {
  it('слушателя снимает ТОЛЬКО второй пришедший — и touchend пальца, и конец перехода (tweb `lockTouchScroll.ts:8`)', async() => {
    const { lockTouchScroll } = await loadWithTouch()

    const container = document.createElement('div')
    document.body.append(container)

    const unlock = lockTouchScroll(container)

    const first = makeEvent('touchmove')
    container.dispatchEvent(first)
    expect(first.defaultPrevented).toBe(true)

    // сняли ОДИН замок — «конец перехода вкладок»; палец ещё на экране
    unlock()
    const second = makeEvent('touchmove')
    container.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(true)

    // второй замок — палец отпущен
    container.dispatchEvent(makeEvent('touchend'))
    const third = makeEvent('touchmove')
    container.dispatchEvent(third)
    expect(third.defaultPrevented).toBe(false)
  })
})

describe('AppSearchSuper: свайп между вкладками', () => {
  const SCROLL_HEIGHT = 4000

  function makeMediaTabs(): SearchSuperMediaTab[] {
    return [
      { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
      { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
      { type: 'links', inputFilter: 'inputMessagesFilterUrl', name: 'SharedLinksTab2' as LangPackKey },
    ]
  }

  // Кадры анимации под ручным управлением — как в `appSearchSuper.scroll.test.ts`
  // (полоса вкладок переставляет `active` через `fastRaf`).
  let frames: FrameRequestCallback[] = []
  const realRaf = globalThis.requestAnimationFrame

  beforeEach(() => {
    frames = []
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => frames.push(cb)) as typeof requestAnimationFrame
  })

  afterEach(() => {
    flushFrames()
    globalThis.requestAnimationFrame = realRaf
  })

  function flushFrames() {
    while(frames.length) {
      const current = frames
      frames = []
      current.forEach((cb) => cb(0))
    }
  }

  async function build() {
    const { AppSearchSuper, Scrollable } = await loadWithTouch()

    const scrollableEl = document.createElement('div')
    document.body.append(scrollableEl)
    const scrollable = new Scrollable(scrollableEl)
    Object.defineProperty(scrollable.container, 'scrollHeight', { value: SCROLL_HEIGHT, configurable: true })

    const host = document.createElement('div')
    host.className = 'profile-content'
    host.getBoundingClientRect = () => ({ y: 0 }) as DOMRect
    scrollable.container.append(host)

    // Первый показ (`loadFirstTime`, счётчики и выбор вкладки) — не предмет
    // свайпа; `hideEmptyTabs: false` выключает его, как у левой колонки
    // (tweb `:2384-2386`): иначе `load`, который `selectTab` зовёт за пустой
    // вкладкой, требует `searchContext` и живых счётчиков.
    const searchSuper = new AppSearchSuper({ mediaTabs: makeMediaTabs(), scrollable, managers: IDLE_MANAGERS, hideEmptyTabs: false })
    // контекст поиска обязателен до первого `load` (tweb `:2382`) — его ставит владелец
    searchSuper.setQuery({ peerId: 1 })
    searchSuper.container.getBoundingClientRect = () => ({ y: 0 }) as DOMRect
    host.append(searchSuper.container)
    // Контекст поиска — до первой загрузки, как у потребителя оригинала
    // (`sharedMediaTab.setPeer` → `setQuery`): `load` читает `searchContext.peerId`
    // безусловно (tweb `:2532`, у нас — фильтр вкладок по виду пира, `:2551-2555`).
    searchSuper.setQuery({ peerId: 1 })

    Array.from(searchSuper.tabsContainer.children).forEach((tab) => {
      ;(tab as HTMLElement).getBoundingClientRect = () => ({ width: 400 }) as DOMRect
    })

    searchSuper.selectTab(0, false)
    return searchSuper
  }

  /** палец проходит `dx` по X от точки нажатия внутри контейнера вкладок */
  async function swipe(container: HTMLElement, dx: number) {
    container.dispatchEvent(makeEvent('touchstart', { touches: [touchPoint(300, 100, container)] }))
    await Promise.resolve()
    document.dispatchEvent(makeEvent('touchmove', { touches: [touchPoint(300 + dx, 100, container)] }))
  }

  it('палец влево — следующая вкладка, вправо — предыдущая (tweb :517-532)', async() => {
    const searchSuper = await build()

    await swipe(searchSuper.tabsContainer, -100)
    expect(searchSuper.mediaTab).toBe(searchSuper.mediaTabs[1])

    flushFrames()
    searchSuper.tabsContainer.children[1].dispatchEvent(new Event('transitionend', { bubbles: true }))

    await swipe(searchSuper.tabsContainer, 100)
    expect(searchSuper.mediaTab).toBe(searchSuper.mediaTabs[0])
  })

  it('скрытая соседняя вкладка пропускается — свайп перескакивает через неё (tweb :519-524)', async() => {
    const searchSuper = await build()

    // `hide` на строке ряда значит «в этом чате такой вкладки нет»
    searchSuper.mediaTabs[1].menuTab!.classList.add('hide')

    await swipe(searchSuper.tabsContainer, -100)

    expect(searchSuper.mediaTab).toBe(searchSuper.mediaTabs[2])
  })

  it('свайп запирает прокрутку до КОНЦА перехода, а не до отпускания пальца (tweb :535, :701-704)', async() => {
    const searchSuper = await build()
    const container = searchSuper.tabsContainer

    await swipe(container, -100)

    const during = makeEvent('touchmove')
    container.dispatchEvent(during)
    expect(during.defaultPrevented).toBe(true)

    // палец отпустили — замок ОДИН, прокрутка всё ещё заперта: вкладка ещё едет
    container.dispatchEvent(makeEvent('touchend'))
    const afterFinger = makeEvent('touchmove')
    container.dispatchEvent(afterFinger)
    expect(afterFinger.defaultPrevented).toBe(true)

    // конец перехода — второй замок снят, прокрутка снова живая
    flushFrames()
    container.children[1].dispatchEvent(new Event('transitionend', { bubbles: true }))

    const afterTransition = makeEvent('touchmove')
    container.dispatchEvent(afterTransition)
    expect(afterTransition.defaultPrevented).toBe(false)
  })

  it('свайп по горизонтальному скроллеру ряда вкладку не переключает (tweb :539-541)', async() => {
    const searchSuper = await build()

    // `verifyTouchTarget` отсекает жесты, начатые внутри `.scrollable-x` —
    // там свой горизонтальный скролл, и он важнее
    const navScrollable = searchSuper.navScrollable.container
    navScrollable.dispatchEvent(makeEvent('touchstart', { touches: [touchPoint(300, 100, navScrollable)] }))
    await Promise.resolve()
    document.dispatchEvent(makeEvent('touchmove', { touches: [touchPoint(200, 100, navScrollable)] }))

    expect(searchSuper.mediaTab).toBe(searchSuper.mediaTabs[0])
  })
})
