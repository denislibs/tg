// src/stores/messagesStore.ts
//
// Normalized message windows, single-sourced in a store so that (a) realtimeBridge
// can apply server frames to a chat even when it isn't open, and (b) the window
// survives a ConversationView unmount. `useMessageWindow` is a thin selector/
// actions wrapper over this store and keeps the same shape.
//
// Окна ключуются чатом ИЛИ тредом чата (tweb: history по threadId): "chatId" —
// основное окно, "chatId:root" — окно форум-топика/комментариев. Live-события
// с chat_id применяются ко ВСЕМ окнам этого чата (applyToChat), новое сообщение
// с thread_root_id попадает и в основное окно, и в окно своего треда.
import { create } from 'zustand'
import type { Message, MessageEntity, Poll, ReactionCount } from '../core/models'

// Ключ окна: основное окно чата или тред (форум-топик / комментарии).
export const winKey = (chatId: number, threadRootId?: number | null): string =>
  threadRootId ? `${chatId}:${threadRootId}` : String(chatId)

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

// clientMsgId -> tentative seq, per window. This is the UI reconcile index only
// (maps an ack back to the optimistic bubble's tentative seq); not rendered, so
// kept out of reactive state. It is NOT a duplicate of connectionManager.outbox:
// that lives in the worker and is the transport retry buffer (full SendArgs,
// resent on reconnect). Different threads, different jobs — the UI window's single
// source of truth is this store; the outbox never feeds the UI.
const pendingByWin = new Map<string, Map<string, number>>()
function pendingFor(key: string): Map<string, number> {
  let m = pendingByWin.get(key)
  if (!m) pendingByWin.set(key, (m = new Map()))
  return m
}
// Reverse index clientMsgId -> window key. An ack/error frame carries only the
// client_msg_id (no chat_id), so realtimeBridge resolves the window through this.
const clientToWin = new Map<string, string>()

function dedupAsc(list: Message[]): Message[] {
  const bySeq = new Map<number, Message>()
  for (const m of list) bySeq.set(m.seq, m)
  return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq)
}

interface MessagesState {
  byKey: Record<string, ChatWindow>
  /** Reset a window to the loading state (called on chat/thread open before fetch). */
  beginLoad: (key: string) => void
  /** Replace a window with a freshly loaded page (initial / jumpTo / reloadNewest). */
  setWindow: (key: string, w: { msgs: Message[]; reachedTop: boolean; reachedBottom: boolean; cached?: boolean }) => void
  setLoadingOlder: (key: string, v: boolean) => void
  setLoadingNewer: (key: string, v: boolean) => void
  prepend: (key: string, msgs: Message[], reachedTop: boolean) => void
  append: (key: string, msgs: Message[], reachedBottom: boolean) => void
  appendLocal: (key: string, m: Message) => void
  appendOptimistic: (key: string, text: string, meId: number, clientMsgId: string, mediaId?: number, type?: string, entities?: MessageEntity[], groupedId?: string, media?: OptimisticMedia, extra?: { geo?: { lat: number; lng: number }; contact?: { userId: number; name: string; phone: string }; threadRootId?: number }) => void
  /** Аплоад завершён — проставить оптимистичному сообщению серверный media_id. */
  setOptimisticMedia: (key: string, clientMsgId: string, mediaId: number) => void
  reconcileAck: (key: string, clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => void
  failOptimistic: (key: string, clientMsgId: string) => void
  /** Reconcile/fail by clientMsgId alone (ack/error frames carry no chat_id). */
  reconcileAckByClient: (clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => void
  failOptimisticByClient: (clientMsgId: string) => void
  /** Failed bubble → back to 'sending' before the send is retried. */
  retryOptimistic: (key: string, clientMsgId: string) => void
  /** Drop a failed optimistic bubble entirely (user chose «delete»). */
  removeOptimistic: (key: string, clientMsgId: string) => void
  /** Новое сообщение чата: в основное окно + в окно своего треда (если открыто). */
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

// Update a single window immutably.
function patch(
  state: MessagesState,
  key: string,
  fn: (w: ChatWindow) => Partial<ChatWindow>,
): Pick<MessagesState, 'byKey'> {
  const cur = state.byKey[key] ?? EMPTY_WINDOW
  return { byKey: { ...state.byKey, [key]: { ...cur, ...fn(cur) } } }
}

// Live-события несут только chat_id — применяем ко всем загруженным окнам
// этого чата (основное + треды). fn возвращает новый msgs или null (без изменений).
function patchChat(
  state: MessagesState,
  chatId: number,
  fn: (w: ChatWindow) => Message[] | null,
): Pick<MessagesState, 'byKey'> | Record<string, never> {
  const prefix = String(chatId)
  let next: Record<string, ChatWindow> | null = null
  for (const key of Object.keys(state.byKey)) {
    if (key !== prefix && !key.startsWith(`${prefix}:`)) continue
    const w = state.byKey[key]
    const msgs = fn(w)
    if (msgs === null) continue
    if (!next) next = { ...state.byKey }
    next[key] = { ...w, msgs }
  }
  return next ? { byKey: next } : {}
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

export const useMessagesStore = create<MessagesState>((set, get) => ({
  byKey: {},

  beginLoad: (key) =>
    set((s) => patch(s, key, () => ({ ...EMPTY_WINDOW, loading: true }))),

  setWindow: (key, w) =>
    set((s) =>
      patch(s, key, () => ({
        msgs: dedupAsc(w.msgs),
        reachedTop: w.reachedTop,
        reachedBottom: w.reachedBottom,
        loadedFromCache: !!w.cached,
        loading: false,
      })),
    ),

  setLoadingOlder: (key, v) => set((s) => patch(s, key, () => ({ loadingOlder: v }))),
  setLoadingNewer: (key, v) => set((s) => patch(s, key, () => ({ loadingNewer: v }))),

  prepend: (key, msgs, reachedTop) =>
    set((s) => patch(s, key, (w) => ({ msgs: dedupAsc([...msgs, ...w.msgs]), reachedTop }))),

  append: (key, msgs, reachedBottom) =>
    set((s) => patch(s, key, (w) => ({ msgs: dedupAsc([...w.msgs, ...msgs]), reachedBottom }))),

  appendLocal: (key, m) =>
    set((s) => patch(s, key, (w) => ({ msgs: dedupAsc([...w.msgs, m]) }))),

  appendOptimistic: (key, text, meId, clientMsgId, mediaId, type = 'text', entities, groupedId, media, extra) =>
    set((s) =>
      patch(s, key, (w) => {
        const maxSeq = w.msgs.length ? w.msgs[w.msgs.length - 1].seq : 0
        const tentativeSeq = maxSeq + 1
        pendingFor(key).set(clientMsgId, tentativeSeq)
        clientToWin.set(clientMsgId, key)
        const tmp: Message = {
          id: -Date.now(), chatId: Number(key.split(':')[0]), seq: tentativeSeq, senderId: meId, type, text, entities,
          replyToId: null, mediaId: mediaId ?? null, createdAt: new Date().toISOString(),
          threadRootId: extra?.threadRootId ?? null, groupedId: groupedId ?? null, clientId: clientMsgId,
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

  setOptimisticMedia: (key, clientMsgId, mediaId) =>
    set((s) =>
      patch(s, key, (w) => ({
        msgs: w.msgs.map((m) => (m.clientId === clientMsgId ? { ...m, mediaId } : m)),
      })),
    ),

  reconcileAck: (key, clientMsgId, ack) =>
    set((s) => {
      const tentativeSeq = pendingFor(key).get(clientMsgId)
      if (tentativeSeq === undefined) return {}
      pendingFor(key).delete(clientMsgId)
      clientToWin.delete(clientMsgId)
      return patch(s, key, (w) => ({
        msgs: dedupAsc(
          w.msgs.map((m) => (m.seq === tentativeSeq ? { ...m, id: ack.msgId, seq: ack.seq, createdAt: ack.createdAt } : m)),
        ),
      }))
    }),

  // Rejected send: keep the bubble with a red error mark (tweb sendingerror) —
  // the user decides to retry or delete it. The pending maps stay so a later
  // retry's ack can still reconcile the same bubble.
  failOptimistic: (key, clientMsgId) =>
    set((s) => patch(s, key, (w) => ({
      msgs: w.msgs.map((m) => (m.clientId === clientMsgId ? { ...m, failed: true } : m)),
    }))),

  retryOptimistic: (key, clientMsgId) =>
    set((s) => patch(s, key, (w) => ({
      msgs: w.msgs.map((m) => (m.clientId === clientMsgId ? { ...m, failed: undefined } : m)),
    }))),

  removeOptimistic: (key, clientMsgId) =>
    set((s) => {
      pendingFor(key).delete(clientMsgId)
      clientToWin.delete(clientMsgId)
      return patch(s, key, (w) => ({ msgs: w.msgs.filter((m) => m.clientId !== clientMsgId) }))
    }),

  reconcileAckByClient: (clientMsgId, ack) => {
    const key = clientToWin.get(clientMsgId)
    if (key !== undefined) get().reconcileAck(key, clientMsgId, ack)
  },

  failOptimisticByClient: (clientMsgId) => {
    const key = clientToWin.get(clientMsgId)
    if (key !== undefined) get().failOptimistic(key, clientMsgId)
  },

  applyIncoming: (chatId, m) =>
    set((s) => {
      // Apply to the main chat window AND (for a thread message) that thread's
      // window — each only if loaded (else refetched on open).
      const keys = m.threadRootId ? [winKey(chatId), winKey(chatId, m.threadRootId)] : [winKey(chatId)]
      let out: Pick<MessagesState, 'byKey'> | Record<string, never> = {}
      let cur = s
      for (const key of keys) {
        if (!cur.byKey[key]) continue
        const w = cur.byKey[key]
        if (w.msgs.some((x) => x.id === m.id)) continue
        // The realtime echo of our OWN just-sent message arrives with the server
        // id/seq but no clientId, and dedupAsc (keyed by seq) would replace the
        // optimistic entry — flipping its React key (clientId → m-<id>) and
        // remounting the bubble mid-appear. Carry the optimistic clientId over so
        // the key stays stable and the appear animation isn't cut short. Also keep
        // the local blob preview (localUrl) so an uploaded photo doesn't re-fetch
        // from the server (tweb reuses the local object URL).
        const optimistic = w.msgs.find((x) => x.clientId && x.seq === m.seq)
        const merged = optimistic ? { ...m, clientId: optimistic.clientId, localUrl: optimistic.localUrl } : m
        out = patch(cur as MessagesState, key, () => ({ msgs: dedupAsc([...w.msgs, merged]) }))
        cur = { ...cur, ...out }
      }
      return out
    }),

  applyPollUpdate: (chatId, poll) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.poll?.id === poll.id)
          ? w.msgs.map((m) => (m.poll?.id === poll.id ? { ...m, poll: { ...poll, myVotes: m.poll.myVotes } } : m))
          : null,
      )),

  setPoll: (chatId, poll) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.poll?.id === poll.id)
          ? w.msgs.map((m) => (m.poll?.id === poll.id ? { ...m, poll } : m))
          : null,
      )),

  applyEdit: (chatId, msgId, text, editedAt, entities) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId)
          ? w.msgs.map((m) => (m.id === msgId ? { ...m, text, editedAt, entities } : m))
          : null,
      )),

  applyDelete: (chatId, msgId) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId) ? w.msgs.filter((m) => m.id !== msgId) : null,
      )),

  applyMediaRead: (chatId, msgId) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId && m.mediaUnread)
          ? w.msgs.map((m) => (m.id === msgId ? { ...m, mediaUnread: false } : m))
          : null,
      )),

  patchViews: (chatId, views) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        // Only rebuild rows whose count actually changed, so unaffected bubbles keep
        // their reference (memoized rows don't re-render).
        w.msgs.some((m) => views.has(m.id) && views.get(m.id) !== m.views)
          ? w.msgs.map((m) => (views.has(m.id) && views.get(m.id) !== m.views ? { ...m, views: views.get(m.id) } : m))
          : null,
      )),

  applyReaction: (chatId, msgId, emoji, action, mine) =>
    set((s) =>
      patchChat(s, chatId, (w) => {
        if (!w.msgs.some((m) => m.id === msgId)) return null
        let changed = false
        const msgs = w.msgs.map((m) => {
          if (m.id !== msgId) return m
          const next = reactionDelta(m.reactions, emoji, action, mine)
          if (next === null) return m
          changed = true
          return { ...m, reactions: next }
        })
        return changed ? msgs : null
      })),
}))
