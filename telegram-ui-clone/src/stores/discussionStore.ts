// src/stores/discussionStore.ts
//
// Comments of channel-post discussion threads, keyed by `${discussionChatId}:${postId}`.
// The single source of truth for an open thread: realtimeBridge appends live frames
// here (never the View), and useDiscussion reads its slice via a selector. Only
// threads that are currently open have an entry (created on load, dropped on close).
import { create } from 'zustand'

// Raw comment entity — the sender's display name is resolved in useDiscussion
// (presentation), not stored here.
export interface DiscussionComment {
  id?: number // server id; absent only for an in-flight optimistic comment
  clientId?: string // optimistic key, until the server assigns an id
  senderId: number
  text: string
  createdAt: string
}

interface Thread {
  comments: DiscussionComment[]
  seen: Set<number> // server ids already represented (dedupes live echoes)
}

interface DiscussionState {
  byThread: Record<string, Thread>
  // Seed the thread with the initial server page (resets seen).
  setComments: (key: string, comments: DiscussionComment[]) => void
  // Live frame from realtimeBridge — lands only if the thread is open and unseen.
  appendLive: (key: string, c: DiscussionComment & { id: number }) => void
  // Optimistic local append before the server assigns an id.
  addOptimistic: (key: string, c: DiscussionComment & { clientId: string }) => void
  // Stamp the server id onto an optimistic comment and suppress its live echo.
  reconcile: (key: string, clientId: string, id: number) => void
  clear: (key: string) => void
}

export const threadKey = (discussionChatId: number, postId: number): string => `${discussionChatId}:${postId}`

export const useDiscussionStore = create<DiscussionState>((set) => ({
  byThread: {},
  setComments: (key, comments) =>
    set((s) => ({
      byThread: {
        ...s.byThread,
        [key]: { comments, seen: new Set(comments.map((c) => c.id).filter((id): id is number => id != null)) },
      },
    })),
  appendLive: (key, c) =>
    set((s) => {
      const t = s.byThread[key]
      if (!t || t.seen.has(c.id)) return {} // thread not open, or already shown
      const seen = new Set(t.seen)
      seen.add(c.id)
      return { byThread: { ...s.byThread, [key]: { comments: [...t.comments, c], seen } } }
    }),
  addOptimistic: (key, c) =>
    set((s) => {
      const t = s.byThread[key]
      if (!t) return {}
      return { byThread: { ...s.byThread, [key]: { ...t, comments: [...t.comments, c] } } }
    }),
  reconcile: (key, clientId, id) =>
    set((s) => {
      const t = s.byThread[key]
      if (!t) return {}
      const seen = new Set(t.seen)
      seen.add(id)
      const comments = t.comments.map((c) => (c.clientId === clientId ? { ...c, id } : c))
      return { byThread: { ...s.byThread, [key]: { comments, seen } } }
    }),
  clear: (key) =>
    set((s) => {
      if (!s.byThread[key]) return {}
      const next = { ...s.byThread }
      delete next[key]
      return { byThread: next }
    }),
}))
