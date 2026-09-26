/**
 * Порт tweb `src/components/radioField.ts` (812502980, 89 строк) — только сам
 * контрол: `span.radio-field` → `input[type=radio]` + `div.radio-field-main`,
 * опционально с иконкой замка. Подписи у поля нет (tweb `:8-10`): видимый
 * текст — в `Row.Title` строки, которая и есть `label` для этого `input`
 * (472e3e76b: `span`, а не `label`, чтобы в label-строке не было label-в-label
 * и `row.control === input`).
 *
 * Отличия от оригинала:
 *  1. `stateKey`/`valueForState` (tweb `:20-21`, `:38-48` — двусторонняя
 *     привязка к `apiManagerProxy`/`appStateManager`) не портированы: тот же
 *     вычет сделан в `checkboxField.ts` по той же причине — состояние у нас в
 *     zustand-сторах, глобали tweb нет;
 *  2. `simulateEvent(this.input, 'change')` (`:63`) — хелпера
 *     `helpers/dom/dispatchEvent` в репозитории нет (та же причина, что в
 *     `checkboxField.ts`); замена — `new Event('change', {bubbles: true,
 *     cancelable: true})`, поведение то же.
 */
import Icon from '@components/icon'
import { RADIO_FIELD_RIGHT_CLASS } from '@components/rowFieldClasses'

export default class RadioField {
  public input: HTMLInputElement
  public container: HTMLSpanElement
  public main: HTMLElement
  public lockIcon?: HTMLElement

  constructor(options: {
    name: string
    value?: string
    alignRight?: boolean
  }) {
    const container = this.container = document.createElement('span')
    container.classList.add('radio-field')

    if (options.alignRight) {
      container.classList.add(RADIO_FIELD_RIGHT_CLASS)
    }

    const input = this.input = document.createElement('input')
    input.type = 'radio'
    input.name = 'input-radio-' + options.name

    if (options.value !== undefined) {
      input.value = options.value
    }

    const main = this.main = document.createElement('div')
    main.classList.add('radio-field-main')

    container.append(input, main)
  }

  get checked() {
    return this.input.checked
  }

  set checked(checked: boolean) {
    this.setValueSilently(checked)
    this.input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
  }

  get locked() {
    return !!this.lockIcon
  }

  set locked(locked: boolean) {
    if (!locked) {
      this.lockIcon?.remove()
      this.lockIcon = undefined
      this.main.classList.remove('is-locked')
      return
    }

    if (this.lockIcon) {
      return
    }

    this.main.prepend(this.lockIcon = Icon('premium_lock', 'radio-field-lock'))
    this.main.classList.add('is-locked')
  }

  public setValueSilently(checked: boolean) {
    this.input.checked = checked
  }
}
