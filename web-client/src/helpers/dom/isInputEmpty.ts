/**
 * Порт tweb `src/helpers/dom/isInputEmpty.ts` (812502980) — дословно: пусто ли
 * поле ввода (contenteditable — по тексту и наличию эмодзи-узлов, `<input>` —
 * по значению; `allowStartingSpace` — пробелы тоже считаются содержимым).
 */
export default function isInputEmpty(element: HTMLElement, allowStartingSpace?: boolean) {
  let value: string
  if(element.isContentEditable || element.tagName !== 'INPUT') {
    if(element.querySelector('.emoji, .custom-emoji, .custom-emoji-placeholder')) {
      return false
    }
    /* const value = element.innerText;

    return !value.trim() && !serializeNodes(Array.from(element.childNodes)).trim(); */
    // return !getRichValueWithCaret(element, false, false).value.trim();
    value = element.textContent ?? ''
  } else {
    value = (element as HTMLInputElement).value
  }

  if(!allowStartingSpace) {
    return !value.trim()
  }

  return !value
}
