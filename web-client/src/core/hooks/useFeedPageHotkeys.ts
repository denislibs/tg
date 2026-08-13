import { useEffect } from 'react'
import { useIsActiveChat } from '../chat/chatInstanceContext'

// Ctrl/Cmd+PageUp / PageDown — к началу / концу истории (tweb). Слушатель висит
// на window, а инстансов чата в стеке смонтировано несколько (неактивные скрыты,
// но живут в DOM) — поэтому эффект обязан быть за гейтом активности, иначе
// нажатие отработает во всех копиях сразу.
interface Args {
  enabled: boolean
  onPageUp: () => void
  onPageDown: () => void
}

export function useFeedPageHotkeys({ enabled, onPageUp, onPageDown }: Args): void {
  const isActive = useIsActiveChat()

  useEffect(() => {
    if (!enabled || !isActive) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      if (e.key === 'PageUp') {
        e.preventDefault()
        onPageUp()
      } else if (e.key === 'PageDown') {
        e.preventDefault()
        onPageDown()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, isActive, onPageUp, onPageDown])
}
