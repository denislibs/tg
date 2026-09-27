/** @jsxImportSource solid-js */
/**
 * Тесты порта `scrollable2.solid.tsx` — Solid-обёртки скролла.
 *
 * Пины из брифа задачи (task-2-brief.md):
 *  1. Узел отдаёт наружу те же ручки, что у оригинала: `ref` получает сам
 *     контейнер, `contextRef` — `ScrollableContextValue` (`container` — тот
 *     же DOM-узел, гетторы читают его геометрию). Это ровно то, чем
 *     пользуется `AuthCardsHost.tsx:161-173` у tweb (`ref`) плюс полный
 *     контракт для будущих потребителей `withBorders`/`onScrolledTop` и т.п.
 *  2. Подписка на шину тяжёлых анимаций снимается на `onCleanup`
 *     (`scrollable2.tsx:104`: `onCleanup(removeHeavyAnimationListener)`) —
 *     мокаем `onHeavyAnimation` и проверяем, что возвращённая им функция
 *     отписки реально вызывается при размонтировании.
 *  3. Концы скролла (tweb 3eb7a9020 + 2556fc949, `scrollable2.tsx:53-58`,
 *     `:228-231`, `:275-298`, `:320-325`): `trackEnds` держит
 *     `isScrolledToStart/End` контекста без рамки; без `trackEnds`/`withBorders`
 *     концы не считаются; `onSizeChange` и включение слежения после монтирования
 *     пересчитывают их.
 *  4. `tabIndex` (472e3e76b, `:48`, `:345`) доходит до корневого узла.
 *
 * `@core/dom/heavyAnimation` мокается: это та же шина, на которую подписан
 * `components/animationIntersector.ts` (см. шапку `scrollable.ts`), и
 * реальная подписка module-level — снаружи не видно, вызвалась ли функция
 * ОТПИСКИ. Мок делает именно эту невидимую связь наблюдаемой.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScrollableContextValue } from './scrollable2.solid'

const offSpy = vi.fn()
const onHeavyAnimation = vi.fn((..._args: unknown[]) => offSpy)

vi.mock('@core/dom/heavyAnimation', () => ({
  onHeavyAnimation: (...args: unknown[]) => onHeavyAnimation(...(args as [never, never])),
}))

// Замер скролла троттлится `setTimeout(24)` при оверлейном скролле и rAF без него
// (`throttleMeasurement`); в happy-dom ветка зависит от UA. Фиксируем оверлейную —
// тогда замер двигают фейковые таймеры, а `onSizeChange` не зовёт `onScroll`
// (ветка ползунка), и пересчёт концов в нём виден сам по себе.
vi.mock('@environment/overlayScrollSupport', () => ({
  IS_OVERLAY_SCROLL_SUPPORTED: () => true,
}))

const { render } = await import('solid-js/web')
const { createSignal } = await import('solid-js')
const { default: Scrollable } = await import('./scrollable2.solid')

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function mount(component: () => unknown) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(component as () => never, host)
  return host
}

afterEach(() => {
  vi.useRealTimers()
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  onHeavyAnimation.mockClear()
  offSpy.mockClear()
})

describe('scrollable2.solid: наружные ручки', () => {
  it('ref получает сам контейнер .scrollable.scrollable-y, дети внутри', () => {
    let refEl: HTMLDivElement | undefined
    const el = mount(() => (
      <Scrollable ref={(node) => { refEl = node }}>
        <div class="payload">x</div>
      </Scrollable>
    ))

    const container = el.querySelector<HTMLDivElement>('.scrollable.scrollable-y')!
    expect(refEl).toBe(container)
    expect(container.querySelector('.payload')).not.toBeNull()
  })

  it('contextRef отдаёт ScrollableContextValue с тем же container и рабочими геттерами', () => {
    let ctx: ScrollableContextValue | undefined
    const el = mount(() => (
      <Scrollable contextRef={(value) => { ctx = value }}>
        <div>x</div>
      </Scrollable>
    ))

    const container = el.querySelector<HTMLDivElement>('.scrollable')!
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true })
    container.scrollTop = 100

    expect(ctx).toBeDefined()
    expect(ctx!.container).toBe(container)
    expect(ctx!.scrollPosition).toBe(100)
    expect(ctx!.scrollSize).toBe(1000)
    expect(ctx!.clientSize).toBe(500)
    expect(typeof ctx!.setScrollPositionSilently).toBe('function')
    expect(typeof ctx!.checkForTriggers).toBe('function')
  })
})

describe('scrollable2.solid: подписка на тяжёлые анимации снимается на onCleanup', () => {
  it('размонтирование зовёт функцию отписки, возвращённую onHeavyAnimation', () => {
    mount(() => <Scrollable><div>x</div></Scrollable>)

    expect(onHeavyAnimation).toHaveBeenCalledTimes(1)
    expect(offSpy).not.toHaveBeenCalled()

    dispose!()
    dispose = undefined

    expect(offSpy).toHaveBeenCalledTimes(1)
  })
})

/** Контент выше контейнера: 1000 против 500, как у длинного тела попапа. */
function stubGeometry(container: HTMLDivElement, scrollTop: number) {
  Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(container, 'offsetHeight', { value: 500, configurable: true })
  container.scrollTop = scrollTop
}

describe('scrollable2.solid: концы скролла (trackEnds, 3eb7a9020 + 2556fc949)', () => {
  it('trackEnds: isScrolledToStart/End следуют за скроллом, рамки (scrolled-start) нет', () => {
    vi.useFakeTimers()
    let ctx: ScrollableContextValue | undefined
    const el = mount(() => (
      <Scrollable trackEnds contextRef={(value) => { ctx = value }}>
        <div>x</div>
      </Scrollable>
    ))
    const container = el.querySelector<HTMLDivElement>('.scrollable')!
    stubGeometry(container, 0)

    expect(ctx!.isScrolledToStart).toBe(true)

    container.scrollTop = 10
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(24)

    expect(ctx!.isScrolledToStart).toBe(false)
    expect(ctx!.isScrolledToEnd).toBe(false)
    expect(container.classList.contains('scrolled-start')).toBe(false)
    expect(container.classList.contains('scrolled-end')).toBe(false)
    expect(container.classList.contains('scrollable-y-bordered')).toBe(false)
  })

  it('без trackEnds и withBorders концы не считаются: isScrolledToStart остаётся true', () => {
    vi.useFakeTimers()
    let ctx: ScrollableContextValue | undefined
    const el = mount(() => (
      <Scrollable contextRef={(value) => { ctx = value }}>
        <div>x</div>
      </Scrollable>
    ))
    const container = el.querySelector<HTMLDivElement>('.scrollable')!
    stubGeometry(container, 0)

    container.scrollTop = 10
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(24)
    ctx!.onSizeChange()

    expect(ctx!.isScrolledToStart).toBe(true)
    expect(ctx!.isScrolledToEnd).toBe(true)
  })

  it('onSizeChange пересчитывает концы без события scroll (контент вырос после показа)', () => {
    let ctx: ScrollableContextValue | undefined
    const el = mount(() => (
      <Scrollable trackEnds contextRef={(value) => { ctx = value }}>
        <div>x</div>
      </Scrollable>
    ))
    const container = el.querySelector<HTMLDivElement>('.scrollable')!
    stubGeometry(container, 10)

    expect(ctx!.isScrolledToStart).toBe(true)
    ctx!.onSizeChange()
    expect(ctx!.isScrolledToStart).toBe(false)
    expect(ctx!.isScrolledToEnd).toBe(false)
  })

  it('слежение, включённое после монтирования (футер зарегистрировался позже), сразу считает концы', () => {
    const [track, setTrack] = createSignal(false)
    let ctx: ScrollableContextValue | undefined
    mount(() => (
      <Scrollable
        trackEnds={track()}
        ref={(node) => stubGeometry(node, 10)}
        contextRef={(value) => { ctx = value }}
      >
        <div>x</div>
      </Scrollable>
    ))

    expect(ctx!.isScrolledToStart).toBe(true)
    setTrack(true)
    expect(ctx!.isScrolledToStart).toBe(false)
    expect(ctx!.isScrolledToEnd).toBe(false)
  })
})

describe('scrollable2.solid: tabIndex (472e3e76b)', () => {
  it('tabIndex={0} → div.scrollable[tabindex="0"]; без пропа атрибута нет', () => {
    const el = mount(() => (
      <>
        <Scrollable class="with" tabIndex={0}><div>x</div></Scrollable>
        <Scrollable class="without"><div>x</div></Scrollable>
      </>
    ))

    expect(el.querySelector('.scrollable.with')!.getAttribute('tabindex')).toBe('0')
    expect(el.querySelector('.scrollable.without')!.hasAttribute('tabindex')).toBe(false)
  })
})
