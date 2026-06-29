// src/core/hooks/useChatSearch.ts
// In-chat message search. Open-state + query live in searchStore (single source of
// truth, per chat) so other parts (pinned bar, sticky-date offset) can see whether
// search is open without prop drilling; the debounced backend fetch + results stay
// local to whoever calls this hook (ChatHeader). The caller owns the presentation
// (input + dropdown) and decides what a result click does (jump-to-message).
import { useCallback, useEffect, useState } from 'react'
import type { Message } from '../models'
import { useSearchStore } from '../../stores/searchStore'

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
  const st = useSearchStore((s) => s.byChat[chatId])
  const open = st?.open ?? false
  const query = st?.query ?? ''
  const setOpen = useCallback((v: boolean) => useSearchStore.getState().setOpen(chatId, v), [chatId])
  const setQuery = useCallback((v: string) => useSearchStore.getState().setQuery(chatId, v), [chatId])
  const reset = useCallback(() => useSearchStore.getState().reset(chatId), [chatId])

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

  return { open, setOpen, query, setQuery, results, reset }
}
