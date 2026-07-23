// src/core/hooks/useSendAs.ts
//
// View-model for the composer's "send-as" identity (Telegram send_as): fetches
// the identities the user may post under in this chat (personal account, a linked
// channel they admin, the anonymous group) and remembers the chosen one per chat.
import { useEffect, useMemo, useState } from 'react'
import type { SendAsPeer } from '../managers/chatsManager'
import type { Managers } from '../../client/bootstrap'

// Per-chat selection, remembered across remounts / chat switches (tweb keeps the
// default_send_as; we keep the last explicit pick in-session).
const selection = new Map<number, number>()

export interface SendAsVM {
  peers: SendAsPeer[]
  currentId: number
  select: (peerId: number) => void
}

export function useSendAs(chatId: number, enabled: boolean, meId: number | null, managers: Managers): SendAsVM {
  const [peers, setPeers] = useState<SendAsPeer[]>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setPeers([])
      return
    }
    let alive = true
    void managers.chats
      .getSendAs(chatId)
      .then((ps) => {
        if (alive) setPeers(ps)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [chatId, enabled, managers])

  // Current identity: the remembered pick if still offered, else the first
  // (personal account); falls back to meId until the list loads.
  const currentId = useMemo(() => {
    if (!peers.length) return meId ?? 0
    const stored = selection.get(chatId)
    if (stored != null && peers.some((p) => p.peerId === stored)) return stored
    return peers[0].peerId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, chatId, meId, tick])

  const select = (peerId: number) => {
    selection.set(chatId, peerId)
    setTick((n) => n + 1)
  }

  return { peers, currentId, select }
}
