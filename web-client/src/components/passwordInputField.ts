/**
 * Порт tweb `src/components/passwordInputField.ts` (812502980, 67 строк) — поле
 * пароля поверх `InputField`: `type=password`, два «невидимых» поля-обманки
 * вокруг настоящего (чтобы менеджер паролей не цеплялся к полю), глаз
 * `span.toggle-visible` справа переключает видимость. Стили —
 * `.input-field-password`/`.toggle-visible` (`styles/tweb/_input.scss:337-380`),
 * `.stealthy` (`styles/tweb/_bridge.scss:408`). Первый потребитель — вкладка
 * ввода код-пароля (`sidebarLeft/tabs/passcodeLock/enterPasswordTab.solid.tsx`).
 *
 * Отличий от оригинала нет, кроме строгих типов: `toggleVisible` —
 * `!`-поле (присваивается в конструкторе), `onVisibilityClickAdditional` —
 * опциональное, `input.parentElement!` (у поля `InputField` родитель есть всегда
 * — контейнер `div.input-field`).
 */
import cancelEvent from '@helpers/dom/cancelEvent'
import Icon from '@components/icon'
import InputField, { type InputFieldOptions } from '@components/inputField'

export class PasswordInputHelpers {
  public passwordVisible = false
  public toggleVisible!: HTMLElement
  public onVisibilityClickAdditional?: () => void

  constructor(public container: HTMLElement, public input: HTMLInputElement) {
    input.type = 'password'
    input.setAttribute('required', '')
    input.name = 'notsearch_password'
    input.autocomplete = 'off'

    // * https://stackoverflow.com/a/35949954/6758968
    const stealthy = document.createElement('input')
    stealthy.classList.add('stealthy')
    stealthy.tabIndex = -1
    stealthy.setAttribute('aria-hidden', 'true')
    stealthy.type = 'password'
    input.parentElement!.prepend(stealthy)
    input.parentElement!.insertBefore(stealthy.cloneNode(), input.nextSibling)

    const toggleVisible = this.toggleVisible = document.createElement('span')
    toggleVisible.classList.add('toggle-visible')
    toggleVisible.append(Icon('eye1_filled'))

    container.classList.add('input-field-password')
    container.append(toggleVisible)

    toggleVisible.addEventListener('click', this.onVisibilityClick)
    toggleVisible.addEventListener('touchend', this.onVisibilityClick)
  }

  public onVisibilityClick = (e: Event) => {
    cancelEvent(e)
    this.passwordVisible = !this.passwordVisible

    this.toggleVisible.replaceChildren(Icon(this.passwordVisible ? 'eye2_filled' : 'eye1_filled'))
    this.input.type = this.passwordVisible ? 'text' : 'password'
    this.onVisibilityClickAdditional?.()
  }
}

export default class PasswordInputField extends InputField {
  public helpers: PasswordInputHelpers

  constructor(options: InputFieldOptions = {}) {
    super({
      plainText: true,
      allowStartingSpace: true,
      ...options,
    })

    this.helpers = new PasswordInputHelpers(this.container, this.input as HTMLInputElement)
  }
}
