import { create } from 'zustand'
import type { OpenPeer } from '../data'
import type { ThreadInfo } from '../components/ConversationView'
import type { TopicRow } from '../core/managers/groupsManager'
import { useChatsStore } from './chatsStore'

// Навигация мессенджера (де-факто роутер): какой чат/тред/черновик открыт.
// Единый источник истины вместо useState+ref-зеркал в App — хоткеи, SW-хендлер
// и deep-links читают getState() напрямую. Здесь только чистое состояние и
// действия, не требующие managers; орхестрация с сетью (openPeer/onChatCreated/
// openPublicChannel) живёт в useChatNavigation.

export interface OpenThread {
  chatId: number
  thread: ThreadInfo
}

interface NavState {
  /** id выбранного чата ("123", "draft:<peerId>" или null) */
  selectedId: string | null
  /** открытый тред (форум-топик / комментарии поста) поверх колонки чата */
  openThread: OpenThread | null
  /** peer, с которым открыт черновик-чат (нет диалога, пока не отправлено) */
  draftPeer: OpenPeer | null

  /** Выбрать чат: закрывает черновик и тред (tweb setPeer). */
  selectChat: (id: string | null) => void
  setSelectedId: (id: string | null) => void
  setDraftPeer: (peer: OpenPeer | null) => void
  /** Открыть тему форума в колонке чата (форум подсвечен в списке). */
  openTopicThread: (chatId: number, topic: TopicRow) => void
  /** Открыть ветку комментариев под постом канала. */
  openCommentsThread: (args: { chatId: number; rootMsgId: number; title: string; subtitle?: string }) => void
  /** Закрыть тред: топик — очистить выбор (панель тем осталась слева),
   *  комментарии — назад к каналу (selectedId не трогаем). */
  closeThread: () => void
}

export const useNavigationStore = create<NavState>((set) => ({
  selectedId: null,
  openThread: null,
  draftPeer: null,

  selectChat: (id) => set({ selectedId: id, draftPeer: null, openThread: null }),
  setSelectedId: (id) => set({ selectedId: id }),
  setDraftPeer: (peer) => set({ draftPeer: peer }),

  openTopicThread: (chatId, topic) => {
    const group = useChatsStore.getState().dialogs.find((d) => d.chatId === chatId)
    set({
      openThread: {
        chatId,
        thread: {
          rootMsgId: topic.rootMsgId, title: topic.title, subtitle: group?.title,
          iconColor: topic.iconColor, closed: topic.closed, topicId: topic.id, kind: 'topic',
        },
      },
      selectedId: String(chatId),
      draftPeer: null,
    })
  },

  openCommentsThread: (args) =>
    set({
      openThread: {
        chatId: args.chatId,
        thread: { rootMsgId: args.rootMsgId, title: args.title, subtitle: args.subtitle, kind: 'comments' },
      },
    }),

  closeThread: () =>
    set((s) => (s.openThread?.thread.kind === 'topic'
      ? { openThread: null, selectedId: null }
      : { openThread: null })),
}))
