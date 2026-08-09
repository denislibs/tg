// Работа с кареткой/выделением в contenteditable — порт tweb
// `helpers/dom/selectElementContents.ts` и `helpers/dom/placeCaretAtEnd.ts`.

/** Выделить всё содержимое элемента (tweb `selectElementContents`). */
export function selectElementContents(el: HTMLElement): void {
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  const selection = el.ownerDocument.defaultView?.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * Поставить каретку в конец элемента (tweb `placeCaretAtEnd`). `focus` = false —
 * когда фокус уже на элементе и перехватывать его не нужно.
 */
export function placeCaretAtEnd(el: HTMLElement, focus = true): void {
  if (focus) el.focus()
  if (el instanceof HTMLInputElement) {
    const length = el.value.length
    el.selectionStart = length
    el.selectionEnd = length
    return
  }
  const range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const selection = el.ownerDocument.defaultView?.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}
