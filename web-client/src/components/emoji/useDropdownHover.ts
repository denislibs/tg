// Hover-открытие эмодзи-дропдауна (tweb DropdownHover.attachButtonListener).
// Вынесено из EmojiDropdown.tsx отдельным модулем: сам дропдаун грузится лениво
// (React.lazy), а этот хук вызывается в Composer безусловно — держим его в
// главном чанке, чтобы ленивый импорт не тянул весь пикер обратно.
//
// Кнопка: mouseenter → таймер 200 мс → open; mouseleave → таймер 200 мс → close.
// Панель: mouseenter отменяет закрытие, mouseleave снова взводит. Клик — toggle.
// Touch: только клик. Клик вне панели/кнопки закрывает (кроме ignore-целей).
import { useCallback, useEffect, useRef, useState } from 'react'

// tweb DropdownHover: TOGGLE_TIMEOUT = 200 (hover open/close).
const TOGGLE_TIMEOUT = 200
const IS_TOUCH = typeof window !== 'undefined' && 'ontouchstart' in window

export function useDropdownHover(ignore?: (target: Node) => boolean) {
  const [open, setOpen] = useState(false)
  const openTimer = useRef(0)
  const closeTimer = useRef(0)
  const buttonRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const ignoreRef = useRef(ignore)
  ignoreRef.current = ignore

  const clearTimers = useCallback(() => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }, [])
  const close = useCallback(() => {
    clearTimers()
    setOpen(false)
  }, [clearTimers])

  // out-click (tweb onButtonClick → window click listener)
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t) || panelRef.current?.contains(t)) return
      if (ignoreRef.current?.(t)) return
      close()
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open, close])

  const buttonProps = {
    onMouseEnter: () => {
      if (IS_TOUCH) return
      window.clearTimeout(closeTimer.current)
      window.clearTimeout(openTimer.current)
      openTimer.current = window.setTimeout(() => setOpen(true), TOGGLE_TIMEOUT)
    },
    onMouseLeave: () => {
      if (IS_TOUCH) return
      window.clearTimeout(openTimer.current)
      window.clearTimeout(closeTimer.current)
      closeTimer.current = window.setTimeout(() => setOpen(false), TOGGLE_TIMEOUT)
    },
    onClick: () => {
      clearTimers()
      setOpen((o) => !o)
    },
  }
  const panelProps = {
    onMouseEnter: () => window.clearTimeout(closeTimer.current),
    onMouseLeave: () => {
      if (IS_TOUCH) return
      window.clearTimeout(closeTimer.current)
      closeTimer.current = window.setTimeout(() => setOpen(false), TOGGLE_TIMEOUT)
    },
  }

  useEffect(() => clearTimers, [clearTimers])

  return { open, close, buttonRef, panelRef, buttonProps, panelProps }
}
