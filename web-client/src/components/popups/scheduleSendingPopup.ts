// Порт tweb `components/popups/scheduleSendingPopup.tsx` (812502980, 157 строк) —
// «Запланировать сообщение»: календарь `showDatePickerPopup` в режиме `withTime` и
// вторичная кнопка «Отправить, когда будет в сети» (`SEND_WHEN_ONLINE_TIMESTAMP`).
// Пачка П-6, Б-32.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Календарь — мост `popups/datePicker.bridge.ts` (ВРЕМЕННО до 2C-23, React
//     `DatePickerPopup`), поэтому файл `.ts`, а не Solid `.tsx`: тумблера «Без звука» в
//     шапке (`SilentToggle`, `headerActions`) нет — `silent` в `onPick` всегда
//     `initSilent`; вернётся с портом попапа 2C-23.
//  2. Строки «Повторять» (`RepeatRow`, `scheduleRepeatPeriod`) нет: у бэкенда нет
//     повторяющихся отложенных (`POST /chats/{id}/scheduled` без `repeat_period`) —
//     бэклог Б-126; `repeatPeriod` в `onPick` всегда `undefined`.
import showDatePickerPopup from '@components/popups/datePicker.bridge'
import { SEND_WHEN_ONLINE_TIMESTAMP } from '@core/format/dayLabel'

export type ScheduleSendingPopupOptions = {
  initDate?: Date,
  addMinutes?: boolean,
  initRepeatPeriod?: number,
  initSilent?: boolean,
  canSendSilently?: boolean,
  canSendWhenOnline?: boolean,
  onPick: (timestamp: number, repeatPeriod: number | undefined, silent: boolean) => void
}

/**
 * Schedule-message variant of the date picker.
 *
 * Wraps {@link showDatePickerPopup} with the schedule-specific extra that
 * doesn't belong in the generic picker: a "Send when online" secondary footer
 * button that emits a sentinel {@link SEND_WHEN_ONLINE_TIMESTAMP}.
 */
export default function showScheduleSendingPopup(opts: ScheduleSendingPopupOptions): void {
  const selectedSilent = !!opts.initSilent

  showDatePickerPopup({
    initDate: opts.initDate ?? new Date(),
    addMinutes: opts.addMinutes ?? (opts.initDate === undefined),
    withTime: true,
    onPick: (timestamp) => {
      opts.onPick(timestamp, undefined, selectedSilent)
    },
    secondaryButton: opts.canSendWhenOnline ? {
      langKey: 'Schedule.SendWhenOnline',
      callback: () => opts.onPick(SEND_WHEN_ONLINE_TIMESTAMP, undefined, selectedSilent),
    } : undefined,
  })
}
