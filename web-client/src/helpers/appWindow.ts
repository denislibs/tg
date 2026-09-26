/**
 * Порт tweb `src/helpers/appWindow.ts` (812502980) — окно, в котором живёт
 * приложение, и корень оверлеев в нём.
 *
 * У tweb активное окно переключается: клиент целиком выносится в Document
 * Picture-in-Picture (`setAppWindow`, `onAppWindowChange`,
 * `onBeforeAppWindowChange`, `bindActiveWindowListener` — `:36-122`), и
 * оверлеи, открытые в выносе, монтируются в body ОКНА ВЫНОСА. Выноса клиента у
 * нас нет (в PiP уходит только видео, `core/pip.ts`) — переключателей и
 * подписок без вызывающих не заводим: активное окно здесь всегда вкладка, и
 * `getOverlayRoot()` отдаёт её `document.body` ровно тем путём, что оригинал.
 * Вынос клиента, если появится, заводится здесь же — точки монтирования
 * оверлеев уже зовут эту функцию.
 */

// tweb :18 (`let` — у оригинала его переписывает `setAppWindow`)
const activeWindow: Window = window

/**
 * The body where transient overlays (context menus, popups, tooltips, the media viewer) should mount.
 * It's the active app window's body — so an overlay opened while the client is popped out lands in the
 * Document PiP window instead of the now-background tab. The whole app lives in one window at a time,
 * so this single atomic target is all the overlay layer needs.
 */
export function getOverlayRoot(): HTMLElement {
  return activeWindow.document.body
}
