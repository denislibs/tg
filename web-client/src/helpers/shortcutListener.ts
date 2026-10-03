/**
 * Порт tweb `src/helpers/shortcutListener.ts` (812502980, 42 строки) — слушатель
 * сочетаний вида `Alt+Shift+KeyL`: модификаторы — по флагам события,
 * позиционные клавиши (`KeyL`) — по `event.code` (не зависят от раскладки),
 * прочие — по `event.key`. Из нескольких сочетаний срабатывает самое длинное.
 * Первый потребитель — сочетание блокировки код-паролем
 * (`lib/appManagers/utils/useLockScreenShortcut.ts`), затем Ctrl+F/Ctrl+0
 * колонки (`components/sidebarLeft/index.ts`, tweb `:457-468`).
 *
 * Расхождение: слушатель висит на `window`, а не на активном окне приложения
 * (`bindActiveWindowListener`, tweb `helpers/appWindow.ts`) — окна Document PiP,
 * ради которого там следят за активным окном, у нас нет.
 */
const positionKeyRegexp = /^key[a-zA-Z]$/i

function matchNonMetaKey(event: KeyboardEvent, key: string) {
  if(positionKeyRegexp.test(key)) return event.code.toLowerCase() === key.toLowerCase()

  return event.key.toLowerCase() === key.toLowerCase()
}

function matchComboKey(event: KeyboardEvent, key: string) {
  return (
    (key === 'ctrl' && event.ctrlKey) ||
    (key === 'shift' && event.shiftKey) ||
    (key === 'alt' && event.altKey) ||
    (key === 'meta' && event.metaKey) ||
    (key === 'anymeta' && (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey)) ||
    matchNonMetaKey(event, key)
  )
}

export function addShortcutListener(combos: string[], callback: (combo: string, event: KeyboardEvent) => void, preventByDefault = true) {
  const listener = (event: KeyboardEvent) => {
    const pairs = combos
    .map((combo) => [combo, combo.toLowerCase().split('+')] as const)
    .sort((a, b) => b[1].length - a[1].length)

    for(const [combo, keys] of pairs) {
      const isComboMatched = keys.every((key) => matchComboKey(event, key))

      if(isComboMatched) {
        if(preventByDefault) event.preventDefault()
        callback(combo, event)
        break
      }
    }
  }

  window.addEventListener('keydown', listener)
  return () => window.removeEventListener('keydown', listener)
}
