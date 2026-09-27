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
 * `getOverlayRoot()` на момент `lock()`: запертый в выносе клиента (Document PiP)
 * встаёт в body окна выноса, а при возврате его вместе с прочими временными
 * корнями переносит `core/pip.ts` (tweb `clientPip.tsx:106-120`). Модуль экрана —
 * ленивый чанк (`Promise.race` с паузой 100 мс, как у оригинала), снятие — через
 * `--hidden` и паузы 120 + 250 + 120 мс под `startViewTransition`.
 *
 * Запирание с анимацией (`lock(fromLockIcon, onAnimationEnd)`): кнопка замка шапки
 * (`sidebarLeft/lockButton.solid.tsx`) отдаёт обёртку иконки — её клон
 * (`__animated-lock-icon`, `--x`/`--y` по центру иконки) едет к обезьянке, экран
 * проявляется из `--hidden` через `doubleRaf`; сочетание (`true`) — только
 * проявление и `onAnimationEnd` через 200 мс. Воркер и перезагрузка — в
 * `onAnimationEnd`, после анимации.
 *
 * Расхождения с tweb:
 *  1. `isLocked` сразу разрешает флаг «код включён» вкладки и сверяет с ним
 *     настройку `passcodeEnabled` (localStorage) — истина у записи в `msgr/kv`;
 *     `getIsLocked()` — стор `useLockStore` (его читает сочетание блокировки).
 *  2. Хэш адреса не прячется на время замка (`savedHash`): у нас его применяет
 *     `boot.ts` уже после разблокировки.
 *  3. Без `LockScreenHotReloadGuardProvider` (tweb `lib/solidjs/
 *     lockScreenHotReloadGuardProvider.tsx`): экран и обезьянка импортируют
 *     `InputFieldTsx`, `PasswordInputField`, `PasswordMonkey` и канал к воркеру
 *     сами. Провайдер живёт в контроллере, а контроллер у нас — в стартовом чанке
 *     (`client/boot.ts`): он вытащил бы поле пароля и лотти обезьянки из ленивого
 *     чанка экрана в старт каждой вкладки. HMR-подмены модулей tweb
 *     (`useHotReloadGuard`) в проекте нет нигде.
 *  4. Воркер не ответил на `isLocked` — старт не вешаем (данные всё равно за ключом).
 */
import { render } from 'solid-js/web'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import { getOverlayRoot } from '@helpers/appWindow'
import { doubleRaf } from '@helpers/schedulers'
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

  public static async lock(fromLockIcon?: HTMLElement | boolean, onAnimationEnd?: () => void) {
    if(this.mountedElement) return

    useLockStore.getState().lock()

    const shouldAnimateIn = !!fromLockIcon

    await Promise.race([pause(100), importPasscodeLockScreen()])

    const element = this.mountedElement = document.createElement('div')
    element.classList.add('passcode-lock-screen')

    const clonedLockIcon = fromLockIcon instanceof HTMLElement ? this.cloneLockIcon(fromLockIcon) : undefined
    if(clonedLockIcon) element.append(clonedLockIcon)

    if(shouldAnimateIn) {
      element.classList.add('passcode-lock-screen--hidden')
    }
    getOverlayRoot().append(element)

    const { default: PasscodeLockScreen } = await importPasscodeLockScreen()
    // разблокировали, пока грузился модуль экрана (соседняя вкладка ввела код)
    if(this.mountedElement !== element) return

    this.dispose = render(() => (
      <PasscodeLockScreen
        onUnlock={() => this.unlock()}
        fromLockIcon={clonedLockIcon}
        onAnimationEnd={onAnimationEnd}
      />
    ), element)

    if(shouldAnimateIn) {
      void doubleRaf().then(async() => {
        element.classList.remove('passcode-lock-screen--hidden')

        if(!clonedLockIcon) void pause(200).then(() => {
          onAnimationEnd?.()
        })
      })
    }
  }

  private static cloneLockIcon(icon: HTMLElement) {
    const clonedLockIcon = icon.cloneNode(true) as HTMLElement
    clonedLockIcon.classList.add('passcode-lock-screen__animated-lock-icon')

    const rect = icon.getBoundingClientRect()

    clonedLockIcon.style.setProperty('--x', (rect.left + rect.width / 2) + 'px')
    clonedLockIcon.style.setProperty('--y', (rect.top + rect.height / 2) + 'px')

    return clonedLockIcon
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
