// Навигация чатов для Shell: состояние из navigationStore + действия. Действия,
// которым нужны managers, вынесены в useNavigationActions (чистые, зовутся и во
// View напрямую). Здесь остаётся SW-эффект (открытие чата по клику уведомления),
// который должен подписываться ровно один раз — Shell вызывает этот хук единожды.
import { useEffect } from 'react'
import { useNavigationStore } from '../../stores/navigationStore'
import { useNavigationActions } from './useNavigationActions'

export function useChatNavigation() {
  const selectedId = useNavigationStore((s) => s.selectedId)
  const openThread = useNavigationStore((s) => s.openThread)
  const draftPeer = useNavigationStore((s) => s.draftPeer)
  const selectChat = useNavigationStore((s) => s.selectChat)
  const setSelectedId = useNavigationStore((s) => s.setSelectedId)
  const openCommentsThread = useNavigationStore((s) => s.openCommentsThread)
  const closeThread = useNavigationStore((s) => s.closeThread)
  const actions = useNavigationActions()

  // Клик по браузерному уведомлению: sw.js фокусирует вкладку и шлёт
  // {type:'open-chat', chatId} — открываем этот чат.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; chatId?: number } | null
      if (d && d.type === 'open-chat' && d.chatId != null) {
        useNavigationStore.getState().selectChat(String(d.chatId))
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

  return {
    selectedId, openThread, draftPeer,
    selectChat, setSelectedId, openCommentsThread, closeThread,
    ...actions,
  }
}
