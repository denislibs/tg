import { describe, expect, it, vi } from 'vitest'
import RadioField from './radioField'

// Пин на setValueSilently (radioField.ts) отдельным тестом: раньше это состояние
// проверялось только косвенно, через RadioForm — там arrange (`setValueSilently(true)`)
// и assert (`.toBe(false)` после смены выбора другим полем) схлопывались в одно и то
// же значение `false`, и пустое тело метода проходило тест зелёным (ревью проверило
// фактически). Здесь проверка стоит СРАЗУ после arrange, до всякого dispatchEvent —
// красит любую порчу метода: опечатку в имени свойства, замену на
// `setAttribute('checked', …)` (атрибут не меняет свойство `.checked`), потерянный
// вызов.
describe('RadioField.setValueSilently', () => {
  it('меняет input.checked немедленно и без события change', () => {
    const field = new RadioField({ name: 'g', text: 'A', value: 'a' })
    const onChange = vi.fn()
    field.input.addEventListener('change', onChange)

    field.setValueSilently(true)
    expect(field.input.checked).toBe(true)

    field.setValueSilently(false)
    expect(field.input.checked).toBe(false)

    expect(onChange).not.toHaveBeenCalled()
  })
})
