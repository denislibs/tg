// Popup — переиспользуемая центрированная модалка (tweb .popup/.popup-container):
// скрим + карточка с хедером (× + заголовок), скроллируемым телом и опциональной
// широкой accent-кнопкой снизу. Владелец монтирует/размонтирует сам (портал).
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import IconButton from '../IconButton'
import Text from '../Text'
import TgIcon from '../../../components/TgIcon'
import s from './Popup.module.scss'

interface PopupProps {
  /** заголовок (уже переведённый) */
  title: ReactNode
  onClose: () => void
  /** широкая кнопка снизу (tweb popup-footer button) */
  action?: { label: string; onClick: () => void }
  /** ширина карточки, по умолчанию 420 */
  width?: number
  children: ReactNode
}

export default function Popup({ title, onClose, action, width = 420, children }: PopupProps) {
  return createPortal(
    <>
      <div className={s.scrim} onClick={onClose} />
      <motion.div
        className={s.card}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className={s.header}>
          <IconButton size="small" onClick={onClose} color="var(--tg-textSecondary)">
            <TgIcon name="close" size={22} />
          </IconButton>
          <Text size={19} weight={600} color="var(--tg-textPrimary)">{title}</Text>
        </div>
        <div className={s.body}>{children}</div>
        {action && (
          <div className={s.action} onClick={action.onClick}>
            {action.label}
          </div>
        )}
      </motion.div>
    </>,
    document.body,
  )
}
