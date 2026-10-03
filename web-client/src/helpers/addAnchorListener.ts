// Порт tweb `src/helpers/addAnchorListener.ts` (812502980) — регистрация обработчиков
// внутренних ссылок Telegram (`internalLinkProcessor.construct`).
//
// ОБЪЯВЛЕННОЕ РАСХОЖДЕНИЕ С ОРИГИНАЛОМ (одно, навязано `web-client/CLAUDE.md`,
// «Безопасность»): у tweb обработчик кладётся глобалью
// `window[(protocol ? protocol + '_' : '') + name]`, а якорь зовёт её inline-атрибутом
// `onclick="имя(this)"`. Inline-обработчиков у нас нет: имя действия якорь несёт
// атрибутом `data-anchor-action` (`lib/richtext/url.ts`), обработчики лежат в реестре
// модуля, а исполняет их один делегированный `click` на `document` — `listenForAnchorClicks`
// (роль inline-`onclick`). Ключ реестра и тело обработчика — дословно оригинала.
// `noPathnameParams`/`noUriParams`/`noCancelEvent` не портированы: зарегистрированных
// у нас обработчиков с ними нет (`tg_iv`, единственный с `noCancelEvent`, — `lib/richtext/url.ts`).
import cancelEvent from '@helpers/dom/cancelEvent'
import parseUriParams from '@helpers/string/parseUriParams'
import matchTelegramUrlHost from '@lib/richtext/matchTelegramUrlHost'
import { ANCHOR_ACTION_ATTRIBUTE, wrapUrl } from '@lib/richtext/url'

// * https://core.telegram.org/api/links

/** tweb `:7-38` в объёме зарегистрированных у нас (`lib/internalLinkProcessor.ts`). */
type InternalLinkAnchorType =
  | 'showMaskedAlert'
  | 'addstickers'
  | 'im'
  | 'resolve'
  | 'privatepost'
  | 'joinchat'
  | 'join'
  | 'addemoji'
  | 'addlist'

type AnchorCallback = (element: HTMLAnchorElement, e?: Event) => unknown

/** Наша замена `window[...]` оригинала (шапка). */
const anchorListeners = new Map<string, AnchorCallback>()

/** Обработчик действия `data-anchor-action` — роль `window[onclick]` (tweb `appImManager.openUrl` `:1909`). */
export function getAnchorListener(name: string | null | undefined): AnchorCallback | undefined {
  return name ? anchorListeners.get(name) : undefined
}

export default function addAnchorListener<
  Params extends {
    pathnameParams?: string[],
    uriParams?: Record<string, string | undefined>
  },
>(options: {
  name: InternalLinkAnchorType,
  protocol?: 'tg',
  callback: (params: Params & { element: HTMLAnchorElement, masked?: boolean, event?: Event }) => unknown
}) {
  anchorListeners.set((options.protocol ? options.protocol + '_' : '') + options.name, (element, e) => {
    cancelEvent(e)

    let href = element.href
    if(!href) {
      return
    }

    const u = new URL(href)
    const match = matchTelegramUrlHost(u)
    if(match?.prefix) {
      u.pathname = match.prefix + (u.pathname === '/' ? '' : u.pathname)
      href = u.toString()
    }

    const pathnameParams = new URL(href).pathname.split('/').slice(1)
    const uriParams = parseUriParams(href)

    const masked = element.href !== wrapUrl(element.textContent ?? '').url && element.getAttribute('safe') === null
    const result = options.callback({
      ...{ pathnameParams, uriParams } as Params,
      element,
      masked,
      event: e,
    })

    if(!e?.isTrusted) {
      return result
    }
  })
}

const MIDDLE_BUTTON = 1

/** The handler's name — у нас один носитель, атрибут `data-anchor-action` (шапка). */
function getAnchorCallbackName(anchor: HTMLAnchorElement) {
  return anchor.getAttribute(ANCHOR_ACTION_ATTRIBUTE) ?? undefined
}

/**
 * A masked link asks before it opens, and that question hangs off the anchor's `onclick` — which
 * the browser fires for the primary button alone. A middle click went around it and opened the
 * real host in a new tab, i.e. exactly the navigation the alert is there to hold back, so it is
 * answered with the same alert. The remaining ways past it (the native context menu, dragging
 * the link out) belong to the browser and cannot be taken back from it.
 */
function onMaskedAnchorAuxClick(e: MouseEvent) {
  if(e.button !== MIDDLE_BUTTON || e.defaultPrevented) {
    return false
  }

  // the innermost anchor, not the innermost MASKED one: a plain link nested in a masked web-page
  // box carries its own destination, and the box's alert would name a url nobody clicked
  const anchor = (e.target as Element | null)?.closest?.('a')
  if(!anchor?.href || getAnchorCallbackName(anchor) !== 'showMaskedAlert') {
    return false
  }

  const showMaskedAlert = getAnchorListener('showMaskedAlert')
  if(!showMaskedAlert) {
    return false
  }

  cancelEvent(e)
  showMaskedAlert(anchor, e)
  return true
}

let listeningForMaskedAnchorAuxClicks = false
export function listenForMaskedAnchorAuxClicks() {
  if(listeningForMaskedAnchorAuxClicks) {
    return
  }

  listeningForMaskedAnchorAuxClicks = true
  // bubble phase on purpose: a capture-phase guard closer to the content (hidden links inside
  // bubbles, the read-only preview chat) gets to swallow the click before this one sees it
  document.addEventListener('auxclick', onMaskedAnchorAuxClick)
}

/**
 * Наша замена inline-`onclick="имя(this)"` (шапка): основная кнопка по якорю с
 * `data-anchor-action` зовёт его обработчик. Действие без обработчика (реестр
 * `KNOWN_ANCHOR_ACTIONS` шире зарегистрированного — у части путей t.me нет предмета
 * на бэкенде) остаётся браузеру: `target=_blank` у якоря уже стоит. Уже отменённый
 * клик — чужой, как и у средней кнопки.
 */
function onAnchorClick(e: MouseEvent) {
  if(e.button !== 0 || e.defaultPrevented) {
    return
  }

  const anchor = (e.target as Element | null)?.closest?.<HTMLAnchorElement>(`a[${ANCHOR_ACTION_ATTRIBUTE}]`)
  const callback = anchor && getAnchorListener(getAnchorCallbackName(anchor))
  if(!callback) {
    return
  }

  callback(anchor, e)
}

let listeningForAnchorClicks = false
export function listenForAnchorClicks() {
  if(listeningForAnchorClicks) {
    return
  }

  listeningForAnchorClicks = true
  document.addEventListener('click', onAnchorClick)
}
