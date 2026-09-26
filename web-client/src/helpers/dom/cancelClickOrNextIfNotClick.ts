// Порт tweb `src/helpers/dom/cancelClickOrNextIfNotClick.ts` (812502980) — 1:1.
// Гасит клик: сам `click` — сразу, а на таче, где «кликом» служит `mousedown`
// (`CLICK_EVENT_NAME`), — следующий за ним настоящий `click`. Первый
// потребитель — перехват клика по элементу shared media в режиме выделения
// (`AppSearchSuper`, tweb `appSearchSuper.ts:767-772`): элемент выбирается, а
// не открывается. `getOverlayRoot()` (боди окна Document PiP) → `document.body`,
// как во всём порте.
import cancelEvent from '@helpers/dom/cancelEvent'

export default function cancelClickOrNextIfNotClick(e: Event) {
  if(e.type === 'click') {
    cancelEvent(e)
    return
  }

  document.body.addEventListener('click', cancelEvent, { once: true, capture: true })
}
