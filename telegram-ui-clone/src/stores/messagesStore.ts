// src/stores/messagesStore.ts
//
// Normalized message windows, one per chat, single-sourced in a store so that
// (a) realtimeBridge can apply server frames to a chat even when it isn't open,
// and (b) the window survives a ConversationView unmount. `useMessageWindow`
// is a thin selector/actions wrapper over this store and keeps the same shape.
import { create } from 'zustand'
import type { Message, MessageEntity } from '../core/models'

export interface ChatWindow {
  msgs: Message[]
  reachedTop: boolean
  reachedBottom: boolean
  loadingOlder: boolean
  loadingNewer: boolean
  loading: boolean
  /** the most recent initial load was served from the in-memory cache (no
   * network) — used to skip the open-chat ladder, matching tweb's setPeerCached */
  loadedFromCache: boolean
}

export const EMPTY_WINDOW: ChatWindow = {
  msgs: [], reachedTop: false, reachedBottom: false,
  loadingOlder: false, loadingNewer: false, loading: true, loadedFromCache: false,
}

// clientMsgId -> tentative seq, per chat. This is the UI reconcile index only
// (maps an ack back to the optimistic bubble's tentative seq); not rendered, so
// kept out of reactive state. It is NOT a duplicate of connectionManager.outbox:
// that lives in the worker and is the transport retry buffer (full SendArgs,
// resent on reconnect). Different threads, different jobs — the UI window's single
// source of truth is this store; the outbox never feeds the UI.
const pendingByChat = new Map<number, Map<string, number>>()
function pendingFor(chatId: number): Map<string, number> {
  let m = pendingByChat.get(chatId)
  if (!m) pendingByChat.set(chatId, (m = new Map()))
  return m
}
// Reverse index clientMsgId -> chatId. An ack/error frame carries only the
// client_msg_id (no chat_id), so realtimeBridge resolves the chat through this.
const clientToChat = new Map<string, number>()

function dedupAsc(list: Message[]): Message[] {
  const bySeq = new Map<number, Message>()
  for (const m of list) bySeq.set(m.seq, m)
  return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq)
}

interface MessagesState {
  byChat: Record<number, ChatWindow>
  /** Reset a chat's window to the loading state (called on chat open before fetch). */
  beginLoad: (chatId: number) => void
  /** Replace a chat's window with a freshly loaded page (initial / jumpTo / reloadNewest). */
  setWindow: (chatId: number, w: { msgs: Message[]; reachedTop: boolean; reachedBottom: boolean; cached?: boolean }) => void
  setLoadingOlder: (chatId: number, v: boolean) => void
  setLoadingNewer: (chatId: number, v: boolean) => void
  prepend: (chatId: number, msgs: Message[], reachedTop: boolean) => void
  append: (chatId: number, msgs: Message[], reachedBottom: boolean) => void
  appendLocal: (chatId: number, m: Message) => void
  appendOptimistic: (chatId: number, text: string, meId: number, clientMsgId: string, mediaId?: number, type?: string, entities?: MessageEntity[]) => void
  reconcileAck: (chatId: number, clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => void
  failOptimistic: (chatId: number, clientMsgId: string) => void
  /** Reconcile/fail by clientMsgId alone (ack/error frames carry no chat_id). */
  reconcileAckByClient: (clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => void
  failOptimisticByClient: (clientMsgId: string) => void
  applyIncoming: (chatId: number, m: Message) => void
  applyEdit: (chatId: number, msgId: number, text: string, editedAt: string, entities?: MessageEntity[]) => void
  applyDelete: (chatId: number, msgId: number) => void
}

// Update a single chat's window immutably.
function patch(
  state: MessagesState,
  chatId: number,
  fn: (w: ChatWindow) => Partial<ChatWindow>,
): Pick<MessagesState, 'byChat'> {
  const cur = state.byChat[chatId] ?? EMPTY_WINDOW
  return { byChat: { ...state.byChat, [chatId]: { ...cur, ...fn(cur) } } }
}

export const useMessagesStore = create<MessagesState>((set, get) => ({
  byChat: {},

  beginLoad: (chatId) =>
    set((s) => patch(s, chatId, () => ({ ...EMPTY_WINDOW, loading: true }))),

  setWindow: (chatId, w) =>
    set((s) =>
      patch(s, chatId, () => ({
        msgs: dedupAsc(w.msgs),
        reachedTop: w.reachedTop,
        reachedBottom: w.reachedBottom,
        loadedFromCache: !!w.cached,
        loading: false,
      })),
    ),

  setLoadingOlder: (chatId, v) => set((s) => patch(s, chatId, () => ({ loadingOlder: v }))),
  setLoadingNewer: (chatId, v) => set((s) => patch(s, chatId, () => ({ loadingNewer: v }))),

  prepend: (chatId, msgs, reachedTop) =>
    set((s) => patch(s, chatId, (w) => ({ msgs: dedupAsc([...msgs, ...w.msgs]), reachedTop }))),

  append: (chatId, msgs, reachedBottom) =>
    set((s) => patch(s, chatId, (w) => ({ msgs: dedupAsc([...w.msgs, ...msgs]), reachedBottom }))),

  appendLocal: (chatId, m) =>
    set((s) => patch(s, chatId, (w) => ({ msgs: dedupAsc([...w.msgs, m]) }))),

  appendOptimistic: (chatId, text, meId, clientMsgId, mediaId, type = 'text', entities) =>
    set((s) =>
      patch(s, chatId, (w) => {
        const maxSeq = w.msgs.length ? w.msgs[w.msgs.length - 1].seq : 0
        const tentativeSeq = maxSeq + 1
        pendingFor(chatId).set(clientMsgId, tentativeSeq)
        clientToChat.set(clientMsgId, chatId)
        const tmp: Message = {
          id: -Date.now(), chatId, seq: tentativeSeq, senderId: meId, type, text, entities,
          replyToId: null, mediaId: mediaId ?? null, createdAt: new Date().toISOString(),
          threadRootId: null, clientId: clientMsgId,
        }
        return { msgs: dedupAsc([...w.msgs, tmp]) }
      }),
    ),

  reconcileAck: (chatId, clientMsgId, ack) =>
    set((s) => {
      const tentativeSeq = pendingFor(chatId).get(clientMsgId)
      if (tentativeSeq === undefined) return {}
      pendingFor(chatId).delete(clientMsgId)
      clientToChat.delete(clientMsgId)
      return patch(s, chatId, (w) => ({
        msgs: dedupAsc(
          w.msgs.map((m) => (m.seq === tentativeSeq ? { ...m, id: ack.msgId, seq: ack.seq, createdAt: ack.createdAt } : m)),
        ),
      }))
    }),

  failOptimistic: (chatId, clientMsgId) =>
    set((s) => {
      pendingFor(chatId).delete(clientMsgId)
      clientToChat.delete(clientMsgId)
      return patch(s, chatId, (w) => ({ msgs: w.msgs.filter((m) => m.clientId !== clientMsgId) }))
    }),

  reconcileAckByClient: (clientMsgId, ack) => {
    const chatId = clientToChat.get(clientMsgId)
    if (chatId !== undefined) get().reconcileAck(chatId, clientMsgId, ack)
  },

  failOptimisticByClient: (clientMsgId) => {
    const chatId = clientToChat.get(clientMsgId)
    if (chatId !== undefined) get().failOptimistic(chatId, clientMsgId)
  },

  applyIncoming: (chatId, m) =>
    set((s) => {
      if (!s.byChat[chatId]) return {} // only apply to a loaded window (else refetched on open)
      return patch(s, chatId, (w) => {
        if (w.msgs.some((x) => x.id === m.id)) return {}
        // The realtime echo of our OWN just-sent message arrives with the server
        // id/seq but no clientId, and dedupAsc (keyed by seq) would replace the
        // optimistic entry — flipping its React key (clientId → m-<id>) and
        // remounting the bubble mid-appear. Carry the optimistic clientId over so
        // the key stays stable and the appear animation isn't cut short.
        const optimistic = w.msgs.find((x) => x.clientId && x.seq === m.seq)
        const merged = optimistic ? { ...m, clientId: optimistic.clientId } : m
        return { msgs: dedupAsc([...w.msgs, merged]) }
      })
    }),

  applyEdit: (chatId, msgId, text, editedAt, entities) =>
    set((s) => (s.byChat[chatId] ? patch(s, chatId, (w) => ({ msgs: w.msgs.map((m) => (m.id === msgId ? { ...m, text, editedAt, entities } : m)) })) : {})),

  applyDelete: (chatId, msgId) =>
    set((s) => (s.byChat[chatId] ? patch(s, chatId, (w) => ({ msgs: w.msgs.filter((m) => m.id !== msgId) })) : {})),
}))
