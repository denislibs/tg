// Порт tweb `lib/passcode/deferredIsUsingPasscode.ts` — 1:1. «Код-пароль
// включён» — deferred до первого ответа. У tweb его разрешает
// `commonStateStorage` из `settings.passcode.enabled`; у нас настройки лежат в
// localStorage, воркеру недоступном, поэтому воркер разрешает его по наличию
// записи `passcode` в `msgr/kv` (`core/store/sessionKv.ts`), вкладка — ответом
// воркера на старте (`components/passcodeLockScreenController.tsx`).
// `resetDeferred` (для SW tweb) не портирован: наш SW — скрипт вне сборки.
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'

export default class DeferredIsUsingPasscode {
  private static deferred: CancellablePromise<void> | undefined = deferredPromise<void>()
  private static value: boolean | undefined

  public static resolveDeferred(value: boolean) {
    this.value = value
    this.deferred?.resolve!()
    this.deferred = undefined
  }

  public static async isUsingPasscode() {
    if(this.deferred) await this.deferred

    if(typeof this.value !== 'boolean') throw new Error('Is using passcode is not boolean WTF?')

    return this.value
  }

  public static isUsingPasscodeUndeferred() {
    return this.value
  }
}
