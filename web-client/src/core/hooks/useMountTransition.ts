// src/core/hooks/useMountTransition.ts
// Роль AnimatePresence на классах tweb: узел живёт в DOM, пока играет
// backwards-анимация. Классы — те же, что у useSetTransition
// (порт `components/singleTransition.ts`).
//
// Семантика взята у tweb `PopupElement` (`components/popups/index.ts:315-346`):
// hide() вешает класс закрытия, а сам узел снимается из DOM только по
// окончании перехода (`onFullScreenChange`/таймаут длиной transition-time).
// useSetTransition этого не умеет — он лишь ведёт классы на живом узле.
import { useEffect, useRef, useState } from 'react'

export function useMountTransition(open: boolean, className: string, duration: number) {
  const [mounted, setMounted] = useState(open)
  const [cls, setCls] = useState(open ? `${className} forwards` : '')
  const first = useRef(true)

  useEffect(() => {
    // первый рендер уже отражён в initial state — без анимации
    if (first.current) {
      first.current = false
      return
    }

    if (open) {
      setMounted(true)
      setCls(`${className} forwards animating`)
      const id = window.setTimeout(() => setCls(`${className} forwards`), duration)
      return () => window.clearTimeout(id)
    }

    setCls(`${className} backwards animating`)
    const id = window.setTimeout(() => {
      setMounted(false)
      setCls('')
    }, duration)
    return () => window.clearTimeout(id)
  }, [open, className, duration])

  return { mounted, cls }
}
