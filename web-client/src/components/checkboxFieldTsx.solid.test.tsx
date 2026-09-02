/** @jsxImportSource solid-js */
/**
 * Тесты порта `checkboxFieldTsx.solid.ts` и портированной вместе с ним
 * toggle-ветки `CheckboxField`.
 *
 * Предмет — ДВУСТОРОННЯЯ связь и то, что она не зацикливается: щелчок
 * пользователя обязан дойти до сигнала и до `onChange`, а запись извне —
 * дойти до узла, НЕ породив ещё одного `change`. Именно ради второй половины
 * в `CheckboxField` появился `setValueSilently`; наивная запись
 * `input.checked = …` через сеттер с `simulateEvent` дала бы кольцо.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, createSignal } from 'solid-js'
import CheckboxField from './checkboxField'
import CheckboxFieldTsx from './checkboxFieldTsx.solid'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
})

/** Компонент вне дерева: узел он и так возвращает готовым. */
function mount<T>(fn: () => T): T {
  return createRoot((d) => {
    dispose = d
    return fn()
  })
}

describe('CheckboxField: toggle-ветка', () => {
  it('toggle строит дорожку с бегунком и НЕ строит коробку с галочкой', () => {
    const field = new CheckboxField({ toggle: true })

    expect(field.label.classList.contains('checkbox-field-toggle')).toBe(true)
    expect(field.label.querySelector('.checkbox-toggle .checkbox-toggle-circle')).not.toBeNull()
    expect(field.label.querySelector('.checkbox-box')).toBeNull()
  })

  it('без toggle остаётся коробка, дорожки нет', () => {
    const field = new CheckboxField({})

    expect(field.label.classList.contains('checkbox-field-toggle')).toBe(false)
    expect(field.label.querySelector('.checkbox-box-check')).not.toBeNull()
    expect(field.label.querySelector('.checkbox-toggle')).toBeNull()
  })

  it('setValueSilently пишет состояние и НЕ порождает change', () => {
    const field = new CheckboxField({})
    const onChange = vi.fn()
    field.input.addEventListener('change', onChange)

    field.setValueSilently(true)

    expect(field.input.checked).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('checkboxFieldTsx: связь сигнала и узла', () => {
  it('начальное значение сигнала попадает в узел при создании', () => {
    const label = mount(() => {
      const signal = createSignal(true)
      return CheckboxFieldTsx({ signal }) as HTMLLabelElement
    })

    expect(label.querySelector<HTMLInputElement>('input')!.checked).toBe(true)
  })

  it('щелчок пользователя двигает сигнал и зовёт onChange', () => {
    const onChange = vi.fn()
    const result = mount(() => {
      const signal = createSignal(false)
      const label = CheckboxFieldTsx({ signal, onChange }) as HTMLLabelElement
      return { label, signal }
    })

    const input = result.label.querySelector<HTMLInputElement>('input')!
    input.checked = true
    input.dispatchEvent(new Event('change'))

    expect(result.signal[0]()).toBe(true)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('запись в сигнал доезжает до узла и НЕ порождает второго onChange', () => {
    const onChange = vi.fn()
    const result = mount(() => {
      const signal = createSignal(false)
      const label = CheckboxFieldTsx({ signal, onChange }) as HTMLLabelElement
      return { label, signal }
    })

    result.signal[1](true)

    expect(result.label.querySelector<HTMLInputElement>('input')!.checked).toBe(true)
    // Кольцо: если бы запись шла через сеттер с `simulateEvent`, подписчик
    // `change` увидел бы её как щелчок пользователя.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('toggle прокидывается в узел', () => {
    const label = mount(() => CheckboxFieldTsx({ toggle: true }) as HTMLLabelElement)

    expect(label.classList.contains('checkbox-field-toggle')).toBe(true)
  })
})
