// Пикер «Запланировать сообщение» — порт tweb showScheduleSendingPopup
// (popups/scheduleSendingPopup.tsx:50-70): календарь datePicker в режиме withTime
// (поля часов/минут, живой лейбл «Send today at HH:MM») + вторичная кнопка
// «Send when online». Нативных <input type=date/time> нет.
import DatePickerPopup, { getMaxScheduleDate } from './DatePickerPopup'
import { useT } from '../i18n'

export default function SchedulePopup({ onPick, onClose, initUnix, onWhenOnline }: {
  onPick: (unixSeconds: number) => void
  onClose: () => void
  /** перепланирование (tweb MessageScheduleEditTime): начальные дата/время */
  initUnix?: number
  /** вторичная кнопка «Отправить, когда онлайн» (tweb Schedule.SendWhenOnline) */
  onWhenOnline?: () => void
}) {
  const t = useT()
  const now = new Date()
  // Начальная дата (tweb checkDate): без initUnix — «сейчас + 10 минут»
  // (addMinutes: 10 только для нового планирования); метка выше максимума
  // (напр. sentinel у when_online-записи) — «сейчас»; прошлую подтягиваем к
  // «сейчас» (tweb minTimeDate-сидинг: инпуты не ниже первой доступной минуты).
  const fromInit = initUnix != null ? new Date(initUnix * 1000) : null
  const init = fromInit == null || Number.isNaN(fromInit.getTime())
    ? new Date(now.getTime() + 10 * 60_000)
    : fromInit.getTime() > getMaxScheduleDate().getTime() || fromInit.getTime() < now.getTime()
      ? now
      : fromInit

  return (
    <DatePickerPopup
      open
      onClose={onClose}
      withTime
      initDate={init.getTime()}
      minDate={now.getTime()}
      onPick={onPick}
      secondaryAction={onWhenOnline ? { label: t('Send When Online'), onClick: onWhenOnline } : undefined}
    />
  )
}
