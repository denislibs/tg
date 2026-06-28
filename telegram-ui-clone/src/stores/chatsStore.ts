// src/stores/chatsStore.ts
import { create } from 'zustand'
import type { Dialog } from '../core/models'
import type { User } from '../core/managers/authManager'
import type { NewMessageEvt, ReadEvt, PresenceEvt, TypingAction } from '../core/realtime/events'

// Per-chat typing state: chatId -> userId -> {action, at}. `at` is the event
// timestamp (ms) so stale entries can be ignored; entries are also actively
// cleared on a timer / when the user sends a message.
export interface TypingEntry { action: TypingAction; at: number }
export type ChatTyping = Record<number, TypingEntry>

interface ChatsState {
  dialogs: Dialog[]
  me: User | null
  meId: number | null
  loaded: boolean
  activeChatId: number | null
  presence: Record<number, { online: boolean; lastSeen: number }>
  typing: Record<number, ChatTyping>
  setDialogs: (d: Dialog[]) => void
  setMe: (u: User | null) => void
  setMeId: (id: number | null) => void
  upsertDialog: (d: Dialog) => void
  setActiveChat: (id: number | null) => void
  setDialogMuted: (chatId: number, muted: boolean) => void
  applyNewMessage: (m: NewMessageEvt) => void
  applyRead: (r: ReadEvt) => void
  setPresence: (p: PresenceEvt) => void
  setTyping: (chatId: number, userId: number, action: TypingAction, at: number) => void
  clearTyping: (chatId: number, userId: number) => void
}

export const useChatsStore = create<ChatsState>((set) => ({
  dialogs: [],
  me: null,
  meId: null,
  loaded: false,
  activeChatId: null,
  presence: {},
  typing: {},
  setDialogs: (dialogs) => set({ dialogs, loaded: true }),
  setMe: (me) => set({ me }),
  setMeId: (meId) => set({ meId }),
  upsertDialog: (d) =>
    set((s) => {
      const idx = s.dialogs.findIndex((x) => x.chatId === d.chatId)
      if (idx === -1) return { dialogs: [d, ...s.dialogs] }
      const next = s.dialogs.slice()
      next[idx] = d
      return { dialogs: next }
    }),
  setActiveChat: (activeChatId) => set({ activeChatId }),
  setDialogMuted: (chatId, muted) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === chatId)
      if (idx === -1) return {}
      const next = s.dialogs.slice()
      next[idx] = { ...next[idx], muted }
      return { dialogs: next }
    }),
  setPresence: (p) => set((s) => ({ presence: { ...s.presence, [p.user_id]: { online: p.online, lastSeen: p.last_seen } } })),
  setTyping: (chatId, userId, action, at) =>
    set((s) => ({
      typing: { ...s.typing, [chatId]: { ...s.typing[chatId], [userId]: { action, at } } },
    })),
  clearTyping: (chatId, userId) =>
    set((s) => {
      const chat = s.typing[chatId]
      if (!chat || !(userId in chat)) return {}
      const next = { ...chat }
      delete next[userId]
      return { typing: { ...s.typing, [chatId]: next } }
    }),
  applyNewMessage: (m) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === m.chat_id)
      if (idx === -1) return {} // unknown chat (will surface on next dialog reload)
      const d = s.dialogs[idx]
      const incoming = m.sender_id !== s.meId
      const bumpUnread = incoming && s.activeChatId !== m.chat_id
      const updated = {
        ...d,
        // carry media so the sidebar preview keeps its thumbnail + type label
        lastMessage: {
          seq: m.seq,
          text: m.text,
          senderId: m.sender_id,
          at: m.created_at,
          mediaId: m.media_id ?? undefined,
          mediaType: m.type || undefined,
          // forward arrow in the sidebar preview live (not only on a full reload)
          forwarded: m.fwd_from_user_id != null || m.fwd_from_chat_id != null || undefined,
        },
        unread: bumpUnread ? d.unread + 1 : d.unread,
      }
      const rest = s.dialogs.filter((_, i) => i !== idx)
      // A message from a user clears their typing indicator in that chat.
      let typing = s.typing
      const chatTyping = typing[m.chat_id]
      if (chatTyping && m.sender_id in chatTyping) {
        const next = { ...chatTyping }
        delete next[m.sender_id]
        typing = { ...typing, [m.chat_id]: next }
      }
      return { dialogs: [updated, ...rest], typing }
    }),
  applyRead: (r) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === r.chat_id)
      if (idx === -1) return {}
      const next = s.dialogs.slice()
      if (r.user_id === s.meId) {
        // my own read (also echoed to my other tabs) → clear unread + advance my horizon
        next[idx] = { ...next[idx], unread: 0, lastReadSeq: Math.max(next[idx].lastReadSeq, r.up_to_seq) }
      } else {
        // the OTHER side read my messages → advance the peer horizon (out ticks → ✓✓)
        next[idx] = { ...next[idx], peerReadSeq: Math.max(next[idx].peerReadSeq, r.up_to_seq) }
      }
      return { dialogs: next }
    }),
}))

interface LoadDeps {
  auth: { me(): Promise<User | null> }
  chats: { listDialogs(): Promise<Dialog[]> }
}

// Fetch the current user + dialogs and populate the store.
export async function loadChats(managers: LoadDeps): Promise<void> {
  const [me, dialogs] = await Promise.all([managers.auth.me(), managers.chats.listDialogs()])
  const st = useChatsStore.getState()
  st.setMe(me)
  st.setMeId(me?.id ?? null)
  st.setDialogs(dialogs)
}

// Seed online / last-seen for a set of users (or all private-dialog peers when
// no ids are given). Live updates then arrive via rt:presence.
export async function loadPresence(
  managers: { presence: { get(ids: number[]): Promise<PresenceEvt[]> } },
  ids?: number[],
): Promise<void> {
  const st = useChatsStore.getState()
  const targets =
    ids ?? st.dialogs.filter((d) => d.type === 'private' && d.peer).map((d) => d.peer!.id)
  if (!targets.length) return
  const list = await managers.presence.get(targets)
  for (const p of list) st.setPresence(p)
}
