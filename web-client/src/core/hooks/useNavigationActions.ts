// Действия навигации, которым нужны managers (открыть/создать приватный чат,
// вступить в публичный канал, субтитр темы). Чистые useCallback БЕЗ эффектов —
// поэтому хук безопасно звать в любом View (Sidebar/Chat), а не только
// в Shell. Состояние навигации при этом читается из navigationStore напрямую.
import { useCallback } from 'react'
import type { TopicRow } from '../managers/groupsManager'
import type { OpenPeer } from '../../data'
import { useManagers } from './useManagers'
import { useChatsStore, loadChats, loadPresence } from '../../stores/chatsStore'
import { useNavigationStore } from '../../stores/navigationStore'

export function useNavigationActions() {
  const managers = useManagers()
  const openTopicThreadRaw = useNavigationStore((s) => s.openTopicThread)

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

  return { openTopicThread, openPeer, onChatCreated, openPublicChannel }
}
