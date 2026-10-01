/**
 * Порт tweb `src/helpers/appWindow.ts:18-122` (812502980) — окно, в котором
 * живёт приложение, и корень оверлеев в нём.
 *
 * Активное окно переключается: пункт меню «Картинка в картинке» выносит клиент
 * целиком (`#root`) в окно Document Picture-in-Picture (`core/pip.ts`,
 * `enterAppPip`), и на это время всё, что монтируется «поверх приложения»
 * (попапы, меню, тултипы), обязано монтироваться в body ОКНА ВЫНОСА — иначе оно
 * откроется в фоновой вкладке. Писатель один, как у tweb (`clientPip.tsx:62`,
 * `:118`): `enterAppPip` при выносе и его `restore` при возврате.
 *
 * Расхождения с оригиналом:
 *  1. `onBeforeAppWindowChange` (`:21`, `:40-47`, `:62-70`) не портирован —
 *     у нас нет ни одного читателя. У tweb его читает снимок скролла ленты
 *     перед переносом (`bubbles.ts`); наши метрики в выносе окно не меняют
 *     (`core/dom/mediaSizes.ts`, шапка), узкий лейаут PiP держит
 *     `usePipStore().active`. Заводится вместе с первым читателем.
 *     `getAppWindow` (`:23-25`) заведён с первым читателем — предпросмотром
 *     стикера (`components/stickerViewer.ts`): жест удержания слушает
 *     документ и таймеры того окна, где сейчас живёт приложение.
 */

// tweb :18
let activeWindow: Window = typeof window !== 'undefined' ? window : (undefined as unknown as Window)

// tweb :20
const listeners = new Set<(win: Window, prev: Window) => void>()

// tweb :23-25
export function getAppWindow(): Window {
  return activeWindow
}

/**
 * The body where transient overlays (context menus, popups, tooltips, the media viewer) should mount.
 * It's the active app window's body — so an overlay opened while the client is popped out lands in the
 * Document PiP window instead of the now-background tab. The whole app lives in one window at a time,
 * so this single atomic target is all the overlay layer needs.
 */
export function getOverlayRoot(): HTMLElement {
  return activeWindow.document.body
}

// tweb :37-54 (без `beforeListeners` — расхождение 1)
export function setAppWindow(win: Window): void {
  const prev = activeWindow
  if(!win || win === prev) return
  activeWindow = win
  listeners.forEach((listener) => {
    try {
      listener(win, prev)
    } catch{}
  })
}

/** Subscribe to active-window changes. Callback gets `(newWindow, previousWindow)`. */
export function onAppWindowChange(cb: (win: Window, prev: Window) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * Attach a global listener that FOLLOWS the active app window. Always-on document/window listeners
 * (keyboard shortcuts, the global "type anywhere → focus input" handler, Esc/back navigation,
 * paste/drop) are registered once at app init against the tab's realm; when the client pops into a
 * Document PiP window those events fire on the PiP document instead, so a main-realm listener goes
 * dead. This re-binds the listener to the new window's target on every active-window change (and
 * back on restore). `getTarget` selects the target from a window — `w => w`, `w => w.document`,
 * `w => w.document.body`; the return type picks the matching overload so the listener keeps its
 * exact event type. Returns a disposer that removes the listener and stops following. When the app
 * window never changes (no PiP) this behaves exactly like a plain `addEventListener`.
 */
export function bindActiveWindowListener<K extends keyof WindowEventMap>(
  getTarget: (win: Window) => Window,
  type: K,
  listener: (ev: WindowEventMap[K]) => unknown,
  options?: boolean | AddEventListenerOptions,
): () => void
export function bindActiveWindowListener<K extends keyof DocumentEventMap>(
  getTarget: (win: Window) => Document,
  type: K,
  listener: (ev: DocumentEventMap[K]) => unknown,
  options?: boolean | AddEventListenerOptions,
): () => void
export function bindActiveWindowListener<K extends keyof HTMLElementEventMap>(
  getTarget: (win: Window) => HTMLElement,
  type: K,
  listener: (ev: HTMLElementEventMap[K]) => unknown,
  options?: boolean | AddEventListenerOptions,
): () => void
export function bindActiveWindowListener(
  getTarget: (win: Window) => EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): () => void {
  let target: EventTarget | undefined
  const attach = (win: Window) => {
    target = getTarget(win)
    target.addEventListener(type, listener, options)
  }
  const detach = () => target?.removeEventListener(type, listener, options)
  attach(activeWindow)
  const off = onAppWindowChange((win) => {
    detach()
    attach(win)
  })
  return () => {
    detach()
    off()
  }
}
