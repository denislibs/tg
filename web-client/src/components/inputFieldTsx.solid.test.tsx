/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/inputFieldTsx.tsx` (812502980) и того, что он берёт у
 * класса `components/inputField.ts`: разметка поля, лимит длины, ошибка
 * уровня поля (472e3e76b: `span.input-field-error-label[role=alert]`,
 * `aria-invalid`, `aria-describedby`). Потребители в плане 2D — профиль,
 * 2FA, редактор папки.
 *
 * Лимит у tweb НЕ режет ввод (`inputField.ts:677-700`): сверх `maxLength`
 * поле получает `.error`, а к подписи дописывается остаток ` (N)`, начиная с
 * `showLengthOn` (по умолчанию `min(40, round(maxLength / 3))`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import InputField, { InputState } from './inputField'
import { InputFieldTsx } from './inputFieldTsx.solid'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

const type = (input: HTMLElement, text: string) => {
  if(input instanceof HTMLInputElement) input.value = text
  else input.textContent = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('InputFieldTsx', () => {
  it('разметка: div.input-field > contenteditable-ввод + рамка + подпись, подпись называет ввод', () => {
    let field!: InputField
    dispose = render(() => (
      <InputFieldTsx label="EditProfile.FirstNameLabel" instanceRef={(f) => { field = f }} class="own" />
    ), document.body)

    const container = document.body.firstElementChild as HTMLElement
    expect(container).toBe(field.container)
    expect([...container.classList]).toEqual(['input-field', 'own'])
    expect([...container.children].map((el) => el.tagName.toLowerCase() + (el.className ? '.' + el.className.replace(/ /g, '.') : ''))).toEqual([
      'div.input-field-input.is-empty',
      'div.input-field-border',
      'label',
    ])
    const input = field.input
    expect(input.contentEditable).toBe('true')
    expect(input.getAttribute('role')).toBe('textbox')
    expect(input.getAttribute('aria-labelledby')).toBe(field.label.id)
    expect(field.label.textContent).not.toBe('')
  })

  it('plainText — настоящий <input type=text>, значение читается из него', () => {
    let field!: InputField
    const onRawInput = vi.fn()
    dispose = render(() => (
      <InputFieldTsx plainText label="Login.Password.Title" name="hint" onRawInput={onRawInput} instanceRef={(f) => { field = f }} />
    ), document.body)

    const input = field.input as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.type).toBe('text')
    expect(input.name).toBe('hint')
    type(input, 'abc')
    expect(field.value).toBe('abc')
    expect(onRawInput).toHaveBeenLastCalledWith('abc')
    expect(input.classList.contains('is-empty')).toBe(false)
  })

  it('maxLength не режет ввод: сверх лимита .error, остаток — в подписи', () => {
    let field!: InputField
    dispose = render(() => (
      <InputFieldTsx label="EditProfile.FirstNameLabel" maxLength={10} instanceRef={(f) => { field = f }} />
    ), document.body)
    const caption = field.label.textContent!

    type(field.input, '1234')
    expect(field.label.textContent).toBe(caption) // остаток 6 > showLengthOn (round(10/3) = 3)

    type(field.input, '12345678')
    expect(field.label.textContent).toBe(caption + ' (2)')
    expect(field.input.classList.contains('error')).toBe(false)

    type(field.input, '123456789012')
    expect(field.value).toBe('123456789012')
    expect(field.input.classList.contains('error')).toBe(true)
    expect(field.label.textContent).toBe(caption + ' (-2)')

    type(field.input, '12')
    expect(field.input.classList.contains('error')).toBe(false)
    expect(field.label.textContent).toBe(caption)
  })

  it('errorLabel: подпись ошибки с role=alert, aria-invalid и aria-describedby; снятие — всё обратно', () => {
    let field!: InputField
    const [error, setError] = createSignal<'Error.AnError' | undefined>(undefined)
    dispose = render(() => (
      <InputFieldTsx label="EditProfile.FirstNameLabel" errorLabel={error()} errorDescriptionId="hint-id" instanceRef={(f) => { field = f }} />
    ), document.body)

    expect(field.input.getAttribute('aria-describedby')).toBe('hint-id')
    expect(field.container.querySelector('.input-field-error-label')).toBeNull()

    setError('Error.AnError')
    const errorEl = field.container.querySelector('.input-field-error-label') as HTMLElement
    expect(errorEl.getAttribute('role')).toBe('alert')
    expect(errorEl.textContent).not.toBe('')
    expect(field.container.classList.contains('has-error-label')).toBe(true)
    expect(field.input.getAttribute('aria-invalid')).toBe('true')
    expect(field.input.classList.contains('error')).toBe(true)
    expect(field.input.getAttribute('aria-describedby')!.split(' ').sort()).toEqual(['hint-id', errorEl.id].sort())

    setError(undefined)
    expect(field.container.querySelector('.input-field-error-label')).toBeNull()
    expect(field.container.classList.contains('has-error-label')).toBe(false)
    expect(field.input.hasAttribute('aria-invalid')).toBe(false)
    expect(field.input.getAttribute('aria-describedby')).toBe('hint-id')
  })

  it('value и disabled — из пропов; originalValue/isChanged — как у класса', () => {
    let field!: InputField
    const [value, setValue] = createSignal('Имя')
    const [disabled, setDisabled] = createSignal(false)
    dispose = render(() => (
      <InputFieldTsx plainText label="EditProfile.FirstNameLabel" value={value()} disabled={disabled()} instanceRef={(f) => { field = f }} />
    ), document.body)

    expect(field.value).toBe('Имя')
    field.setOriginalValue('Имя', true)
    expect(field.isChanged()).toBe(false)

    setValue('Другое')
    expect(field.value).toBe('Другое')
    expect(field.isChanged()).toBe(true)

    setDisabled(true)
    expect(field.input.hasAttribute('disabled')).toBe(true)
  })

  it('setState(Valid) и ручной setError без подписи ошибки красят поле, не заводя узла', () => {
    const field = new InputField({ label: 'EditProfile.FirstNameLabel' })

    field.setState(InputState.Valid)
    expect(field.input.classList.contains('valid')).toBe(true)
    field.setError()
    expect(field.input.classList.contains('error')).toBe(true)
    expect(field.container.querySelector('.input-field-error-label')).toBeNull()
  })
})
