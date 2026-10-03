// Порт tweb `src/lib/appManagers/utils/useLockScreenShortcut.ts` (812502980,
// 94 строки) — сочетание блокировки код-паролем: пока код включён, сочетание
// включено и приложение не заблокировано, `<модификаторы>+KeyL` блокирует
// приложение. Сочетание задаёт вкладка «Код-пароль»
// (`sidebarLeft/tabs/passcodeLock/mainTab.solid.tsx`, `ShortcutBuilder`).
// Зовёт `appImManager.construct` (tweb `appImManager.ts:630`).
//
// Расхождения с оригиналом:
//  1. Без Solid-корня: три `createResource` + `settings_updated` — подписка на
//     zustand `useSettingsStore` (единственный владелец настроек),
//     `PasscodeLockScreenController.getIsLocked()` — `useLockStore`. Как у
//     оригинала, возвращает `{dispose}`.
//  2. `apiManagerProxy.lock()` → `lockAndReload()` (воркер завершается вместе
//     с ключом, все вкладки перезагружаются на экран блокировки) — в
//     `onAnimationEnd`, после проявления экрана, как у оригинала (`:70-72`).
import { useSettingsStore } from '@/settings'
import { useLockStore } from '@stores/lockStore'
import PasscodeLockScreenController from '@components/passcodeLock/passcodeLockScreenController.solid'
import { lockAndReload } from '@/client/passcodeClient'
import { addShortcutListener } from '@helpers/shortcutListener'
import appImManager from '@lib/appImManager'

const useLockScreenShortcut = () => {
  let removeListener: (() => void) | undefined

  // tweb :48-80 — эффект по (locked, enabled, shortcutEnabled, shortcutKeys)
  const update = () => {
    if(removeListener) {
      removeListener()
      removeListener = undefined
      appImManager.isShiftLockShortcut = false
    }

    const { passcodeEnabled, passcodeLockShortcutEnabled, passcodeLockShortcut } = useSettingsStore.getState()
    if(useLockStore.getState().locked || !passcodeEnabled || !passcodeLockShortcutEnabled) return

    if(!passcodeLockShortcut.length) return

    const combo = [...passcodeLockShortcut, 'KeyL'].join('+')

    const isShiftLockShortcut = combo === 'Shift+KeyL'
    appImManager.isShiftLockShortcut = isShiftLockShortcut

    removeListener = addShortcutListener([combo], (_, event) => {
      const activeElement = document.activeElement as HTMLElement | null

      if(
        isShiftLockShortcut &&
        activeElement &&
        (activeElement.isContentEditable || ['INPUT', 'TEXTAREA'].includes(activeElement.tagName))
      ) return

      event.preventDefault()

      void PasscodeLockScreenController.lock(true, () => {
        lockAndReload()
      })
    }, false)
  }

  update()
  const unsubSettings = useSettingsStore.subscribe((s, prev) => {
    if(
      s.passcodeEnabled !== prev.passcodeEnabled ||
      s.passcodeLockShortcutEnabled !== prev.passcodeLockShortcutEnabled ||
      s.passcodeLockShortcut !== prev.passcodeLockShortcut
    ) update()
  })
  const unsubLock = useLockStore.subscribe((s, prev) => {
    if(s.locked !== prev.locked) update()
  })

  return {
    dispose: () => {
      unsubSettings()
      unsubLock()
      if(removeListener) {
        removeListener()
        removeListener = undefined
        appImManager.isShiftLockShortcut = false
      }
    },
  }
}

export default useLockScreenShortcut
