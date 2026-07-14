import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { CSSProperties, ReactNode } from 'react'
import classNames from '../../lib/classNames'
import s from './Menu.module.scss'

interface MenuProps {
  open: boolean
  onClose: () => void
  /** called after the close animation finishes (unmount the owner here) */
  onExitComplete?: () => void
  /** position + transform-origin (anchor a corner at the click point) */
  style?: CSSProperties
  /** extra panel styling (width, radius override, …) */
  className?: string
  children: ReactNode
}

// Shared menu surface — portal + backdrop + a single open/close animation
// (scale .8 + fade, like tweb .btn-menu) so every dropdown/context menu behaves
// identically. The caller positions it via `style` (top/left or right/bottom +
// transform-origin) so the panel grows from the anchor (e.g. the click corner).
export default function Menu({ open, onClose, onExitComplete, style, className, children }: MenuProps) {
  return createPortal(
    <>
      {open && (
        <div
          className={s.backdrop}
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault()
            onClose()
          }}
        />
      )}
      <AnimatePresence onExitComplete={onExitComplete}>
        {open && (
          <motion.div
            className={classNames(s.panel, className ?? '')}
            style={style}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  )
}
