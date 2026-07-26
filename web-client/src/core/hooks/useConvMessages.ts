// src/core/hooks/useConvMessages.ts
//
// Read-model for the message feed: maps the windowed Message[] (from
// useMessageWindow) into the ConvMsg[] the bubbles render, resolving sender /
// forward-origin / reply-author display names via usePeers and caching each
// converted row by value so unchanged rows keep a stable identity (the memoized
// <MessageRow> bails out; appending re-renders only the new/last row).
import { useMemo, useRef } from 'react'
import type { ConvMsg } from '../../data'
import { messageToConvMsg } from '../messageToConvMsg'
import { usePeers, peersKey } from './usePeers'
import type { Peer } from '../managers/peersManager'
import { useChatsStore } from '../../stores/chatsStore'
import type { MessageWindow } from './useMessageWindow'

interface UseConvMessagesArgs {
  numericChatId: number
  isRealChat: boolean
  isGroup: boolean
  win: MessageWindow
  meId: number | null
  /** имя канала для корневого поста треда комментариев (сообщение из ДРУГОГО
   * чата, подшитое бэком с seq=0): рендерится входящим от имени канала (tweb —
   * автофорвард поста, from_id = канал, isOut=false) */
  foreignRootName?: string
}

export function useConvMessages({ numericChatId, isRealChat, isGroup, win, meId, foreignRootName }: UseConvMessagesArgs): {
  msgs: ConvMsg[]
  peers: Map<number, Peer>
} {
  // Peer's read horizon (real chats): out messages with seq<=peerReadSeq render the
  // double-check (read). Read straight from the store dialog — it's seeded from
  // GET /chats (peer_read_seq) on load and advanced by applyRead on live rt:read,
  // so ticks are correct immediately on open and after switching chats.
  const peerReadSeq = useChatsStore((s) =>
    isRealChat ? s.dialogs.find((d) => d.chatId === numericChatId)?.peerReadSeq ?? 0 : 0,
  )

  // For real group chats, resolve incoming sender ids -> display names so bubbles
  // can show the author. Private chats never pass a senderName (unchanged).
  const resolveSenders = isRealChat && isGroup
  const senderIds = useMemo(
    () => {
      if (!isRealChat) return []
      const ids = resolveSenders ? win.msgs.filter((m) => m.senderId !== meId).map((m) => m.senderId) : []
      // Forward attribution ("Переслано от X") in ANY chat needs the origin's name.
      for (const m of win.msgs) if (m.fwdFromUserId != null) ids.push(m.fwdFromUserId)
      // Reply previews need the replied-to author's name (any chat).
      for (const m of win.msgs) if (m.replyTo && m.replyTo.senderId !== meId) ids.push(m.replyTo.senderId)
      return ids
    },
    // peersKey gives a stable dep that ignores ordering/duplicates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveSenders, isRealChat, meId, peersKey(win.msgs.map((m) => m.senderId)), peersKey(win.msgs.map((m) => m.fwdFromUserId ?? 0)), peersKey(win.msgs.map((m) => m.replyTo?.senderId ?? 0))],
  )
  const peers = usePeers(senderIds)

  // Per-message conversion cache: returns the SAME ConvMsg reference when the
  // converted value is unchanged (compared by its JSON), so unchanged rows keep a
  // stable identity → the memoized <MessageRow> bails out. Appending/sending then
  // re-renders only the new row (and the previous-last, whose group tail flips).
  const convCacheRef = useRef<Map<string | number, { json: string; conv: ConvMsg }>>(new Map())
  const msgs: ConvMsg[] = useMemo(() => {
    if (!isRealChat) return []
    const cache = convCacheRef.current
    const seen = new Set<string | number>()
    const next = win.msgs.map((m) => {
      let conv = messageToConvMsg(m, meId, {
        senderName: resolveSenders ? peers.get(m.senderId)?.displayName : undefined,
        readUpToSeq: peerReadSeq,
        forwardFromName: m.fwdFromUserId != null ? peers.get(m.fwdFromUserId)?.displayName : undefined,
        replyToName: m.replyTo ? peers.get(m.replyTo.senderId)?.displayName : undefined,
      })
      // Корневой пост канала в треде комментариев: всегда входящий, от имени
      // канала (даже если автор поста — я), без тиков.
      if (m.seq === 0 && m.chatId !== numericChatId) {
        conv = { ...conv, out: false, status: undefined, sender: foreignRootName || conv.sender, senderId: undefined }
      }
      const key = m.clientId ?? m.id ?? m.seq
      seen.add(key)
      const json = JSON.stringify(conv)
      const hit = cache.get(key)
      if (hit && hit.json === json) return hit.conv // value-identical → reuse stable ref
      cache.set(key, { json, conv })
      return conv
    })
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key)
    return next
  }, [isRealChat, win.msgs, meId, resolveSenders, peers, peerReadSeq, foreignRootName, numericChatId])

  return { msgs, peers }
}
