// Popup — переиспользуемая центрированная модалка (tweb .popup/.popup-container):
// скрим + карточка с хедером (× + заголовок [+ правый слот]), скроллируемым телом,
// опциональным футером и/или широкой accent-кнопкой снизу. Анимация 1:1 tweb:
// скрим — fade, карточка — выезд снизу (translateY 48px→0), 0.15s cubic-bezier(.4,0,.2,1);
// на закрытии — то же в обратную сторону. Владелец держит компонент смонтированным
// и управляет `open`; размонтировать можно в onExitComplete.
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import IconButton from '../IconButton'
import Text from '../Text'
import TgIcon from '../../../components/TgIcon'
import s from './Popup.module.scss'

const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]
const DUR = 0.15 // tweb --popup-transition-time

interface PopupProps {
  open: boolean
  /** заголовок (уже переведённый) */
  title: ReactNode
  onClose: () => void
  /** exit-анимация закончилась — можно размонтировать владельцу */
  onExitComplete?: () => void
  /** правый слот хедера (например, кнопка «⋮») */
  headerRight?: ReactNode
  /** прибитый низ карточки (например, строка подписи + send) */
  footer?: ReactNode
  /** широкая кнопка снизу (tweb popup-footer button) */
  action?: { label: string; onClick: () => void }
  /** ширина карточки, по умолчанию 420 */
  width?: number
  children: ReactNode
}

export default function Popup({ open, title, onClose, onExitComplete, headerRight, footer, action, width = 420, children }: PopupProps) {
  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <motion.div
          key="overlay"
          className={s.overlay}
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR, ease: EASE }}
        >
          <motion.div
            className={s.card}
            style={{ width: `min(${width}px, calc(100vw - 32px))` }}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 48 }}
            animate={{ y: 0 }}
            exit={{ y: 48 }}
            transition={{ duration: DUR, ease: EASE }}
          >
            <div className={s.header}>
              <IconButton size="small" onClick={onClose} color="var(--tg-textSecondary)">
                <TgIcon name="close" size={22} />
              </IconButton>
              <Text size={19} weight={600} color="var(--tg-textPrimary)" className={s.title}>{title}</Text>
              {headerRight}
            </div>
            <div className={s.body}>{children}</div>
            {footer}
            {action && (
              <div className={s.action} onClick={action.onClick}>
                {action.label}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
