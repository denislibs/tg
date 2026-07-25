// Навигация чатов: состояние из navigationStore + действия, которым нужны
// managers (открыть/создать приватный чат, вступить в публичный канал). Чистые
// действия (selectChat/openThread/closeThread) переэкспортируются из стора,
// чтобы у View был один источник хендлеров.
import { useCallback, useEffect } from 'react'
import type { TopicRow } from '../managers/groupsManager'
import type { OpenPeer } from '../../data'
import { useManagers } from './useManagers'
import { useChatsStore, loadChats, loadPresence } from '../../stores/chatsStore'
import { useNavigationStore } from '../../stores/navigationStore'

export function useChatNavigation() {
  const managers = useManagers()
  const selectedId = useNavigationStore((s) => s.selectedId)
  const openThread = useNavigationStore((s) => s.openThread)
  const draftPeer = useNavigationStore((s) => s.draftPeer)
  const selectChat = useNavigationStore((s) => s.selectChat)
  const setSelectedId = useNavigationStore((s) => s.setSelectedId)
  const openTopicThreadRaw = useNavigationStore((s) => s.openTopicThread)
  const openCommentsThread = useNavigationStore((s) => s.openCommentsThread)
  const closeThread = useNavigationStore((s) => s.closeThread)

  // Субтитр темы (имя группы) готовим здесь, чтобы navigationStore не импортировал
  // chatsStore (развязка единственного кросс-стор импорта).
  const openTopicThread = useCallback((chatId: number, topic: TopicRow) => {
    const subtitle = useChatsStore.getState().dialogs.find((d) => d.chatId === chatId)?.title
    openTopicThreadRaw(chatId, topic, subtitle)
  }, [openTopicThreadRaw])

  // Открыть чат с пользователем (участник, автор в группе, результат поиска).
  // Переиспользует существующий приватный диалог; иначе — черновик, который
  // становится реальным чатом лишь после первого сообщения.
  const openPeer = useCallback((peer: OpenPeer) => {
    const nav = useNavigationStore.getState()
    if (peer.chatId != null) { nav.selectChat(String(peer.chatId)); return }
    const { meId, dialogs } = useChatsStore.getState()
    if (meId != null && peer.id === meId) return // skip self for now
    const existing = dialogs.find((d) => d.type === 'private' && d.peer?.id === peer.id)
    if (existing) { nav.selectChat(String(existing.chatId)); return }
    nav.setDraftPeer(peer)
    nav.setSelectedId(`draft:${peer.id}`)
    void loadPresence(managers, [peer.id])
  }, [managers])

  // Первое сообщение в черновике создало реальный чат: обновить список и открыть.
  const onChatCreated = useCallback((chatId: number) => {
    const nav = useNavigationStore.getState()
    nav.setDraftPeer(null)
    nav.setSelectedId(String(chatId))
    void loadChats(managers)
  }, [managers])

  // Клик по «похожему каналу»: вступаем по @username и открываем.
  const openPublicChannel = useCallback(async (chatId: number, username: string) => {
    if (username) {
      try { await managers.channels.join(username) } catch { /* уже вступил / приватный — просто откроем */ }
    }
    await loadChats(managers)
    useNavigationStore.getState().setSelectedId(String(chatId))
  }, [managers])

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
    selectChat, setSelectedId, openTopicThread, openCommentsThread, closeThread,
    openPeer, onChatCreated, openPublicChannel,
  }
}

