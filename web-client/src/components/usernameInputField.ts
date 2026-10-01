/**
 * Порт tweb `src/components/usernameInputField.ts` (812502980, 111 строк) —
 * поле публичного имени поверх `InputField`: формат проверяется на вводе
 * (`isUsernameValid`), занятость — сетью за debounce 150 мс, «голова» поля
 * (`head`, например `t.me/`) отрезается от значения и возвращается на место.
 * Первый потребитель — вкладка типа чата (`sidebarRight/tabs/chatType.solid.tsx`).
 *
 * Расхождения:
 *  1. `AppManagers` → наш `Managers` (`client/bootstrap.ts`): имя пользователя —
 *     `profile.checkUsername` (у tweb `appUsersManager.checkUsername`), имя чата —
 *     `groups.checkUsername(peerId, …)` (у tweb `appChatsManager.checkUsername(chatId, …)`;
 *     наши ручки адресуют чат знаковым ключом пира, поэтому `toChatId()` не нужен).
 */
import type ListenerSetter from '@helpers/listenerSetter'
import debounce from '@helpers/schedulers/debounce'
import type { LangPackKey } from '@lib/langPack'
import InputField, { InputState, type InputFieldOptions } from '@components/inputField'
import { isUsernameValid } from '@lib/richtext/validators'
import type { Managers } from '@/client/bootstrap'

export class UsernameInputField extends InputField {
  private checkUsernamePromise?: Promise<void>
  private checkUsernameDebounced: (username: string) => void
  declare public options: InputFieldOptions & {
    peerId?: PeerId
    listenerSetter: ListenerSetter
    onChange?: () => void
    invalidText: LangPackKey
    takenText: LangPackKey
    availableText: LangPackKey
    head?: string
  }

  public error?: ApiError

  constructor(
    options: UsernameInputField['options'],
    private managers: Managers,
  ) {
    super(options)

    this.checkUsernameDebounced = debounce(this.checkUsername.bind(this), 150, false, true)

    options.listenerSetter.add(this.input)('input', () => {
      const value = this.getValue()

      this.error = undefined
      if(value === this.originalValue || !value.length) {
        this.setState(InputState.Neutral)
        this.options.onChange?.()
        return
      } else if(!isUsernameValid(value)) {
        this.setError(this.options.invalidText)
      } else {
        this.setState(InputState.Neutral)
      }

      if(this.input.classList.contains('error')) {
        this.options.onChange?.()
        return
      }

      this.checkUsernameDebounced(value)
    })
  }

  public getValue() {
    let value = this.value
    if(this.options.head) {
      value = value.slice(this.options.head.length)
      this.setValueSilently(this.options.head + value)
    }

    return value
  }

  private checkUsername(username: string) {
    if(this.checkUsernamePromise) return

    this.error = undefined
    let checkPromise: Promise<boolean>
    if(this.options.peerId) {
      checkPromise = this.managers.groups.checkUsername(this.options.peerId, username)
    } else {
      checkPromise = this.managers.profile.checkUsername(username)
    }

    const promise = this.checkUsernamePromise = checkPromise.then((available) => {
      if(this.getValue() !== username) return

      if(available) {
        this.setState(InputState.Valid, this.options.availableText)
      } else {
        this.setError(this.options.takenText)
      }
    }, (err: ApiError) => {
      if(this.getValue() !== username) return

      this.error = err
      switch(this.error.type) {
        case 'USERNAME_PURCHASE_AVAILABLE': {
          this.setError(this.options.takenText)
          break
        }

        case 'USERNAME_INVALID':
        default: {
          this.setError(this.options.invalidText)
          break
        }
      }
    }).then(() => {
      if(this.checkUsernamePromise === promise) {
        this.checkUsernamePromise = undefined
      }

      this.options.onChange?.()

      const value = this.getValue()
      if(value !== username && this.isValidToChange() && isUsernameValid(value)) {
        this.checkUsername(value)
      }
    })
  }
}
