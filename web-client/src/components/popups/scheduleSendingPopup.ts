// Порт tweb `components/popups/scheduleSendingPopup.tsx` (812502980, 157 строк) —
// «Запланировать сообщение»: календарь `showDatePickerPopup` в режиме `withTime`,
// ряд «Повторять» (`RepeatRow`) и вторичная кнопка
// «Отправить, когда будет в сети» (`SEND_WHEN_ONLINE_TIMESTAMP`).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Календарь — мост `popups/datePicker.bridge.ts` (ВРЕМЕННО до 2C-23, React
//     `DatePickerPopup`), поэтому файл `.ts`, а не Solid `.tsx`: тумблера «Без звука» в
//     шапке (`SilentToggle`, `headerActions`) нет — `silent` в `onPick` всегда
//     `initSilent`; вернётся с портом попапа 2C-23. Ряд «Повторять» — Solid-остров в
//     слоте `bodyAfter` (`scheduleRepeatRow.solid.tsx`).
//  2. ОСОЗНАННОЕ ОТСТУПЛЕНИЕ (решение пользователя 2026-10-10, Ф-5): повтор
//     отложенных — БЕЗ Telegram Premium. Гейт `rootScope.premium` ряда (tweb
//     `:115-125`, замок `:149-151`) снят, см. шапку `scheduleRepeatRow.solid.tsx`.
import showDatePickerPopup from '@components/popups/datePicker.bridge'
import ScheduleRepeatRow from '@components/popups/scheduleRepeatRow.solid'
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
 * Wraps {@link showDatePickerPopup} with two schedule-specific extras that
 * don't belong in the generic picker:
 *  - a "Repeat" row that surfaces a recurring period selector
 *  - a "Send when online" secondary footer button that emits a sentinel
 *    {@link SEND_WHEN_ONLINE_TIMESTAMP}
 */
export default function showScheduleSendingPopup(opts: ScheduleSendingPopupOptions): void {
  // Plain mutable variable rather than a Solid signal — we only need to read
  // it once at confirm time, and the RepeatRow component owns the reactive
  // state internally for its own UI.
  let selectedRepeatPeriod = opts.initRepeatPeriod || 0
  const selectedSilent = !!opts.initSilent

  showDatePickerPopup({
    initDate: opts.initDate ?? new Date(),
    addMinutes: opts.addMinutes ?? (opts.initDate === undefined),
    withTime: true,
    onPick: (timestamp) => {
      opts.onPick(timestamp, selectedRepeatPeriod || undefined, selectedSilent)
    },
    bodyAfter: {
      component: ScheduleRepeatRow,
      props: {
        initValue: opts.initRepeatPeriod || 0,
        onChange: (v: number) => { selectedRepeatPeriod = v },
      },
    },
    secondaryButton: opts.canSendWhenOnline ? {
      langKey: 'Schedule.SendWhenOnline',
      callback: () => opts.onPick(SEND_WHEN_ONLINE_TIMESTAMP, undefined, selectedSilent),
    } : undefined,
  })
}
