// src/components/conversation/ScrollDownFab.tsx
// The "scroll to bottom" floating button with an unread-count badge. Memoized;
// the scroll/reload decision lives in the parent and arrives via onClick.
import { memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import s from './ScrollDownFab.module.scss'

export interface ScrollDownFabProps {
  show: boolean
  unreadBelow: number
  onClick: () => void
}

function ScrollDownFab({ show, unreadBelow, onClick }: ScrollDownFabProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="scroll-down"
          className={s.fab}
          onClick={onClick}
          whileTap={{ scale: 0.92 }}
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <TgIcon name="down" />
          {unreadBelow > 0 && (
            <div className={s.badge}>{unreadBelow > 99 ? '99+' : unreadBelow}</div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default memo(ScrollDownFab)
