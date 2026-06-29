// src/core/hooks/useChatSearch.ts
// In-chat message search extracted from ConversationView: owns the panel open
// state, the query, and the debounced backend fetch that powers the results
// dropdown. The component keeps the presentation (input + dropdown) and decides
// what a result click does (jump-to-message).
import { useCallback, useEffect, useState } from 'react'
import type { Message } from '../models'

interface ChatSearchManagers {
  messages: {
    searchMessages(chatId: number, q: string, offset?: number, limit?: number): Promise<{ messages: Message[]; count: number }>
  }
}

export interface ChatSearch {
  open: boolean
  setOpen: (v: boolean) => void
  query: string
  setQuery: (v: string) => void
  results: Message[]
  reset: () => void
}

export function useChatSearch(chatId: number, enabled: boolean, managers: ChatSearchManagers): ChatSearch {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Message[]>([])

  // Debounced query → backend; results power the dropdown.
  useEffect(() => {
    if (!enabled || !open) { setResults([]); return }
    const q = query.trim()
    if (!q) { setResults([]); return }
    let alive = true
    const t = window.setTimeout(() => {
      void managers.messages.searchMessages(chatId, q)
          .then((r) => { if (alive) setResults(r.messages) })
    }, 250)
    return () => { alive = false; window.clearTimeout(t) }
  }, [enabled, open, query, chatId, managers])

  const reset = useCallback(() => { setOpen(false); setQuery('') }, [])

  return { open, setOpen, query, setQuery, results, reset }
}
