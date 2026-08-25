// Порт tweb `helpers/dom/blurActiveElement.ts` — 1:1; правки только под строгий
// tsconfig (в tweb `strict` выключен): проверка `blur` через `instanceof
// HTMLElement` вместо каста к `HTMLInputElement`.
export default function blurActiveElement(): boolean {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    active.blur()
    return true
  }

  return false
}
