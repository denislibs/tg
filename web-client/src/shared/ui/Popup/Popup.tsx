// Popup — центрированная модалка на механизме tweb 1:1 (popups/_popup.scss):
//   div.popup[.active] > div.popup-container > .popup-header(.popup-close +
//   .popup-title) + .popup-body
// Показ/скрытие делает КЛАСС `.active`: у `.popup` анимируются opacity и
// visibility (с задержкой visibility на закрытии), у `.popup-container` —
// transform translate3d(x, 3rem, 0) → translate3d(x, 0, 0), всё за
// --popup-transition-time/--popup-transition-function. framer-motion не нужен.
//
// Владелец держит компонент смонтированным и управляет `open`; размонтировать
// можно в onExitComplete (он вызывается после окончания перехода).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import classNames from '../../lib/classNames'
import IconButton from '../IconButton'
import TgIcon from '../../../components/TgIcon'
import { usePortalContainer } from '../../../core/pip'
import { useNavLayer } from '../../../core/hooks/useNavLayer'
import s from './Popup.module.scss'

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
  const container = usePortalContainer()
  useNavLayer(open, onClose) // браузерный/аппаратный Back закрывает попап

  const rootRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(open)
  const exitRef = useRef(onExitComplete)
  exitRef.current = onExitComplete

  // `.active` — кадром позже появления узла, иначе анимировать не от чего
  // (владелец обычно монтирует Popup уже открытым).
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!open) { setActive(false); return }
    const id = requestAnimationFrame(() => setActive(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  // Конец закрытия — по transitionend корня; таймерный фолбэк на случай
  // animation-level-0, где перехода нет.
  useEffect(() => {
    const justClosed = wasOpen.current && !open
    wasOpen.current = open
    if (!justClosed) return
    const el = rootRef.current
    let done = false
    const finish = () => {
      if (done) return
      done = true
      el?.removeEventListener('transitionend', onEnd)
      exitRef.current?.()
    }
    const onEnd = (e: TransitionEvent) => { if (e.target === el) finish() }
    el?.addEventListener('transitionend', onEnd)
    const timer = window.setTimeout(finish, 300)
    return () => {
      window.clearTimeout(timer)
      el?.removeEventListener('transitionend', onEnd)
    }
  }, [open])

  return createPortal(
    <div
      ref={rootRef}
      className={classNames('popup', active ? 'active' : '', s.popup)}
      onClick={onClose}
      style={{ ['--popup-width' as string]: `min(${width}px, calc(100vw - 32px))` }}
    >
      <div className={classNames('popup-container', s.container)} onClick={(e) => e.stopPropagation()}>
        <div className="popup-header">
          <IconButton className="popup-close" onClick={onClose} color="var(--secondary-text-color)">
            <TgIcon name="close" size={22} />
          </IconButton>
          <div className="popup-title">{title}</div>
          {headerRight}
        </div>
        <div className={s.body}>{children}</div>
        {footer}
        {action && (
          <div className={s.action} onClick={action.onClick}>
            {action.label}
          </div>
        )}
      </div>
    </div>,
    container,
  )
}
