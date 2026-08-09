// src/components/conversation/SelectionBar.tsx
// Панель мультивыбора — tweb `chat/selection.ts:1044-1126`: пока идёт выделение,
// в `.chat-input-container` ДОБАВЛЯЕТСЯ ещё один ребёнок (последним), а композер
// остаётся на месте и гасится классом `is-centering` на контейнере:
//
//   div.chat-input-wrapper.selection-wrapper
//     div.chat-input-plate.rows-wrapper-row.selection-container   ← тот же ChatInputPlate,
//       div.chat-input-plate-side   > button.btn-icon.danger.selection-container-delete
//       div.chat-input-plate-center > button.chat-input-plate-button > div.selection-container-count
//       div.chat-input-plate-side   > button.btn-icon.selection-container-forward
//
// Проявление — чистый CSS: `.bubbles.is-selecting.forwards ~ .chat-input-main
// .selection-wrapper { opacity: 1 }` (_chat.scss:369-375); класс на `.bubbles`
// ставит Chat через useSetTransition.
import { memo } from 'react'
import TgIcon from '../TgIcon'
import IconButton from '../../shared/ui/IconButton'
import classNames from '../../shared/lib/classNames'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import { useT } from '../../i18n'

export interface SelectionBarProps {
  count: number
  onClear: () => void
  onForward: () => void
  onDelete: () => void
  // Секретный чат: пересылки нет (E2E), кнопку forward прячем.
  canForward?: boolean
}

function SelectionBar({ count, onClear, onForward, onDelete, canForward = true }: SelectionBarProps) {
  const t = useT()
  const { onPointerDown, ripple } = useRipple()

  return (
    <div className="chat-input-wrapper selection-wrapper">
      <div className="chat-input-plate rows-wrapper-row selection-container">
        <div className="chat-input-plate-side">
          <IconButton className="danger selection-container-delete" onClick={onDelete}>
            <TgIcon name="delete" className="button-icon" size="inherit" />
          </IconButton>
        </div>
        <div className="chat-input-plate-center">
          {/* tweb: клик по счётчику снимает выделение (cancelSelection) */}
          <button
            type="button"
            className="btn-primary btn-transparent text-bold chat-input-plate-button rp"
            onPointerDown={onPointerDown}
            onClick={onClear}
          >
            {ripple}
            <div className="selection-container-count">{t('Selected')}: {count}</div>
          </button>
        </div>
        <div className="chat-input-plate-side">
          <IconButton
            className={classNames('selection-container-forward', canForward ? '' : 'hide')}
            onClick={onForward}
          >
            <TgIcon name="forward" className="button-icon" size="inherit" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

export default memo(SelectionBar)
