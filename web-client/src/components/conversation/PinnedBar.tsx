// src/components/conversation/PinnedBar.tsx
// The pinned-message bar under the header (tweb pinnedMessage): показывает пин,
// к которому прыгнет следующий клик, клик перелистывает дальше (onFollow);
// слева индикатор-стек сегментов, справа — pinlist-кнопка (несколько пинов,
// tweb .is-many) или крестик-unpin (один пин).
// Memoized — only its own inputs (pins/index, searchOpen, playerOffset) re-render it.
import { memo } from 'react'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { EASE, DUR } from '../../motion'
import type { Message } from '../../core/models'
import { pinBadgeNumber } from '../../core/pinnedCycle'
import { replyMediaLabel } from '../../core/messageToConvMsg'
import PinnedBorder from './PinnedBorder'
import useMediaQuery from '../../shared/lib/useMediaQuery'
import s from './PinnedBar.module.scss'

const EASE_STD = EASE
const DUR_IN = DUR.in

export interface PinnedBarProps {
  pins: Message[]
  /** индекс показанного пина (0 = новейший) — из usePinnedBar */
  index: number
  searchOpen: boolean
  playerOffset: number
  /** клик по плашке: прыжок к показанному пину + перелистывание */
  onFollow: () => void
  onUnpin: (id: number) => void
  /** открыть экран «Закреплённые сообщения» */
  onOpenList: () => void
}

function PinnedBar({ pins, index, searchOpen, playerOffset, onFollow, onUnpin, onOpenList }: PinnedBarProps) {
  const t = useT()
  // tweb: на handhelds плейты в 8px от краёв (--page-chats-padding: 8px)
  const narrow = useMediaQuery('(max-width:900px)')

  const shown = pins[index]
  const badge = pinBadgeNumber(index, pins.length)
  const isMany = pins.length > 1

  return (
    <AnimatePresence initial={false}>
      {!searchOpen && pins.length > 0 && (
        <motion.div
          key="pinbar"
          className={s.bar}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: DUR_IN, ease: EASE_STD }}
          onClick={onFollow}
          style={{ top: `${(narrow ? 8 : 16) + 48 + 8 + playerOffset}px` }}
        >
          <TgIcon name="pin" size={20} color="var(--tg-accent)" />
          {/* tweb pinnedMessageBorder.render(count, count - pinnedIndex - 1):
              сегменты по треку сверху вниз — верхний это старейший пин */}
          <PinnedBorder count={pins.length} index={pins.length - index - 1} />
          <div className={s.body}>
            <Text size={13} weight={600} color="var(--tg-accent)" style={{ lineHeight: 1.2 }}>
              {t('Pinned message')}{badge != null ? ` #${badge}` : ''}
            </Text>
            <Text noWrap size={13.5} color="var(--tg-textSecondary)">
              {shown?.text || replyMediaLabel(shown?.type) || t('Message')}
            </Text>
          </div>
          {isMany ? (
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onOpenList() }}
              color="var(--tg-textFaint)"
              aria-label={t('Pinned Messages')}
            >
              <TgIcon name="pinlist" size={20} />
            </IconButton>
          ) : (
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); if (shown?.id != null) onUnpin(shown.id) }}
              color="var(--tg-textFaint)"
              aria-label={t('Unpin')}
            >
              <TgIcon name="close" size={20} />
            </IconButton>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default memo(PinnedBar)
