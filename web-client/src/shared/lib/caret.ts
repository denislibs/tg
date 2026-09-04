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

/**
 * Отразить `value` в contenteditable-узле (tweb `setValueSilently` +
 * `placeCaretAtEnd`, `components/inputField.ts:764-773`).
 *
 * НЕ полагается на голое `el.textContent === value` — после того как браузер
 * удаляет ПОСЛЕДНИЙ символ в contenteditable, Chrome/Safari оставляют узел с
 * одиноким `<br>` (тот же квирк, ради которого rich-text-редакторы вида
 * Slate/ProseMirror отдельно чистят «anchor `<br>`»). `textContent` такого узла
 * тоже `''`, поэтому строковое сравнение считает DOM «уже синхронизированным» и
 * не трогает его — `<br>` остаётся НАВСЕГДА (до первого ввода, который даст
 * ДРУГУЮ строку и провалит сравнение сам). Персистентный `<br>` — лишняя строка
 * внутри однострочного поля: высота узла удваивается визуально «пустым»
 * контентом, хотя значение и правда пустое. У tweb дыры нет: `setValueSilently`
 * вызывает `replaceContent` БЕЗУСЛОВНО, не сверяясь с текущим содержимым.
 * Здесь — тот же безусловный результат при любом структурном рассогласовании,
 * но без лишней перезаписи в ЧИСТОМ случае: «уже синхронизировано» значит
 * РОВНО ОДИН текстовый узел с нужной строкой (или вовсе ни одного child при
 * пустом значении) — то есть именно то состояние, которое сама же функция и
 * оставляет после rebuild.
 */
export function syncContentEditableValue(el: HTMLElement, value: string): void {
  const clean =
    value === ''
      ? el.childNodes.length === 0
      : el.childNodes.length === 1 && el.firstChild!.nodeType === Node.TEXT_NODE && el.firstChild!.textContent === value
  if (clean) return
  el.textContent = value
  if (el.ownerDocument.activeElement === el) placeCaretAtEnd(el)
}
