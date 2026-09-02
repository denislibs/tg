// Popup — центрированная модалка на механизме tweb 1:1 (popups/_popup.scss):
//   div.popup[.<модификатор>][.active] > div.popup-container.z-depth-1 >
//     .popup-header(.popup-close + .popup-title) + .popup-body +
//     .popup-footer.popup-footer-abitlarger > button.popup-footer-button
//   (popups/index.ts:121-231 — классы контейнера/тела/футера,
//    popups/indexTsx.tsx:447-520 — Body/Footer/FooterButton)
// Показ/скрытие делают КЛАССЫ `.active` (tweb popups/index.ts:359 `show()`) и
// `.hiding` (tweb popups/index.ts:420-421 `destroy()` вешает `hiding` и снимает
// `active`): у `.popup` анимируются opacity и visibility (с задержкой visibility
// на закрытии), у `.popup-container` — transform translate3d(x, 3rem, 0) →
// translate3d(x, 0, 0), всё за --popup-transition-time/--popup-transition-function.
// `.hiding` ОСТАВЛЯЕТ карточку на месте (_popup.scss:65-69) — на закрытии гаснет
// только скрим, вниз карточка не уезжает. framer-motion не нужен.
//
// Владелец держит компонент смонтированным и управляет `open`; размонтировать
// можно в onExitComplete (он вызывается после окончания перехода).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode, RefObject } from 'react'
import classNames from '../../lib/classNames'
import IconButton from '../IconButton'
import { useRipple } from '../Ripple/useRipple'
import TgIcon from '../../../components/TgIcon'
import { usePortalContainer } from '../../../core/pip'
import { useNavLayer } from '../../../core/hooks/useNavLayer'
import s from './Popup.module.scss'

interface PopupProps {
  open: boolean
  /** заголовок (уже переведённый) */
  title: ReactNode
  /**
   * Модификатор попапа — первый аргумент конструктора tweb PopupElement
   * (popups/index.ts:122 `element.className = 'popup' + ' ' + className`):
   * `popup-forward`, `popup-schedule popup-date-picker` и т.п.
   */
  className?: string
  onClose: () => void
  /** exit-анимация закончилась — можно размонтировать владельцу */
  onExitComplete?: () => void
  /** правый слот хедера (например, кнопка «⋮») */
  headerRight?: ReactNode
  /** прибитый низ карточки (например, строка подписи + send) */
  footer?: ReactNode
  /** широкая кнопка снизу (tweb PopupElement.Footer + FooterButton) */
  action?: { label: string; onClick: () => void }
  /**
   * tweb PopupOptions.body (popups/index.ts:207-211): тело-обёртка `.popup-body`.
   * `false` — дети ложатся прямо в `.popup-container`, как у попапа календаря,
   * где роль тела играет сам `.popup-scrollable` (datePicker.tsx:811).
   */
  body?: boolean
  /** доп. класс(ы) на `.popup-body` — например `is-loading` (tweb popups/_stickers.scss) */
  bodyClassName?: string
  /** ref на `.popup-body` — скроллер карточки; корень IntersectionObserver ленивых сеток */
  bodyRef?: RefObject<HTMLDivElement | null>
  /** ширина карточки, по умолчанию 420 */
  width?: number
  children: ReactNode
}

/**
 * Широкая кнопка футера — tweb PopupElement.FooterButton (popups/indexTsx.tsx:501-517):
 * `popup-footer-button btn-primary btn-color-primary` + ripple (дамп
 * `17-popup-06-date-picker.json`, `17-popup-01-forward-share.json`).
 */
export function PopupFooterButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { onPointerDown, ripple } = useRipple()
  return (
    <button
      type="button"
      className="popup-footer-button btn-primary btn-color-primary rp"
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {ripple}
      {label}
    </button>
  )
}

export default function Popup({
  open, title, className, onClose, onExitComplete, headerRight, footer, action, body = true, bodyClassName, bodyRef, width = 420, children,
}: PopupProps) {
  const container = usePortalContainer()
  // ОДНА запись навигации на обе кнопки: и браузерный/аппаратный Back, и Escape
  // закрывают верхний попап. Раньше здесь стояла ВТОРАЯ регистрация — свой
  // Esc-обработчик через `core/hotkeys.pushEsc`, потому что контроллера
  // навигации у нас не было и Back с клавишей жили в разных стеках. Контроллер
  // портирован (#108), и `onKeyDown` снимает ту же самую верхнюю запись
  // (`appNavigationController.ts:217-224`), что и popstate.
  useNavLayer(open, onClose, 'popup')

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

  // `hiding` вешается только на реально открывавшийся попап (tweb ставит его в
  // destroy(), т.е. всегда после show()).
  const openedRef = useRef(false)
  if (open) openedRef.current = true
  const hiding = !open && openedRef.current

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
      className={classNames('popup', className ?? '', open && active ? 'active' : hiding ? 'hiding' : '', s.popup)}
      onClick={onClose}
      style={{ ['--popup-width' as string]: `min(${width}px, calc(100vw - 32px))` }}
    >
      <div className={classNames('popup-container', 'z-depth-1', s.container)} onClick={(e) => e.stopPropagation()}>
        <div className="popup-header">
          <IconButton className="popup-close" onClick={onClose} color="var(--secondary-text-color)">
            <TgIcon name="close" size={22} />
          </IconButton>
          <div className="popup-title">{title}</div>
          {headerRight}
        </div>
        {body ? <div ref={bodyRef} className={classNames('popup-body', s.body, bodyClassName ?? '')}>{children}</div> : children}
        {footer}
        {action && (
          <div className="popup-footer popup-footer-abitlarger">
            <PopupFooterButton label={action.label} onClick={action.onClick} />
          </div>
        )}
      </div>
    </div>,
    container,
  )
}
