// src/core/hooks/useChatSearch.ts
// In-chat message search. Open-state + query live in searchStore (single source of
// truth, per chat) so other parts (pinned bar, sticky-date offset) can see whether
// search is open without prop drilling; the debounced backend fetch + results +
// filters stay local to whoever calls this hook (ChatHeader). The caller owns the
// presentation (input + dropdown + filter chips) and decides what a result click
// does (jump-to-message).
import { useCallback, useEffect, useState } from 'react'
import type { Message } from '../models'
import { useSearchStore } from '../../stores/searchStore'

// Media-type filter values (совпадают с бэком): tweb inputMessagesFilter*.
export type SearchMediaType = 'photo' | 'video' | 'voice' | 'roundvideo' | 'file' | 'link' | 'music'

// Активные фильтры поиска (tweb topbarSearch: от кого / тип / реакция).
export interface SearchFilters {
  senderId?: number
  mediaType?: SearchMediaType
  reaction?: string
}

interface ChatSearchManagers {
  messages: {
    searchMessages(
      chatId: number,
      q: string,
      opts?: { senderId?: number; mediaType?: string; reaction?: string; offset?: number; limit?: number },
    ): Promise<{ messages: Message[]; count: number }>
    messageByDate(chatId: number, date: number): Promise<number | null>
  }
}

export interface ChatSearch {
  open: boolean
  setOpen: (v: boolean) => void
  query: string
  setQuery: (v: string) => void
  results: Message[]
  filters: SearchFilters
  setFilters: (f: SearchFilters) => void
  /** есть ли активный фильтр (сужает выдачу даже при пустом запросе) */
  hasFilter: boolean
  /** jump-to-date: seq ближайшего сообщения на/после даты (unix, сек) или null */
  jumpToDate: (date: number) => Promise<number | null>
  reset: () => void
}

export function useChatSearch(chatId: number, enabled: boolean, managers: ChatSearchManagers): ChatSearch {
  const st = useSearchStore((s) => s.byChat[chatId])
  const open = st?.open ?? false
  const query = st?.query ?? ''
  const setOpen = useCallback((v: boolean) => useSearchStore.getState().setOpen(chatId, v), [chatId])
  const setQuery = useCallback((v: string) => useSearchStore.getState().setQuery(chatId, v), [chatId])

  const [results, setResults] = useState<Message[]>([])
  const [filters, setFilters] = useState<SearchFilters>({})
  const hasFilter = filters.senderId != null || filters.mediaType != null || filters.reaction != null

  const reset = useCallback(() => {
    useSearchStore.getState().reset(chatId)
    setFilters({})
  }, [chatId])

  // Debounced query/filters → backend; results power the dropdown. Пустой запрос
  // без фильтров искать нечего.
  useEffect(() => {
    if (!enabled || !open) { setResults([]); return }
    const q = query.trim()
    if (!q && !hasFilter) { setResults([]); return }
    let alive = true
    const t = window.setTimeout(() => {
      void managers.messages.searchMessages(chatId, q, {
        senderId: filters.senderId,
        mediaType: filters.mediaType,
        reaction: filters.reaction,
      }).then((r) => { if (alive) setResults(r.messages) })
    }, 250)
    return () => { alive = false; window.clearTimeout(t) }
  }, [enabled, open, query, chatId, managers, filters, hasFilter])

  const jumpToDate = useCallback(
    (date: number) => managers.messages.messageByDate(chatId, date),
    [chatId, managers],
  )

  return { open, setOpen, query, setQuery, results, filters, setFilters, hasFilter, jumpToDate, reset }
}
