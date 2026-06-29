// src/core/hooks/usePinnedBar.ts
// View-model hook for a chat's pinned messages. Reads the pins from pinsStore (the
// single source of truth) and triggers the initial load on open. Live updates are
// applied by realtimeBridge (the only socket subscriber) on rt:pin_message — this
// hook never listens to the socket, per the "only realtimeBridge subscribes" rule.
// The initial listPins() here is a fetch (read path), not a socket subscription.
import { useEffect } from 'react'
import { usePinsStore } from '../../stores/pinsStore'
import type { Message } from '../models'

interface PinManagers {
  messages: { listPins(chatId: number): Promise<Message[]> }
}

const NO_PINS: Message[] = []

export function usePinnedBar(numericChatId: number, isRealChat: boolean, managers: PinManagers): Message[] {
  const pins = usePinsStore((s) => s.byChat[numericChatId])

  useEffect(() => {
    const setPins = usePinsStore.getState().setPins
    if (!isRealChat) { setPins(numericChatId, NO_PINS); return }
    let alive = true
    void managers.messages.listPins(numericChatId).then((p) => { if (alive) setPins(numericChatId, p) })
    return () => { alive = false }
  }, [isRealChat, numericChatId, managers])

  return pins ?? NO_PINS
}
