// Попап выбора длительности mute — порт tweb PopupMute (src/components/popups/mute.ts:29-52):
// компактный tweb-конфирм (PopupPeer): заголовок «Notifications», радио-строки
// «For 1 Hour … Forever» (Forever отмечен по умолчанию), кнопки MUTE / CANCEL
// row-reverse. Радио — наша реализация (TgIcon radioon/radiooff), строки 48px.
import { useState } from 'react'
import ConfirmPopup from '../shared/ui/ConfirmPopup'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import s from './MutePopup.module.scss'

const HOUR = 3600
const TIMES: { value: number; label: string }[] = [
  { value: HOUR, label: 'For 1 Hour' },
  { value: HOUR * 4, label: 'For 4 Hours' },
  { value: HOUR * 8, label: 'For 8 Hours' },
  { value: HOUR * 24, label: 'For 1 Day' },
  { value: HOUR * 24 * 3, label: 'For 3 Days' },
  { value: -1, label: 'Forever' },
]

export default function MutePopup({
  open,
  onClose,
  onExitComplete,
  onMute,
}: {
  open: boolean
  onClose: () => void
  onExitComplete?: () => void
  /** seconds — длительность mute; null — навсегда */
  onMute: (seconds: number | null) => void
}) {
  const t = useT()
  const [value, setValue] = useState(-1) // tweb: Forever отмечен по умолчанию
  return (
    <ConfirmPopup
      open={open}
      onClose={onClose}
      onExitComplete={onExitComplete}
      title={t('Notifications')}
      buttons={[{
        text: t('Mute'),
        primary: true,
        onClick: () => onMute(value === -1 ? null : value),
      }]}
    >
      <div className={s.list} role="radiogroup">
        {TIMES.map((tm) => (
          <div
            key={tm.value}
            className={s.row}
            role="radio"
            aria-checked={value === tm.value}
            onClick={() => setValue(tm.value)}
          >
            <TgIcon
              name={value === tm.value ? 'radioon' : 'radiooff'}
              color={value === tm.value ? 'var(--primary-color)' : 'var(--secondary-text-color)'}
            />
            <Text size={16} color="var(--primary-text-color)">{t(tm.label)}</Text>
          </div>
        ))}
      </div>
    </ConfirmPopup>
  )
}
