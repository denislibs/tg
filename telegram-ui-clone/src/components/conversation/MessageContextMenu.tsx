// src/components/conversation/MessageContextMenu.tsx
// The message right-click menu: a reactions pill + an action list, stacked in one
// vertical column (tweb .btn-menu.has-items-wrapper) so the reactions always sit
// ABOVE the actions. The column is anchored by a corner at the click point — top-
// anchored when it grows down, bottom-anchored when it grows up — so the reactions
// land above the menu without needing to know the menu's height. Rows use MenuItem;
// each pill carries the shared menu surface (bg/blur/shadow).
import { memo, useRef, type ReactNode, type MouseEvent, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import classNames from '../../shared/lib/classNames'
import { MenuItem } from '../../shared/ui/Menu'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import s from './MessageContextMenu.module.scss'

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
  const t = useT()
  // The "Viewers" action needs the click coordinates; capture the last pointer
  // event on a wrapper so MenuItem's (event-less) onClick can still forward it.
  const lastEvent = useRef<MouseEvent | null>(null)

  // Anchor a corner at the click: top/left when growing down-right, right/bottom
  // (via CSS) when growing up-left — exact at the cursor regardless of menu size.
  const xPos: CSSProperties =
    menu.originX === 'left' ? { left: menu.x } : { right: window.innerWidth - menu.x }
  const yPos: CSSProperties =
    menu.originY === 'top' ? { top: menu.y } : { bottom: window.innerHeight - menu.y }

  return createPortal(
    <>
      <div
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
        style={{ position: 'fixed', inset: 0, zIndex: 2000 }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        style={{
          position: 'fixed',
          ...xPos,
          ...yPos,
          zIndex: 2001,
          display: 'flex',
          flexDirection: 'column',
          alignItems: menu.originX === 'left' ? 'flex-start' : 'flex-end',
          gap: 8,
          transformOrigin: `${menu.originY} ${menu.originX}`,
        }}
      >
        {/* Reactions pill — always on top */}
        <div className={classNames(s.reactions, s.surface)}>
          {REACTIONS.map((r) => (
            <div key={r} className={s.reaction} onClick={onClose}>
              {r}
            </div>
          ))}
          <TgIcon name="down" size={22} color="var(--tg-textSecondary)" style={{ marginLeft: 2 }} />
        </div>

        {/* Actions pill — MenuItem rows on the shared surface */}
        <div className={classNames(s.actions, s.surface)}>
          {items.map((it) => (
            <div key={it.label} onClickCapture={(e) => (lastEvent.current = e)}>
              <MenuItem
                icon={it.icon}
                label={t(it.label)}
                danger={it.danger}
                onClick={() => (it.onClick ? it.onClick(lastEvent.current as MouseEvent) : onClose())}
              />
            </div>
          ))}
        </div>
      </motion.div>
    </>,
    document.body,
  )
}

export default memo(MessageContextMenu)
