// Сдвиг градиента обоев вместе с прокруткой — порт tweb bubbles.ts:4710-4714.
//
// Регрессия, ради которой это писалось (сообщено с экрана: «много нажимаешь —
// фон сам меняется»): раньше `toNextPosition()` звался БЕЗ аргумента на каждую
// отправку, то есть уходил в ветку самоанимации (gradientRenderer.ts:258-288).
// Контракт теперь такой: нет прокрутки — нет сдвига; есть прокрутка — ровно один
// сдвиг и обязательно с `getProgress`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import ChatBackgroundGradientRenderer from './gradientRenderer'
import {
  setActiveGradientRenderer,
  getActiveGradientRenderer,
  onActiveGradientRendererChange,
  shiftGradientWithScroll,
} from './activeGradient'

const toNextPosition = vi.fn()

/** контейнер ленты с заданной геометрией — jsdom сам её не считает */
function scroller({ scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true })
  return el
}

beforeEach(() => {
  toNextPosition.mockClear()
  setActiveGradientRenderer({ toNextPosition } as unknown as ChatBackgroundGradientRenderer)
})

describe('shiftGradientWithScroll', () => {
  it('лента уже у низа — прокрутки не будет, сдвига тоже (два сообщения подряд ничего не двигают)', () => {
    const el = scroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })

    expect(shiftGradientWithScroll(el)).toBe(false)
    expect(shiftGradientWithScroll(el)).toBe(false)
    expect(toNextPosition).not.toHaveBeenCalled()
  })

  it('есть куда прокручиваться — один сдвиг и обязательно с getProgress', () => {
    const el = scroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 500 })

    expect(shiftGradientWithScroll(el)).toBe(true)
    expect(toNextPosition).toHaveBeenCalledTimes(1)
    expect(typeof toNextPosition.mock.calls[0][0]).toBe('function')
  })

  it('getProgress = доля пройденного пути прокрутки', () => {
    const el = scroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 500 })
    shiftGradientWithScroll(el)
    const getProgress = toNextPosition.mock.calls[0][0] as () => number

    expect(getProgress()).toBe(0)
    el.scrollTop = 550
    expect(getProgress()).toBeCloseTo(0.5)
    el.scrollTop = 600
    expect(getProgress()).toBe(1)
    // перелёт (доехали дальше, чем считали на старте) — прогресс не выходит за 1
    el.scrollTop = 900
    expect(getProgress()).toBe(1)
  })

  it('обои без градиента (своё фото/цвет) — рендерера нет, сдвигать нечего', () => {
    setActiveGradientRenderer(undefined)
    expect(getActiveGradientRenderer()).toBeUndefined()
    expect(shiftGradientWithScroll(scroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 }))).toBe(false)
    expect(toNextPosition).not.toHaveBeenCalled()
  })
})

// tweb appChatBackground.onActiveGradientRendererChange (chatBackground.tsx:762-775).
// Потребитель — колонка папок: без подписки она не узнала бы про смену обоев и
// осталась бы с зеркалом мёртвого рендерера.
describe('onActiveGradientRendererChange', () => {
  it('зовёт слушателя текущим значением сразу при подписке', () => {
    const renderer = { toNextPosition } as unknown as ChatBackgroundGradientRenderer
    setActiveGradientRenderer(renderer, { isDarkMaskPattern: true })

    const seen: unknown[][] = []
    onActiveGradientRendererChange((r, meta) => seen.push([r, meta]))

    expect(seen).toEqual([[renderer, { isDarkMaskPattern: true }]])
  })

  it('смена обоев доезжает до подписчика вместе с метой; отписка её прекращает', () => {
    setActiveGradientRenderer(undefined)
    const seen: unknown[][] = []
    const off = onActiveGradientRendererChange((r, meta) => seen.push([r, meta]))
    seen.length = 0

    const renderer = { toNextPosition } as unknown as ChatBackgroundGradientRenderer
    setActiveGradientRenderer(renderer, { isDarkMaskPattern: false })
    expect(seen).toEqual([[renderer, { isDarkMaskPattern: false }]])

    off()
    setActiveGradientRenderer(undefined)
    expect(seen).toHaveLength(1)
  })
})
