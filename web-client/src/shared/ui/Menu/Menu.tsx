import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'
import classNames from '../../lib/classNames'
import { usePortalContainer } from '../../../core/pip'
import { useNavLayer } from '../../../core/hooks/useNavLayer'
import s from './Menu.module.scss'

/** Угол, из которого «растёт» панель. В tweb это класс на `.btn-menu`
 *  (`_button.scss:240-277`), который выставляет `--transform-origin-x/y`;
 *  инлайновый `transform-origin` для того же — отсебятина. */
export type MenuCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center-left' | 'center-right'

/** Класс-угол из CSS `transform-origin`, для мест, где угол вычисляется в
 *  рантайме (флип у края экрана), а не задаётся статически. Соответствие —
 *  `_button.scss:228-262` (инверсия: там класс задаёт origin, здесь по origin
 *  находим класс):
 *   top left     → bottom-right
 *   top right    → bottom-left
 *   bottom left  → top-right
 *   bottom right → top-left */
export function cornerFrom(originY: 'top' | 'bottom', originX: 'left' | 'right'): MenuCorner {
  if (originY === 'top') return originX === 'left' ? 'bottom-right' : 'bottom-left'
  return originX === 'left' ? 'top-right' : 'top-left'
}

interface MenuProps {
  open: boolean
  onClose: () => void
  /** called after the close animation finishes (unmount the owner here) */
  onExitComplete?: () => void
  /** угол роста панели — класс tweb вместо инлайнового transform-origin */
  corner?: MenuCorner
  /** position (fixed-координаты якоря) */
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
// `.btn-menu-toggle`-хоста, и класс-угол там делает две вещи разом — задаёт
// `--transform-origin-*` И раскладывает панель (`inset-block: 100% auto`).
// У нас панель уезжает в портал с fixed-координатами от вызывающего, поэтому
// от класса-угла остаётся только точка роста: инлайновые top/left/right/bottom
// перебивают inset-правила класса по специфичности. Отсюда требование к
// вызывающему — задавать координаты ПОЛНОСТЬЮ (обе оси), иначе недостающую
// сторону подставит `inset` класса. Порт positionMenu() — отдельная задача.
export default function Menu({ open, onClose, onExitComplete, corner, style, className, zIndex, children }: MenuProps) {
  const container = usePortalContainer()

  // Открытое меню — ВЕРХНЯЯ запись навигации: Esc и Back обязаны закрыть его, а
  // не то, что под ним. Тип `'menu'` — как в оригинале
  // (`overlayClickHandler.ts:74-81` + `contextMenuController.ts:19`), и это
  // ОДНА запись на обе кнопки: `onKeyDown` контроллера снимает ту же верхнюю,
  // что и popstate (`appNavigationController.ts:217-224`). Раньше здесь стояла
  // вторая регистрация через `core/hotkeys.pushEsc` — контроллера не было, и
  // клавиша с Back'ом жили в разных стеках (#108).
  //
  // Без записи Esc проваливался мимо меню и закрывал ЧАТ ПОД ним: меню
  // оставалось висеть вместе со своим бэкдропом на весь экран (z-index 2000),
  // то есть приложение переставало принимать клики.
  useNavLayer(open, onClose, 'menu')

  const panelRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(open)
  const exitRef = useRef(onExitComplete)
  exitRef.current = onExitComplete

  // `.active` вешаем НА КАДР ПОЗЖЕ появления узла. У tweb меню всегда в DOM,
  // поэтому переход запускается сам; у нас владелец нередко создаёт <Menu>
  // уже открытым — узел рождается сразу с `.active`, браузеру не от чего
  // анимировать, и меню «выскакивает» рывком.
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!open) { setActive(false); return }
    const id = requestAnimationFrame(() => setActive(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  // tweb вешает `active` и `was-open` ВМЕСТЕ (contextMenuController.ts:140,171)
  // и `was-open` больше никогда не снимает. На мобиле (_button.scss:215) он
  // оставляет панель в scale3d(1,1,1) при закрытии — уходят только opacity и
  // visibility, зума наружу нет. До первого открытия класса нет, поэтому вход
  // по-прежнему играет от scale(.8).
  const everActive = useRef(false)
  if (active) everActive.current = true

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
    // Конец ловим и по переходу самой панели, и по переходу её анимируемого
    // ребёнка. Контекстное меню (`has-items-wrapper`) гасит переход у панели
    // — `transition: unset !important` (_button.scss:149) — и анимирует
    // ВНУТРЕННИЕ обёртки `.btn-menu-transition`; без второй ветки такой попап
    // доживал до фолбэк-таймера, то есть размонтировался с задержкой.
    const onEnd = (e: TransitionEvent) => {
      const t = e.target
      if (t === el || (t instanceof HTMLElement && t.classList.contains('btn-menu-transition'))) finish()
    }
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
        className={classNames('btn-menu', corner ?? '', active ? 'active' : '', everActive.current ? 'was-open' : '', className ?? '')}
        style={{ position: 'fixed', zIndex: zIndex != null ? zIndex + 1 : 2001, ...style }}
      >
        {children}
      </div>
    </>,
    container,
  )
}
