// src/core/hooks/useChatInfoCard.ts
// View-model hook for a real group/channel's header card (extracted from
// ConversationView): fetches type + member count + my rights, and for groups the
// member snapshot (seeding their presence into the store as the single source of
// truth). Derives the post/type permissions, discussion wiring, and the live online
// count. Behaviour is unchanged.
import { useEffect, useRef, useState } from 'react'
import { useChatsStore } from '../../stores/chatsStore'

interface Card {
  type: string
  memberCount: number
  myRole: string
  myRights: number
  discussionChatId: number
  slowmodeSeconds: number
  chargeStars: number
}

interface InfoManagers {
  groups: {
    card(chatId: number): Promise<Card>
    members(chatId: number): Promise<{ userId: number; role: string; online: boolean }[]>
  }
}

export interface ChatInfoCard {
  card: Card | null
  /** Channels: only posters (creator / POST_MESSAGES) may type; groups & private always can. */
  canType: boolean
  discussionChatId: number
  discussionsEnabled: boolean
  /** Live count of online group members (derived from chatsStore.presence). */
  onlineCount: number
}

export function useChatInfoCard(args: {
  isRealChat: boolean
  isChannel: boolean
  numericChatId: number
  managers: InfoManagers
}): ChatInfoCard {
  const { isRealChat, isChannel, numericChatId, managers } = args
  const [card, setCard] = useState<Card | null>(null)
  const memberIds = useRef<Set<number>>(new Set())
  // Online status is single-sourced from chatsStore.presence (fed by realtimeBridge);
  // we seed members' presence on load and derive the count below — no local listener.
  const setPresence = useChatsStore((s) => s.setPresence)

  // Fetch the card (type + memberCount) and, for groups, the member snapshot (seeds
  // memberIds + initial online state). Reset on chat change so no stale count leaks.
  useEffect(() => {
    setCard(null)
    memberIds.current = new Set()
    if (!isRealChat) return
    let alive = true
    void managers.groups.card(numericChatId).then((c) => {
      if (!alive) return
      setCard({ type: c.type, memberCount: c.memberCount, myRole: c.myRole, myRights: c.myRights, discussionChatId: c.discussionChatId, slowmodeSeconds: c.slowmodeSeconds, chargeStars: c.chargeStars })
      if (c.type === 'group') {
        void managers.groups.members(numericChatId).then((mem) => {
          if (!alive) return
          memberIds.current = new Set(mem.map((m) => m.userId))
          // Seed members' presence into the store (single source of truth); preserve
          // any existing lastSeen so a private-chat peer's "last seen" text isn't lost.
          const cur = useChatsStore.getState().presence
          for (const m of mem) setPresence({ user_id: m.userId, online: m.online, last_seen: cur[m.userId]?.lastSeen ?? 0 })
        })
      }
    })
    return () => { alive = false }
  }, [isRealChat, numericChatId, managers, setPresence])

  const discussionChatId = card?.discussionChatId ?? 0
  const discussionsEnabled = isRealChat && isChannel && discussionChatId > 0
  const canPostChannel = card?.myRole === 'creator' || ((card?.myRights ?? 0) & 1) === 1
  const canType = !isChannel || canPostChannel

  // Count members currently online. Re-renders only when the number changes
  // (presence frames for non-members don't touch it).
  const onlineCount = useChatsStore((s) => {
    let n = 0
    for (const id of memberIds.current) if (s.presence[id]?.online) n++
    return n
  })

  return { card, canType, discussionChatId, discussionsEnabled, onlineCount }
}
