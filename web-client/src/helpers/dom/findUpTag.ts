// Порт tweb `src/helpers/dom/findUpTag.ts` — 1:1 (`el.closest(tag)`).
//
// Правка под строгий tsconfig, та же, что у соседнего `findUpClassName`:
// честный `| null` в возвращаемом типе. Закомментированный черновик обхода
// по `parentElement` (оригинал :3-10) не перенесён.
export default function findUpTag(el: EventTarget | { closest: (selector: string) => Element | null }, tag: string): HTMLElement | null {
  return (el as Element).closest(tag) as HTMLElement | null
}
