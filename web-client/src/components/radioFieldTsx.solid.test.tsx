/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/tests/radioFieldTsx.test.tsx` (812502980) — кейсы 1-4 — и
 * `rowRadioFieldInteraction.test.tsx` — кейсы с НАСТОЯЩИМИ `RadioFieldTsx`/
 * `CheckboxFieldTsx` (остальные кейсы того файла портированы задачей 0 в
 * `rowTsx.solid.test.tsx`). У tweb `RadioField` и `Row` в первом файле
 * подменены моками; здесь — настоящие: предмет теста — узел, который реально
 * получает строка.
 *
 * Кейсы `RadioFormTsx` (5-6 оригинала) не переносятся: `radioFormTsx` вне
 * настроек (у tweb — `chatType.tsx`), у нас его нет.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import Row from './rowTsx.solid'
import RadioFieldTsx from './radioFieldTsx.solid'
import CheckboxFieldTsx from './checkboxFieldTsx.solid'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('RadioFieldTsx', () => {
  it('держит императивное радио в синхроне с Solid-состоянием', () => {
    const [checked, setChecked] = createSignal(false)
    const onChange = vi.fn()

    dispose = render(() => (
      <Row>
        <Row.RadioField>
          <RadioFieldTsx checked={checked()} name="test" value="option" onChange={onChange} />
        </Row.RadioField>
      </Row>
    ), document.body)

    const input = document.querySelector('input') as HTMLInputElement
    expect(input.checked).toBe(false)
    expect(document.querySelector('.radio-field-main')?.textContent).toBe('')

    setChecked(true)
    expect(input.checked).toBe(true)

    input.checked = false
    input.dispatchEvent(new Event('change'))
    expect(onChange).toHaveBeenCalledWith(false, expect.any(Event))
  })

  it('снимает слушатель change на уборке', () => {
    const onChange = vi.fn()

    dispose = render(() => (
      <Row>
        <Row.RadioField>
          <RadioFieldTsx name="test" onChange={onChange} />
        </Row.RadioField>
      </Row>
    ), document.body)

    const input = document.querySelector('input') as HTMLInputElement
    dispose()
    dispose = undefined
    input.dispatchEvent(new Event('change'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('держит замок в синхроне', () => {
    const [locked, setLocked] = createSignal(false)

    dispose = render(() => (
      <Row>
        <Row.RadioField>
          <RadioFieldTsx locked={locked()} name="test" />
        </Row.RadioField>
      </Row>
    ), document.body)

    const main = document.querySelector('.radio-field-main') as HTMLElement
    expect(main.classList.contains('is-locked')).toBe(false)

    setLocked(true)
    expect(main.classList.contains('is-locked')).toBe(true)
    expect(main.firstElementChild?.classList.contains('radio-field-lock')).toBe(true)

    setLocked(false)
    expect(main.querySelector('.radio-field-lock')).toBeNull()
  })

  it('доступен без собственной подписи: текст — в Row.Title, ariaLabel — на инпуте', () => {
    const [ariaLabel, setAriaLabel] = createSignal<string | undefined>('Correct answer')

    dispose = render(() => (
      <Row>
        <Row.RadioField>
          <RadioFieldTsx ariaLabel={ariaLabel()} name="test" value="option" />
        </Row.RadioField>
        <Row.Title>Option</Row.Title>
      </Row>
    ), document.body)

    const field = document.querySelector('.radio-field') as HTMLElement
    const input = document.querySelector('input') as HTMLInputElement
    expect(field.textContent).not.toContain('Option')
    expect(document.querySelector('.row-title')?.textContent).toBe('Option')
    expect(input.getAttribute('aria-label')).toBe('Correct answer')

    setAriaLabel(undefined)
    expect(input.hasAttribute('aria-label')).toBe(false)
  })

  it('alignRight → span.radio-field.radio-field-right, класс снаружи — на том же узле', () => {
    dispose = render(() => (
      <RadioFieldTsx name="test" alignRight class="disable-hover" />
    ), document.body)

    const field = document.querySelector('.radio-field') as HTMLElement
    expect(field.tagName).toBe('SPAN')
    expect(field.classList.contains('radio-field-right')).toBe(true)
    expect(field.classList.contains('disable-hover')).toBe(true)
    expect([...field.children].map((el) => el.tagName + '.' + el.className)).toEqual(['INPUT.', 'DIV.radio-field-main'])
    expect((field.firstElementChild as HTMLInputElement).name).toBe('input-radio-test')
  })
})

/**
 * Число вызовов обработчика СТРОКИ здесь не пинится, в отличие от tweb
 * (`toHaveBeenCalledOnce`): у tweb тесты в jsdom, где `label` активирует свой
 * контрол без второго события `click`, а happy-dom пересылает щелчок в `input`
 * отдельным `click` (`HTMLLabelElement.dispatchEvent`), который всплывает
 * обратно в строку, и притом ещё на фазе всплытия — до делегированного
 * обработчика Solid на `document`. Это поведение среды, а не полей; предмет
 * этого файла — поле: один `label` на строку, `row.control === input`, одно
 * `change` с верным значением.
 */
describe('Row.RadioField interaction (настоящие поля)', () => {
  it('щелчок по заголовку строки выбирает радио: одна семантическая подпись', () => {
    const onClick = vi.fn()
    const onChange = vi.fn()

    dispose = render(() => (
      <Row noRipple clickable={onClick}>
        <Row.RadioField>
          <RadioFieldTsx checked={false} name="privacy" value="contacts" onChange={onChange} />
        </Row.RadioField>
        <Row.Title>My Contacts</Row.Title>
      </Row>
    ), document.body)

    const row = document.querySelector('.row') as HTMLLabelElement
    const radioField = document.querySelector('.radio-field') as HTMLElement
    const input = document.querySelector('input') as HTMLInputElement
    const title = document.querySelector('.row-title') as HTMLElement

    expect(row.tagName).toBe('LABEL')
    expect(radioField.tagName).toBe('SPAN')
    expect(row.querySelector('label')).toBeNull()
    expect(row.htmlFor).toBe('')
    expect(input.id).toBe('')
    expect(input.labels).toHaveLength(1)
    expect(input.labels!.item(0)).toBe(row)
    expect(row.control).toBe(input)
    expect(input.checked).toBe(false)

    title.click()

    expect(input.checked).toBe(true)
    expect(onClick).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(true, expect.any(Event))
  })

  it('отмена щелчка строки (закрытая строка) не выбирает радио', () => {
    const onClick = vi.fn((event: MouseEvent) => event.preventDefault())
    const onChange = vi.fn()

    dispose = render(() => (
      <Row noRipple clickable={onClick}>
        <Row.RadioField>
          <RadioFieldTsx checked={false} name="privacy" value="contacts" onChange={onChange} />
        </Row.RadioField>
        <Row.Title>My Contacts</Row.Title>
      </Row>
    ), document.body)

    const input = document.querySelector('input') as HTMLInputElement
    const title = document.querySelector('.row-title') as HTMLElement

    title.click()

    expect(input.checked).toBe(false)
    expect(onClick).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('строка с тумблером: одна подпись, одно change', () => {
    const onClick = vi.fn()
    const onChange = vi.fn()

    dispose = render(() => (
      <Row noRipple clickable={onClick}>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx checked={false} toggle onChange={onChange} />
        </Row.CheckboxFieldToggle>
        <Row.Title>Enabled</Row.Title>
      </Row>
    ), document.body)

    const row = document.querySelector('.row') as HTMLLabelElement
    const field = document.querySelector('.checkbox-field') as HTMLElement
    const input = document.querySelector('input') as HTMLInputElement
    const title = document.querySelector('.row-title') as HTMLElement

    expect(row.tagName).toBe('LABEL')
    expect(field.tagName).toBe('SPAN')
    expect(row.querySelector('label')).toBeNull()
    expect(row.control).toBe(input)

    title.click()

    expect(input.checked).toBe(true)
    expect(onClick).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
