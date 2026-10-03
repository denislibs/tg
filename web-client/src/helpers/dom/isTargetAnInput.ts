// Порт tweb `src/helpers/dom/isTargetAnInput.ts` (812502980) — 1:1.
export default function isTargetAnInput(target: HTMLElement | null | undefined) {
  return !!target && (target.tagName === 'TEXTAREA' ||
    target.tagName === 'INPUT' && !['checkbox', 'radio'].includes((target as HTMLInputElement).type) ||
    target.isContentEditable)
}
