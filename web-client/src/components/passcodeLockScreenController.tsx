// Порт tweb `components/passcodeLock/passcodeLockScreenController.tsx` — владелец
// экрана блокировки код-паролем вне дерева приложения.
//
// Старт (tweb `index.ts:453`): `client/boot.ts` ждёт `waitForUnlock()` ДО чтения
// токена и State — под замком не поднимается ни приложение, ни одна загрузка.
// `checkLockState`: сперва ключ из передачи через перезагрузку
// (`takeEncryptionKeyHandoff`, 65c6ea8f8), затем `isLocked` у воркера; заперто —
// колбэк (язык из кэша) и экран.
//
// Расхождения с tweb:
//  1. Экран — React-компонент (`PasscodeLockScreen.tsx`), монтируется своим корнем
//     в `document.body`, без анимации замка из шапки и без view transition.
//  2. `isLocked` сразу же разрешает флаг «код включён» вкладки и сверяет с ним
//     настройку `passcodeEnabled` (localStorage) — истина у записи в `msgr/kv`.
//  3. Хэш адреса не прячется на время замка (`savedHash`): у нас его применяет
//     `boot.ts` уже после разблокировки.
import { createRoot, type Root } from 'react-dom/client'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode'
import EncryptionKeyStore from '@lib/passcode/keyStore'
import { importHandoffKey, takeEncryptionKeyHandoff } from '@lib/passcode/keyHandoff'
import { invokePasscode } from '../client/passcodeClient'
import { useSettingsStore } from '../settings'
import { useLockStore } from '../stores/lockStore'
import PasscodeLockScreen from './PasscodeLockScreen'

export default class PasscodeLockScreenController {
  private static mountedElement: HTMLDivElement | undefined
  private static root: Root | undefined

  private static appStartupDeferred: CancellablePromise<void> | undefined = deferredPromise<void>()

  private static async tryGetStoredEncryptionHash() {
    const storedBase64Key = takeEncryptionKeyHandoff()
    if(!storedBase64Key) return false

    try {
      const importedKey = await importHandoffKey(storedBase64Key)
      await invokePasscode({ method: 'saveEncryptionKey', payload: importedKey })
      EncryptionKeyStore.save(importedKey)
      return true
    } catch{
      return false // битый ключ — экран кода
    }
  }

  private static async checkLockState(isLockedCallback: () => Promise<void>) {
    await this.tryGetStoredEncryptionHash()

    const { isUsingPasscode, isLocked } = await invokePasscode<{ isUsingPasscode: boolean, isLocked: boolean }>({ method: 'isLocked' })

    DeferredIsUsingPasscode.resolveDeferred(isUsingPasscode)
    if(!isUsingPasscode) EncryptionKeyStore.save(null)
    if(useSettingsStore.getState().passcodeEnabled !== isUsingPasscode) {
      useSettingsStore.getState().update({ passcodeEnabled: isUsingPasscode })
    }

    if(isLocked) {
      await isLockedCallback()
      this.lock()
    } else {
      this.resolveStartup()
    }
  }

  private static resolveStartup() {
    this.appStartupDeferred?.resolve!()
    this.appStartupDeferred = undefined
  }

  public static async waitForUnlock(isLockedCallback: () => Promise<void>) {
    this.checkLockState(isLockedCallback).catch((err: unknown) => {
      // Воркер не ответил — старт не вешаем: данные всё равно за его ключом
      console.error('[passcode] lock state check failed', err)
      this.resolveStartup()
    })
    await this.appStartupDeferred
  }

  public static lock() {
    if(this.mountedElement) return

    useLockStore.getState().lock()

    this.mountedElement = document.createElement('div')
    this.mountedElement.classList.add('passcode-lock-screen')
    document.body.append(this.mountedElement)

    this.root = createRoot(this.mountedElement)
    this.root.render(<PasscodeLockScreen onUnlock={() => this.unlock()} />)
  }

  public static unlock() {
    const element = this.mountedElement
    this.mountedElement = undefined

    useLockStore.getState().unlock()

    if(element) {
      this.root?.unmount()
      this.root = undefined
      element.remove()
    }

    this.resolveStartup()
  }
}
