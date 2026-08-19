import { create } from 'zustand'
import type { SuggestedPost } from '../core/models'

// Предложенные посты канала, нормализованные по peerId (список по id внутри).
// Наполняется ответом на listSuggestedPosts (setList) и live-кадрами
// suggested_post_update (apply). Представление (админ видит pending, автор — свои
// с бейджем статуса) фильтруется во View.
interface SuggestedPostsState {
  byChat: Record<number, SuggestedPost[]>
  setList: (peerId: number, posts: SuggestedPost[]) => void
  // apply — upsert по id (новая предложка сверху, изменившийся статус на месте).
  apply: (peerId: number, post: SuggestedPost) => void
}

export const useSuggestedPostsStore = create<SuggestedPostsState>((set) => ({
  byChat: {},
  setList: (peerId, posts) =>
    set((s) => ({ byChat: { ...s.byChat, [peerId]: posts } })),
  apply: (peerId, post) =>
    set((s) => {
      const prev = s.byChat[peerId] ?? []
      const idx = prev.findIndex((p) => p.id === post.id)
      const next = idx >= 0
        ? prev.map((p) => (p.id === post.id ? post : p))
        : [post, ...prev]
      return { byChat: { ...s.byChat, [peerId]: next } }
    }),
}))
