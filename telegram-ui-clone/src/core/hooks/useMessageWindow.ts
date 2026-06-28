// src/core/hooks/useMessageWindow.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message, MessageEntity } from '../models'
import type { HistoryResult } from '../managers/messagesManager'

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

function dedupAsc(list: Message[]): Message[] {
  const bySeq = new Map<number, Message>()
  for (const m of list) bySeq.set(m.seq, m)
  return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq)
}

export function useMessageWindow(chatId: number, managers: ManagersLike, limit = 40): MessageWindow {
  const [msgs, setMsgs] = useState<Message[]>([])
  const [reachedTop, setReachedTop] = useState(false)
  const [reachedBottom, setReachedBottom] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadedFromCache, setLoadedFromCache] = useState(false)
  // guards against overlapping loads / stale chat responses
  const reqChat = useRef(chatId)

  useEffect(() => {
    reqChat.current = chatId
    setMsgs([]); setReachedTop(false); setReachedBottom(false); setLoading(true)
    let cancelled = false
    ;(async () => {
      const r = await managers.messages.getHistory({ chatId, offsetSeq: 0, addOffset: 0, limit })
      if (cancelled || reqChat.current !== chatId) return
      setMsgs(dedupAsc(r.messages))
      setReachedTop(r.reachedTop)
      setReachedBottom(r.reachedBottom)
      setLoadedFromCache(!!r.cached)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [chatId, managers, limit])

  const loadOlder = useCallback(async () => {
    if (reachedTop || loadingOlder || loading) return
    const oldest = msgs[0]
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const r = await managers.messages.getHistory({ chatId, offsetSeq: oldest.seq, addOffset: 1, limit })
      if (reqChat.current !== chatId) return
      setMsgs((prev) => dedupAsc([...r.messages, ...prev]))
      setReachedTop(r.reachedTop)
    } finally {
      setLoadingOlder(false)
    }
  }, [chatId, managers, limit, msgs, reachedTop, loadingOlder, loading])

  const loadNewer = useCallback(async () => {
    if (reachedBottom || loadingNewer || loading) return
    const newest = msgs[msgs.length - 1]
    if (!newest) return
    setLoadingNewer(true)
    try {
      // addOffset = -limit means "load `limit` messages NEWER than newest.seq"
      // (tweb semantics). Passing 0 made the cache's sliceMe walk the OLDER
      // direction in the descending slice and report a false hit (the already-loaded
      // window), so newer pages never fetched after a jump-to-message. The backend
      // only checks the sign (<=0 ⇒ newer), so the network result is unchanged.
      const r = await managers.messages.getHistory({ chatId, offsetSeq: newest.seq, addOffset: -limit, limit })
      if (reqChat.current !== chatId) return
      setMsgs((prev) => dedupAsc([...prev, ...r.messages]))
      setReachedBottom(r.reachedBottom)
    } finally {
      setLoadingNewer(false)
    }
  }, [chatId, managers, limit, msgs, reachedBottom, loadingNewer, loading])

  const appendLocal = useCallback((m: Message) => {
    setMsgs((prev) => dedupAsc([...prev, m]))
  }, [])

  const pending = useRef<Map<string, number>>(new Map())

  const appendOptimistic = useCallback((text: string, meId: number, clientMsgId: string, mediaId?: number, type = 'text', entities?: MessageEntity[]) => {
    setMsgs((prev) => {
      const maxSeq = prev.length ? prev[prev.length - 1].seq : 0
      const tentativeSeq = maxSeq + 1
      pending.current.set(clientMsgId, tentativeSeq)
      const tmp: Message = { id: -Date.now(), chatId, seq: tentativeSeq, senderId: meId, type, text, entities, replyToId: null, mediaId: mediaId ?? null, createdAt: new Date().toISOString(), threadRootId: null, clientId: clientMsgId }
      return dedupAsc([...prev, tmp])
    })
  }, [chatId])

  const reconcileAck = useCallback((clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => {
    const tentativeSeq = pending.current.get(clientMsgId)
    if (tentativeSeq === undefined) return
    pending.current.delete(clientMsgId)
    setMsgs((prev) => dedupAsc(prev.map((m) => m.seq === tentativeSeq ? { ...m, id: ack.msgId, seq: ack.seq, createdAt: ack.createdAt } : m)))
  }, [])

  const failOptimistic = useCallback((clientMsgId: string) => {
    pending.current.delete(clientMsgId)
    setMsgs((prev) => prev.filter((m) => m.clientId !== clientMsgId))
  }, [])

  const applyIncoming = useCallback((m: Message) => {
    setMsgs((prev) => {
      if (prev.some((x) => x.id === m.id)) return prev
      // The realtime echo of our OWN just-sent message arrives with the server
      // id/seq but no clientId, and dedupAsc (keyed by seq) would replace the
      // optimistic entry — flipping its React key (clientId → m-<id>) and
      // remounting the bubble mid-appear. Carry the optimistic clientId over so
      // the key stays stable and the appear animation isn't cut short.
      const optimistic = prev.find((x) => x.clientId && x.seq === m.seq)
      const merged = optimistic ? { ...m, clientId: optimistic.clientId } : m
      return dedupAsc([...prev, merged])
    })
  }, [])

  const jumpTo = useCallback(async (centerSeq: number) => {
    if (!managers.messages.getAround) return
    const r = await managers.messages.getAround(chatId, centerSeq, limit)
    if (reqChat.current !== chatId) return
    setMsgs(dedupAsc(r.messages))
    setReachedTop(r.reachedTop)
    setReachedBottom(r.reachedBottom)
    setLoading(false)
  }, [chatId, managers, limit])

  // Escape hatch after a jump: re-fetch the newest page and replace the window
  // with it (mirrors tweb's setMessageId() with no target — go to dialog.top).
  const reloadNewest = useCallback(async () => {
    const r = await managers.messages.getHistory({ chatId, offsetSeq: 0, addOffset: 0, limit })
    if (reqChat.current !== chatId) return
    setMsgs(dedupAsc(r.messages))
    setReachedTop(r.reachedTop)
    setReachedBottom(r.reachedBottom)
    setLoading(false)
  }, [chatId, managers, limit])

  const applyEdit = useCallback((msgId: number, text: string, editedAt: string, entities?: MessageEntity[]) => {
    setMsgs((prev) => prev.map((m) => (m.id === msgId ? { ...m, text, editedAt, entities } : m)))
  }, [])

  const applyDelete = useCallback((msgId: number, _forMe: boolean) => {
    setMsgs((prev) => prev.filter((m) => m.id !== msgId))
  }, [])

  return { msgs, reachedTop, reachedBottom, loadingOlder, loadingNewer, loading, loadedFromCache, loadOlder, loadNewer, jumpTo, reloadNewest, appendLocal, appendOptimistic, reconcileAck, failOptimistic, applyIncoming, applyEdit, applyDelete }
}
