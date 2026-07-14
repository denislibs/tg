// src/components/ComposeFab.tsx
// The sidebar's compose FAB (bottom-right ✎). It owns the open/closed state of the
// compose menu (so Sidebar no longer holds composeOpen) and renders ComposeMenu
// itself. Hidden while the search is open.
import { memo, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import ComposeMenu from './ComposeMenu'

const MotionFab = motion.create(IconButton)

export interface ComposeFabProps {
  searching: boolean
  onNewGroup: () => void
  onNewPrivate: () => void
  onNewChannel: () => void
}

function ComposeFab({ searching, onNewGroup, onNewPrivate, onNewChannel }: ComposeFabProps) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <>
      {/* FAB (hidden while searching) */}
      <AnimatePresence>
        {!searching && (
          <MotionFab
            onClick={() => setOpen((o) => !o)}
            initial={{ y: 96, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            color="#fff"
            style={{
              position: 'absolute',
              right: 20,
              bottom: 20,
              zIndex: 32,
              width: 56,
              height: 56,
              background: 'var(--tg-accentGradient)',
              '--ib-hover': 'var(--tg-accentGradient)',
            } as CSSProperties}
          >
            <motion.span
              animate={{ rotate: open ? 90 : 0 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'inline-flex' }}
            >
              {open ? <TgIcon name="close" size={24} /> : <TgIcon name="newchat_filled" size={24} />}
            </motion.span>
          </MotionFab>
        )}
      </AnimatePresence>

      <ComposeMenu
        open={open}
        onClose={close}
        onNewGroup={onNewGroup}
        onNewPrivate={onNewPrivate}
        onNewChannel={onNewChannel}
      />
    </>
  )
}

export default memo(ComposeFab)
