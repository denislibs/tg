// src/core/hooks/useMessageWindow.ts
//
// Thin selector/actions wrapper over messagesStore: the per-chat window lives in
// the store (single source of truth, normalized, survives unmount), this hook
// just binds it to a chatId and preserves the original MessageWindow interface.
import { useCallback, useEffect, useRef } from 'react'
import type { Message, MessageEntity } from '../models'
import type { HistoryResult } from '../managers/messagesManager'
import { useMessagesStore, EMPTY_WINDOW } from '../../stores/messagesStore'

interface ManagersLike {
  messages: {
    getHistory(args: { chatId: number; offsetSeq?: number; addOffset?: number; limit?: number }): Promise<HistoryResult>
    getAround?(chatId: number, centerSeq: number, limit?: number): Promise<{ messages: Message[]; reachedTop: boolean; reachedBottom: boolean }>
  }
}

export interface MessageWindow {
  msgs: Message[]
  reachedTop: boolean
  reachedBottom: boolean
  loadingOlder: boolean
  loadingNewer: boolean
  loading: boolean
  /** the most recent initial load was served from the in-memory cache (no
   * network) — used to skip the open-chat ladder, matching tweb's setPeerCached */
  loadedFromCache: boolean
  loadOlder: () => Promise<void>
  loadNewer: () => Promise<void>
  appendLocal: (m: Message) => void
  appendOptimistic: (text: string, meId: number, clientMsgId: string, mediaId?: number, type?: string, entities?: MessageEntity[]) => void
  reconcileAck: (clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => void
  /** Server rejected the send (e.g. too long) — drop the optimistic bubble. */
  failOptimistic: (clientMsgId: string) => void
  applyIncoming: (m: Message) => void
  /** A message was edited (live or via /sync): patch its text + entities + editedAt in place. */
  applyEdit: (msgId: number, text: string, editedAt: string, entities?: MessageEntity[]) => void
  /** Jump-to-message: replace the window with one centered on centerSeq. */
  jumpTo: (centerSeq: number) => Promise<void>
  /** Reset the window to the newest page (tweb onGoDownClick with no target):
   * the escape hatch after a jump landed us mid-history. */
  reloadNewest: () => Promise<void>
  /** A message was deleted (revoke or for-me): drop it from the window — deleted
   * messages are never shown (Telegram). */
  applyDelete: (msgId: number, forMe: boolean) => void
}

export function useMessageWindow(chatId: number, managers: ManagersLike, limit = 40): MessageWindow {
  const win = useMessagesStore((s) => s.byChat[chatId]) ?? EMPTY_WINDOW
  // guards against overlapping loads / stale chat responses
  const reqChat = useRef(chatId)

  useEffect(() => {
    reqChat.current = chatId
    const st = useMessagesStore.getState()
    st.beginLoad(chatId)
    let cancelled = false
    ;(async () => {
      const r = await managers.messages.getHistory({ chatId, offsetSeq: 0, addOffset: 0, limit })
      if (cancelled || reqChat.current !== chatId) return
      useMessagesStore.getState().setWindow(chatId, { msgs: r.messages, reachedTop: r.reachedTop, reachedBottom: r.reachedBottom, cached: r.cached })
    })()
    return () => { cancelled = true }
  }, [chatId, managers, limit])

  const loadOlder = useCallback(async () => {
    const w = useMessagesStore.getState().byChat[chatId] ?? EMPTY_WINDOW
    if (w.reachedTop || w.loadingOlder || w.loading) return
    const oldest = w.msgs[0]
    if (!oldest) return
    const st = useMessagesStore.getState()
    st.setLoadingOlder(chatId, true)
    try {
      const r = await managers.messages.getHistory({ chatId, offsetSeq: oldest.seq, addOffset: 1, limit })
      if (reqChat.current !== chatId) return
      useMessagesStore.getState().prepend(chatId, r.messages, r.reachedTop)
    } finally {
      useMessagesStore.getState().setLoadingOlder(chatId, false)
    }
  }, [chatId, managers, limit])

  const loadNewer = useCallback(async () => {
    const w = useMessagesStore.getState().byChat[chatId] ?? EMPTY_WINDOW
    if (w.reachedBottom || w.loadingNewer || w.loading) return
    const newest = w.msgs[w.msgs.length - 1]
    if (!newest) return
    const st = useMessagesStore.getState()
    st.setLoadingNewer(chatId, true)
    try {
      // addOffset = -limit means "load `limit` messages NEWER than newest.seq"
      // (tweb semantics). Passing 0 made the cache's sliceMe walk the OLDER
      // direction in the descending slice and report a false hit (the already-loaded
      // window), so newer pages never fetched after a jump-to-message. The backend
      // only checks the sign (<=0 ⇒ newer), so the network result is unchanged.
      const r = await managers.messages.getHistory({ chatId, offsetSeq: newest.seq, addOffset: -limit, limit })
      if (reqChat.current !== chatId) return
      useMessagesStore.getState().append(chatId, r.messages, r.reachedBottom)
    } finally {
      useMessagesStore.getState().setLoadingNewer(chatId, false)
    }
  }, [chatId, managers, limit])

  const appendLocal = useCallback((m: Message) => useMessagesStore.getState().appendLocal(chatId, m), [chatId])

  const appendOptimistic = useCallback(
    (text: string, meId: number, clientMsgId: string, mediaId?: number, type = 'text', entities?: MessageEntity[]) =>
      useMessagesStore.getState().appendOptimistic(chatId, text, meId, clientMsgId, mediaId, type, entities),
    [chatId],
  )

  const reconcileAck = useCallback(
    (clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) =>
      useMessagesStore.getState().reconcileAck(chatId, clientMsgId, ack),
    [chatId],
  )

  const failOptimistic = useCallback((clientMsgId: string) => useMessagesStore.getState().failOptimistic(chatId, clientMsgId), [chatId])

  const applyIncoming = useCallback((m: Message) => useMessagesStore.getState().applyIncoming(chatId, m), [chatId])

  const applyEdit = useCallback(
    (msgId: number, text: string, editedAt: string, entities?: MessageEntity[]) =>
      useMessagesStore.getState().applyEdit(chatId, msgId, text, editedAt, entities),
    [chatId],
  )

  const applyDelete = useCallback((msgId: number, _forMe: boolean) => useMessagesStore.getState().applyDelete(chatId, msgId), [chatId])

  const jumpTo = useCallback(async (centerSeq: number) => {
    if (!managers.messages.getAround) return
    const r = await managers.messages.getAround(chatId, centerSeq, limit)
    if (reqChat.current !== chatId) return
    useMessagesStore.getState().setWindow(chatId, { msgs: r.messages, reachedTop: r.reachedTop, reachedBottom: r.reachedBottom })
  }, [chatId, managers, limit])

  // Escape hatch after a jump: re-fetch the newest page and replace the window
  // with it (mirrors tweb's setMessageId() with no target — go to dialog.top).
  const reloadNewest = useCallback(async () => {
    const r = await managers.messages.getHistory({ chatId, offsetSeq: 0, addOffset: 0, limit })
    if (reqChat.current !== chatId) return
    useMessagesStore.getState().setWindow(chatId, { msgs: r.messages, reachedTop: r.reachedTop, reachedBottom: r.reachedBottom })
  }, [chatId, managers, limit])

  return {
    msgs: win.msgs,
    reachedTop: win.reachedTop,
    reachedBottom: win.reachedBottom,
    loadingOlder: win.loadingOlder,
    loadingNewer: win.loadingNewer,
    loading: win.loading,
    loadedFromCache: win.loadedFromCache,
    loadOlder, loadNewer, jumpTo, reloadNewest,
    appendLocal, appendOptimistic, reconcileAck, failOptimistic, applyIncoming, applyEdit, applyDelete,
  }
}
