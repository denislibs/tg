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

interface SearchState {
  byChat: Record<number, ChatSearch>
  setOpen: (chatId: number, open: boolean) => void
  setQuery: (chatId: number, query: string) => void
  reset: (chatId: number) => void
}

const EMPTY: ChatSearch = { open: false, query: '' }

export const useSearchStore = create<SearchState>((set) => ({
  byChat: {},
  setOpen: (chatId, open) => set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...(s.byChat[chatId] ?? EMPTY), open } } })),
  setQuery: (chatId, query) => set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...(s.byChat[chatId] ?? EMPTY), query } } })),
  reset: (chatId) => set((s) => ({ byChat: { ...s.byChat, [chatId]: EMPTY } })),
}))
