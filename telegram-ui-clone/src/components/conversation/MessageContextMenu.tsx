// Контекстное меню сообщения — обычный ui-kit Menu (портал/бэкдроп/анимация из
// кита, как у attach-меню); полоска реакций — абсолют НАД панелью, как tweb
// вешает .btn-menu-reactions-container внутрь .btn-menu (margin-top: -(40+8)px).
//
// Полоска — порт tweb: таблетка 40px (radius 40, фон/blur как у btn-menu,
// drop-shadow 0 2px 8px .24), ячейки 36×28 с эмодзи 28px, шеврон 32×32
// разворачивает полный EmojiPicker (tweb onMoreClick → EmojiTab). Lottie
// appear/select-анимации реакций приходят с MTProto-сервера и вне Telegram
// недоступны — замена: scale-подскок на hover.
import { memo, useRef, useState, type ReactNode, type MouseEvent, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence } from 'framer-motion'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import Emoji from '../emoji/Emoji'
import EmojiPicker from '../EmojiPicker'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { usePortalContainer } from '../../core/pip'
import classNames from '../../shared/lib/classNames'
import s from './MessageContextMenu.module.scss'

const REACTIONS = ['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁']

// Высота полоски (2.5rem) + зазор до меню (.5rem) — tweb --menu-offset.
const BAR_OFFSET = 48

export interface MsgMenuItem {
  icon: ReactNode
  label: string
  danger?: boolean
  onClick?: (e: MouseEvent) => void
}

export interface MessageContextMenuProps {
  menu: { x: number; y: number; originX: 'left' | 'right'; originY: 'top' | 'bottom'; closing?: boolean }
  items: MsgMenuItem[]
  onClose: () => void
  /** exit-анимация доиграла — владелец окончательно размонтирует меню */
  onExited: () => void
  /** клик по эмодзи в полоске/пикере реакций (undefined — мок-чат, полоски нет) */
  onReaction?: (emoji: string) => void
}

function MessageContextMenu({ menu, items, onClose, onExited, onReaction }: MessageContextMenuProps) {
  const t = useT()
  const portalContainer = usePortalContainer()
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
  // Полоска над панелью не должна уйти за верх экрана (меню открылось у верха) —
  // тогда tweb показывает её под меню (openSide top → шеврон 'up').
  const barBelow = menu.originY === 'top' && menu.y < BAR_OFFSET + 8

  if (expanded && onReaction) {
    // Полный пикер эмодзи на месте меню (tweb onMoreClick → EmojiTab);
    // exit-анимация пикера — при closing, окончательный анмаунт по onExited.
    return createPortal(
      <>
        {!menu.closing && (
          <div
            onClick={onClose}
            onContextMenu={(e) => { e.preventDefault(); onClose() }}
            style={{ position: 'fixed', inset: 0, zIndex: 2000 }}
          />
        )}
        <div style={{ position: 'fixed', ...xPos, ...yPos, zIndex: 2001 }}>
          <AnimatePresence onExitComplete={onExited}>
            {!menu.closing && (
              <EmojiPicker className={s.pickerInMenu} onPick={(e) => onReaction(e)} onClose={onClose} />
            )}
          </AnimatePresence>
        </div>
      </>,
      portalContainer,
    )
  }

  return (
    <Menu
      open={!menu.closing}
      onClose={onClose}
      onExitComplete={onExited}
      style={{ ...xPos, ...yPos, transformOrigin: `${menu.originY} ${menu.originX}` }}
    >
      {onReaction && (
        <div
          className={classNames(s.reactionsBar, barBelow ? s.below : '')}
          style={menu.originX === 'left' ? { left: 0 } : { right: 0 }}
        >
          {REACTIONS.map((r) => (
            <div key={r} className={s.reaction} onClick={() => onReaction(r)}>
              <Emoji e={r} size={28} />
            </div>
          ))}
          <div className={s.more} onClick={() => setExpanded(true)}>
            <TgIcon name={barBelow ? 'up' : 'down'} size={24} />
          </div>
        </div>
      )}
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
  )
}

export default memo(MessageContextMenu)
