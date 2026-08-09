// src/stores/searchStore.ts
// In-chat search UI state (топбар-серч открыт + видна ли строка тегов-реакций), per
// chat. Владелец поиска — TopbarSearch (tweb components/chat/topbarSearch.tsx);
// сюда вынесено ровно то, что нужно ДРУГИМ узлам: пин-бар и sticky-дата смотрят на
// `open`, колонка чата вешает `.chat.is-search-active` по `reactionsShown`
// (tweb chat.ts:795 onActive). Сам запрос живёт в компоненте, как в tweb.
import { create } from 'zustand'

interface ChatSearch {
  open: boolean
  /** tweb topbarSearch shouldShowReactions() → chat.ts onActive → `.is-search-active` */
  reactionsShown: boolean
}

// Кросс-чат ответ (tweb ReplyToAnotherChat): выбран целевой чат → ждём его
// открытия, Chat ставит reply-плашку с исходным чатом + снимком.
export interface PendingReply {
  targetChatId: number
  sourceChatId: number
  msgId: number
  name: string
  text: string
  color: string
}

// Пересылка (tweb initMessagesForward): выбран один целевой чат → ждём его
// открытия, Chat ставит плашку форварда в композере (превью +
// меню show/hide sender/caption). Финализация — по нажатию «Отправить».
export interface PendingForward {
  targetChatId: number
  sourceChatId: number
  msgIds: number[]
  /** число пересылаемых сообщений — для заголовка «Переслать N сообщений». */
  count: number
  /** превью-подпод плашки: «Отправитель: текст» или «Переслано из: имена». */
  text: string
  /** среди сообщений есть медиа с подписью → доступен пункт show/hide caption. */
  hasCaption: boolean
}

interface SearchState {
  byChat: Record<number, ChatSearch>
  /** результат сайдбар-поиска ждёт открытия чата → Chat прыгает к seq */
  pendingJump: { chatId: number; seq: number } | null
  /** «Ответить в другом чате» ждёт открытия целевого чата → ставится reply-плашка */
  pendingReply: PendingReply | null
  /** пересылка в один чат ждёт открытия целевого чата → ставится плашка форварда */
  pendingForward: PendingForward | null
  setOpen: (chatId: number, open: boolean) => void
  setReactionsShown: (chatId: number, shown: boolean) => void
  setPendingJump: (chatId: number, seq: number) => void
  clearPendingJump: () => void
  setPendingReply: (r: PendingReply) => void
  clearPendingReply: () => void
  setPendingForward: (f: PendingForward) => void
  clearPendingForward: () => void
}

const EMPTY: ChatSearch = { open: false, reactionsShown: false }

export const useSearchStore = create<SearchState>((set) => ({
  byChat: {},
  pendingJump: null,
  pendingReply: null,
  pendingForward: null,
  setOpen: (chatId, open) => set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...(s.byChat[chatId] ?? EMPTY), open, ...(open ? null : { reactionsShown: false }) } } })),
  setReactionsShown: (chatId, reactionsShown) =>
    set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...(s.byChat[chatId] ?? EMPTY), reactionsShown } } })),
  setPendingJump: (chatId, seq) => set({ pendingJump: { chatId, seq } }),
  clearPendingJump: () => set({ pendingJump: null }),
  setPendingReply: (r) => set({ pendingReply: r }),
  clearPendingReply: () => set({ pendingReply: null }),
  setPendingForward: (f) => set({ pendingForward: f }),
  clearPendingForward: () => set({ pendingForward: null }),
}))
