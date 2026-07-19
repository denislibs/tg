// The message right-click menu: a reactions bar + the ui-kit Menu, stacked in one
// vertical column (tweb .btn-menu.has-items-wrapper) so the reactions always sit
// ABOVE the actions. The column is anchored by a corner at the click point — top-
// anchored when it grows down, bottom-anchored when it grows up.
//
// Полоска реакций — порт tweb .btn-menu-reactions-container: таблетка 40px
// (radius 40, фон/blur как у btn-menu, drop-shadow 0 2px 8px .24), ячейки 36×28
// с эмодзи 28px, кнопка-шеврон 32×32 открывает полный EmojiPicker (tweb
// onMoreClick → EmojiTab). Lottie appear/select-анимации реакций приходят с
// MTProto-сервера и вне Telegram недоступны — замена: scale-подскок на hover.
import { memo, useRef, useState, type ReactNode, type MouseEvent, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import Emoji from '../emoji/Emoji'
import EmojiPicker from '../EmojiPicker'
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
  /** клик по эмодзи в полоске/пикере реакций (undefined — мок-чат, полоски нет) */
  onReaction?: (emoji: string) => void
}

function MessageContextMenu({ menu, items, onClose, onReaction }: MessageContextMenuProps) {
  const t = useT()
  // Шеврон «ещё» разворачивает полный пикер эмодзи на месте меню (tweb EmojiTab).
  const [expanded, setExpanded] = useState(false)
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
      <div
        style={{
          position: 'fixed',
          ...xPos,
          ...yPos,
          zIndex: 2001,
          display: 'flex',
          flexDirection: 'column',
          alignItems: menu.originX === 'left' ? 'flex-start' : 'flex-end',
          gap: 8,
        }}
      >
        {/* Полоска реакций (tweb btn-menu-transition: scale .8 → 1, .2s) */}
        {onReaction && !expanded && (
          <motion.div
            className={s.reactionsBar}
            style={{ transformOrigin: `bottom ${menu.originX}` }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {REACTIONS.map((r) => (
              <div key={r} className={s.reaction} onClick={() => onReaction(r)}>
                <Emoji e={r} size={28} />
              </div>
            ))}
            <div className={s.more} onClick={() => setExpanded(true)}>
              <TgIcon name="down" size={24} />
            </div>
          </motion.div>
        )}

        {expanded && onReaction ? (
          // Полный пикер эмодзи на месте меню (tweb onMoreClick → EmojiTab).
          <EmojiPicker
            className={s.pickerInMenu}
            onPick={(e) => onReaction(e)}
            onClose={onClose}
          />
        ) : (
          // Действия — ui-kit Menu (inline: позиционирует эта колонка).
          <Menu inline open onClose={onClose}>
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
          </Menu>
        )}
      </div>
    </>,
    document.body,
  )
}

export default memo(MessageContextMenu)
