/**
 * Порт tweb `src/components/toast.ts` — одна всплывашка на всё приложение
 * (`.toasts-container` → `.toast.is-visible`), закрывается сама по таймеру или
 * кликом мимо. Структура и тайминги (200мс на исчезновение, 3с показа по
 * умолчанию) дословные; правки только под нашу инфраструктуру:
 *  • `getOverlayRoot()` (боди активного окна Document PiP, `helpers/appWindow.ts`)
 *    → `document.body` — то же отступление уже задокументировано в
 *    `helpers/overlayClickHandler.ts` и `components/mediaViewer/base.ts`:
 *    Document PiP у нас нет;
 *  • `replaceContent(elem, node)` → `elem.replaceChildren(node)` —
 *    `Element.replaceChildren` принимает и строку, и `Node` тем же вызовом,
 *    отдельного хелпера не нужно (тот же приём уже в `stackedAvatars.ts`,
 *    `avatar.ts`, `chat/peerTitle.ts`);
 *  • `LangPackKey`/`i18n(key, args)` → строка + `useI18nStore.getState().t`
 *    (#109: у нашего словаря ключ=строка, без интерполяции аргументов — тот же
 *    приём, что в `button.ts`/`checkboxField.ts`; `langPackArguments` поэтому
 *    не портирован — предмета нет).
 *
 * ── ОСТАТОК ВОЛНЫ (#112) ───────────────────────────────────────────────────
 * СТИЛЕЙ У ЭТОЙ ВСПЛЫВАШКИ НЕТ. `tweb/src/scss/partials/_toast.scss`
 * (`.toasts-container`, `.toast`, `.toast.is-visible`) в `styles/tweb/` не
 * перенесён — `grep -rn "toasts-container" src` даёт только этот файл.
 * Значит DOM ниже строится верный, а видно его не так, как в оригинале:
 * узел рисуется потоком страницы вместо прибитой снизу карточки. Порт
 * партиала — та же задача, что снимает остальные остатки волны.
 */
import OverlayClickHandler from '@helpers/overlayClickHandler'
import { useI18nStore } from '../i18n'

const toastsContainer = document.createElement('div')
toastsContainer.classList.add('toasts-container')

const toastEl = document.createElement('div')
toastEl.classList.add('toast')
let timeout: number | undefined

const x = new OverlayClickHandler('toast')
x.addEventListener('toggle', (open) => {
  if (!open) {
    hideToast()
  }
})

export function hideToast() {
  x.close()

  toastEl.classList.remove('is-visible')
  if (timeout) clearTimeout(timeout)

  timeout = window.setTimeout(() => {
    toastEl.remove()
    timeout = undefined
  }, 200)
}

export function toast(content: string | Node, onClose?: () => void, duration = 3000) {
  x.close()

  toastEl.replaceChildren(content)

  if (!toastEl.parentElement) {
    if (!toastsContainer.parentNode) {
      document.body.append(toastsContainer)
    }

    toastsContainer.append(toastEl)
    void toastEl.offsetLeft // reflow
  }

  toastEl.classList.add('is-visible')

  if (timeout) clearTimeout(timeout)
  x.open(toastEl)

  timeout = window.setTimeout(hideToast, duration)

  if (onClose) {
    x.addEventListener('toggle', onClose, { once: true })
  }
}

// `langPackKey` — обязательный (в отличие от tweb `Partial<>`, где он
// формально опционален, но реально всегда передаётся вызывающим): подстановка
// пустой строки при пропуске показывала бы пустую всплывашку, которая на
// `duration` мс всё равно забирает слой навигации (`pushEsc`/`pushLayer` в
// `OverlayClickHandler.open`) — то есть съедала бы первый Esc/Back
// пользователя без всякого видимого повода. У tweb пустой строки не
// подставляется вовсе; здесь то же самое гарантируется типом, а не рантайм-проверкой.
export function toastNew(options: {
  langPackKey: string
  onClose?: () => void
  duration?: number
}) {
  toast(useI18nStore.getState().t(options.langPackKey), options.onClose, options.duration)
}
