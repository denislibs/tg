// src/components/call/CallProvider.tsx
// Тонкая chat-bound обёртка над callEngine: хедер/меню зовут start(video) без
// знания peer-деталей. Сам экран звонка глобален (CallOverlay в App) — входящий
// звонок показывается из любого места, а не только из открытого чата.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { startOutgoing, hangup } from '../../core/calls/callEngine'
import type { Chat } from '../../data'

interface CallContextValue {
  start: (video: boolean) => void
  end: () => void
}

const CallContext = createContext<CallContextValue | null>(null)

export function CallProvider({ chat, children }: { chat: Chat; children: ReactNode }) {
  const value = useMemo(
    () => ({
      start: (video: boolean) => {
        if (chat.peerId == null) return
        const numericChatId = Number(chat.id)
        startOutgoing(
          {
            id: chat.peerId,
            name: chat.name,
            avatar: chat.avatar,
            avatarText: chat.avatarText,
            avatarUrl: chat.avatarUrl,
          },
          video,
          Number.isFinite(numericChatId) && String(numericChatId) === chat.id ? numericChatId : null,
        )
      },
      end: hangup,
    }),
    [chat],
  )
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCall must be used within <CallProvider>')
  return ctx
}
