// src/core/hooks/useDiscussion.ts
//
// ViewModel for a channel-post discussion thread: loads the initial page of
// comments (command on open), reads live comments from the discussion store
// (filled by realtimeBridge), resolves sender names, and exposes an optimistic
// `send`. DiscussionView is then a dumb render of `comments` + a `send` callback.
import { useEffect, useMemo } from 'react'
import { useDiscussionStore, threadKey } from '../../stores/discussionStore'
import { useChatsStore } from '../../stores/chatsStore'
import { usePeers, peersKey } from './usePeers'
import { useManagers } from './useManagers'

// Per-author tint for sender names (same palette tweb uses for peers).
const PEER_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774']
function peerColor(seed: number): string {
  return PEER_COLORS[Math.abs(seed) % PEER_COLORS.length]
}
function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export interface DisplayComment {
  key: string
  name: string
  text: string
  time: string
  color: string // peer tint for the name/avatar; '' for own messages
  out: boolean
}

export function useDiscussion(channelId: number, postId: number, discussionChatId: number): {
  comments: DisplayComment[]
  count: number
  send: (text: string) => void
} {
  const managers = useManagers()
  const meId = useChatsStore((s) => s.meId)
  const key = threadKey(discussionChatId, postId)
  const setComments = useDiscussionStore((s) => s.setComments)
  const addOptimistic = useDiscussionStore((s) => s.addOptimistic)
  const reconcile = useDiscussionStore((s) => s.reconcile)
  const clear = useDiscussionStore((s) => s.clear)
  const raw = useDiscussionStore((s) => s.byThread[key]?.comments)

  // Initial load (a command on open). Cleanup drops the thread from the store on
  // unmount / post switch, so live frames stop landing for a closed thread.
  useEffect(() => {
    let alive = true
    void managers.channels.listComments(channelId, postId).then(({ messages }) => {
      if (!alive) return
      setComments(
        key,
        messages.map((m) => ({ id: m.id, senderId: m.senderId, text: m.text, createdAt: m.createdAt })),
      )
    })
    return () => {
      alive = false
      clear(key)
    }
  }, [channelId, postId, key, managers, setComments, clear])

  const comments = raw ?? []
  // Resolve names for other authors only (own messages show "You").
  const senderIds = useMemo(
    () => comments.filter((c) => c.senderId !== meId).map((c) => c.senderId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peersKey(comments.map((c) => c.senderId)), meId],
  )
  const peers = usePeers(senderIds)

  const display: DisplayComment[] = comments.map((c, i) => {
    const out = c.senderId === meId
    const p = peers.get(c.senderId)
    return {
      key: c.clientId ?? String(c.id ?? i),
      name: out ? 'You' : p?.displayName || p?.username || `#${c.senderId}`,
      text: c.text,
      time: fmtTime(c.createdAt),
      color: out ? '' : peerColor(c.senderId),
      out,
    }
  })

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || meId == null) return
    const clientMsgId = `c-disc-${postId}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    // Optimistic append; the server echo (same id) is deduped via the store's seen set.
    addOptimistic(key, { clientId: clientMsgId, senderId: meId, text: trimmed, createdAt: new Date().toISOString() })
    void managers.channels.postComment(channelId, postId, trimmed, clientMsgId).then((m) => reconcile(key, clientMsgId, m.id))
  }

  return { comments: display, count: display.length, send }
}
