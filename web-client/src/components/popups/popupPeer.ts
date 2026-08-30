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
//  • `inputField`/`noTitle`/`old`/`threadId` (peer.ts:22-30, :44-124) — их
//    не просит ни `confirmationPopup`, ни задача 3. `checkboxes` из этого же
//    списка выбыл в раунде правок 3, см. ниже — нашёлся реальный потребитель.
//
// РАУНД ПРАВОК 1: `peerId`/аватар (peer.ts:44-55) — ПОРТИРОВАН, отчёт задачи 2
// назвал это находкой («нет потребителя» — до того, как выяснилось обратное:
// `shared/ui/ConfirmPopup/ConfirmPopup.tsx:58-59` + `components/MutePopup.tsx:51,68`
// реально показывают аватар чата в подтверждении, значит `peerId` — видимая
// пользователю функция, а не мёртвая опция). Разблокировано портом
// `middlewareHelper` в базе (`popupElement.ts`, тот же раунд) — `avatarNew`
// (`components/avatar.ts`) получает его через `this.middlewareHelper.get()`,
// как в оригинале, и отписывается от зеркала пиров при `destroy()` попапа.
//
// РАУНД ПРАВОК 2 (задача 3 — переезд пяти вызывающих): два поля добавлены,
// оба по факту реального потребителя, а не «на всякий случай»:
//  • `body`/`descriptionLangKey?` — потребитель `PopupMute`
//    (`components/popupMute.ts`, mute.ts:29-52): у него ЕСТЬ `peerId`
//    (аватар), но НЕТ описания — вместо `<p>` в `body` едет радио-список
//    длительности. `descriptionLangKey` стал опциональным (как и у
//    оригинала, peer.ts:65), `this.description` — тоже.
//  • `zIndex` — НАШЕ расширение, не из tweb (см. докблок
//    `PopupOptions.zIndex`, `popupElement.ts`); потребитель — мост
//    `components/settings/ConfirmDialog.tsx`, который обязан лечь поверх
//    уже существующих React-оверлеев (MediaEditor/SettingsScreen), которых у
//    оригинала как класса проблем не было.
//
// РАУНД ПРАВОК 3 (ревью после задачи 3): `checkboxes` (peer.ts:22, :96-124) —
// ПОРТИРОВАН. Ревью указало, что рукописная React-копия `DeleteMessageDialog`
// (`messages/ChatDialogs.tsx`) — это ВТОРОЙ владелец того же DOM-контракта
// попапа (`popup`/`popup-peer`/`popup-container`/`popup-header`/…), который
// уже строит `PopupElement`/`PopupPeer`, а не законный остаток: объём порта
// чекбоксов сопоставим с тем, что уже написано в этом файле, значит копия
// писалась ВМЕСТО порта, а не по недостатку скоупа. `DeleteMessageDialog`
// переведён на `PopupPeer` напрямую (НЕ через `confirmationPopup` — как и
// оригинал, tweb `PopupDeleteMessages` строит `PopupPeer` сам, минуя
// `SimpleConfirmationPopup`, см. `deleteMessages.ts:182-193`).
//
// Портировано из peer.ts:96-124: класс `have-checkbox` на `this.container`
// при непустом `checkboxes`; каждый — `new CheckboxField({text, checked})`
// (`checkboxField.ts`, тот же раунд — добавлены `text`/`checked`, см. его
// докблок); ВСЕ `button.callback` (не только чекбоксные) оборачиваются, чтобы
// получить вторым параметром `Set<string>` отмеченных подписей — 1:1 с
// tweb `PopupPeerButtonCallback = (e, checkboxes?: Set<LangPackKey>) => void`
// (у нас без `MouseEvent` первым параметром — та же урезка, что была у
// `PopupButton.callback` изначально, см. докблок `popupPeer.ts` про
// `titleLangArgs`). `inputField`/`onlyWithCheckbox` (peer.ts:22, :29, :107-124)
// НЕ портированы — ни один вызывающий (ни `confirmationPopup`, ни
// `DeleteMessageDialog`) их не просит; `checkboxField.ts` объясняет, почему
// `withRipple` (peer.ts:98, безусловно для чекбоксов `PopupPeer`) тоже не
// портирован ЦЕЛИКОМ.
import PopupElement, { type PopupButton } from './popupElement'
import CheckboxField from '@components/checkboxField'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'

/** peer.ts:16-31, сужено до полей с потребителем в волне 1 (задача 2) + двух
 *  добавленных в задаче 3, у которых нашёлся реальный потребитель уже здесь:
 *   • `body` (peer.ts:37-41 — форвардится в `PopupOptions` через `...options`
 *     у оригинала; наш порт форвардит явно, как и остальные поля) —
 *     единственный потребитель `PopupMute` (`components/popupMute.ts`,
 *     mute.ts:32-38 `body: true`, радио-список длительности заглушения);
 *   • `zIndex` — НАШЕ расширение, не из tweb, см. докблок
 *     `PopupOptions.zIndex` (`popupElement.ts`); форвардится тем же путём.
 *  `managers` обязателен вместе с `peerId` — ими пользуется только `avatarNew`
 *  (peer.ts:46-53); без `peerId` он не нужен и не запрашивается. */
export type PopupPeerOptions = {
  titleLangKey: LangPackKey // peer.ts:58-59 — `i18n(titleLangKey, titleLangArgs)`
  /** peer.ts:21 — аргументы заголовка. До задачи 7 их не было, и вызывающий отдавал
   *  сюда ГОТОВУЮ строку («Удалить 5 сообщений») отдельным пропом `titleText`: у
   *  строкового `t()` подстановки не было. Теперь число подставляет попап. */
  titleLangArgs?: FormatterArguments
  // peer.ts:70 — опционально и у оригинала: `PopupMute` описания не задаёт
  // вовсе (mute.ts:29-38), у него вместо `<p>` — радио-список в `body`.
  descriptionLangKey?: LangPackKey
  /** peer.ts:26 — то же, что `titleLangArgs`, для описания. */
  descriptionLangArgs?: FormatterArguments
  buttons: PopupPeerButton[] // peer.ts:41 — `addCancelButton(options.buttons)`
  body?: boolean
  zIndex?: number
  /** peer.ts:22, :96-124 — раунд правок 3, см. докблок файла. Ровно то, что
   *  просит единственный вызывающий (`DeleteMessageDialog`): подпись + флаг
   *  предвзведения — `PopupPeerCheckboxOptions` оригинала несёт больше
   *  (`withRipple`/`withHover`/`color`/…), но их не портируем целиком
   *  (`checkboxField.ts`). */
  checkboxes?: { text: string, checked?: boolean }[]
} & (
  | { peerId?: undefined, managers?: AvatarManagers }
  | { peerId: PeerId, managers: AvatarManagers }
)

/**
 * peer.ts:17 (`PopupPeerButton = Omit<PopupButton,'callback'> &
 * Partial<{callback: PopupPeerButtonCallback, onlyWithCheckbox}>`), сужено:
 * без `onlyWithCheckbox` (нет потребителя — ни один чекбокс `DeleteMessageDialog`
 * не дизейблит кнопку) и без `MouseEvent` первым параметром колбэка (та же
 * урезка, что у обычного `PopupButton.callback`, см. докблок файла про
 * `titleLangArgs`). Второй параметр `checked` — ОПЦИОНАЛЕН, как и у оригинала
 * (`PopupPeerButtonCallback`, peer.ts:12): `button.callback` оборачивается
 * ТОЛЬКО когда `options.checkboxes` непуст (peer.ts:96), иначе вызывается без
 * аргументов вовсе, 1:1. */
export type PopupPeerButton = Omit<PopupButton, 'callback'> & {
  callback?: (checked?: Set<string>) => void
}

/** tweb `components/popups/index.ts:484-494`, дословно: кнопка отмены несёт КЛЮЧ. */
export function addCancelButton(buttons: PopupButton[]): PopupButton[] {
  const button = buttons.find((b) => b.isCancel)
  if(!button) {
    buttons.push({
      langKey: 'Cancel',
      isCancel: true
    })
  }

  return buttons
}

export default class PopupPeer extends PopupElement {
  // Опционален — задача 3: `PopupMute` не задаёт `descriptionLangKey` вовсе
  // (см. докблок `PopupPeerOptions` выше), значит и параграфа у него нет.
  protected description?: HTMLParagraphElement

  constructor(className: string, options: PopupPeerOptions) {
    super('popup-peer' + (className ? ' ' + className : ''), { // peer.ts:37
      overlayClosable: true, // peer.ts:38
      title: true, // peer.ts:40 — узел заголовка резервируется, наполняет его потомок
      body: options.body, // peer.ts:37-41 `...options` — см. докблок PopupPeerOptions.body
      zIndex: options.zIndex,
    })

    // peer.ts:58-59. Аргументы подставляет ЗАГОЛОВОК, а не вызывающий: до задачи 7
    // «Удалить N сообщений» приезжало сюда готовой строкой (`titleText`), потому что
    // строковый `t()` подстановки не умел.
    this.title.append(i18n(options.titleLangKey, options.titleLangArgs))

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

    // peer.ts:96-124 — чекбоксы строятся ДО кнопок: колбэку кнопки в момент
    // клика нужно ЖИВОЕ состояние (замыкание на `checkboxFields`), не снимок.
    const checkboxFields: { text: string, field: CheckboxField }[] = []
    if(options.checkboxes?.length) {
      this.container.classList.add('have-checkbox') // peer.ts:104
      for(const o of options.checkboxes) { // peer.ts:106-110
        checkboxFields.push({ text: o.text, field: new CheckboxField({ text: o.text, checked: o.checked }) })
      }
    }

    // peer.ts:111-123 — ВСЕ `button.callback` оборачиваются, чтобы получить
    // вторым параметром отмеченные подписи, но ТОЛЬКО когда чекбоксы есть
    // (peer.ts:96 `if(options.checkboxes)`) — без них поведение как раньше:
    // клик зовёт колбэк без аргументов вовсе.
    const buttons: PopupPeerButton[] = checkboxFields.length
      ? options.buttons.map((b) => ({
        ...b,
        callback: b.callback
          ? () => {
            const checked = new Set(checkboxFields.filter((c) => c.field.input.checked).map((c) => c.text))
            b.callback!(checked)
          }
          : undefined,
      }))
      : options.buttons

    this.setButtons(addCancelButton(buttons)) // peer.ts:41

    // peer.ts:63-125 — один `DocumentFragment` на описание + чекбоксы, один
    // `this.header.after(fragment)` (peer.ts:126): порядок в DOM решает
    // порядок append НИЖЕ, а не порядок вызовов setButtons/фрагмента выше.
    const fragment = document.createDocumentFragment()
    if(options.descriptionLangKey) { // peer.ts:65
      const p = this.description = document.createElement('p') // peer.ts:68
      p.classList.add('popup-description') // peer.ts:69
      p.append(i18n(options.descriptionLangKey, options.descriptionLangArgs)) // peer.ts:70
      fragment.append(p)
    }
    for(const { field } of checkboxFields) { // peer.ts:110 — `fragment.append(checkboxField.label)`
      fragment.append(field.label)
    }
    if(fragment.childNodes.length) {
      this.header.after(fragment) // peer.ts:126
    }
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
  titleLangKey: LangPackKey
  titleLangArgs?: FormatterArguments
  descriptionLangKey?: LangPackKey
  descriptionLangArgs?: FormatterArguments
  button: PopupButton
  /** НАШЕ расширение, не из tweb — см. докблок `PopupOptions.zIndex`
   *  (`popupElement.ts`). Потребитель — мост `ConfirmDialog.tsx` (задача 3). */
  zIndex?: number
  /**
   * НАШЕ расширение, не из tweb — у оригинала вызывающий и попап живут в
   * одном (классовом) мире и владеют друг другом естественно; у нас
   * `confirmationPopup` может быть вызван МОСТОМ из React (`ConfirmDialog.tsx`),
   * который обязан снять СВОЙ попап сам, если его унесло размонтированием
   * ДО исхода промиса (правило шва, `web-client/CLAUDE.md` — «никакого
   * "родитель размонтируется и унесёт"»). Промис такой ручки не даёт, поэтому
   * инстанс отдаётся синхронно, ДО `show()`, тем же вызовом.
   */
  getPopup?: (popup: PopupPeer) => void
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
      titleLangArgs: options.titleLangArgs,
      descriptionLangKey: options.descriptionLangKey,
      descriptionLangArgs: options.descriptionLangArgs,
      buttons,
      zIndex: options.zIndex,
    })
    options.getPopup?.(popup)

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
