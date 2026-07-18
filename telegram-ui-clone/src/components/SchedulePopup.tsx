// Пикер «Запланировать сообщение» (tweb showScheduleSendingPopup / datePicker):
// дата + время, кнопка с динамическим текстом «Отправить сегодня в HH:MM» /
// «Отправить DD.MM в HH:MM».
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
import { useT } from '../i18n'
import s from './SchedulePopup.module.scss'

const pad = (n: number) => String(n).padStart(2, '0')

export default function SchedulePopup({ onPick, onClose }: {
  onPick: (unixSeconds: number) => void
  onClose: () => void
}) {
  const t = useT()
  const now = new Date()
  const in10 = new Date(now.getTime() + 10 * 60_000)
  const [date, setDate] = useState(`${in10.getFullYear()}-${pad(in10.getMonth() + 1)}-${pad(in10.getDate())}`)
  const [time, setTime] = useState(`${pad(in10.getHours())}:${pad(in10.getMinutes())}`)

  const picked = new Date(`${date}T${time}:00`)
  const valid = !Number.isNaN(picked.getTime()) && picked.getTime() > Date.now()
  const isToday = picked.toDateString() === now.toDateString()
  const label = isToday
    ? `${t('Send today at')} ${time}`
    : `${t('Send on')} ${pad(picked.getDate())}.${pad(picked.getMonth() + 1)} ${t('at')} ${time}`

  return (
    <Popup
      open
      title={t('Schedule Message')}
      onClose={onClose}
      width={360}
      action={{ label: valid ? label : t('Schedule Message'), onClick: () => valid && onPick(Math.floor(picked.getTime() / 1000)) }}
    >
      <div className={s.body}>
        <input className={s.field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className={s.field} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
    </Popup>
  )
}
