import { describe, expect, it, vi } from 'vitest'
import RadioForm from './radioForm'

// radioForm.ts — дословный порт tweb: сам он снятие отметки с прежде выбранного
// не делает (это нативная radio-группировка браузера по `input.name`, вне этого
// файла). Пинуем то, что делает ИМЕННО этот код — сборку `<form>` из
// `{container, input}` и условие вызова `onChange` — а не побочный эффект
// одинакового `name`, который отработал бы и без единой строчки этого файла.
describe('RadioForm', () => {
  it('собирает <form> из контейнеров и передаёт value отмеченного поля в onChange', () => {
    const inputA = document.createElement('input')
    inputA.type = 'radio'
    inputA.name = 'g'
    inputA.value = 'a'

    const inputB = document.createElement('input')
    inputB.type = 'radio'
    inputB.name = 'g'
    inputB.value = 'b'

    const onChange = vi.fn()
    const form = RadioForm(
      [{ container: inputA, input: inputA }, { container: inputB, input: inputB }],
      onChange,
    )

    expect(form.tagName).toBe('FORM')
    expect(Array.from(form.children)).toEqual([inputA, inputB])

    inputB.checked = true
    inputB.dispatchEvent(new Event('change', { bubbles: true }))

    expect(onChange).toHaveBeenCalledWith('b', expect.anything())
  })

  it('не зовёт onChange, если change пришёл со СНЯТОГО поля', () => {
    const input = document.createElement('input')
    input.type = 'radio'
    input.value = 'x'
    input.checked = false

    const onChange = vi.fn()
    RadioForm([{ container: input, input }], onChange)

    input.dispatchEvent(new Event('change', { bubbles: true }))

    expect(onChange).not.toHaveBeenCalled()
  })
})
