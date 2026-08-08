// Попап выбора длительности mute — порт tweb PopupMute (src/components/popups/mute.ts:29-52):
// компактный tweb-конфирм (PopupPeer): аватар чата (32) + заголовок «Notifications»,
// радио-строки «For 1 Hour … Forever» (Forever отмечен по умолчанию, с ripple —
// tweb RadioFormFromValues(..., true)), кнопки MUTE / CANCEL row-reverse.
// Радио — наша реализация (TgIcon radioon/radiooff), строки 48px.
import { useState, type ReactNode } from 'react'
import ConfirmPopup from '../shared/ui/ConfirmPopup'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import { useRipple } from '../shared/ui/Ripple/useRipple'
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

// Радио-строка с ripple (tweb RadioFormFromValues(..., ripple=true)).
function RadioRow({ label, checked, onSelect }: { label: string; checked: boolean; onSelect: () => void }) {
  const { onPointerDown, ripple } = useRipple()
  return (
    <div
      className={classNames('rp', 'rp-overflow', s.row)}
      role="radio"
      aria-checked={checked}
      onPointerDown={onPointerDown}
      onClick={onSelect}
    >
      {ripple}
      <TgIcon
        name={checked ? 'radioon' : 'radiooff'}
        color={checked ? 'var(--primary-color)' : 'var(--secondary-text-color)'}
      />
      <Text size={16} color="var(--primary-text-color)">{label}</Text>
    </div>
  )
}

export default function MutePopup({
  open,
  onClose,
  onExitComplete,
  onMute,
  avatar,
}: {
  open: boolean
  onClose: () => void
  onExitComplete?: () => void
  /** seconds — длительность mute; null — навсегда */
  onMute: (seconds: number | null) => void
  /** аватар чата 32px слева от заголовка (tweb PopupMute → PopupPeer peerId) */
  avatar?: ReactNode
}) {
  const t = useT()
  const [value, setValue] = useState(-1) // tweb: Forever отмечен по умолчанию
  return (
    <ConfirmPopup
      open={open}
      onClose={onClose}
      onExitComplete={onExitComplete}
      avatar={avatar}
      title={t('Notifications')}
      buttons={[{
        text: t('Mute'),
        primary: true,
        onClick: () => onMute(value === -1 ? null : value),
      }]}
    >
      <div className={s.list} role="radiogroup">
        {TIMES.map((tm) => (
          <RadioRow key={tm.value} label={t(tm.label)} checked={value === tm.value} onSelect={() => setValue(tm.value)} />
        ))}
      </div>
    </ConfirmPopup>
  )
}
