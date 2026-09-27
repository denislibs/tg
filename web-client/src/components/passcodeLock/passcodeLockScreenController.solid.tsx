/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/passcodeLock/passcodeLockScreenController.tsx` (812502980)
 * — владелец экрана блокировки код-паролем вне дерева приложения.
 *
 * Старт (tweb `index.ts:453`): `client/boot.ts` ждёт `waitForUnlock()` ДО чтения
 * токена и State — под замком не поднимается ни приложение, ни одна загрузка.
 * `checkLockState`: сперва ключ из передачи через перезагрузку
 * (`takeEncryptionKeyHandoff`, 65c6ea8f8), затем `isLocked` у воркера; заперто —
 * колбэк (тема и язык, `boot.ts`) и экран. Экран — Solid-корень в
 * `getOverlayRoot()`, модуль экрана — ленивый чанк (`Promise.race` с паузой 100 мс,
 * как у оригинала), снятие — через `--hidden` и паузы 120 + 250 + 120 мс под
 * `startViewTransition`.
 *
 * Расхождения с tweb:
 *  1. Без анимации замка из шапки (`fromLockIcon`/`onAnimationEnd`, `cloneLockIcon`):
 *     наша кнопка замка — React-`IconButton` в `Sidebar.tsx`, не порт
 *     `lockButton.tsx`, и иконку не передаёт; ветки без вызывающего не заводим.
 *  2. `isLocked` сразу разрешает флаг «код включён» вкладки и сверяет с ним
 *     настройку `passcodeEnabled` (localStorage) — истина у записи в `msgr/kv`;
 *     `getIsLocked()` — стор `useLockStore` (его читает сочетание блокировки).
 *  3. Хэш адреса не прячется на время замка (`savedHash`): у нас его применяет
 *     `boot.ts` уже после разблокировки.
 *  4. `LockScreenHotReloadGuardProvider` (подмена модулей под HMR у tweb) не нужен:
 *     экран импортирует зависимости напрямую.
 *  5. Воркер не ответил на `isLocked` — старт не вешаем (данные всё равно за ключом).
 */
import { render } from 'solid-js/web'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import { getOverlayRoot } from '@helpers/appWindow'
import pause from '@helpers/schedulers/pause'
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode'
import EncryptionKeyStore from '@lib/passcode/keyStore'
import { importHandoffKey, takeEncryptionKeyHandoff } from '@lib/passcode/keyHandoff'
import { invokePasscode } from '@/client/passcodeClient'
import { useSettingsStore } from '@/settings'
import { useLockStore } from '@/stores/lockStore'

const importPasscodeLockScreen = () => import('./passcodeLockScreen.solid')

export default class PasscodeLockScreenController {
  private static mountedElement: HTMLDivElement | undefined
  private static dispose: (() => void) | undefined

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
      await this.lock()
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
      console.error('[passcode] lock state check failed', err)
      this.resolveStartup()
    })
    await this.appStartupDeferred
  }

  public static async lock() {
    if(this.mountedElement) return

    useLockStore.getState().lock()

    await Promise.race([pause(100), importPasscodeLockScreen()])

    const element = this.mountedElement = document.createElement('div')
    element.classList.add('passcode-lock-screen')
    getOverlayRoot().append(element)

    const { default: PasscodeLockScreen } = await importPasscodeLockScreen()
    // разблокировали, пока грузился модуль экрана (соседняя вкладка ввела код)
    if(this.mountedElement !== element) return

    this.dispose = render(() => (
      <PasscodeLockScreen onUnlock={() => this.unlock()} />
    ), element)
  }

  public static unlock() {
    const element = this.mountedElement
    const dispose = this.dispose
    this.mountedElement = undefined
    this.dispose = undefined

    useLockStore.getState().unlock()

    if(element) void (async() => {
      element.style.setProperty('transition-time', '.12s')
      await pause(120)

      const next = async() => {
        await pause(250)
        element.classList.add('passcode-lock-screen--hidden')
        await pause(120)

        dispose?.()
        element.remove()
      }

      if(document.startViewTransition) document.startViewTransition(next)
      else void next()
    })()

    this.resolveStartup()
  }
}
