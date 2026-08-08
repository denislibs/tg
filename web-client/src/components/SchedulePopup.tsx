// Пикер «Запланировать сообщение» — порт tweb showScheduleSendingPopup
// (popups/scheduleSendingPopup.tsx:50-70): календарь datePicker в режиме withTime
// (поля часов/минут, живой лейбл «Send today at HH:MM») + вторичная кнопка
// «Send when online». Нативных <input type=date/time> нет.
import DatePickerPopup from './DatePickerPopup'
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
  // Начальная дата: перепланируемое время (initUnix) либо «сейчас + 10 минут»
  // (tweb addMinutes: 10). Невалидную/прошлую метку (напр. у when_online-записи)
  // заменяем на +10 минут.
  const fallback = new Date(now.getTime() + 10 * 60_000)
  const fromInit = initUnix != null ? new Date(initUnix * 1000) : null
  const init = fromInit && !Number.isNaN(fromInit.getTime()) && fromInit.getTime() > now.getTime() ? fromInit : fallback

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
