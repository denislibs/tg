// Порт tweb `src/lib/appManagers/utils/useLockScreenShortcut.ts` (812502980,
// 94 строки) — сочетание блокировки код-паролем: пока код включён, сочетание
// включено и приложение не заблокировано, `<модификаторы>+KeyL` блокирует
// приложение. Сочетание задаёт вкладка «Код-пароль»
// (`sidebarLeft/tabs/passcodeLock/mainTab.solid.tsx`, `ShortcutBuilder`).
//
// Расхождения с оригиналом:
//  1. React-хук рядом с `useAutoLock` (оба зовёт `App.tsx`), а не Solid-корень
//     из конструктора `appImManager` (`appImManager.ts:630`): оболочка
//     приложения у нас React. Три `createResource` + `settings_updated` —
//     подписка на zustand `useSettingsStore` (единственный владелец настроек),
//     `PasscodeLockScreenController.getIsLocked()` — `useLockStore`.
//  2. `PasscodeLockScreenController.lock(true, () => apiManagerProxy.lock())` —
//     без анимации: экран сразу, затем `lockAndReload()` (воркер завершается
//     вместе с ключом, все вкладки перезагружаются на экран блокировки).
//  3. Флага `appImManager.isShiftLockShortcut` нет: его единственный читатель —
//     «печать уводит фокус в композер» (`appImManager.ts:1733`), такого
//     обработчика у нас нет. Ввод в поле при сочетании Shift+L по-прежнему не
//     блокирует — как у оригинала (`:62-66`).
import { useEffect } from 'react'
import { useSettingsStore } from '../../settings'
import { useLockStore } from '../../stores/lockStore'
import PasscodeLockScreenController from '../../components/passcodeLock/passcodeLockScreenController.solid'
import { lockAndReload } from '../../client/passcodeClient'
import { addShortcutListener } from '@helpers/shortcutListener'

export function useLockScreenShortcut(): void {
  useEffect(() => {
    let removeListener: (() => void) | undefined

    // tweb :48-80 — эффект по (locked, enabled, shortcutEnabled, shortcutKeys)
    const update = () => {
      removeListener?.()
      removeListener = undefined

      const { passcodeEnabled, passcodeLockShortcutEnabled, passcodeLockShortcut } = useSettingsStore.getState()
      if(useLockStore.getState().locked || !passcodeEnabled || !passcodeLockShortcutEnabled) return

      if(!passcodeLockShortcut.length) return

      const combo = [...passcodeLockShortcut, 'KeyL'].join('+')

      const isShiftLockShortcut = combo === 'Shift+KeyL'

      removeListener = addShortcutListener([combo], (_, event) => {
        const activeElement = document.activeElement as HTMLElement | null

        if(
          isShiftLockShortcut &&
          activeElement &&
          (activeElement.isContentEditable || ['INPUT', 'TEXTAREA'].includes(activeElement.tagName))
        ) return

        event.preventDefault()

        void PasscodeLockScreenController.lock()
        lockAndReload()
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

    return () => {
      unsubSettings()
      unsubLock()
      removeListener?.()
    }
  }, [])
}
