// navigationTransition — JS-часть navigation-перехода (порт tweb
// components/transition.ts:23-42 + бухгалтерия классов TransitionSlider).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NAVIGATION_TRANSITION_TIME, runNavigationTransition, slideNavigation } from './navigationTransition'
import { interruptHeavyAnimation, isHeavyAnimationInProgress } from './heavyAnimation'

function makeTabs() {
  const container = document.createElement('div')
  container.dataset.animation = 'navigation'
  const left = document.createElement('div')
  const center = document.createElement('div')
  left.className = center.className = 'tabs-tab'
  container.append(left, center)
  document.body.append(container)
  // happy-dom не считает layout — ширина берётся из мока
  const width = 800
  left.getBoundingClientRect = center.getBoundingClientRect =
    () => ({ width }) as DOMRect
  return { container, left, center, width }
}

beforeEach(() => {
  vi.useFakeTimers()
  interruptHeavyAnimation()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('slideNavigation', () => {
  it('вперёд: уходящий притормаживает на четверть ширины и темнеет, приходящий въезжает справа', () => {
    const { left, center, width } = makeTabs()
    const done = slideNavigation(center, left, true)

    // toRight → elements.reverse(): «тормозит» уходящий (prev), въезжает приходящий
    expect(left.style.filter).toBe('brightness(80%)')
    expect(left.style.transform).toBe(`translate3d(${-width * 0.25}px, 0px, 0)`)
    expect(center.classList.contains('active')).toBe(true)
    // приходящему инлайн сброшен после reflow — дальше его везёт CSS-переход
    expect(center.style.transform).toBe('')
    expect(center.style.filter).toBe('')

    done()
    expect(left.style.transform).toBe('')
    expect(left.style.filter).toBe('')
  })

  it('назад: тормозит и темнеет приходящий, уходящий уезжает на ширину вправо', () => {
    const { left, center, width } = makeTabs()
    slideNavigation(left, center, false)

    expect(left.style.filter).toBe('')
    expect(center.style.transform).toBe(`translate3d(${width}px, 0px, 0)`)
    expect(left.classList.contains('active')).toBe(true)
  })
})

describe('runNavigationTransition', () => {
  it('ставит animating/backwards и снимает их по концу перехода', () => {
    const { container, left, center } = makeTabs()
    left.classList.add('active')

    runNavigationTransition({ container, to: center, from: left, toRight: true })
    expect(container.classList.contains('animating')).toBe(true)
    expect(container.classList.contains('backwards')).toBe(false)
    expect(left.classList.contains('from')).toBe(true)
    expect(center.classList.contains('to')).toBe(true)
    expect(center.classList.contains('active')).toBe(true)

    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME + 100)
    expect(container.classList.contains('animating')).toBe(false)
    expect(left.classList.contains('active')).toBe(false)
    expect(left.classList.contains('from')).toBe(false)
    expect(center.classList.contains('to')).toBe(false)
  })

  it('назад по стеку — backwards', () => {
    const { container, left, center } = makeTabs()
    runNavigationTransition({ container, to: left, from: center, toRight: false })
    expect(container.classList.contains('backwards')).toBe(true)
  })

  it('на время перехода объявлена тяжёлая анимация', async () => {
    const { container, left, center } = makeTabs()
    runNavigationTransition({ container, to: center, from: left, toRight: true })
    expect(isHeavyAnimationInProgress()).toBe(true)

    await vi.advanceTimersByTimeAsync(NAVIGATION_TRANSITION_TIME * 2 + 10)
    expect(isHeavyAnimationInProgress()).toBe(false)
  })

  it('без вкладок (их двигает другой слой) — только классы контейнера и тяжёлая анимация', () => {
    const { container } = makeTabs()
    runNavigationTransition({ container, toRight: true })
    expect(container.classList.contains('animating')).toBe(true)
    expect(isHeavyAnimationInProgress()).toBe(true)

    vi.advanceTimersByTime(NAVIGATION_TRANSITION_TIME + 100)
    expect(container.classList.contains('animating')).toBe(false)
  })
})
