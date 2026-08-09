// src/components/conversation/ScrollDownFab.tsx
// Кнопка «вниз» с бейджем непрочитанных — tweb `chat/input.ts:615`:
//   ButtonCorner({icon: 'arrow_down', className: 'bubbles-corner-button chat-secondary-button bubbles-go-down'})
//
// Показ — НЕ размонтированием: кнопка всегда в DOM, а видимость даёт класс
// `is-go-down-visible` на `.chat` (_chat.scss:1217-1231 → opacity/visibility по
// --layer-transition). Поэтому сам компонент только рисует узел, а класс на
// колонке ставит Chat. Разметка — общий порт ButtonCorner (CornerButton).
import { memo } from 'react'
import CornerButton from './CornerButton'

export interface ScrollDownFabProps {
  unreadBelow: number
  onClick: () => void
}

function ScrollDownFab({ unreadBelow, onClick }: ScrollDownFabProps) {
  return (
    <CornerButton
      icon="down"
      role="bubbles-go-down"
      badge={unreadBelow}
      onClick={onClick}
      label="Scroll to bottom"
    />
  )
}

export default memo(ScrollDownFab)
