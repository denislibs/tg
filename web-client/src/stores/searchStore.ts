// src/stores/searchStore.ts
// In-chat search UI state (panel open + query), per chat. ChatHeader owns the search
// (drives this store via useChatSearch); other parts that only need to know whether
// search is open — the pinned bar and the sticky-date offset — read it here, so the
// `open` flag has a single source of truth and isn't drilled through props.
import { create } from 'zustand'

interface ChatSearch {
  open: boolean
  query: string
}

// Кросс-чат ответ (tweb ReplyToAnotherChat): выбран целевой чат → ждём его
// открытия, ConversationView ставит reply-плашку с исходным чатом + снимком.
export interface PendingReply {
  targetChatId: number
  sourceChatId: number
  msgId: number
  name: string
  text: string
  color: string
}

// Пересылка (tweb initMessagesForward): выбран один целевой чат → ждём его
// открытия, ConversationView ставит плашку форварда в композере (превью +
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
  /** результат сайдбар-поиска ждёт открытия чата → ConversationView прыгает к seq */
  pendingJump: { chatId: number; seq: number } | null
  /** «Ответить в другом чате» ждёт открытия целевого чата → ставится reply-плашка */
  pendingReply: PendingReply | null
  /** пересылка в один чат ждёт открытия целевого чата → ставится плашка форварда */
  pendingForward: PendingForward | null
  setOpen: (chatId: number, open: boolean) => void
  setQuery: (chatId: number, query: string) => void
  reset: (chatId: number) => void
  setPendingJump: (chatId: number, seq: number) => void
  clearPendingJump: () => void
  setPendingReply: (r: PendingReply) => void
  clearPendingReply: () => void
  setPendingForward: (f: PendingForward) => void
  clearPendingForward: () => void
}

const EMPTY: ChatSearch = { open: false, query: '' }

export const useSearchStore = create<SearchState>((set) => ({
  byChat: {},
  pendingJump: null,
  pendingReply: null,
  pendingForward: null,
  setOpen: (chatId, open) => set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...(s.byChat[chatId] ?? EMPTY), open } } })),
  setQuery: (chatId, query) => set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...(s.byChat[chatId] ?? EMPTY), query } } })),
  reset: (chatId) => set((s) => ({ byChat: { ...s.byChat, [chatId]: EMPTY } })),
  setPendingJump: (chatId, seq) => set({ pendingJump: { chatId, seq } }),
  clearPendingJump: () => set({ pendingJump: null }),
  setPendingReply: (r) => set({ pendingReply: r }),
  clearPendingReply: () => set({ pendingReply: null }),
  setPendingForward: (f) => set({ pendingForward: f }),
  clearPendingForward: () => set({ pendingForward: null }),
}))
