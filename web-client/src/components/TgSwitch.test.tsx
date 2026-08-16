// TgSwitch — тумблер `checkboxField.ts` (ветка `toggle`). Пин держит ИМЕННО
// дерево tweb: до этой задачи компонент рисовал три собственных div'а
// (`TgSwitch.module.scss`), и вся геометрия/анимация портированного
// `styles/tweb/_checkbox.scss` мимо него проходила. Эталон — дампы
// docs/tweb/dom/dumps/07-right-sidebar (строка Notifications) и
// 15-right-13-group-permissions (тумблер-ограничение).
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TgSwitch from './TgSwitch'

const label = (c: HTMLElement) => c.querySelector<HTMLElement>('label')!

describe('TgSwitch', () => {
  it('label.checkbox-field.checkbox-without-caption.checkbox-field-toggle > input + div.checkbox-toggle > div.checkbox-toggle-circle', () => {
    const { container } = render(<TgSwitch checked={false} />)
    const l = label(container)
    expect(l.classList.contains('checkbox-field')).toBe(true)
    expect(l.classList.contains('checkbox-without-caption')).toBe(true)
    expect(l.classList.contains('checkbox-field-toggle')).toBe(true)

    const [input, toggle] = Array.from(l.children) as HTMLElement[]
    expect(input.tagName).toBe('INPUT')
    expect(input.classList.contains('checkbox-field-input')).toBe(true)
    expect(input.getAttribute('type')).toBe('checkbox')
    expect(toggle.className).toBe('checkbox-toggle')
    expect(toggle.children).toHaveLength(1)
    expect(toggle.firstElementChild!.className).toBe('checkbox-toggle-circle')
  })

  it('состояние ведёт именно input.checked — на него смотрит правило `[type=checkbox]:checked + .checkbox-toggle`', () => {
    const on = render(<TgSwitch checked />)
    expect(on.container.querySelector<HTMLInputElement>('input')!.checked).toBe(true)
    const off = render(<TgSwitch checked={false} />)
    expect(off.container.querySelector<HTMLInputElement>('input')!.checked).toBe(false)
  })

  it('restriction/disabled — модификаторы tweb на том же label', () => {
    const { container } = render(<TgSwitch checked={false} restriction disabled />)
    const l = label(container)
    expect(l.classList.contains('checkbox-field-toggle-restriction')).toBe(true)
    expect(l.classList.contains('checkbox-disabled')).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input')!.disabled).toBe(true)
  })
})
