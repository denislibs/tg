// Действия навигации, которым нужны managers (открыть/создать приватный чат,
// вступить в публичный канал, субтитр темы). Чистые useCallback БЕЗ эффектов —
// поэтому хук безопасно звать в любом View (Sidebar/Chat), а не только
// в Shell. Состояние навигации при этом читается из navigationStore напрямую.
import { useCallback } from 'react'
import type { TopicRow } from '../managers/groupsManager'
import type { OpenPeer } from '../../data'
import { useManagers } from './useManagers'
import { useChatsStore, loadPresence } from '../../stores/chatsStore'
import { useNavigationStore } from '../../stores/navigationStore'
import { useChatStackStore } from '../../stores/chatStackStore'

export function useNavigationActions() {
  const managers = useManagers()

  // Форум-топик в tweb остаётся инстансом `chat` с threadId (chat.ts:894) —
  // кладём его поверх стека (tweb setInnerPeer). Субтитр темы (имя группы)
  // готовим здесь, чтобы chatStackStore не импортировал chatsStore.
  const openTopicThread = useCallback((chatId: number, topic: TopicRow) => {
    const subtitle = useChatsStore.getState().dialogs.find((d) => d.chatId === chatId)?.title
    useChatStackStore.getState().setInnerPeer({
      peerId: chatId,
      threadId: topic.rootMsgId,
      type: 'chat',
      thread: {
        rootMsgId: topic.rootMsgId, title: topic.title, subtitle,
        iconColor: topic.iconColor, closed: topic.closed, topicId: topic.id, kind: 'topic',
      },
    })
  }, [])

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
    // selectChat кладёт корневой инстанс в chatStackStore (иначе ChatsContainer
    // ничего не отрендерит — с переездом App.tsx на стек он больше НЕ читает
    // draftPeer/selectedId напрямую), но сам обнуляет draftPeer в своём set() —
    // поэтому setDraftPeer идёт ВТОРЫМ, восстанавливая peer уже после него.
    nav.selectChat(`draft:${peer.id}`)
    nav.setDraftPeer(peer)
    void loadPresence(managers, [peer.id])
  }, [managers])

  // Первое сообщение в черновике создало реальный чат: обновить список и открыть.
  const onChatCreated = useCallback((chatId: number) => {
    // selectChat сам обнуляет draftPeer и переключает chatStackStore на новый
    // peerId реального чата — иначе после первого сообщения колонка осталась бы
    // показывать инстанс черновика (draft-запись стека).
    useNavigationStore.getState().selectChat(String(chatId))
    // `.catch` (Minor #3 финального ревью): fire-and-forget вызов, а refresh()
    // пробрасывает HttpError — без него 401/5xx даёт unhandled rejection.
    void managers.dialogs.refresh().catch(() => {})
  }, [managers])

  // Клик по «похожему каналу»: вступаем по @username и открываем.
  const openPublicChannel = useCallback(async (chatId: number, username: string) => {
    if (username) {
      try { await managers.channels.join(username) } catch { /* уже вступил / приватный — просто откроем */ }
    }
    await managers.dialogs.refresh()
    useNavigationStore.getState().selectChat(String(chatId))
  }, [managers])

  return { openTopicThread, openPeer, onChatCreated, openPublicChannel }
}
