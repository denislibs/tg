/** @jsxImportSource solid-js */
/**
 * Порт tweb `rangeSettingSelector.tsx` + `rangeSelectorTsx.tsx` (812502980).
 * Эталон дерева — живой дамп `docs/tweb/dom/dumps/14-left-14-settings-
 * notifications.json` (узел «Sound Volume»):
 *
 *   div.range-setting-selector
 *     div.range-setting-selector-details
 *       div.range-setting-selector-name
 *       div.range-setting-selector-value "50%"
 *     div.progress-line
 *       div.progress-line__filled [style="width 50%"]
 *       input.progress-line__seek [type="range"]
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import I18n from '@lib/langPack'
import RangeSettingSelector from './rangeSettingSelector.solid'

let dispose: (() => void) | undefined

afterEach(() => {
  I18n.setRTL(false)
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

const percent = (value: number) => Math.floor(value * 100) + '%'

function mount(props: Partial<Parameters<typeof RangeSettingSelector>[0]> = {}) {
  dispose = render(() => (
    <RangeSettingSelector
      textLeft="Sound Volume"
      textRight={percent}
      step={0.01}
      value={0.5}
      minValue={0}
      maxValue={1}
      {...props}
    />
  ), document.body)

  const root = document.body.firstElementChild as HTMLElement
  return {
    root,
    name: root.querySelector('.range-setting-selector-name') as HTMLElement,
    value: root.querySelector('.range-setting-selector-value') as HTMLElement,
    line: root.querySelector('.progress-line') as HTMLElement,
    filled: root.querySelector('.progress-line__filled') as HTMLElement,
    seek: root.querySelector('.progress-line__seek') as HTMLInputElement,
  }
}

/** Трек ширины 200px с левым краем в 0 — геометрия, которую happy-dom сам не считает. */
function stubTrack(line: HTMLElement) {
  line.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 10, width: 200, height: 10, x: 0, y: 0, toJSON() {} }) as DOMRect
}

describe('RangeSettingSelector', () => {
  it('рисует дерево дампа 14-left-14: имя и значение над ползунком progress-line', () => {
    const { root } = mount()

    const tree = (el: Element): unknown => ({
      [el.tagName.toLowerCase() + '.' + [...el.classList].join('.')]: [...el.children].map(tree),
    })
    expect(tree(root)).toEqual({
      'div.range-setting-selector': [
        { 'div.range-setting-selector-details': [
          { 'div.range-setting-selector-name': [] },
          { 'div.range-setting-selector-value': [] },
        ] },
        { 'div.progress-line': [
          { 'div.progress-line__filled': [] },
          { 'input.progress-line__seek': [] },
        ] },
      ],
    })
  })

  it('значение справа и заливка — из value; input — range с шагом и границами', () => {
    const { name, value, filled, seek } = mount()

    expect(name.textContent).toBe('Sound Volume')
    expect(value.textContent).toBe('50%')
    expect(filled.style.width).toBe('50%')
    expect(seek.type).toBe('range')
    expect([seek.step, seek.min, seek.max, seek.value]).toEqual(['0.01', '0', '1', '0.5'])
  })

  it('input связан с именем над треком (aria-labelledby, labelControl)', () => {
    const { name, seek } = mount()

    expect(name.id).not.toBe('')
    expect(seek.getAttribute('aria-labelledby')).toBe(name.id)
  })

  it('скраб по треку зовёт onChange и двигает значение, отпускание — onMouseUp', () => {
    const onChange = vi.fn()
    const onMouseUp = vi.fn()
    const { line, value, filled } = mount({ onChange, onMouseUp })
    stubTrack(line)

    line.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 150 }))
    expect(onChange).toHaveBeenCalled()
    const last = onChange.mock.lastCall![0] as number
    expect(value.textContent).toBe(percent(last))
    expect(filled.style.width).toBe(last * 100 + '%')
    expect(onMouseUp).not.toHaveBeenCalled()

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    expect(onMouseUp).toHaveBeenCalledOnce()
  })

  it('ввод с клавиатуры (input) — тот же onChange', () => {
    const onChange = vi.fn()
    const { seek, value } = mount({ onChange })

    seek.value = '0.3'
    seek.dispatchEvent(new Event('input', { bubbles: true }))

    expect(onChange).toHaveBeenLastCalledWith(0.3)
    expect(value.textContent).toBe('30%')
  })

  it('смена value снаружи доезжает до трека и подписи', () => {
    const [volume, setVolume] = createSignal(0.5)
    dispose = render(() => (
      <RangeSettingSelector textLeft="v" textRight={percent} step={0.01} value={volume()} minValue={0} maxValue={1} />
    ), document.body)

    setVolume(0.25)

    expect(document.querySelector('.range-setting-selector-value')!.textContent).toBe('25%')
    expect((document.querySelector('.progress-line__filled') as HTMLElement).style.width).toBe('25%')
  })

  it('RTL: скраб по треку даёт зеркальное значение (rangeSelectorTsx tweb :110-112)', () => {
    const onChange = vi.fn()
    const { line } = mount({ onChange })
    stubTrack(line)
    // грабер читает pageX, а happy-dom не выводит его из clientX
    const downAt = (pageX: number) => {
      const e = new MouseEvent('mousedown', { bubbles: true, button: 0 })
      Object.defineProperty(e, 'pageX', { value: pageX })
      Object.defineProperty(e, 'pageY', { value: 0 })
      line.dispatchEvent(e)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    }

    downAt(150)
    expect(onChange).toHaveBeenLastCalledWith(0.75)

    I18n.setRTL(true)
    downAt(150)
    // 150 из 200 зеркалится в 50 → 0.25 (левее половины: −step/10 и округление до 0.01)
    expect(onChange).toHaveBeenLastCalledWith(0.25)
  })
})
