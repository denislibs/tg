/**
 * Порт tweb `src/components/radioField.ts` — 1:1 по разметке (`label.radio-field`
 * → `input[type=radio]` + `div.radio-field-main`, опционально с иконкой замка).
 * Правки только там, где в репозитории нет нужной инфраструктуры:
 *  • `stateKey`/`valueForState` (двусторонняя привязка к `apiManagerProxy`/
 *    `rootScope.managers.appStateManager`) — не портированы: тот же вычет уже
 *    сделан в `checkboxField.ts` по той же причине (у нас состояние живёт в
 *    zustand-сторах, глобали tweb нет);
 *  • `LangPackKey`/`_i18n(main, key)` → строка + `useI18nStore.getState().t`,
 *    записанная прямо в `main.textContent` (как и `_i18n` в оригинале — узел
 *    не оборачивается в `span.i18n`, он ПИШЕТ в переданный элемент);
 *  • `simulateEvent(this.input, 'change')` — хелпера `helpers/dom/dispatchEvent`
 *    в репозитории нет (та же причина, что в `checkboxField.ts`); инлайновая
 *    замена — `new Event('change', {bubbles: true, cancelable: true})`,
 *    поведение то же самое, просто без отдельного файла-обёртки на одну строку.
 */
import Icon from '@components/icon'
import { useI18nStore } from '../i18n'

export default class RadioField {
  public input: HTMLInputElement
  public label: HTMLLabelElement
  public main: HTMLElement
  public lockIcon?: HTMLElement

  constructor(options: {
    text?: string
    textElement?: HTMLElement | DocumentFragment
    /** переводимый ключ — идёт через `t()`, в отличие от `text` (уже готовая строка) */
    langKey?: string
    name: string
    value?: string
    alignRight?: boolean
  }) {
    const label = this.label = document.createElement('label')
    label.classList.add('radio-field')

    if (options.alignRight) {
      label.classList.add('radio-field-right')
    }

    const input = this.input = document.createElement('input')
    input.type = 'radio'
    input.name = 'input-radio-' + options.name

    if (options.value !== undefined) {
      input.value = options.value
    }

    const main = this.main = document.createElement('div')
    main.classList.add('radio-field-main')

    if (options.textElement) {
      main.append(options.textElement)
    } else if (options.text) {
      main.textContent = options.text
    } else if (options.langKey) {
      main.textContent = useI18nStore.getState().t(options.langKey)
    }

    label.append(input, main)
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
