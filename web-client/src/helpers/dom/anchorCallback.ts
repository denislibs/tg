// Порт tweb `helpers/dom/anchorCallback.ts` (812502980): ссылка-аргумент ключа с
// разметкой `[текст]()` (`I18n.superFormatter` вставляет текст внутрь этого `<a>`).
// Отличия — только под `.oxlintrc.json` репо: без `;`, `unknown` вместо `any` у
// результата колбэка и `if` вместо `_cancelEvent && cancelEvent(e)`.
import cancelEvent from '@helpers/dom/cancelEvent'

export default function anchorCallback(callback: (e: MouseEvent) => unknown, _cancelEvent = true) {
  const a = document.createElement('a')
  a.href = '#'
  a.onclick = (e) => {
    if(_cancelEvent) cancelEvent(e)
    callback(e)
  }
  return a
}
