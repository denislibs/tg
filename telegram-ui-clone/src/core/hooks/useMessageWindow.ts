// src/core/hooks/useMessageWindow.ts
//
// Thin selector/actions wrapper over messagesStore: the per-chat window lives in
// the store (single source of truth, normalized, survives unmount), this hook
// just binds it to a chatId and preserves the original MessageWindow interface.
//
// State + actions are pulled through useMessagesStore selectors only (no
// getState()). The paging callbacks read the latest committed window through a
// ref mirror of the selected value, and guard re-entry with synchronous in-flight
// refs (a burst of scroll events can fire several times before React re-renders,
// so the store's loading flag isn't visible yet).
import { useCallback, useEffect, useRef } from 'react'
import type { Message, MessageEntity } from '../models'
import { useMessagesStore, EMPTY_WINDOW, winKey, type OptimisticMedia } from '../../stores/messagesStore'
import { useManagers } from './useManagers'

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
  appendOptimistic: (text: string, meId: number, clientMsgId: string, mediaId?: number, type?: string, entities?: MessageEntity[], groupedId?: string, media?: OptimisticMedia, extra?: { geo?: { lat: number; lng: number }; contact?: { userId: number; name: string; phone: string } }) => void
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

export function useMessageWindow(chatId: number, limit = 40, threadRootId?: number): MessageWindow {
  // Окно треда (форум-топик/комментарии) живёт под своим ключом (tweb threadId).
  const key = winKey(chatId, threadRootId)
  const win = useMessagesStore((s) => s.byKey[key]) ?? EMPTY_WINDOW
  const managers = useManagers()

  // Store actions — stable references, pulled via selectors (never getState()).
  const beginLoad = useMessagesStore((s) => s.beginLoad)
  const setWindow = useMessagesStore((s) => s.setWindow)
  const setLoadingOlder = useMessagesStore((s) => s.setLoadingOlder)
  const setLoadingNewer = useMessagesStore((s) => s.setLoadingNewer)
  const prepend = useMessagesStore((s) => s.prepend)
  const append = useMessagesStore((s) => s.append)
  const appendLocalAction = useMessagesStore((s) => s.appendLocal)
  const appendOptimisticAction = useMessagesStore((s) => s.appendOptimistic)
  const reconcileAckAction = useMessagesStore((s) => s.reconcileAck)
  const failOptimisticAction = useMessagesStore((s) => s.failOptimistic)
  const applyIncomingAction = useMessagesStore((s) => s.applyIncoming)
  const applyEditAction = useMessagesStore((s) => s.applyEdit)
  const applyDeleteAction = useMessagesStore((s) => s.applyDelete)

  // guards against overlapping loads / stale chat/thread responses
  const reqChat = useRef(key)
  // Latest committed window, mirrored from the selector so the paging callbacks can
  // read current msgs/flags without subscribing-in-deps or getState().
  const winRef = useRef(win)
  winRef.current = win
  // Synchronous in-flight guards (the store's loading flag lags a render behind).
  const loadingOlderRef = useRef(false)
  const loadingNewerRef = useRef(false)

  useEffect(() => {
    reqChat.current = key
    loadingOlderRef.current = false
    loadingNewerRef.current = false
    beginLoad(key)
    let cancelled = false;
    (async () => {
      const r = await managers.messages.getHistory({ chatId, offsetSeq: 0, addOffset: 0, limit, threadRoot: threadRootId })
      if (cancelled || reqChat.current !== key) return
      setWindow(key, { msgs: r.messages, reachedTop: r.reachedTop, reachedBottom: r.reachedBottom, cached: r.cached })
    })()
    return () => { cancelled = true }
  }, [chatId, key, threadRootId, managers, limit, beginLoad, setWindow])

  const loadOlder = useCallback(async () => {
    const w = winRef.current
    if (w.reachedTop || loadingOlderRef.current || w.loading) return
    const oldest = w.msgs[0]
    if (!oldest) return
    loadingOlderRef.current = true
    setLoadingOlder(key, true)
    try {
      const r = await managers.messages.getHistory({ chatId, offsetSeq: oldest.seq, addOffset: 1, limit, threadRoot: threadRootId })
      if (reqChat.current !== key) return
      prepend(key, r.messages, r.reachedTop)
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(key, false)
    }
  }, [chatId, key, threadRootId, managers, limit, setLoadingOlder, prepend])

  const loadNewer = useCallback(async () => {
    const w = winRef.current
    if (w.reachedBottom || loadingNewerRef.current || w.loading) return
    const newest = w.msgs[w.msgs.length - 1]
    if (!newest) return
    loadingNewerRef.current = true
    setLoadingNewer(key, true)
    try {
      // addOffset = -limit means "load `limit` messages NEWER than newest.seq"
      // (tweb semantics). Passing 0 made the cache's sliceMe walk the OLDER
      // direction in the descending slice and report a false hit (the already-loaded
      // window), so newer pages never fetched after a jump-to-message. The backend
      // only checks the sign (<=0 ⇒ newer), so the network result is unchanged.
      const r = await managers.messages.getHistory({ chatId, offsetSeq: newest.seq, addOffset: -limit, limit, threadRoot: threadRootId })
      if (reqChat.current !== key) return
      append(key, r.messages, r.reachedBottom)
    } finally {
      loadingNewerRef.current = false
      setLoadingNewer(key, false)
    }
  }, [chatId, key, threadRootId, managers, limit, setLoadingNewer, append])

  const appendLocal = useCallback((m: Message) => appendLocalAction(key, m), [key, appendLocalAction])

  const appendOptimistic = useCallback(
    (text: string, meId: number, clientMsgId: string, mediaId?: number, type = 'text', entities?: MessageEntity[], groupedId?: string, media?: OptimisticMedia, extra?: { geo?: { lat: number; lng: number }; contact?: { userId: number; name: string; phone: string } }) =>
      appendOptimisticAction(key, text, meId, clientMsgId, mediaId, type, entities, groupedId, media,
        { ...extra, threadRootId }),
    [key, threadRootId, appendOptimisticAction],
  )

  const reconcileAck = useCallback(
    (clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) =>
      reconcileAckAction(key, clientMsgId, ack),
    [key, reconcileAckAction],
  )

  const failOptimistic = useCallback((clientMsgId: string) => failOptimisticAction(key, clientMsgId), [key, failOptimisticAction])

  const applyIncoming = useCallback((m: Message) => applyIncomingAction(chatId, m), [chatId, applyIncomingAction])

  const applyEdit = useCallback(
    (msgId: number, text: string, editedAt: string, entities?: MessageEntity[]) =>
      applyEditAction(chatId, msgId, text, editedAt, entities),
    [chatId, applyEditAction],
  )

  const applyDelete = useCallback((msgId: number, _forMe: boolean) => applyDeleteAction(chatId, msgId), [chatId, applyDeleteAction])

  const jumpTo = useCallback(async (centerSeq: number) => {
    if (!managers.messages.getAround) return
    const r = await managers.messages.getAround(chatId, centerSeq, limit, threadRootId)
    if (reqChat.current !== key) return
    setWindow(key, { msgs: r.messages, reachedTop: r.reachedTop, reachedBottom: r.reachedBottom })
  }, [chatId, key, threadRootId, managers, limit, setWindow])

  // Escape hatch after a jump: re-fetch the newest page and replace the window
  // with it (mirrors tweb's setMessageId() with no target — go to dialog.top).
  const reloadNewest = useCallback(async () => {
    const r = await managers.messages.getHistory({ chatId, offsetSeq: 0, addOffset: 0, limit, threadRoot: threadRootId })
    if (reqChat.current !== key) return
    setWindow(key, { msgs: r.messages, reachedTop: r.reachedTop, reachedBottom: r.reachedBottom })
  }, [chatId, key, threadRootId, managers, limit, setWindow])

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
