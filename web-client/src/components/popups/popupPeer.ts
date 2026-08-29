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
// `titleLangKey`, `descriptionLangKey`, `buttons`, и — с раунда правок 1,
// см. ниже — `peerId`/аватар. Не портировано (см. комментарии по месту,
// каждое — «нет потребителя», а не недосмотр):
//  • `titleLangArgs`/`descriptionLangArgs` (peer.ts:21, :26) — у нашего `t()`
//    (`@/i18n`, `dict[s] ?? s`) нет интерполяции аргументов, предмета нет;
//  • `checkboxes`/`inputField`/`noTitle`/`old`/`threadId` (peer.ts:22-30,
//    :44-124) — их не просит ни `confirmationPopup`, ни задача 3.
//
// РАУНД ПРАВОК 1: `peerId`/аватар (peer.ts:44-55) — ПОРТИРОВАН, отчёт задачи 2
// назвал это находкой («нет потребителя» — до того, как выяснилось обратное:
// `shared/ui/ConfirmPopup/ConfirmPopup.tsx:58-59` + `components/MutePopup.tsx:51,68`
// реально показывают аватар чата в подтверждении, значит `peerId` — видимая
// пользователю функция, а не мёртвая опция). Разблокировано портом
// `middlewareHelper` в базе (`popupElement.ts`, тот же раунд) — `avatarNew`
// (`components/avatar.ts`) получает его через `this.middlewareHelper.get()`,
// как в оригинале, и отписывается от зеркала пиров при `destroy()` попапа.
import PopupElement, { type PopupButton } from './popupElement'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import { useI18nStore } from '@/i18n'

/** peer.ts:16-31, сужено до полей с потребителем в волне 1. `managers`
 *  обязателен вместе с `peerId` — ими пользуется только `avatarNew`
 *  (peer.ts:46-53); без `peerId` он не нужен и не запрашивается. */
export type PopupPeerOptions = {
  titleLangKey: string // peer.ts:58-59 — `i18n(titleLangKey)`
  descriptionLangKey: string // peer.ts:70 — `i18n(descriptionLangKey)`
  buttons: PopupButton[] // peer.ts:41 — `addCancelButton(options.buttons)`
} & (
  | { peerId?: undefined, managers?: AvatarManagers }
  | { peerId: PeerId, managers: AvatarManagers }
)

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

    if(options.peerId !== undefined) { // peer.ts:44
      // peer.ts:45, :50-52 — `isSavedDialog`/`threadId`/`meAsNotes` не
      // портированы: `threadId` не входит в `PopupPeerOptions` этой волны
      // (нет потребителя — см. докблок файла), поэтому ветка «это диалог
      // избранного» ни для кого не наступает.
      const { node } = avatarNew({ // peer.ts:46-53
        middleware: this.middlewareHelper.get(),
        size: 32,
        peerId: options.peerId,
        managers: options.managers
      })
      this.header.prepend(node) // peer.ts:54
    }

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
