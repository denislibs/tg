// Порт tweb `helpers/dom/isSelectionEmpty.ts` — 1:1.
//
// «Пользователь ничего не выделил»: нет диапазонов вовсе либо диапазон
// схлопнут. Второе условие оригинала (`!selectionRange.START_TO_END`) —
// проверка того, что перед нами настоящий `Range` (константа сравнения есть у
// любого `Range`), перенесена дословно.
//
// Адаптация: `getAppWindow()` (окно Document PiP) → `window`, как уже сделано
// в `helpers/dom/clickEvent.ts` и `helpers/positionMenu.ts`.
export default function isSelectionEmpty(selection: Selection | null = window.getSelection()) {
  if(!selection?.rangeCount) {
    return true
  }

  const selectionRange = selection.getRangeAt(0)
  if(selectionRange.collapsed || !selectionRange.START_TO_END) {
    return true
  }

  return false
}
