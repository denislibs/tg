// src/components/call/CallProvider.tsx
// Renders the call UI (markup) from the global callStore and exposes a hook to
// start/end a call bound to the conversation's chat — so the call screen is no
// longer inline in ConversationView and no onCall callback is drilled into the
// header. State/logic live in callStore; this provider owns only the markup + a
// chat-bound convenience API.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import CallScreen from '../CallScreen'
import { useCallStore } from '../../stores/callStore'
import type { Chat } from '../../data'

interface CallContextValue {
  start: (video: boolean) => void
  end: () => void
}

const CallContext = createContext<CallContextValue | null>(null)

export function CallProvider({ chat, children }: { chat: Chat; children: ReactNode }) {
  const call = useCallStore((s) => s.call)
  const startCall = useCallStore((s) => s.startCall)
  const endCall = useCallStore((s) => s.endCall)
  // Stable, chat-bound API so consumers (the header) just call start(video).
  const value = useMemo(
    () => ({ start: (video: boolean) => startCall(chat, video), end: endCall }),
    [chat, startCall, endCall],
  )

  return (
    <CallContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {call && <CallScreen chat={call.chat} video={call.video} onClose={endCall} />}
      </AnimatePresence>
    </CallContext.Provider>
  )
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCall must be used within <CallProvider>')
  return ctx
}
