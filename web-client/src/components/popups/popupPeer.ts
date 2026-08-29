// Порт tweb `components/popups/peer.ts` (класс `PopupPeer`, 133 строки) и
// `components/popups/simpleConfirmation.ts` (хелпер `confirmationPopup`,
// оригинальный класс `SimpleConfirmationPopup`, 69 строк). Ни один из
// источников не использует Solid — содержимое строится DOM'ом напрямую (нуль
// вхождений `appendSolid`/`render` из `solid-js/web` в обоих файлах).
//
// В оригинале `SimpleConfirmationPopup` дублирует часть `PopupPeer` вместо
// того, чтобы им пользоваться — комментарий simpleConfirmation.ts:4
// («! cant use PopupPeer/confirmationPopup because of awkward recursive
// dependencies») объясняет это модульным циклом tweb (`pages/loginPage.ts` →
// `peer.ts` → обратно). У нас обе части живут в одном файле, цикла нет —
// поэтому `confirmationPopup` ниже честно построен на `PopupPeer`, а не на
// отдельном классе-дублёре.
//
// Объём порта СУЖЕН до опций, у которых есть потребитель в волне 1
// (`confirmationPopup` — единственный вызываемый вызывающими задачи 3):
// `titleLangKey`, `descriptionLangKey`, `buttons`. Не портировано (см.
// комментарии по месту, каждое — «нет потребителя», а не недосмотр):
//  • `peerId`/аватар (peer.ts:44-55, `avatarNew`) — НАХОДКА, см. докблок
//    `PopupPeerOptions` ниже;
//  • `titleLangArgs`/`descriptionLangArgs` (peer.ts:21, :26) — у нашего `t()`
//    (`@/i18n`, `dict[s] ?? s`) нет интерполяции аргументов, предмета нет;
//  • `checkboxes`/`inputField`/`noTitle`/`old`/`threadId` (peer.ts:22-30,
//    :44-124) — их не просит ни `confirmationPopup`, ни задача 3.
import PopupElement, { type PopupButton } from './popupElement'
import { useI18nStore } from '@/i18n'

/**
 * peer.ts:16-31, сужено до полей с потребителем в волне 1.
 *
 * НАХОДКА (не молчу, как просили): `peerId`/аватар (peer.ts:16-17, :44-55)
 * сюда не попал. `avatarNew` (`components/avatar.ts`) — единственный
 * ванильный аналог tweb `avatarNew` в этом репозитории — принимает
 * ОБЯЗАТЕЛЬНЫЙ `middleware: Middleware` и вешает на него `onClean`, чтобы
 * снять подписку узла на зеркало пиров (`avatar.ts`: `live.add(this)` /
 * `options.middleware.onClean(() => live.delete(this))`) — без вызова этого
 * `onClean` узел навсегда остаётся в модульном `Set` живых аватаров. У
 * базового `PopupElement` этой волны своего `middlewareHelper` НЕТ — это
 * уже зафиксированный докблоком `popupElement.ts` долг («ни один попап волны
 * 1 не переживает async-результат дольше своего destroy()»). Заводить
 * `middleware` здесь ради одного поля значило бы тихо расширять базу или
 * тихо плодить второй способ управления временем жизни — вместо этого
 * поле не портировано, а находка вынесена в отчёт задачи.
 */
export interface PopupPeerOptions {
  titleLangKey: string // peer.ts:58-59 — `i18n(titleLangKey)`
  descriptionLangKey: string // peer.ts:70 — `i18n(descriptionLangKey)`
  buttons: PopupButton[] // peer.ts:41 — `addCancelButton(options.buttons)`
}

/**
 * tweb `components/popups/index.ts:484-494`. `langKey: 'Cancel'` заменён на
 * уже переведённый `text` — наш `PopupButton` (см. докблок `popupElement.ts`)
 * несёт готовую строку, а не `LangPackKey`; переводом владеет эта функция, а
 * не база.
 */
export function addCancelButton(buttons: PopupButton[]): PopupButton[] {
  const button = buttons.find((b) => b.isCancel)
  if(!button) {
    buttons.push({
      text: useI18nStore.getState().t('Cancel'),
      isCancel: true
    })
  }

  return buttons
}

export default class PopupPeer extends PopupElement {
  protected description: HTMLParagraphElement

  constructor(className: string, options: PopupPeerOptions) {
    const t = useI18nStore.getState().t

    super('popup-peer' + (className ? ' ' + className : ''), { // peer.ts:37
      overlayClosable: true, // peer.ts:38
      // peer.ts:40, :57-59 — оригинал резервирует `title: true` и заполняет
      // `this.title` сам; наша база принимает готовую строку напрямую и
      // делает то же самое (`setButtons`-докблок `popupElement.ts` :130-134).
      title: t(options.titleLangKey)
    })

    this.setButtons(addCancelButton(options.buttons)) // peer.ts:41

    const p = this.description = document.createElement('p') // peer.ts:68
    p.classList.add('popup-description') // peer.ts:69
    p.append(document.createTextNode(t(options.descriptionLangKey))) // peer.ts:70

    this.header.after(p) // peer.ts:126 — `this.header.after(fragment)`
  }
}

/**
 * Порт `SimpleConfirmationPopup.show` (simpleConfirmation.ts:26-66).
 * Резолвит промис на подтверждении, реджектит на отмене — причём «отмена»
 * это ЛЮБОЙ путь закрытия без клика по кнопке подтверждения: Cancel-кнопка,
 * клик по оверлею, Esc, аппаратный/браузерный Back. Все четыре в базе
 * (`popupElement.ts`) сводятся к `hide()` → `destroy()` →
 * (250мс) → `closeAfterTimeout`, кроме явного клика по Cancel-кнопке —
 * её `callback` реджектит немедленно, как и в оригинале
 * (simpleConfirmation.ts:37-42).
 */
export function confirmationPopup(options: {
  titleLangKey: string
  descriptionLangKey: string
  button: PopupButton
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let resolved = false // simpleConfirmation.ts:33

    const buttons = addCancelButton([options.button]) // simpleConfirmation.ts:35
    const cancelButton = buttons.find((b) => b.isCancel)!
    cancelButton.callback = () => { // simpleConfirmation.ts:37-42
      if(!resolved) {
        reject()
        resolved = true
      }
    }
    options.button.callback = () => { // simpleConfirmation.ts:43-48
      if(!resolved) {
        resolve()
        resolved = true
      }
    }

    const popup = PopupElement.createPopup(PopupPeer, 'popup-confirmation', { // simpleConfirmation.ts:50-55
      titleLangKey: options.titleLangKey,
      descriptionLangKey: options.descriptionLangKey,
      buttons
    })

    // simpleConfirmation.ts:57-62 — реджект на закрытие БЕЗ клика по кнопке
    // подтверждения (Esc/Back/оверлей): `destroy()` уже случился, окно
    // `closeAfterTimeout` — момент, когда popup гарантированно закрыт.
    popup.addEventListener('closeAfterTimeout', () => {
      if(!resolved) {
        reject()
        resolved = true
      }
    })

    popup.show() // simpleConfirmation.ts:64
  })
}
