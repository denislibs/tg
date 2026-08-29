import { describe, expect, it, vi } from 'vitest'
import RadioField from './radioField'
import RadioForm from './radioForm'

describe('RadioForm', () => {
  it('сообщает значение выбранного и снимает отметку с прежнего', () => {
    const a = new RadioField({ name: 'g', text: 'A', value: 'a' })
    const b = new RadioField({ name: 'g', text: 'B', value: 'b' })
    a.setValueSilently(true)

    const onChange = vi.fn()
    const form = RadioForm(
      [{ container: a.label, radioField: a }, { container: b.label, radioField: b }],
      onChange,
    )
    document.body.append(form)

    b.input.checked = true
    b.input.dispatchEvent(new Event('change', { bubbles: true }))

    expect(onChange).toHaveBeenCalledWith('b', expect.anything())
    expect(a.input.checked).toBe(false)
  })

  // Тест выше делит `name` между полями ('g' → одинаковый DOM-атрибут
  // `input-radio-g'), поэтому снятие отметки с `a` там дважды подстраховано:
  // и явным `setValueSilently(false)` в radioForm.ts, и встроенной браузерной
  // (в т.ч. happy-dom) семантикой radio-группы по общему `name` — порча ветки
  // radioForm.ts, отвечающей за сброс, эту проверку не красит. Здесь поля
  // НАМЕРЕННО из разных групп (`name` не совпадает), чтобы браузерная
  // группировка была не властна — единственный, кто может снять отметку с
  // `a`, это explicit-цикл в radioForm.ts.
  it('снимает отметку даже когда DOM-имена полей разные — сброс делает сам radioForm, не браузер', () => {
    const a = new RadioField({ name: 'group-a', text: 'A', value: 'a' })
    const b = new RadioField({ name: 'group-b', text: 'B', value: 'b' })
    a.setValueSilently(true)

    const form = RadioForm(
      [{ container: a.label, radioField: a }, { container: b.label, radioField: b }],
      vi.fn(),
    )
    document.body.append(form)

    b.input.checked = true
    b.input.dispatchEvent(new Event('change', { bubbles: true }))

    expect(a.input.checked).toBe(false)
  })
})
