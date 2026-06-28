// src/components/conversation/MessageContextMenu.tsx
// The message right-click menu: a reactions strip + an action list, anchored at
// the click point and grown from the nearest corner. Rendered into a portal.
import { memo, type ReactNode, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { EASE } from '../../motion'

const EASE_STD = EASE
const REACTIONS = ['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁']

export interface MsgMenuItem {
  icon: ReactNode
  label: string
  danger?: boolean
  onClick?: (e: MouseEvent) => void
}

export interface MessageContextMenuProps {
  menu: { x: number; y: number; originX: 'left' | 'right'; originY: 'top' | 'bottom' }
  items: MsgMenuItem[]
  onClose: () => void
}

function MessageContextMenu({ menu, items, onClose }: MessageContextMenuProps) {
  const tg = useTheme().tg
  const t = useT()

  return createPortal(
    <>
      <Box
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
        sx={{ position: 'fixed', inset: 0, zIndex: 2000 }}
      />
      <Box
        component={motion.div}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: EASE_STD }}
        sx={{
          position: 'fixed',
          ...(menu.originX === 'left' ? { left: menu.x } : { right: window.innerWidth - menu.x }),
          ...(menu.originY === 'top' ? { top: menu.y } : { bottom: window.innerHeight - menu.y }),
          zIndex: 2001,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          alignItems: menu.originX === 'right' ? 'flex-end' : 'flex-start',
          transformOrigin: `${menu.originY} ${menu.originX}`,
        }}
      >
        {/* Reactions */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            alignSelf: menu.originX === 'right' ? 'flex-end' : 'flex-start',
            px: 1,
            py: 0.5,
            borderRadius: '24px',
            background: tg.menuBg,
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
            boxShadow: tg.menuShadow,
          }}
        >
          {REACTIONS.map((r) => (
            <Box
              key={r}
              component={motion.div}
              whileHover={{ scale: 1.25 }}
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              sx={{ fontSize: 24, lineHeight: 1, cursor: 'pointer', px: 0.25 }}
            >
              {r}
            </Box>
          ))}
          <TgIcon name="down" size={22} color={tg.textSecondary} style={{ marginLeft: 2 }} />
        </Box>

        {/* Actions */}
        <Box
          sx={{
            minWidth: 220,
            py: 0.75,
            borderRadius: '12px',
            background: tg.menuBg,
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
            boxShadow: tg.menuShadow,
          }}
        >
          {items.map((it) => (
            <Box
              key={it.label}
              onClick={(e) => (it.onClick ? it.onClick(e) : onClose())}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1.5,
                py: 0.65,
                mx: 0.5,
                borderRadius: '8px',
                cursor: 'pointer',
                '&:hover': { background: tg.hover },
              }}
            >
              <Box sx={{ display: 'flex', color: it.danger ? '#ff595a' : tg.textSecondary, '& svg': { fontSize: 20 } }}>
                {it.icon}
              </Box>
              <Typography sx={{ fontSize: 15, color: it.danger ? '#ff595a' : tg.textPrimary }}>
                {t(it.label)}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </>,
    document.body,
  )
}

export default memo(MessageContextMenu)
