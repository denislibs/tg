// Порт tweb `helpers/dom/findUpAsChild.ts` — 1:1 по логике; правки только под
// строгий tsconfig (в tweb `strict` выключен): честный `| null` на входе и в
// возвращаемом типе + `parentElement: HTMLElement | null` в констрейнте
// (у настоящих элементов он nullable) — рантайм тот же.
export default function findUpAsChild<T extends { parentElement: HTMLElement | null }>(
  el: T | null,
  parent: HTMLElement,
): T | null {
  if (!el) return null
  if (el.parentElement === parent) return el

  while (el.parentElement) {
    el = el.parentElement as unknown as T
    if (el.parentElement === parent) {
      return el
    }
  }

  return null
}
