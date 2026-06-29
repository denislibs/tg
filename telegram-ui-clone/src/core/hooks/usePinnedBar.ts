// src/core/hooks/usePinnedBar.ts
// View-model hook for a chat's pinned messages (extracted from ConversationView):
// loads the pin list on open and refreshes it on a live pin_message for this chat.
// Behaviour is unchanged. (A future step may replace the refetch with a pins store
// fed by realtimeBridge — see Этап 1b in the refactor plan.)
import { useEffect, useState } from 'react'
import { uiEvents } from './uiEvents'
import { RT } from '../realtime/events'
import type { Message } from '../models'

interface PinManagers {
  messages: { listPins(chatId: number): Promise<Message[]> }
}

export function usePinnedBar(numericChatId: number, isRealChat: boolean, managers: PinManagers): Message[] {
  const [pins, setPins] = useState<Message[]>([])

  useEffect(() => {
    if (!isRealChat) { setPins([]); return }
    let alive = true
    const refresh = () => { void managers.messages.listPins(numericChatId).then((p) => { if (alive) setPins(p) }) }
    refresh()
    const off = uiEvents.on(RT.pinMessage, (raw) => {
      const e = raw as { chat_id: number }
      if (e.chat_id === numericChatId) refresh()
    })
    return () => { alive = false; off() }
  }, [isRealChat, numericChatId, managers])

  return pins
}
