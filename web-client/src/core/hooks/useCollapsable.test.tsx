// Обе ветки жеста сворачивания ряда историй — порт tweb `hooks/useCollapsable.ts`.
//
// Дефект, ради которого написан файл: тач-ветка (:155-172) не была портирована
// вовсе. На сенсорном экране колеса нет, поэтому ряд разворачивался кликом, а
// свернуть его обратно было НЕЧЕМ — единственный вход в `onMove` (колесо) там
// не срабатывает никогда.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Тач-ветка гейтится константой окружения — в happy-dom она false.
vi.mock('@environment/touchSupport', () => ({ default: true }))

type SwipeOptions = {
  element: HTMLElement
  onSwipe: (xDiff: number, yDiff: number, e: unknown) => void
  verifyTouchTarget?: (e: { target: EventTarget | null }) => boolean
  cancelEvent?: boolean
  cursor?: string
}

const swipes: SwipeOptions[] = []
const removeListeners = vi.fn()

// Сам SwipeHandler — вендорный порт со своими тестами; здесь важен факт, что
// хук его СОЗДАЁТ на нужном узле и сводит свайп в тот же `onMove`.
vi.mock('@core/dom/swipeHandler', () => ({
  default: class {
    constructor(options: SwipeOptions) {
      swipes.push(options)
    }
    removeListeners = removeListeners
  },
}))

const { default: useCollapsable, STATE_FOLDED, STATE_UNFOLDED } = await import('./useCollapsable')

let listenWheelOn: HTMLElement
let container: HTMLElement
let scrollable: HTMLElement

function setup() {
  return renderHook(() => useCollapsable({
    scrollable: () => scrollable,
    listenWheelOn: () => listenWheelOn,
    container: () => container,
  }))
}

/** событие-двойник: хуку от него нужны только оба гасителя */
const fakeEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() })

beforeEach(() => {
  swipes.length = 0
  removeListeners.mockClear()
  listenWheelOn = document.createElement('div')
  container = document.createElement('div')
  scrollable = document.createElement('div')
  document.body.append(listenWheelOn, container, scrollable)
})

describe('useCollapsable — колесо (tweb :144-152)', () => {
  it('колесо вверх разворачивает, вниз — сворачивает', () => {
    const { result } = setup()
    expect(result.current.progress).toBe(STATE_FOLDED)

    // delta = -wheelDeltaY: прокрутка ВВЕРХ даёт wheelDeltaY > 0 → delta < 0
    act(() => {
      const e = new WheelEvent('wheel', { cancelable: true })
      Object.defineProperty(e, 'wheelDeltaY', { value: 120 })
      listenWheelOn.dispatchEvent(e)
    })
    expect(result.current.progress).toBe(STATE_UNFOLDED)

    act(() => {
      const e = new WheelEvent('wheel', { cancelable: true })
      Object.defineProperty(e, 'wheelDeltaY', { value: -120 })
      listenWheelOn.dispatchEvent(e)
    })
    expect(result.current.progress).toBe(STATE_FOLDED)
  })
})

describe('useCollapsable — свайп на сенсорном экране (tweb :155-172)', () => {
  it('SwipeHandler ставится на тот же узел, что и колесо и переживает ре-рендеры', () => {
    const { rerender } = setup()
    rerender()
    rerender()
    // Пересоздание рвало бы жест посередине: свайп сам вызывает рендер.
    expect(swipes).toHaveLength(1)
    expect(swipes[0].element).toBe(listenWheelOn)
    // tweb :162-163 — жест не гасит событие сам и не меняет курсор
    expect(swipes[0].cancelEvent).toBe(false)
    expect(swipes[0].cursor).toBe('')
  })

  it('свайп вниз разворачивает ряд, свайп вверх — сворачивает обратно', () => {
    const { result } = setup()
    const onSwipe = swipes[0].onSwipe

    // delta = -yDiff: тянем ВНИЗ (yDiff > 0) → delta < 0 → развернуть
    const down = fakeEvent()
    act(() => onSwipe(0, 60, down))
    expect(result.current.progress).toBe(STATE_UNFOLDED)
    expect(down.preventDefault).toHaveBeenCalled()

    // …и обратно — то, чего на сенсорном экране не было вовсе
    const up = fakeEvent()
    act(() => onSwipe(0, -60, up))
    expect(result.current.progress).toBe(STATE_FOLDED)
  })

  it('прокрученный список сворачивает ряд свайпом любого направления (tweb :80-84)', () => {
    Object.defineProperty(scrollable, 'scrollTop', { value: 120, configurable: true })
    const { result } = setup()
    const onSwipe = swipes[0].onSwipe

    act(() => onSwipe(0, 60, fakeEvent()))
    expect(result.current.progress).toBe(STATE_FOLDED)
  })

  it('лента табов папок жест не отдаёт (tweb :164-166)', () => {
    setup()
    const verify = swipes[0].verifyTouchTarget!

    const plain = document.createElement('div')
    listenWheelOn.append(plain)
    expect(verify({ target: plain })).toBe(true)

    const tabs = document.createElement('div')
    tabs.className = 'folders-tabs-scrollable'
    const insideTabs = document.createElement('div')
    tabs.append(insideTabs)
    listenWheelOn.append(tabs)
    expect(verify({ target: insideTabs })).toBe(false)
  })

  it('размонтирование снимает листенеры жеста (tweb onCleanup :169-171)', () => {
    const { unmount } = setup()
    unmount()
    expect(removeListeners).toHaveBeenCalled()
  })
})
