// src/components/conversation/PinnedBar.tsx
// The pinned-message bar under the header (most recent pin; click jumps to it).
// Memoized — only its own inputs (pins, searchOpen, playerOffset) re-render it.
import { memo } from 'react'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { EASE, DUR } from '../../motion'
import type { Message } from '../../core/models'
import s from './PinnedBar.module.scss'

const EASE_STD = EASE
const DUR_IN = DUR.in

export interface PinnedBarProps {
  pins: Message[]
  searchOpen: boolean
  playerOffset: number
  onJump: (seq?: number) => void
  onUnpin: (id: number) => void
}

function PinnedBar({ pins, searchOpen, playerOffset, onJump, onUnpin }: PinnedBarProps) {
  const t = useT()

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
          onClick={() => onJump(pins[0]?.seq)}
          style={{ top: `${16 + 48 + 8 + playerOffset}px` }}
        >
          <TgIcon name="pin" size={20} color="var(--tg-accent)" />
          <div className={s.body}>
            <Text size={13} weight={600} color="var(--tg-accent)" style={{ lineHeight: 1.2 }}>
              {t('Pinned message')}{pins.length > 1 ? ` (${pins.length})` : ''}
            </Text>
            <Text noWrap size={13.5} color="var(--tg-textSecondary)">
              {pins[0]?.text || t('Message')}
            </Text>
          </div>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); if (pins[0]?.id != null) onUnpin(pins[0].id) }}
            color="var(--tg-textFaint)"
          >
            <TgIcon name="close" size={20} />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default memo(PinnedBar)
