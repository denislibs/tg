// Тесты порта tweb `rangeSelector.ts` (базовый класс). Геометрия трека
// мокается через getBoundingClientRect (happy-dom отдаёт нули), pageX
// прописывается в событие явно (happy-dom его не деривирует из clientX).
import { afterEach, describe, expect, it, vi } from 'vitest'
import RangeSelector from './rangeSelector'

function makeSelector(value = 1) {
  // параметры зум-слайдера медиавьювера (tweb mediaViewer/base.ts:375-380)
  const rs = new RangeSelector({
    step: 0.01,
    min: 0.5,
    max: 4,
    withTransition: true,
  }, value)
  rs.setListeners()
  document.body.append(rs.container)
  return rs
}

function stubTrackRect(rs: RangeSelector, left: number, width: number) {
  rs.container.getBoundingClientRect = () => ({
    left,
    top: 0,
    width,
    height: 4,
    right: left + width,
    bottom: 4,
    x: left,
    y: 0,
    toJSON: () => null,
  }) as DOMRect
}

function mouseDownAt(el: HTMLElement, pageX: number) {
  const e = new MouseEvent('mousedown', { bubbles: true, button: 0 })
  Object.defineProperty(e, 'pageX', { value: pageX })
  Object.defineProperty(e, 'pageY', { value: 0 })
  el.dispatchEvent(e)
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('RangeSelector (порт tweb rangeSelector.ts)', () => {
  it('разметка: div.progress-line.with-transition > filled + input[type=range]', () => {
    const rs = makeSelector()
    expect(rs.container.matches('.progress-line.with-transition')).toBe(true)
    const children = [...rs.container.children]
    expect(children[0].matches('.progress-line__filled')).toBe(true)
    const seek = children[1] as HTMLInputElement
    expect(seek.matches('input.progress-line__seek')).toBe(true)
    expect(seek.type).toBe('range')
    expect(seek.step).toBe('0.01')
    expect(seek.min).toBe('0.5')
    expect(seek.max).toBe('4')
    expect(rs.value).toBe(1)
  })

  it('клик по середине трека → onScrub(2.25) и filled 50% (scrub tweb :173-191)', () => {
    const rs = makeSelector()
    const onScrub = vi.fn()
    rs.setHandlers({ onScrub })
    stubTrackRect(rs, 0, 100)

    mouseDownAt(rs.container, 50)

    // 0.5 + 0.5·(4−0.5) = 2.25; ровно половина — вычет step/10 не применяется
    expect(onScrub).toHaveBeenCalledWith(2.25)
    expect(rs.value).toBe(2.25)
    const filled = rs.container.querySelector<HTMLElement>('.progress-line__filled')!
    expect(filled.style.width).toBe('50%')
    // во время mousedown трек в фокусе
    expect(rs.container.classList.contains('is-focused')).toBe(true)
    expect(rs.mousedown).toBe(true)
  })

  it('клик левее половины вычитает step/10 до округления (tweb :176-178)', () => {
    const rs = makeSelector()
    const onScrub = vi.fn()
    rs.setHandlers({ onScrub })
    stubTrackRect(rs, 0, 100)

    // 0.5 + 0.25·3.5 = 1.375 → −0.001 → 1.374 → toFixed(2) → 1.37
    mouseDownAt(rs.container, 25)
    expect(onScrub).toHaveBeenCalledWith(1.37)
  })

  it('input по seek → setFilled + onScrub (onInput tweb :117-121)', () => {
    const rs = makeSelector()
    const onScrub = vi.fn()
    rs.setHandlers({ onScrub })
    const seek = rs.container.querySelector<HTMLInputElement>('input')!
    seek.value = '3'
    seek.dispatchEvent(new Event('input'))
    expect(onScrub).toHaveBeenCalledWith(3)
  })

  it('setProgress клампит filled в [0,1]', () => {
    const rs = makeSelector()
    rs.setProgress(100)
    const filled = rs.container.querySelector<HTMLElement>('.progress-line__filled')!
    expect(filled.style.width).toBe('100%')
    rs.setProgress(-5)
    expect(filled.style.width).toBe('0%')
  })

  it('removeListeners глушит и seek, и грабер', () => {
    const rs = makeSelector()
    const onScrub = vi.fn()
    rs.setHandlers({ onScrub })
    stubTrackRect(rs, 0, 100)
    rs.removeListeners()
    mouseDownAt(rs.container, 50)
    const seek = rs.container.querySelector<HTMLInputElement>('input')!
    seek.value = '3'
    seek.dispatchEvent(new Event('input'))
    expect(onScrub).not.toHaveBeenCalled()
  })
})
