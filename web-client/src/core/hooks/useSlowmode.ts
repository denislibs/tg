// Таймер медленного режима для композера (tweb slowmode countdown). Обычный
// участник группы со slowmode после отправки блокируется на N секунд — хук
// держит дедлайн и тикает раз в секунду, отдавая оставшиеся секунды. Админов/
// создателя ограничение не касается (exempt), как на бэке.
import { useCallback, useEffect, useRef, useState } from 'react'

export function useSlowmode(seconds: number, exempt: boolean): {
  left: number
  markSent: () => void
} {
  const active = seconds > 0 && !exempt
  const [deadline, setDeadline] = useState(0)
  const [left, setLeft] = useState(0)

  const markSent = useCallback(() => {
    if (!active) return
    setDeadline(Date.now() + seconds * 1000)
  }, [active, seconds])

  // сбросить при смене чата/выключении slowmode
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    if (!active) {
      setDeadline(0)
      setLeft(0)
    }
  }, [active])

  useEffect(() => {
    if (deadline === 0) {
      setLeft(0)
      return
    }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setLeft(rem)
      if (rem === 0) setDeadline(0)
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [deadline])

  return { left, markSent }
}
