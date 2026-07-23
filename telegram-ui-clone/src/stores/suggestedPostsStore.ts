import { create } from 'zustand'
import type { SuggestedPost } from '../core/models'

// Предложенные посты канала, нормализованные по chatId (список по id внутри).
// Наполняется ответом на listSuggestedPosts (setList) и live-кадрами
// suggested_post_update (apply). Представление (админ видит pending, автор — свои
// с бейджем статуса) фильтруется во View.
interface SuggestedPostsState {
  byChat: Record<number, SuggestedPost[]>
  setList: (chatId: number, posts: SuggestedPost[]) => void
  // apply — upsert по id (новая предложка сверху, изменившийся статус на месте).
  apply: (chatId: number, post: SuggestedPost) => void
}

export const useSuggestedPostsStore = create<SuggestedPostsState>((set) => ({
  byChat: {},
  setList: (chatId, posts) =>
    set((s) => ({ byChat: { ...s.byChat, [chatId]: posts } })),
  apply: (chatId, post) =>
    set((s) => {
      const prev = s.byChat[chatId] ?? []
      const idx = prev.findIndex((p) => p.id === post.id)
      const next = idx >= 0
        ? prev.map((p) => (p.id === post.id ? post : p))
        : [post, ...prev]
      return { byChat: { ...s.byChat, [chatId]: next } }
    }),
}))
