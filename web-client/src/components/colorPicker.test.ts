/**
 * `ColorPicker` (порт tweb `components/colorPicker.ts`, 812502980) — выбор цвета
 * вкладки «Цвет» (`sidebarLeft/tabs/backgroundColor.solid.tsx`).
 *
 * Предмет — видимый результат: разметка оригинала (`defaultBuildLayout`, :171-189),
 * поля HEX/RGB после `setColor` и реакция на ввод в них (:141-165).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ColorPicker from './colorPicker'

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 380, height: 198, right: 380, bottom: 198, x: 0, y: 0,
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

const inputs = (picker: ColorPicker) =>
  [...picker.container.querySelectorAll<HTMLInputElement>('.color-picker-inputs .input-field input')]

describe('ColorPicker', () => {
  it('разметка — поле, ползунок оттенка и два поля ввода, как defaultBuildLayout', () => {
    const picker = new ColorPicker()
    const { container } = picker

    expect(container.className).toBe('color-picker')
    expect([...container.children].map((el) => el.getAttribute('class'))).toEqual([
      'color-picker-box',
      'color-picker-sliders',
      'color-picker-inputs',
    ])
    expect(container.querySelector('.color-picker-box .color-picker-box-dragger')).not.toBeNull()
    expect(container.querySelector('.color-picker-sliders .color-picker-color-slider-dragger')).not.toBeNull()
    expect(inputs(picker)).toHaveLength(2)
  })

  it('setColor(hex) заполняет HEX и RGB и зовёт onChange с тем же цветом', () => {
    const picker = new ColorPicker()
    document.body.append(picker.container)
    const onChange = vi.fn()
    picker.onChange = onChange

    picker.setColor('#008dd0')

    const [hex, rgb] = inputs(picker)
    expect(hex.value).toBe('#008dd0')
    expect(rgb.value).toBe('0, 141, 208')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].hex).toBe('#008dd0')
  })

  it('неверный HEX — поле с ошибкой, цвет не меняется; верный — применяется', () => {
    const picker = new ColorPicker()
    document.body.append(picker.container)
    picker.setColor('#cccccc')
    const onChange = vi.fn()
    picker.onChange = onChange
    const [hex, rgb] = inputs(picker)

    hex.value = '#12'
    hex.dispatchEvent(new Event('input'))
    expect(hex.classList.contains('error')).toBe(true)
    expect(onChange).not.toHaveBeenCalled()

    hex.value = '#e6ebee'
    hex.dispatchEvent(new Event('input'))
    expect(hex.classList.contains('error')).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].hex).toBe('#e6ebee')
    // RGB обновился, HEX — нет (его ввод и есть источник, :152)
    expect(rgb.value).toBe('230, 235, 238')
  })

  it('ввод RGB применяет цвет и переписывает HEX', () => {
    const picker = new ColorPicker()
    document.body.append(picker.container)
    picker.setColor('#cccccc')
    const [hex, rgb] = inputs(picker)

    rgb.value = '0, 141, 208'
    rgb.dispatchEvent(new Event('input'))

    expect(rgb.classList.contains('error')).toBe(false)
    expect(hex.value).toBe('#008dd0')
  })
})
