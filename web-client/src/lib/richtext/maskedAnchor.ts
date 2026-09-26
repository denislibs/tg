// Подтверждение «Открыть ссылку?» у замаскированной ссылки — порт двух кусков
// tweb 812502980:
//  • обработчик `showMaskedAlert` (`lib/internalLinkProcessor.ts:91-113`):
//    попап `popup-masked-url` с настоящим адресом и кнопкой «Открыть»;
//  • делегированный `auxclick` (e96e06c37, `helpers/addAnchorListener.ts:94-147`):
//    средняя кнопка до inline-`onclick` не доходит и открывала бы настоящий
//    хост новой вкладкой, ни о чём не спросив.
//
// Замаскированная ссылка — `<a>` текста сообщения, чей адрес не совпадает с
// видимым текстом (`wrapRichText.ts:377` ставит ей действие `showMaskedAlert`).
// У tweb вопрос висит на inline-`onclick` якоря; inline-обработчики у нас
// запрещены (web-client/CLAUDE.md, «Безопасность»), имя действия едет
// атрибутом `data-anchor-action` (`lib/richtext/url.ts`). Поэтому основную
// кнопку ловит такой же делегированный слушатель, как средняя, — он и есть
// наша замена inline-`onclick` для этого действия. Остальные действия
// `data-anchor-action` (t.me-ссылки, хэштеги) исполнителя по-прежнему не имеют
// — это B20, волна 2G (docs/tweb/delta/security-and-bugs.md).
//
// Слушатели стоят в фазе ВСПЛЫТИЯ на `document`, как у оригинала: защита ближе
// к контенту (своя ветка ленты `chat/bubbles.ts::onContainerClick`, если
// когда-нибудь исполнит действие сама) гасит клик раньше, и уже отменённый клик
// здесь не трогается. `execBotCommand` у нас не эмитится вовсе
// (`lib/richtext/url.ts`, реестр действий), контекстное меню браузера и
// перетаскивание ссылки — не наши.
import PopupElement from '@components/popups/popupElement'
import PopupPeer from '@components/popups/popupPeer'
import cancelEvent from '@helpers/dom/cancelEvent'
import { ANCHOR_ACTION_ATTRIBUTE } from './url'

const MIDDLE_BUTTON = 1
const MASKED_ALERT = 'showMaskedAlert'

/**
 * Порт колбэка `showMaskedAlert` (tweb `internalLinkProcessor.ts:91-113`).
 * Клон якоря подписан настоящим адресом; «Открыть» кликает его — `target=_blank`
 * у замаскированной ссылки уже стоит (`setBlankToAnchor`), так что открывается
 * новая вкладка. Имя действия с клона снимается (у tweb — `removeAttribute
 * ('onclick')`), иначе клик по нему снова спросил бы.
 */
export function showMaskedAlert(element: HTMLAnchorElement): void {
  const href = element.href

  const a = element.cloneNode(true) as HTMLAnchorElement
  a.className = 'anchor-url'
  a.innerText = href
  a.removeAttribute(ANCHOR_ACTION_ATTRIBUTE)

  PopupElement.createPopup(PopupPeer, 'popup-masked-url', {
    titleLangKey: 'OpenUrlTitle',
    descriptionLangKey: 'OpenUrlAlert2',
    descriptionLangArgs: [a],
    buttons: [{
      langKey: 'Open',
      callback: () => {
        a.click()
      },
    }],
  }).show()
}

/** Самый внутренний `<a>` с адресом, если он замаскирован. tweb e96e06c37:
 *  именно самый внутренний `<a>`, а не самый внутренний замаскированный —
 *  обычная ссылка внутри замаскированного бокса несёт свой адрес, и алерт бокса
 *  назвал бы адрес, по которому никто не кликал. */
function getMaskedAnchor(e: MouseEvent): HTMLAnchorElement | undefined {
  const anchor = (e.target as Element | null)?.closest?.('a')
  if (!anchor?.href || anchor.getAttribute(ANCHOR_ACTION_ATTRIBUTE) !== MASKED_ALERT) {
    return undefined
  }

  return anchor
}

/** tweb `onMaskedAnchorAuxClick` (addAnchorListener.ts:115-135). */
function onMaskedAnchorAuxClick(e: MouseEvent): boolean {
  if (e.button !== MIDDLE_BUTTON || e.defaultPrevented) {
    return false
  }

  const anchor = getMaskedAnchor(e)
  if (!anchor) {
    return false
  }

  cancelEvent(e)
  showMaskedAlert(anchor)
  return true
}

/** Наша замена inline-`onclick="showMaskedAlert(this)"` (см. шапку): основная
 *  кнопка. Уже отменённый клик — чужой, как и у средней кнопки. */
function onMaskedAnchorClick(e: MouseEvent): boolean {
  if (e.button !== 0 || e.defaultPrevented) {
    return false
  }

  const anchor = getMaskedAnchor(e)
  if (!anchor) {
    return false
  }

  cancelEvent(e)
  showMaskedAlert(anchor)
  return true
}

let listeningForMaskedAnchorClicks = false

/** tweb `listenForMaskedAnchorAuxClicks` (addAnchorListener.ts:138-147) + основная
 *  кнопка. Зовёт `client/boot.ts::bootstrap` — наш аналог
 *  `InternalLinkProcessor.construct` (internalLinkProcessor.ts:84-89). */
export function listenForMaskedAnchorClicks(): void {
  if (listeningForMaskedAnchorClicks) {
    return
  }

  listeningForMaskedAnchorClicks = true
  // bubble phase on purpose: a capture-phase guard closer to the content gets to
  // swallow the click before this one sees it
  document.addEventListener('auxclick', onMaskedAnchorAuxClick)
  document.addEventListener('click', onMaskedAnchorClick)
}
