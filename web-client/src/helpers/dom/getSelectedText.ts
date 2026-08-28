// Порт tweb `helpers/dom/getSelectedText.ts` — текст текущего выделения браузера.
//
// Адаптация та же, что в `cancelSelection.ts`: `getAppWindow()` → `window`
// (хелпера `appWindow` в репо нет). Ветка `document.selection` (IE) не
// портирована — в tweb она под двумя `@ts-ignore`, а её носитель не поддержан
// ни одним нашим таргетом.
export default function getSelectedText(): string {
  return window.getSelection?.()?.toString() ?? ''
}
