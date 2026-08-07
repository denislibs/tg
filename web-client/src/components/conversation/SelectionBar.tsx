// src/components/conversation/SelectionBar.tsx
// The bottom action bar shown in multi-select mode (count + forward + delete).
// Replaces the composer while messages are selected.
import { memo } from 'react'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import s from './SelectionBar.module.scss'

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

  return (
    <div className={s.bar}>
      <IconButton onClick={onClear} color="var(--secondary-text-color)">
        <TgIcon name="close" />
      </IconButton>
      <Text size={15} weight={600} color="var(--primary-text-color)" className={s.count}>
        {t('Selected')}: {count}
      </Text>
      {canForward && (
        <IconButton onClick={onForward} color="var(--primary-color)">
          <TgIcon name="reply" style={{ transform: 'scaleX(-1)' }} />
        </IconButton>
      )}
      <IconButton onClick={onDelete} color="#ff595a">
        <TgIcon name="delete" />
      </IconButton>
    </div>
  )
}

export default memo(SelectionBar)
