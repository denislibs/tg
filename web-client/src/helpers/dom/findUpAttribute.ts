// Порт tweb `helpers/dom/findUpAttribute.ts` — 1:1 (обёртка над `closest`);
// правки только под формат `.oxlintrc.json` (без `;`) и строгий tsconfig:
// честный `| null` в возвращаемом типе и `EventTarget` на входе вместо `any`,
// как у соседа `findUpClassName.ts`. Закомментированный ручной обход родителей
// (webogram-наследие под браузеры без `closest`) не переносился.
export default function findUpAttribute(el: EventTarget | { closest: (selector: string) => Element | null }, attribute: string): HTMLElement | null {
  return (el as Element).closest(`[${attribute}]`) as HTMLElement | null
}
