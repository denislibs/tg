// src/components/conversation/ScrollDownFab.tsx
// The "scroll to bottom" floating button with an unread-count badge. Memoized;
// the scroll/reload decision lives in the parent and arrives via onClick.
import { memo } from 'react'
import { Box, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'

export interface ScrollDownFabProps {
  show: boolean
  unreadBelow: number
  onClick: () => void
}

function ScrollDownFab({ show, unreadBelow, onClick }: ScrollDownFabProps) {
  const theme = useTheme()
  const tg = theme.tg
  const mode = theme.palette.mode

  return (
    <AnimatePresence>
      {show && (
        <Box
          key="scroll-down"
          component={motion.div}
          onClick={onClick}
          whileTap={{ scale: 0.92 }}
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
          sx={{
            position: 'absolute',
            right: 0,
            top: -64,
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: tg.bubble,
            boxShadow:
              mode === 'dark' ? '0 2px 12px rgba(0,0,0,0.5)' : '0 2px 12px rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: tg.textSecondary,
            zIndex: 7,
          }}
        >
          <TgIcon name="down" />
          {unreadBelow > 0 && (
            <Box
              sx={{
                position: 'absolute',
                top: -6,
                minWidth: 22,
                height: 22,
                px: 0.75,
                borderRadius: 11,
                background: tg.badge,
                color: '#fff',
                fontSize: 12.5,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 0 2px ' + tg.bubble,
              }}
            >
              {unreadBelow > 99 ? '99+' : unreadBelow}
            </Box>
          )}
        </Box>
      )}
    </AnimatePresence>
  )
}

export default memo(ScrollDownFab)
