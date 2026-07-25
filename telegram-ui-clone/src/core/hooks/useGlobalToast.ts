// Глобальный транзиентный тост (лимит закреплённых, deep-link баннеры и т.п.).
// Один источник: подписка на uiEvents('ui:toast') + императивный showToast для
// прямых вызовов (deep-links). Авто-скрытие через 4с.
import { useCallback, useEffect, useRef, useState } from 'react'
import { uiEvents } from './uiEvents'

export interface GlobalToast {
  toast: string | null
  showToast: (text: string) => void
}

export function useGlobalToast(): GlobalToast {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((text: string) => {
    setToast(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(() => {
    const off = uiEvents.on('ui:toast', (p) => showToast(String(p)))
    return () => {
      off()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [showToast])

  return { toast, showToast }
}
