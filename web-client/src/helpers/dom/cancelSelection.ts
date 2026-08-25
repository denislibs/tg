// Порт tweb `helpers/dom/cancelSelection.ts` — снять выделение текста браузера.
//
// Адаптация: `getAppWindow()` (окно Document PiP) заменено на `window` — хелпера
// `appWindow` в репо нет, ровно как и у апстримного tweb до pip-патча (там же,
// где это уже сделано для `helpers/dom/clickEvent.ts`).
export default function cancelSelection() {
  const selection = window.getSelection?.()
  if (!selection) return

  if (selection.empty) { // Chrome
    selection.empty()
  } else if (selection.removeAllRanges) { // Firefox
    selection.removeAllRanges()
  }
}
