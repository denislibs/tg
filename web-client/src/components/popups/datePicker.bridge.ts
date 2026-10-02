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
//  2. границы режима планирования (`withTime`): от текущей минуты до года вперёд.
import { createElement } from 'react'
import DatePickerPopup, { DATE_PICKER_POPUP_KIND } from '@components/DatePickerPopup'
import { openPopup } from '@stores/popupStore'
import type { LangPackKey } from '@/lang'

export default function showDatePickerPopup(options: {
  initDate: Date,
  withTime?: boolean,
  onPick: (timestamp: number) => void,
  btnConfirmLangKey?: LangPackKey
}) {
  openPopup((p) => createElement(DatePickerPopup, {
    open: p.open,
    onClose: p.requestClose,
    onExitComplete: p.onExitComplete,
    initDate: options.initDate.getTime(),
    withTime: options.withTime,
    // режим `withTime` попап сам не закрывает (его закрывает вызывающий
    // планирования, `SchedulePopup.tsx`); у оригинала выбор закрывает попап
    onPick: (timestamp: number) => {
      options.onPick(timestamp)
      p.requestClose()
    },
  }), DATE_PICKER_POPUP_KIND)
}
