// ВРЕМЕННО до 2C-23 — мост вместо `showDatePickerPopup` из tweb
// `src/components/popups/datePicker.tsx` (812502980). Solid-попап календаря
// портирует задача 23 плана 2C; до неё дату выбирает текущий React
// `DatePickerPopup.tsx`, открытый ФУНКЦИЕЙ через `popupStore` — тот же приём, что
// у `popups/birthday.bridge.tsx`. Задача 2C-23 заменяет импорт у вызывающих на
// `@components/popups/datePicker` и удаляет этот файл:
// `git grep -n "ВРЕМЕННО до 2C-23"` → пусто.
//
// Сигнатура — оригинала в объёме, который просит потребитель (строка «Срок
// действия» вкладки «Новая ссылка», tweb `editChatInviteLink.tsx:216-221`):
// `initDate`, `withTime`, `onPick` (секунды эпохи), `btnConfirmLangKey`.
// Чего React-попап не умеет (отличия закроет 2C-23):
//  1. своя подпись кнопки подтверждения (`btnConfirmLangKey: 'Save'`) — у
//     попапа при `withTime` она «Отправить сегодня в ЧЧ:ММ» режима
//     планирования; поле принимается и не читается;
//  2. границы режима планирования (`withTime`): от текущей минуты до года вперёд;
//  3. `footerAfter` — только одна вторичная кнопка (`secondaryButton`: ключ + колбэк,
//     «Отправить, когда будет в сети» планирования); `headerActions`/`bodyAfter`
//     (тихая отправка и повтор `scheduleSendingPopup.tsx`) React-попап не держит.
import { createElement } from 'react'
import DatePickerPopup, { DATE_PICKER_POPUP_KIND, getMaxScheduleDate } from '@components/DatePickerPopup'
import { openPopup } from '@stores/popupStore'
import type { LangPackKey } from '@/lang'
import I18n from '@lib/langPack'

export default function showDatePickerPopup(options: {
  initDate: Date,
  /** tweb `addMinutes` — новое планирование открывается на «сейчас + 10 минут» */
  addMinutes?: boolean,
  withTime?: boolean,
  onPick: (timestamp: number) => void,
  btnConfirmLangKey?: LangPackKey,
  /** чат, по дням которого попап отмечает сообщения (`messages.calendarMonth`) — клик
   *  по дата-баблу ленты (`bubbles.ts::onContainerClick`, tweb :3075-3078) */
  peerId?: PeerId,
  /** расхождение 3: одна вторичная кнопка под подтверждением (tweb `footerAfter`) */
  secondaryButton?: { langKey: LangPackKey, callback: () => void }
}) {
  let initDate = options.addMinutes ? new Date(options.initDate.getTime() + 10 * 60_000) : options.initDate
  // tweb `datePicker.tsx::checkDate` — режим планирования: дата вне [сейчас; год вперёд]
  // (метка «когда будет в сети» — год 2038) открывается на «сейчас»
  if(options.withTime && (initDate.getTime() > getMaxScheduleDate().getTime() || initDate.getTime() < Date.now())) {
    initDate = new Date()
  }
  openPopup((p) => createElement(DatePickerPopup, {
    open: p.open,
    onClose: p.requestClose,
    onExitComplete: p.onExitComplete,
    initDate: initDate.getTime(),
    // режим планирования: раньше текущей минуты выбрать нельзя
    minDate: options.withTime ? Date.now() : undefined,
    withTime: options.withTime,
    secondaryAction: options.secondaryButton ? {
      label: I18n.format(options.secondaryButton.langKey, true),
      onClick: () => {
        options.secondaryButton!.callback()
        p.requestClose()
      },
    } : undefined,
    chatId: options.peerId,
    // режим `withTime` попап сам не закрывает (его закрывает вызывающий
    // планирования, `SchedulePopup.tsx`); у оригинала выбор закрывает попап
    onPick: (timestamp: number) => {
      options.onPick(timestamp)
      p.requestClose()
    },
  }), DATE_PICKER_POPUP_KIND)
}
