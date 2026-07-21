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
  /** Ctrl/Cmd+K — фокус в поиск по чатам. */
  focusSearch?: () => void
  /** Esc при пустом стеке — «закрыть открытый чат» (App сам решает, есть ли что закрывать). */
  escFallback?: () => void
  /** Ctrl/Cmd+Shift+M — mute/unmute текущего чата (опционально). */
  muteChat?: () => void
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

  if (!(e.ctrlKey || e.metaKey) || e.altKey) return

  // Ctrl/Cmd+Shift+M — mute текущего чата
  if (e.shiftKey && e.code === 'KeyM') {
    if (isTextTarget(e.target) || !h.muteChat) return
    e.preventDefault()
    h.muteChat()
    return
  }
  // Ctrl/Cmd+K — фокус в поиск
  if (!e.shiftKey && e.code === 'KeyK') {
    if (isTextTarget(e.target) || !h.focusSearch) return
    e.preventDefault()
    h.focusSearch()
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
