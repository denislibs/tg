// src/components/conversation/PinnedBar.tsx
// The pinned-message bar under the header (most recent pin; click jumps to it).
// Memoized — only its own inputs (pins, searchOpen, playerOffset) re-render it.
import { memo } from 'react'
import { Box, IconButton, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { EASE, DUR } from '../../motion'
import type { Message } from '../../core/models'

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
  const theme = useTheme()
  const tg = theme.tg
  const mode = theme.palette.mode
  const t = useT()

  return (
    <AnimatePresence initial={false}>
      {!searchOpen && pins.length > 0 && (
        <Box
          key="pinbar"
          component={motion.div}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: DUR_IN, ease: EASE_STD }}
          onClick={() => onJump(pins[0]?.seq)}
          sx={{
            position: 'absolute',
            top: `${16 + 48 + 8 + playerOffset}px`,
            transition: 'top 0.22s ease',
            left: 0, right: 0, mx: 'auto', width: '100%', maxWidth: 688,
            zIndex: 5,
            display: 'flex', alignItems: 'center', gap: 1,
            px: 1.5, py: 0.75, height: 44,
            borderRadius: '16px', cursor: 'pointer',
            background: tg.bubble,
            boxShadow: mode === 'dark' ? '0 1px 6px -1px rgba(0,0,0,0.5)' : '0 1px 5px -1px rgba(0,0,0,0.16)',
          }}
        >
          <TgIcon name="pin" size={20} color={tg.accent} />
          <Box sx={{ flex: 1, minWidth: 0, borderLeft: `2px solid ${tg.accent}`, pl: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: tg.accent, lineHeight: 1.2 }}>
              {t('Pinned message')}{pins.length > 1 ? ` (${pins.length})` : ''}
            </Typography>
            <Typography noWrap sx={{ fontSize: 13.5, color: tg.textSecondary }}>
              {pins[0]?.text || t('Message')}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); if (pins[0]?.id != null) onUnpin(pins[0].id) }}
            sx={{ color: tg.textFaint }}
          >
            <TgIcon name="close" size={20} />
          </IconButton>
        </Box>
      )}
    </AnimatePresence>
  )
}

export default memo(PinnedBar)
