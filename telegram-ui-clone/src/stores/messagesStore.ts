// src/stores/messagesStore.ts
//
// Normalized message windows, one per chat, single-sourced in a store so that
// (a) realtimeBridge can apply server frames to a chat even when it isn't open,
// and (b) the window survives a ConversationView unmount. `useMessageWindow`
// is a thin selector/actions wrapper over this store and keeps the same shape.
import { create } from 'zustand'
import type { Message, MessageEntity, Poll, ReactionCount } from '../core/models'

// Локальные данные файла для мгновенного оптимистичного медиабабла.
export interface OptimisticMedia {
  localUrl?: string
  width?: number
  height?: number
  mime?: string
  size?: number
  name?: string
}

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
  appendOptimistic: (chatId: number, text: string, meId: number, clientMsgId: string, mediaId?: number, type?: string, entities?: MessageEntity[], groupedId?: string, media?: OptimisticMedia, extra?: { geo?: { lat: number; lng: number }; contact?: { userId: number; name: string; phone: string } }) => void
  /** Аплоад завершён — проставить оптимистичному сообщению серверный media_id. */
  setOptimisticMedia: (chatId: number, clientMsgId: string, mediaId: number) => void
  reconcileAck: (chatId: number, clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => void
  failOptimistic: (chatId: number, clientMsgId: string) => void
  /** Reconcile/fail by clientMsgId alone (ack/error frames carry no chat_id). */
  reconcileAckByClient: (clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => void
  failOptimisticByClient: (clientMsgId: string) => void
  /** Failed bubble → back to 'sending' before the send is retried. */
  retryOptimistic: (chatId: number, clientMsgId: string) => void
  /** Drop a failed optimistic bubble entirely (user chose «delete»). */
  removeOptimistic: (chatId: number, clientMsgId: string) => void
  applyIncoming: (chatId: number, m: Message) => void
  applyEdit: (chatId: number, msgId: number, text: string, editedAt: string, entities?: MessageEntity[]) => void
  applyDelete: (chatId: number, msgId: number) => void
  /** Голосовое/кружок прослушано → точка media_unread гаснет (обе стороны). */
  applyMediaRead: (chatId: number, msgId: number) => void
  /** Patch channel-post view counts from a per-open view_counts fetch. */
  patchViews: (chatId: number, views: Map<number, number>) => void
  /** Live-агрегаты опроса (poll_update): свой выбор (myVotes) сохраняем локальный. */
  applyPollUpdate: (chatId: number, poll: Poll) => void
  /** Полная замена опроса сообщения (ответ на свой голос — с myVotes). */
  setPoll: (chatId: number, poll: Poll) => void
  /** Дельта реакции (rt:reaction / оптимистичный клик): count±1 по emoji.
   * Идемпотентно для своих действий — серверное эхо собственного add/remove
   * (mine=true) поверх уже применённого оптимистичного апдейта — no-op. */
  applyReaction: (chatId: number, msgId: number, emoji: string, action: 'add' | 'remove', mine: boolean) => void
}

// Apply one reaction delta to a message's aggregate list (pure helper).
function reactionDelta(list: ReactionCount[] | undefined, emoji: string, action: 'add' | 'remove', mine: boolean): ReactionCount[] | undefined | null {
  const cur = list ? [...list] : []
  const i = cur.findIndex((r) => r.emoji === emoji)
  if (action === 'add') {
    if (i < 0) cur.push({ emoji, count: 1, mine })
    else {
      if (mine && cur[i].mine) return null // эхо своей уже применённой реакции
      cur[i] = { emoji, count: cur[i].count + 1, mine: cur[i].mine || mine }
    }
  } else {
    if (i < 0) return null
    if (mine && !cur[i].mine) return null // эхо своего уже применённого снятия
    const next = { emoji, count: cur[i].count - 1, mine: cur[i].mine && !mine }
    if (next.count <= 0) cur.splice(i, 1)
    else cur[i] = next
  }
  return cur.length ? cur : undefined
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

  appendOptimistic: (chatId, text, meId, clientMsgId, mediaId, type = 'text', entities, groupedId, media, extra) =>
    set((s) =>
      patch(s, chatId, (w) => {
        const maxSeq = w.msgs.length ? w.msgs[w.msgs.length - 1].seq : 0
        const tentativeSeq = maxSeq + 1
        pendingFor(chatId).set(clientMsgId, tentativeSeq)
        clientToChat.set(clientMsgId, chatId)
        const tmp: Message = {
          id: -Date.now(), chatId, seq: tentativeSeq, senderId: meId, type, text, entities,
          replyToId: null, mediaId: mediaId ?? null, createdAt: new Date().toISOString(),
          threadRootId: null, groupedId: groupedId ?? null, clientId: clientMsgId,
          // локальное превью + размеры файла: бабл появляется сразу, до аплоада
          localUrl: media?.localUrl,
          mediaWidth: media?.width, mediaHeight: media?.height,
          mediaMime: media?.mime, mediaSize: media?.size, mediaName: media?.name,
          // сервер ставит media_unread на voice/roundVideo — отразить сразу в
          // оптимистичном бабле, чтобы точка не «моргала» после ack
          mediaUnread: type === 'voice' || type === 'roundVideo' || undefined,
          // гео/контакт: бабл рисуется сразу из локальных данных, до ack
          geo: extra?.geo,
          contact: extra?.contact,
        }
        return { msgs: dedupAsc([...w.msgs, tmp]) }
      }),
    ),

  setOptimisticMedia: (chatId, clientMsgId, mediaId) =>
    set((s) =>
      patch(s, chatId, (w) => ({
        msgs: w.msgs.map((m) => (m.clientId === clientMsgId ? { ...m, mediaId } : m)),
      })),
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

  // Rejected send: keep the bubble with a red error mark (tweb sendingerror) —
  // the user decides to retry or delete it. The pending maps stay so a later
  // retry's ack can still reconcile the same bubble.
  failOptimistic: (chatId, clientMsgId) =>
    set((s) => patch(s, chatId, (w) => ({
      msgs: w.msgs.map((m) => (m.clientId === clientMsgId ? { ...m, failed: true } : m)),
    }))),

  retryOptimistic: (chatId, clientMsgId) =>
    set((s) => patch(s, chatId, (w) => ({
      msgs: w.msgs.map((m) => (m.clientId === clientMsgId ? { ...m, failed: undefined } : m)),
    }))),

  removeOptimistic: (chatId, clientMsgId) =>
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
        // the key stays stable and the appear animation isn't cut short. Also keep
        // the local blob preview (localUrl) so an uploaded photo doesn't re-fetch
        // from the server (tweb reuses the local object URL).
        const optimistic = w.msgs.find((x) => x.clientId && x.seq === m.seq)
        const merged = optimistic ? { ...m, clientId: optimistic.clientId, localUrl: optimistic.localUrl } : m
        return { msgs: dedupAsc([...w.msgs, merged]) }
      })
    }),

  applyPollUpdate: (chatId, poll) =>
    set((s) =>
      s.byChat[chatId]
        ? patch(s, chatId, (w) => ({
            msgs: w.msgs.map((m) =>
              m.poll?.id === poll.id ? { ...m, poll: { ...poll, myVotes: m.poll.myVotes } } : m,
            ),
          }))
        : {}),

  setPoll: (chatId, poll) =>
    set((s) =>
      s.byChat[chatId]
        ? patch(s, chatId, (w) => ({
            msgs: w.msgs.map((m) => (m.poll?.id === poll.id ? { ...m, poll } : m)),
          }))
        : {}),

  applyReaction: (chatId, msgId, emoji, action, mine) =>
    set((s) => {
      if (!s.byChat[chatId]) return {}
      return patch(s, chatId, (w) => ({
        msgs: w.msgs.map((m) => {
          if (m.id !== msgId) return m
          const next = reactionDelta(m.reactions, emoji, action, mine)
          return next === null ? m : { ...m, reactions: next }
        }),
      }))
    }),

  applyEdit: (chatId, msgId, text, editedAt, entities) =>
    set((s) => (s.byChat[chatId] ? patch(s, chatId, (w) => ({ msgs: w.msgs.map((m) => (m.id === msgId ? { ...m, text, editedAt, entities } : m)) })) : {})),

  applyDelete: (chatId, msgId) =>
    set((s) => (s.byChat[chatId] ? patch(s, chatId, (w) => ({ msgs: w.msgs.filter((m) => m.id !== msgId) })) : {})),

  applyMediaRead: (chatId, msgId) =>
    set((s) =>
      s.byChat[chatId]
        ? patch(s, chatId, (w) => ({
            msgs: w.msgs.some((m) => m.id === msgId && m.mediaUnread)
              ? w.msgs.map((m) => (m.id === msgId ? { ...m, mediaUnread: false } : m))
              : w.msgs,
          }))
        : {},
    ),

  patchViews: (chatId, views) =>
    set((s) =>
      s.byChat[chatId]
        ? patch(s, chatId, (w) => ({
            // Only rebuild rows whose count actually changed, so unaffected bubbles keep
            // their reference (memoized rows don't re-render).
            msgs: w.msgs.some((m) => views.has(m.id) && views.get(m.id) !== m.views)
              ? w.msgs.map((m) => (views.has(m.id) && views.get(m.id) !== m.views ? { ...m, views: views.get(m.id) } : m))
              : w.msgs,
          }))
        : {},
    ),
}))
