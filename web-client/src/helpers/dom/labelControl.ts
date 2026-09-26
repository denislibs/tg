/**
 * Порт tweb `src/helpers/dom/labelControl.ts` (472e3e76b, 8 строк) — связать
 * нативный или contenteditable-контрол с той же видимой подписью через
 * `aria-labelledby`. Своя подпись контрола (`aria-label`/`aria-labelledby`)
 * не перетирается; id подписи заводится, только если его нет.
 */
let labelId = 0

export default function labelControl(control: HTMLElement | null | undefined, label: HTMLElement | null | undefined) {
  if(!control || !label || control.hasAttribute('aria-label') || control.hasAttribute('aria-labelledby')) return
  label.id ||= `control-label-${++labelId}`
  control.setAttribute('aria-labelledby', label.id)
}
