// src/components/conversation/PinnedBar.tsx
// The pinned-message bar under the header (tweb pinnedMessage): показывает пин,
// к которому прыгнет следующий клик, клик перелистывает дальше (onFollow);
// слева индикатор-стек сегментов, справа — pinlist-кнопка (несколько пинов,
// tweb .is-many) или крестик-unpin (один пин).
// Memoized — only its own inputs (pins/index, searchOpen) re-render it.
import { memo } from 'react'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'
import type { Message } from '../../core/models'
import { pinBadgeNumber } from '../../core/pinnedCycle'
import { replyMediaLabel } from '../../core/messageToConvMsg'
import PinnedBorder from './PinnedBorder'
import s from './PinnedBar.module.scss'

export interface PinnedBarProps {
  pins: Message[]
  /** индекс показанного пина (0 = новейший) — из usePinnedBar */
  index: number
  searchOpen: boolean
  /** клик по плашке: прыжок к показанному пину + перелистывание */
  onFollow: () => void
  onUnpin: (id: number) => void
  /** открыть экран «Закреплённые сообщения» */
  onOpenList: () => void
}

function PinnedBar({ pins, index, searchOpen, onFollow, onUnpin, onOpenList }: PinnedBarProps) {
  const t = useT()

  const shown = pins[index]
  const badge = pinBadgeNumber(index, pins.length)
  const isMany = pins.length > 1

  if (searchOpen || pins.length === 0) return null

  return (
    // tweb .pinned-container.pinned-message — сегмент стека .topbar-floating-plates
    // (_chatPinned.scss:249,350): высота --pinned-container-height, фон surface.
    <div className={classNames('pinned-container', 'pinned-message', s.bar)} onClick={onFollow}>
      <TgIcon name="pin" size={20} color="var(--primary-color)" />
      {/* tweb pinnedMessageBorder.render(count, count - pinnedIndex - 1):
          сегменты по треку сверху вниз — верхний это старейший пин */}
      <PinnedBorder count={pins.length} index={pins.length - index - 1} />
      <div className={s.body}>
        <Text size={13} weight={600} color="var(--primary-color)" style={{ lineHeight: 1.2 }}>
          {t('Pinned message')}{badge != null ? ` #${badge}` : ''}
        </Text>
        <Text noWrap size={13.5} color="var(--secondary-text-color)">
          {shown?.text || replyMediaLabel(shown?.type) || t('Message')}
        </Text>
      </div>
      {isMany ? (
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); onOpenList() }}
          color="var(--secondary-text-color)"
          aria-label={t('Pinned Messages')}
        >
          <TgIcon name="pinlist" size={20} />
        </IconButton>
      ) : (
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); if (shown?.id != null) onUnpin(shown.id) }}
          color="var(--secondary-text-color)"
          aria-label={t('Unpin')}
        >
          <TgIcon name="close" size={20} />
        </IconButton>
      )}
    </div>
  )
}

export default memo(PinnedBar)
