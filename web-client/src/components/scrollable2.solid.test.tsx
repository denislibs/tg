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

const { render } = await import('solid-js/web')
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
