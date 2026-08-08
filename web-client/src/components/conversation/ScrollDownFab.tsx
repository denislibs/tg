// src/components/conversation/ScrollDownFab.tsx
// Кнопка «вниз» с бейджем непрочитанных — tweb `chat/input.ts:615`:
//   ButtonCorner({icon: 'arrow_down', className: 'bubbles-corner-button chat-secondary-button bubbles-go-down'})
// то есть `button.btn-circle.btn-corner.z-depth-1.bubbles-corner-button
// .chat-secondary-button.bubbles-go-down` + `span.badge.badge-24.badge-primary`.
//
// Показ — НЕ размонтированием: кнопка всегда в DOM, а видимость даёт класс
// `is-go-down-visible` на `.chat` (_chat.scss:1217-1231 → opacity/visibility по
// --layer-transition). Поэтому сам компонент только рисует узел, а класс на
// колонке ставит Chat.
import { memo } from 'react'
import TgIcon from '../TgIcon'
import classNames from '../../shared/lib/classNames'

export interface ScrollDownFabProps {
  unreadBelow: number
  onClick: () => void
}

function ScrollDownFab({ unreadBelow, onClick }: ScrollDownFabProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={classNames(
        'btn-circle', 'btn-corner', 'z-depth-1',
        'bubbles-corner-button', 'chat-secondary-button', 'bubbles-go-down',
      )}
      onClick={onClick}
      aria-label="Scroll to bottom"
    >
      <TgIcon name="down" />
      {/* tweb: пустой бейдж скрыт классом is-badge-empty (_badge.scss) */}
      <span className={classNames('badge', 'badge-24', 'badge-primary', unreadBelow > 0 ? '' : 'is-badge-empty')}>
        {unreadBelow > 99 ? '99+' : unreadBelow}
      </span>
    </button>
  )
}

export default memo(ScrollDownFab)
