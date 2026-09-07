// Порт tweb `src/components/transition.ts` — обе функции анимации
// (`slideNavigation` :23-43, `slideTabs` :45-95) и бухгалтерия классов
// `TransitionSlider` (:169-381).
//
// Пины здесь — на РЕЗУЛЬТАТ: инлайновый `transform` на узлах, набор классов,
// живость поддерева вкладки и её `scrollTop`. Форму вызова (кого позвали и с
// чем) не проверяем — она мутациями не ловится.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import TransitionSlider, {
  NAVIGATION_TRANSITION_TIME,
  clearPendingTransitionCleanup,
  runNavigationTransition,
  slideNavigation,
} from './transition'
import { interruptHeavyAnimation, isHeavyAnimationInProgress } from '@core/dom/heavyAnimation'

/** happy-dom не считает layout — ширину вкладки задаём моком */
const WIDTH = 800
const TABS_TRANSITION_TIME = 200

function makeTabs(count = 2) {
  const content = document.createElement('div')
  content.className = 'tabs-container'
  const tabs = Array.from({ length: count }, () => {
    const tab = document.createElement('div')
    tab.className = 'tabs-tab'
    tab.getBoundingClientRect = () => ({ width: WIDTH }) as DOMRect
    content.append(tab)
    return tab
  })
  document.body.append(content)
  return { content, tabs }
}

/** Настоящий конец CSS-перехода: tweb снимает временные классы по нему (:200-233). */
function fireTransitionEnd(...elements: HTMLElement[]) {
  for (const element of elements) {
    element.dispatchEvent(new Event('transitionend', { bubbles: true }))
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  interruptHeavyAnimation()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

// ── slideTabs (tweb :45-95) ─────────────────────────────────────────────────
// Вкладки едут симметрично на ±width и БЕЗ `filter` — этим `slideTabs`
// отличается от `slideNavigation`, где уходящий тормозит на четверти ширины и
// притемняется.
describe('TransitionSlider type=tabs — сдвиг на ±width', () => {
  it('вперёд: уходящая уезжает на -width, приходящей инлайн сброшен, яркость никто не трогает', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)
    selectTab(1)

    expect(tabs[0].style.transform).toBe(`translate3d(${-WIDTH}px, 0px, 0)`)
    expect(tabs[1].style.transform).toBe('') // после reflow — дальше везёт CSS
    expect(tabs[0].style.filter).toBe('')
    expect(tabs[1].style.filter).toBe('')
  })

  it('назад: уходящая уезжает на +width (знак задаёт reverse по toRight)', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)
    selectTab(1)
    fireTransitionEnd(tabs[0], tabs[1])
    selectTab(0)

    expect(tabs[1].style.transform).toBe(`translate3d(${WIDTH}px, 0px, 0)`)
    expect(tabs[0].style.transform).toBe('')
  })
})

describe('TransitionSlider — бухгалтерия классов', () => {
  it('0→1: уходящей `from`, приходящей `active to`, контейнеру `animating` без `backwards`', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)
    selectTab(1)

    expect(content.classList.contains('animating')).toBe(true)
    expect(content.classList.contains('backwards')).toBe(false)
    expect(tabs[0].classList.contains('from')).toBe(true)
    expect(tabs[0].classList.contains('active')).toBe(true) // уходящая ещё видима
    expect(tabs[1].classList.contains('active')).toBe(true)
    expect(tabs[1].classList.contains('to')).toBe(true)
  })

  it('1→0: контейнеру `backwards` (по нему CSS берёт out-кривую)', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)
    selectTab(1)
    fireTransitionEnd(tabs[0], tabs[1])
    selectTab(0)

    expect(content.classList.contains('backwards')).toBe(true)
  })

  it('первое переключение — мгновенное: ни `animating`, ни сдвига', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)

    expect(tabs[0].classList.contains('active')).toBe(true)
    expect(content.classList.contains('animating')).toBe(false)
    expect(tabs[0].style.transform).toBe('')
  })

  it('по transitionend временные классы сняты со всех троих', () => {
    const { content, tabs } = makeTabs()
    const ended: number[] = []
    const selectTab = TransitionSlider({
      content,
      type: 'tabs',
      transitionTime: TABS_TRANSITION_TIME,
      onTransitionEnd: (id) => ended.push(id),
    })

    selectTab(0)
    ended.length = 0
    selectTab(1)
    fireTransitionEnd(tabs[0], tabs[1])

    expect(tabs[0].classList.contains('active')).toBe(false)
    expect(tabs[0].classList.contains('from')).toBe(false)
    expect(tabs[0].style.transform).toBe('')
    expect(tabs[1].classList.contains('to')).toBe(false)
    expect(tabs[1].classList.contains('active')).toBe(true)
    expect(content.classList.contains('animating')).toBe(false)
    expect(content.classList.contains('backwards')).toBe(false)
    expect(ended).toEqual([1])
  })

  it('страховочный таймер (transitionTime + 100) убирает уходящую и без события', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)
    selectTab(1)
    // Событие не приходит вовсе (переход сорван сменой раскладки/вкладка скрыта).
    vi.advanceTimersByTime(TABS_TRANSITION_TIME + 100)

    expect(tabs[0].classList.contains('active')).toBe(false)
    expect(tabs[0].classList.contains('from')).toBe(false)
    expect(tabs[0].style.transform).toBe('') // иначе вкладка застряла сдвинутой
  })
})

// Главный пин задачи: вкладка не размонтируется, поэтому её поддерево и
// позиция прокрутки переживают переключение туда-обратно.
describe('TransitionSlider — содержимое вкладки переживает переключение', () => {
  it('туда-обратно: тот же узел и тот же scrollTop', () => {
    const { content, tabs } = makeTabs()
    const list = document.createElement('div')
    list.className = 'inner-list'
    tabs[0].append(list)
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)
    list.scrollTop = 137

    selectTab(1)
    fireTransitionEnd(tabs[0], tabs[1])
    // Ушедшая вкладка осталась в DOM со своим содержимым — её только спрятали классом.
    expect(tabs[0].querySelector('.inner-list')).toBe(list)
    expect(list.scrollTop).toBe(137)

    selectTab(0)
    fireTransitionEnd(tabs[1], tabs[0])

    expect(tabs[0].querySelector('.inner-list')).toBe(list)
    expect(list.scrollTop).toBe(137)
    expect(tabs[0].classList.contains('active')).toBe(true)
    expect(tabs[1].classList.contains('active')).toBe(false)
  })
})

// Отложенная уборка перехода живёт НА УЗЛЕ (`dataset.transitionTimeout`).
// Отступление от tweb: там уборка приходящей вкладки запускается только когда
// уходящей нет (`else if(to)`, :273-276) — см. шапку `transition.ts`.
describe('TransitionSlider — чужая отложенная уборка', () => {
  it('мгновенный возврат до истечения таймера не оставляет экран пустым', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)
    selectTab(1) // на tabs[0] повисает отложенная уборка
    expect(tabs[0].dataset.transitionTimeout).toBeDefined()

    selectTab(0, false) // возврат быстрее таймера, без анимации
    vi.advanceTimersByTime(TABS_TRANSITION_TIME + 200)

    expect(tabs[0].classList.contains('active')).toBe(true)
    expect(tabs[0].style.transform).toBe('') // и не осталась сдвинутой
    expect(tabs[1].classList.contains('active')).toBe(false)
  })

  it('анимированный возврат до истечения таймера — то же самое', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)
    selectTab(1)
    selectTab(0)
    vi.advanceTimersByTime(TABS_TRANSITION_TIME + 200)

    expect(tabs[0].classList.contains('active')).toBe(true)
  })
})

describe('TransitionSlider — prevId/getFrom/setFrom (tweb :376-378)', () => {
  it('после перехода prevId — индекс приходящей, getFrom — её узел', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)
    selectTab(1)

    expect(selectTab.prevId()).toBe(1)
    expect(selectTab.getFrom()).toBe(tabs[1])
  })

  it('setFrom переучивает слайдер: тот же id больше не переигрывается', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'tabs', transitionTime: TABS_TRANSITION_TIME })

    selectTab(0)
    selectTab(1)
    fireTransitionEnd(tabs[0], tabs[1])
    selectTab.setFrom(tabs[0])

    selectTab(0) // id === prevId — переход не запускается
    expect(content.classList.contains('animating')).toBe(false)
  })
})

// ── slideNavigation (tweb :23-43) ───────────────────────────────────────────
describe('slideNavigation', () => {
  it('вперёд: уходящий притормаживает на четверть ширины и темнеет, приходящий въезжает справа', () => {
    const { tabs } = makeTabs()
    const [left, center] = tabs
    const done = slideNavigation(center, left, true)

    // toRight → elements.reverse(): «тормозит» уходящий (prev), въезжает приходящий
    expect(left.style.filter).toBe('brightness(80%)')
    expect(left.style.transform).toBe(`translate3d(${-WIDTH * 0.25}px, 0px, 0)`)
    expect(center.classList.contains('active')).toBe(true)
    // приходящему инлайн сброшен после reflow — дальше его везёт CSS-переход
    expect(center.style.transform).toBe('')
    expect(center.style.filter).toBe('')

    done()
    expect(left.style.transform).toBe('')
    expect(left.style.filter).toBe('')
  })

  it('назад: тормозит и темнеет приходящий, уходящий уезжает на ширину вправо', () => {
    const { tabs } = makeTabs()
    const [left, center] = tabs
    slideNavigation(left, center, false)

    expect(left.style.filter).toBe('')
    expect(center.style.transform).toBe(`translate3d(${WIDTH}px, 0px, 0)`)
    expect(left.classList.contains('active')).toBe(true)
  })
})

describe('TransitionSlider type=navigation — та же бухгалтерия, другая анимация', () => {
  it('уходящая вкладка притемняется — признак slideNavigation, а не slideTabs', () => {
    const { content, tabs } = makeTabs()
    const selectTab = TransitionSlider({ content, type: 'navigation', transitionTime: NAVIGATION_TRANSITION_TIME })

    selectTab(0)
    selectTab(1)

    expect(content.dataset.animation).toBe('navigation')
    expect(tabs[0].style.filter).toBe('brightness(80%)')
    expect(tabs[0].style.transform).toBe(`translate3d(${-WIDTH * 0.25}px, 0px, 0)`)
  })
})

// ── runNavigationTransition: одно переключение без памяти о вкладках ────────
// Наше расширение поверх порта, см. шапку `transition.ts`.
describe('runNavigationTransition', () => {
  it('ставит animating/backwards и снимает их по концу перехода', () => {
    const { content, tabs } = makeTabs()
    const [left, center] = tabs
    left.classList.add('active')

    runNavigationTransition({ container: content, to: center, from: left, toRight: true })
    expect(content.classList.contains('animating')).toBe(true)
    expect(content.classList.contains('backwards')).toBe(false)
    expect(left.classList.contains('from')).toBe(true)
    expect(center.classList.contains('to')).toBe(true)
    expect(center.classList.contains('active')).toBe(true)

    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME + 100)
    expect(content.classList.contains('animating')).toBe(false)
    expect(left.classList.contains('active')).toBe(false)
    expect(left.classList.contains('from')).toBe(false)
    expect(center.classList.contains('to')).toBe(false)
  })

  it('назад по стеку — backwards', () => {
    const { content, tabs } = makeTabs()
    runNavigationTransition({ container: content, to: tabs[0], from: tabs[1], toRight: false })
    expect(content.classList.contains('backwards')).toBe(true)
  })

  it('на время перехода объявлена тяжёлая анимация', async () => {
    const { content, tabs } = makeTabs()
    runNavigationTransition({ container: content, to: tabs[1], from: tabs[0], toRight: true })
    expect(isHeavyAnimationInProgress()).toBe(true)

    await vi.advanceTimersByTimeAsync(NAVIGATION_TRANSITION_TIME * 2 + 10)
    expect(isHeavyAnimationInProgress()).toBe(false)
  })

  it('без вкладок (их двигает другой слой) — только классы контейнера и тяжёлая анимация', () => {
    const { content } = makeTabs()
    runNavigationTransition({ container: content, toRight: true })
    expect(content.classList.contains('animating')).toBe(true)
    expect(isHeavyAnimationInProgress()).toBe(true)

    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME + 100)
    expect(content.classList.contains('animating')).toBe(false)
  })

  it('clearPendingTransitionCleanup снимает уборку, повисшую на узле', () => {
    const { content, tabs } = makeTabs()
    const [left, center] = tabs
    left.classList.add('active')
    runNavigationTransition({ container: content, to: center, from: left, toRight: true })

    left.classList.add('active') // хост вернул вкладку мгновенно
    clearPendingTransitionCleanup(left)
    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME + 200)

    expect(left.classList.contains('active')).toBe(true)
  })
})
