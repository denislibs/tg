/**
 * Порт tweb `src/components/passwordInputField.ts` (812502980, 65 строк) — поле
 * пароля поверх класса `InputField` (`plainText`): `type=password`, две
 * «ловушки» автозаполнения `input.stealthy` до и после поля, «глазок»
 * `span.toggle-visible` с иконкой `eye1_filled`/`eye2_filled`. Первый потребитель —
 * мастер 2FA (`sidebarLeft/tabs/2fa/enterPassword.solid.tsx`,
 * `reEnterPassword.solid.tsx`); карточка входа `auth/cards/PasswordCard.solid.tsx`
 * строит ту же разметку своим JSX и этот класс не использует.
 *
 * Отличия от оригинала:
 *  1. Закомментированная у tweb ветка Safari `readonly` (:28-33) не переносится.
 *  2. `input.parentElement!` и необязательный `onVisibilityClickAdditional` —
 *     под наш strict; поведение то же.
 */
import cancelEvent from '@helpers/dom/cancelEvent'
import Icon from '@components/icon'
import InputField, { type InputFieldOptions } from '@components/inputField'

export class PasswordInputHelpers {
  public passwordVisible = false
  public toggleVisible: HTMLElement
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
