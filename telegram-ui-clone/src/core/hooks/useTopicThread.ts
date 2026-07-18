// ViewModel треда форум-топика — зеркало useDiscussion, но тред живёт в САМОМ
// чате: загрузка через messages.threadMessages, отправка обычным sendMessage с
// threadRootId. Live-сообщения приходят тем же путём (realtimeBridge кладёт
// любые thread_root_id-сообщения в discussionStore по ключу (chat, root)).
import { useEffect, useMemo } from 'react'
import { useDiscussionStore, threadKey } from '../../stores/discussionStore'
import { useChatsStore } from '../../stores/chatsStore'
import { usePeers, peersKey } from './usePeers'
import { useManagers } from './useManagers'
import type { DisplayComment } from './useDiscussion'

const PEER_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774']
const peerColor = (seed: number) => PEER_COLORS[Math.abs(seed) % PEER_COLORS.length]
const fmtTime = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function useTopicThread(chatId: number, rootMsgId: number): {
  comments: DisplayComment[]
  send: (text: string) => void
} {
  const managers = useManagers()
  const meId = useChatsStore((s) => s.meId)
  const key = threadKey(chatId, rootMsgId)
  const setComments = useDiscussionStore((s) => s.setComments)
  const addOptimistic = useDiscussionStore((s) => s.addOptimistic)
  const reconcile = useDiscussionStore((s) => s.reconcile)
  const clear = useDiscussionStore((s) => s.clear)
  const raw = useDiscussionStore((s) => s.byThread[key]?.comments)

  useEffect(() => {
    let alive = true
    void managers.messages.threadMessages(chatId, rootMsgId).then(({ messages }) => {
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
  }, [chatId, rootMsgId, key, managers, setComments, clear])

  const comments = raw ?? []
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
    const clientMsgId = `c-topic-${rootMsgId}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    addOptimistic(key, { clientId: clientMsgId, senderId: meId, text: trimmed, createdAt: new Date().toISOString() })
    void managers.messages
      .sendMessage({ chatId, text: trimmed, clientMsgId, threadRootId: rootMsgId })
      .then((m) => reconcile(key, clientMsgId, m.id))
  }

  return { comments: display, send }
}
