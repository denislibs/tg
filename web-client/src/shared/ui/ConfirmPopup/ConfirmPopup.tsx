// ConfirmPopup — порт tweb PopupPeer (src/components/popups/peer.ts + index.ts
// setButtons + scss/partials/popups/_popup.scss/_peer.scss): компактный конфирм
// со скримом rgba(0,0,0,.3), карточкой 19.5–25rem (radius 2.5rem), хедером
// [avatar? + title], описанием, опц. чекбоксами и рядом текстовых UPPERCASE-кнопок
// (flex row-reverse; ≥3 — колонкой). Cancel добавляется автоматически последним
// (tweb addCancelButton). Esc закрывает, Enter кликает первую не-cancel кнопку
// (tweb btnConfirmOnEnter).
//
// Показ/скрытие — КЛАССЫ, как у tweb PopupElement (popups/index.ts:359 `show()`
// вешает `active` после reflow; popups/index.ts:420-421 `destroy()` вешает
// `hiding` и снимает `active`, узел удаляется по таймауту). Правила — в
// портированном `styles/tweb/popups/_popup.scss`: у `.popup` анимируются
// opacity+visibility, у `.popup-container` — translate3d(x, 3rem, 0) → 0.
// Важно: `.hiding` ОСТАВЛЯЕТ карточку на месте (_popup.scss:65-69) — на закрытии
// гаснет только скрим, вниз карточка не уезжает. framer-motion не нужен.
//
// Два режима владения:
//  • uncontrolled (open не передан): монтируется открытым; клик по кнопке/скриму/Esc
//    запускает exit-анимацию, а колбэк кнопки (или onClose при отмене) вызывается
//    из onExitComplete — владелец размонтирует компонент в этом колбэке.
//  • controlled (open передан): колбэк кнопки выполняется сразу, затем onClose();
//    владелец сам гасит open и размонтирует в onExitComplete.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Checkbox from '../Checkbox'
import { useRipple } from '../Ripple/useRipple'
import classNames from '../../lib/classNames'
import { usePortalContainer } from '../../../core/pip'
import { useNavLayer } from '../../../core/hooks/useNavLayer'
import { useT } from '../../../i18n'
import s from './ConfirmPopup.module.scss'

export interface ConfirmPopupButton {
  text: string
  danger?: boolean
  primary?: boolean
  /** checked — состояния чекбоксов в порядке props.checkboxes (tweb callback(e, checkboxes)) */
  onClick: (checked: boolean[]) => void
}

export interface ConfirmPopupProps {
  /** controlled-режим; не передан — попап монтируется открытым и закрывается сам */
  open?: boolean
  title?: ReactNode
  description?: ReactNode
  /** узел 32px слева от заголовка (tweb avatarNew size 32 в header.prepend) */
  avatar?: ReactNode
  checkboxes?: { text: ReactNode; checked?: boolean }[]
  /** Cancel добавляется автоматически последним (tweb addCancelButton) */
  buttons: ConfirmPopupButton[]
  onClose: () => void
  onExitComplete?: () => void
  /** произвольное тело между описанием и кнопками (радио-строки MutePopup и т.п.) */
  children?: ReactNode
}

// Текстовая кнопка конфирма (tweb .popup-button btn primary/danger) с ripple.
function ConfirmButton({ text, danger, onClick }: { text: string; danger?: boolean; onClick: () => void }) {
  const { onPointerDown, ripple } = useRipple()
  return (
    <button
      type="button"
      className={classNames('rp', 'rp-overflow', s.button, danger ? s.danger : '')}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {ripple}
      {text}
    </button>
  )
}

// Строка чекбокса (tweb .checkbox-field в .popup-peer: min-height 3rem, ripple).
function CheckboxRow({ text, checked, onToggle }: { text: ReactNode; checked: boolean; onToggle: () => void }) {
  const { onPointerDown, ripple } = useRipple()
  return (
    <div
      className={classNames('rp', 'rp-overflow', s.checkboxRow)}
      role="checkbox"
      aria-checked={checked}
      onPointerDown={onPointerDown}
      onClick={onToggle}
    >
      {ripple}
      <Checkbox checked={checked} shape="square" size={20} />
      <span className={s.checkboxText}>{text}</span>
    </div>
  )
}

export default function ConfirmPopup({
  open: openProp, title, description, avatar, checkboxes, buttons, onClose, onExitComplete, children,
}: ConfirmPopupProps) {
  const t = useT()
  const container = usePortalContainer()
  const controlled = openProp !== undefined
  const [innerOpen, setInnerOpen] = useState(true)
  const open = controlled ? openProp : innerOpen
  const rootRef = useRef<HTMLDivElement>(null)
  // uncontrolled: действие кнопки откладывается до конца exit-анимации
  // (владелец размонтирует попап из этого колбэка — анимация успевает доиграть).
  const pendingRef = useRef<(() => void) | null>(null)

  const [checked, setChecked] = useState<boolean[]>(() => (checkboxes ?? []).map((c) => !!c.checked))

  // закрытие без действия (скрим/Esc/Cancel)
  const dismiss = () => {
    if (controlled) onClose()
    else { pendingRef.current = null; setInnerOpen(false) }
  }
  // клик по контентной кнопке
  const activate = (b: ConfirmPopupButton) => {
    const states = [...checked]
    if (controlled) { b.onClick(states); onClose() }
    else { pendingRef.current = () => b.onClick(states); setInnerOpen(false) }
  }
  const handleExit = () => {
    onExitComplete?.()
    if (!controlled) {
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending) pending(); else onClose()
    }
  }

  useNavLayer(open, dismiss) // браузерный/аппаратный Back закрывает попап

  // Esc — закрыть; Enter — не-cancel кнопка, но только когда всего две кнопки
  // с учётом авто-Cancel (tweb setButtons: btnConfirmOnEnter при buttons.length === 2).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); dismiss() }
      else if (e.key === 'Enter' && buttons.length === 1) { e.stopPropagation(); activate(buttons[0]) }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  })

  // `.active` — кадром позже появления узла: tweb перед добавлением класса делает
  // reflow (`void this.element.offsetWidth`, popups/index.ts:357), иначе браузеру
  // нечего анимировать. Попап обычно монтируется уже открытым.
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!open) { setActive(false); return }
    const id = requestAnimationFrame(() => setActive(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  // `hiding` вешается только на реально открывавшийся попап (tweb ставит его в
  // destroy(), т.е. после show()).
  const openedRef = useRef(false)
  if (open) openedRef.current = true
  const hiding = !open && openedRef.current

  // Конец закрытия — по transitionend корня (opacity скрима); таймерный фолбэк
  // на случай animation-level-0, где перехода нет и события не будет.
  const wasOpen = useRef(open)
  const exitRef = useRef(handleExit)
  exitRef.current = handleExit
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
      exitRef.current()
    }
    const onEnd = (e: TransitionEvent) => { if (e.target === el) finish() }
    el?.addEventListener('transitionend', onEnd)
    const timer = window.setTimeout(finish, 300)
    return () => {
      window.clearTimeout(timer)
      el?.removeEventListener('transitionend', onEnd)
    }
  }, [open])

  const vertical = buttons.length + 1 >= 3 // + авто-Cancel (tweb is-vertical-layout при ≥3)

  return createPortal(
    <div
      ref={rootRef}
      className={classNames('popup', open && active ? 'active' : hiding ? 'hiding' : '', s.popup)}
      onClick={dismiss}
    >
      <div className={classNames('popup-container', s.card)} onClick={(e) => e.stopPropagation()}>
        {(title != null || avatar != null) && (
          <div className={s.header}>
            {avatar}
            <div className={s.title}>{title}</div>
          </div>
        )}
        {description != null && <p className={s.description}>{description}</p>}
        {(checkboxes ?? []).map((c, i) => (
          <CheckboxRow
            key={i}
            text={c.text}
            checked={checked[i]}
            onToggle={() => setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)))}
          />
        ))}
        {children}
        <div className={classNames(s.buttons, vertical ? s.vertical : '')}>
          {buttons.map((b, i) => (
            <ConfirmButton key={i} text={b.text} danger={b.danger} onClick={() => activate(b)} />
          ))}
          <ConfirmButton text={t('Cancel')} onClick={dismiss} />
        </div>
      </div>
    </div>,
    container,
  )
}
