/**
 * Порт tweb/src/helpers/dom/isKeyboardControl.ts:1-9 (812502980, пришёл в 472e3e76b).
 * Потребитель в волне 2C — Enter-подтверждение оболочки попапов (`popups/indexTsx.tsx:249`).
 *
 * Расхождения:
 *  1. `shouldPreserveKeyboardFocus` (`:11-19`) не портирован: у tweb его зовут
 *     `appImManager.ts:1708`, `stories/viewer.tsx:2900`, `popups/newMedia.tsx:878`,
 *     `mediaEditor/canvas/initVideoPlayback.ts:53` — ни одного из них волна 2C не
 *     переносит (`newMedia` — О-15 2C). Вместе с ним не нужен и `isTargetAnInput`
 *     (`:1`, импорт только ради `:18`). Заводит тот, кто перенесёт первого потребителя.
 */

/** Controls whose keys must not be redirected into a chat or story composer. */
export default function isKeyboardControl(element: HTMLElement) {
  // `[role="link"]` sits next to `a[href]` on purpose: an element that stands in
  // for a link has to be treated like one, or its keys get redirected into the
  // composer while a native link's do not.
  return !!element.closest('button, a[href], select, input[type="checkbox"], input[type="radio"], input[type="range"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="checkbox"], [role="radio"], [role="slider"]')
}
