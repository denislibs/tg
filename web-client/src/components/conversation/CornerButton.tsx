// src/components/conversation/CornerButton.tsx
// Порт tweb `ButtonCorner({icon, className})` (components/buttonCorner.ts) —
// круглая угловая кнопка, которую композер кладёт прямо в `.chat-input-container`:
//
//   button.btn-circle.btn-corner.z-depth-1.rp[.bubbles-corner-button
//          .chat-secondary-button.<роль>]
//     div.c-ripple
//     span.button-icon.tgico
//     span.badge.badge-24.badge-primary[.is-badge-empty]
//
// Ролей три (input.ts:615 и :827): `bubbles-go-down` — «вниз», и три штуки
// `bubbles-go-mention bubbles-go-reaction` (упоминания / реакции / голосования).
// Видимость даёт НЕ размонтирование: `.bubbles-go-down` открывается классом
// `is-go-down-visible` на `.chat` (_chat.scss:1217-1231), а `.bubbles-go-mention` —
// собственным `is-visible` (_chat.scss:1364-1381), от которого же считается сдвиг
// соседних кнопок вверх (`+ .bubbles-go-reaction`). Поэтому все кнопки всегда в DOM.
import { memo } from 'react'
import TgIcon, { type IconName } from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { useRipple } from '../../shared/ui/Ripple/useRipple'

export interface CornerButtonProps {
  icon: IconName
  /** роль кнопки: `bubbles-go-down` либо `bubbles-go-mention bubbles-go-reaction` */
  role: string
  /** значение бейджа; 0 — пустой бейдж (`is-badge-empty`), как createBadge в tweb */
  badge?: number
  /** `is-visible` на самой кнопке (только для `.bubbles-go-mention`) */
  visible?: boolean
  onClick?: () => void
  label?: string
}

function CornerButton({ icon, role, badge = 0, visible, onClick, label }: CornerButtonProps) {
  const { onPointerDown, ripple } = useRipple()
  return (
    <button
      type="button"
      tabIndex={-1}
      className={classNames(
        'btn-circle', 'btn-corner', 'z-depth-1', 'rp',
        'bubbles-corner-button', 'chat-secondary-button', role,
        visible ? 'is-visible' : '',
      )}
      onPointerDown={onPointerDown}
      onClick={onClick}
      aria-label={label}
    >
      {ripple}
      <TgIcon name={icon} className="button-icon" size="inherit" />
      {/* tweb createBadge('span', 24, 'primary'): пустой бейдж прячется `is-badge-empty` */}
      <span className={classNames('badge', 'badge-24', 'badge-primary', badge > 0 ? '' : 'is-badge-empty')}>
        {badge > 0 ? (badge > 99 ? '99+' : badge) : ''}
      </span>
    </button>
  )
}

export default memo(CornerButton)
