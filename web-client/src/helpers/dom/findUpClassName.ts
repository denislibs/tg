// Порт tweb `helpers/dom/findUpClassName.ts` — 1:1 (обёртка над `closest`);
// правки только под формат `.oxlintrc.json` (без `;`) и строгий tsconfig:
// честный `| null` в возвращаемом типе (tweb с выключенным strict его прячет).
export default function findUpClassName(el: EventTarget | { closest: (selector: string) => Element | null }, className: string): HTMLElement | null {
  return (el as Element).closest('.' + className) as HTMLElement | null
}
