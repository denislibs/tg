// Порт tweb `src/helpers/dom/isSendShortcutPressed.ts` (812502980).
//
// Расхождение: настройки `appSettings.sendShortcut` (Enter / Ctrl+Enter) у нас нет
// (`sidebarLeft/tabs/keyboardShortcuts.solid.tsx`, расхождение о `SendShortcutRow`),
// поэтому работает ветка оригинала `sendShortcut === 'enter'`: Enter отправляет,
// Shift/Ctrl/Cmd+Enter — перевод строки.
import { IS_MOBILE } from '@environment/userAgent'

export default function isSendShortcutPressed(e: KeyboardEvent) {
  if(e.key === 'Enter' && !IS_MOBILE && !e.isComposing) {
    if(e.shiftKey || e.ctrlKey || e.metaKey) {
      return
    }

    return true
  }

  return false
}
