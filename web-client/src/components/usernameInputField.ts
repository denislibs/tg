/**
 * Порт tweb `src/components/usernameInputField.ts` (812502980, 111 строк) —
 * поле имени пользователя: форма проверяется на вводе (`isUsernameValid`),
 * свободное ли имя — запросом с задержкой 150 мс, итог — состоянием поля
 * (`valid` + `availableText`, `error` + `takenText`/`invalidText`). Первый
 * потребитель — вкладка «Редактировать профиль»
 * (`sidebarLeft/tabs/editProfile.solid.tsx`, задача 27 плана 2D).
 *
 * Расхождения с оригиналом:
 *  1. Ветки `peerId` (имя канала — `appChatsManager.checkUsername`, :66-68)
 *     нет: её потребитель — вкладка типа канала (`sidebarRight/tabs/chatType.tsx`),
 *     у нас не портированная. Опции `peerId` нет тоже.
 *  2. `managers` — наш `Managers['profile']` (`checkUsername` → `GET
 *     /username/available`, ответ `Bool`, негодное имя — отказ
 *     `USERNAME_INVALID`), а не `AppManagers`.
 *  3. `options` объявлен `declare`: у нас `useDefineForClassFields`, и
 *     переобъявленное без `declare` поле затёрло бы значение, записанное
 *     конструктором `InputField`.
 *  4. (О-63) Отказа `USERNAME_PURCHASE_AVAILABLE` (имя продаётся на Fragment,
 *     :84-87) наш сервер не шлёт: торговли именами нет. Любой отказ проверки —
 *     `invalidText`, как ветка `USERNAME_INVALID`/`default` оригинала. Поля
 *     `error` (:20, `this.error = …`) нет: его читает только подпись покупки
 *     имени (`editProfile.tsx:396-401`), которой нет по той же причине.
 */
import type ListenerSetter from '@helpers/listenerSetter'
import debounce from '@helpers/schedulers/debounce'
import type { LangPackKey } from '@lib/langPack'
import InputField, { type InputFieldOptions, InputState } from '@components/inputField'
import { isUsernameValid } from '@lib/richtext/validators'
import type { Managers } from '@/client/bootstrap'

export type UsernameInputFieldManagers = Pick<Managers, 'profile'>

export class UsernameInputField extends InputField {
  private checkUsernamePromise?: Promise<unknown>
  private checkUsernameDebounced: (username: string) => void
  declare public options: InputFieldOptions & {
    listenerSetter: ListenerSetter,
    onChange?: () => void,
    invalidText: LangPackKey,
    takenText: LangPackKey,
    availableText: LangPackKey,
    head?: string
  }

  constructor(
    options: UsernameInputField['options'],
    private managers: UsernameInputFieldManagers,
  ) {
    super(options)

    this.checkUsernameDebounced = debounce(this.checkUsername.bind(this), 150, false, true)

    options.listenerSetter.add(this.input)('input', () => {
      const value = this.getValue()

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

    // расхождение 1 — только имя пользователя
    const checkPromise = this.managers.profile.checkUsername(username)

    const promise = this.checkUsernamePromise = checkPromise.then((available) => {
      if(this.getValue() !== username) return

      if(available) {
        this.setState(InputState.Valid, this.options.availableText)
      } else {
        this.setError(this.options.takenText)
      }
    }, () => {
      if(this.getValue() !== username) return

      // расхождение 4: ветки `USERNAME_PURCHASE_AVAILABLE` → `takenText`
      // (:84-87) нет — отказ приходит только `USERNAME_INVALID`
      this.setError(this.options.invalidText)
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
