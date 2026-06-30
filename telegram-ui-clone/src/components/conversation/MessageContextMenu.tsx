// src/components/conversation/MessageContextMenu.tsx
// The message right-click menu: a reactions strip + an action list, anchored at
// the click point and grown from the nearest corner. The action list uses the
// shared Menu/MenuItem surface; the reactions strip is its own pill panel that
// floats just above the menu (kept as a sibling so it reads as a separate bubble,
// like tweb).
import { memo, useRef, type ReactNode, type MouseEvent, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Box, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { EASE } from '../../motion'

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
  // The "Viewers" action needs the click coordinates; capture the last pointer
  // event on a wrapper so MenuItem's (event-less) onClick can still forward it.
  const lastEvent = useRef<MouseEvent | null>(null)

  // Anchor a corner at the click point (right/bottom flip via CSS so it stays
  // exactly at the cursor regardless of menu size). transform-origin grows it
  // from that corner.
  const xPos: CSSProperties =
    menu.originX === 'left' ? { left: menu.x } : { right: window.innerWidth - menu.x }
  const transformOrigin = `${menu.originY} ${menu.originX}`

  // Reactions strip: floats above the action list with an 8px gap. When the menu
  // grows up (originY 'bottom'), the list bottom is at menu.y, so the strip is
  // bottom-anchored to a column that holds both; otherwise anchor it by its own
  // bottom just above the list top (menu.y - 8).
  const REACTIONS_H = 44
  const yMenu: CSSProperties =
    menu.originY === 'top'
      ? { top: menu.y + REACTIONS_H + 8 }
      : { bottom: window.innerHeight - menu.y }
  const yReactions: CSSProperties =
    menu.originY === 'top'
      ? { top: menu.y }
      : { bottom: window.innerHeight - menu.y + 8, transform: 'translateY(-100%)' }

  return (
    <>
      {/* Reactions strip — its own pill panel above the backdrop */}
      {createPortal(
        <Box
          component={motion.div}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, ease: EASE }}
          onContextMenu={(e: MouseEvent) => { e.preventDefault(); onClose() }}
          sx={{
            position: 'fixed',
            ...xPos,
            ...yReactions,
            zIndex: 2002,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            py: 0.5,
            borderRadius: '24px',
            background: tg.menuBg,
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
            boxShadow: tg.menuShadow,
            transformOrigin,
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
        </Box>,
        document.body,
      )}

      {/* Actions — shared Menu surface */}
      <Menu open onClose={onClose} style={{ ...xPos, ...yMenu, minWidth: 220, transformOrigin }}>
        {items.map((it) => (
          <div
            key={it.label}
            onClickCapture={(e) => {
              lastEvent.current = e
            }}
          >
            <MenuItem
              icon={it.icon}
              label={t(it.label)}
              danger={it.danger}
              onClick={() => (it.onClick ? it.onClick(lastEvent.current as MouseEvent) : onClose())}
            />
          </div>
        ))}
      </Menu>
    </>
  )
}

export default memo(MessageContextMenu)
