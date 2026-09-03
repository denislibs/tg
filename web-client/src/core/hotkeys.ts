// Глобальные горячие клавиши приложения (порт `addShortcutListener` tweb —
// комбинации с Ctrl/Cmd). Один keydown-слушатель на window, ставится из App.
//
// ── Esc-стека здесь БОЛЬШЕ НЕТ (#108), и своей ветки Esc тоже (chat-navigation-im-3) ──
// Esc-стек был вторым, параллельным списком открытых оверлеев — рядом со
// стеком слоёв Back. Оба отвечали на один вопрос «что закрыть первым», хранили
// СВОЙ порядок и расходились. Теперь на него отвечает один
// `core/navigation/appNavigationController`, как в оригинале
// (tweb `appNavigationController.ts:217-224`): его `onKeyDown` висит на window
// В ФАЗЕ ЗАХВАТА, берёт верхнюю запись навигации и делает `back(item.type)`.
// Отдельного «Esc закрывает чат» в оригинале нет вовсе — пока чат открыт,
// `core/navigation/chatHistory.ts` держит на стеке контроллера запись `im`/
// `chat`, и Esc закрывает её той же записью, что и Back. Собственный
// `escFallback` этого файла дублировал ровно то же самое поведение вторым
// путём — снят вместе с проводкой в `core/hooks/useAppHotkeys.ts`.
//
// Здесь остаётся ровно то, чего у контроллера нет: комбинации с модификаторами.
// Esc в этом файле не обрабатывается вовсе.

export interface HotkeyHandlers {
  /** Ctrl/Cmd+F — фокус в поиск по чатам (в tweb — глобальный поиск). */
  focusSearch?: () => void
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
