// Глобальные горячие клавиши + Esc-стек (аналог tweb appNavigationController:
// оверлеи регистрируются в стеке, Esc закрывает верхний; addShortcutListener —
// комбинации с Ctrl/Cmd). Один keydown-слушатель на window, ставится из App.

type EscHandler = () => void

// LIFO-стек Esc-обработчиков открытых оверлеев (лайтбокс, мультиселект, …).
const escStack: EscHandler[] = []

/** Регистрирует Esc-обработчик поверх стека; возвращает unregister. */
export function pushEsc(handler: EscHandler): () => void {
  escStack.push(handler)
  return () => {
    const i = escStack.lastIndexOf(handler)
    if (i !== -1) escStack.splice(i, 1)
  }
}

export interface HotkeyHandlers {
  /** Ctrl/Cmd+F — фокус в поиск по чатам (в tweb — глобальный поиск). */
  focusSearch?: () => void
  /** Esc при пустом стеке — «закрыть открытый чат» (App сам решает, есть ли что закрывать). */
  escFallback?: () => void
  /** Ctrl/Cmd+Shift+M — mute/unmute текущего чата (опционально). */
  muteChat?: () => void
  /** Ctrl/Cmd+0 — открыть «Избранное» (Saved Messages). */
  openSaved?: () => void
  /** Alt+↓ — следующий чат в списке диалогов (циклически). */
  nextChat?: () => void
  /** Alt+↑ — предыдущий чат в списке диалогов (циклически). */
  prevChat?: () => void
}

let current: HotkeyHandlers | null = null
let installed = false

// Буквенные хоткеи не должны срабатывать, пока пользователь печатает.
function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

function onKeyDown(e: KeyboardEvent): void {
  const h = current
  if (!h) return

  // Esc работает всегда (и из инпутов). Обработчики React-дерева (хелперы
  // композера и т.п.) выполняются раньше window-слушателя — уважаем их preventDefault.
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return
    const top = escStack[escStack.length - 1]
    if (top) {
      e.preventDefault()
      top()
      return
    }
    // Стек пуст: легаси-оверлеи со своим window-keydown зарегистрированы ПОЗЖЕ
    // нас и выполнятся следом — откладываемся на тик и отступаем, если кто-то
    // из них забрал событие (preventDefault).
    setTimeout(() => {
      if (!e.defaultPrevented) h.escFallback?.()
    }, 0)
    return
  }

  // Alt+↑/↓ — предыдущий/следующий чат (tweb Alt+Up/Down). Только чистый Alt
  // (без ctrl/meta/shift); в поле ввода не трогаем — там Option+стрелка = переход
  // по словам. Проверяем до общего mod-гейта ниже, т.к. здесь ctrl/meta НЕТ.
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    if (isTextTarget(e.target)) return
    const cb = e.key === 'ArrowUp' ? h.prevChat : h.nextChat
    if (!cb) return
    e.preventDefault()
    cb()
    return
  }

  if (!(e.ctrlKey || e.metaKey) || e.altKey) return

  // Ctrl/Cmd+Shift+M — mute текущего чата
  if (e.shiftKey && e.code === 'KeyM') {
    if (isTextTarget(e.target) || !h.muteChat) return
    e.preventDefault()
    h.muteChat()
    return
  }
  if (e.shiftKey) return

  // Ctrl/Cmd+F — фокус в поиск (перебиваем браузерный find; разрешено и из
  // инпута — как в Telegram).
  if (e.code === 'KeyF') {
    if (!h.focusSearch) return
    e.preventDefault()
    h.focusSearch()
    return
  }
  // Ctrl/Cmd+0 — «Избранное» (Saved Messages); разрешено и из инпута.
  if (e.code === 'Digit0') {
    if (!h.openSaved) return
    e.preventDefault()
    h.openSaved()
  }
}

/**
 * Ставит глобальный keydown-обработчик (один раз) и запоминает колбэки.
 * Возвращает деактиватор: снимает колбэки, если они всё ещё текущие
 * (сам слушатель остаётся — он no-op без колбэков).
 */
export function initHotkeys(handlers: HotkeyHandlers): () => void {
  current = handlers
  if (!installed) {
    installed = true
    window.addEventListener('keydown', onKeyDown)
  }
  return () => {
    if (current === handlers) current = null
  }
}
