// Попап выбора длительности mute — порт tweb PopupMute (src/components/popups/mute.ts):
// заголовок «Notifications», радио «For 1 Hour … Forever» (по умолчанию Forever),
// кнопка подтверждения «Mute».
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
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
    <Popup
      open={open}
      title={t('Notifications')}
      onClose={onClose}
      onExitComplete={onExitComplete}
      width={360}
      action={{
        label: t('Mute'),
        onClick: () => {
          onMute(value === -1 ? null : value)
          onClose()
        },
      }}
    >
      <div className={s.list}>
        {TIMES.map((tm) => (
          <div key={tm.value} className={s.row} onClick={() => setValue(tm.value)}>
            <TgIcon
              name={value === tm.value ? 'radioon' : 'radiooff'}
              color={value === tm.value ? 'var(--tg-accent)' : 'var(--tg-textFaint)'}
            />
            <Text size={16} color="var(--tg-textPrimary)">{t(tm.label)}</Text>
          </div>
        ))}
      </div>
    </Popup>
  )
}
