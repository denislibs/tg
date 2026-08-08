import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'
import classNames from '../../lib/classNames'
import { usePortalContainer } from '../../../core/pip'
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
  /** поверх модалок: z бэкдропа (панель — z+1); по умолчанию из CSS (2000/2001) */
  zIndex?: number
  children: ReactNode
}

// Плашка меню — механизм tweb 1:1 (_button.scss:98-212): панель ВСЕГДА в DOM,
// показ/скрытие — только классом `.active`, который переключает
// visibility/opacity/transform: scale(.8)→scale3d(1,1,1) по CSS-переходу
// `--btn-menu-transition`. Никакого JS-анимирования (framer-motion убран).
//
// Отступление: позиционирование. tweb держит меню абсолютом внутри
// `.btn-menu-toggle`-хоста и выбирает угол классом (`bottom-left` и т.п.);
// у нас вызывающий передаёт готовые fixed-координаты точки клика, поэтому
// панель живёт в портале. Порт positionMenu() — отдельная задача.
export default function Menu({ open, onClose, onExitComplete, style, className, zIndex, children }: MenuProps) {
  const container = usePortalContainer()
  const panelRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(open)
  const exitRef = useRef(onExitComplete)
  exitRef.current = onExitComplete

  // Конец закрытия ловим по transitionend самой панели (как tweb ловит конец
  // своего перехода); фолбэк по таймеру — на случай animation-level-0, где
  // перехода нет вовсе и события не будет.
  useEffect(() => {
    const wasJustClosed = wasOpen.current && !open
    wasOpen.current = open
    if (!wasJustClosed) return

    const el = panelRef.current
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
    <>
      {open && (
        <div
          className={s.backdrop}
          style={zIndex != null ? { zIndex } : undefined}
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault()
            onClose()
          }}
        />
      )}
      <div
        ref={panelRef}
        className={classNames('btn-menu', open ? 'active' : '', s.panel, className ?? '')}
        style={zIndex != null ? { ...style, zIndex: zIndex + 1 } : style}
      >
        {children}
      </div>
    </>,
    container,
  )
}
