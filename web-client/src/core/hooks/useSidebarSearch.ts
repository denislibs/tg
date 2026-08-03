import { useEffect, useRef, useState } from 'react'
import { loadChats } from '../../stores/chatsStore'
import { useManagers } from './useManagers'
import type { SearchResult } from '../managers/channelsManager'

// Поиск в сайдбаре: строка запроса + режим поиска, REST-поиск публичных каналов и
// вступление по @username. Ctrl/Cmd+K (core/hotkeys → событие 'tg-focus-search')
// фокусирует поле; onFocus сам включает режим поиска.
export function useSidebarSearch(initialQuery?: string) {
  const managers = useManagers()
  const [query, setQuery] = useState(initialQuery ?? '')
  const [searching, setSearching] = useState(!!initialQuery)
  const inputRef = useRef<HTMLInputElement>(null)

  const closeSearch = () => {
    setSearching(false)
    setQuery('')
    inputRef.current?.blur()
  }

  useEffect(() => {
    const onFocusSearch = () => inputRef.current?.focus()
    window.addEventListener('tg-focus-search', onFocusSearch)
    return () => window.removeEventListener('tg-focus-search', onFocusSearch)
  }, [])

  const searchReal = (q: string): Promise<SearchResult> => managers.channels.search(q)
  const onJoin = async (username: string) => {
    await managers.channels.join(username)
    await loadChats(managers)
    closeSearch()
  }

  return { query, setQuery, searching, setSearching, inputRef, closeSearch, searchReal, onJoin }
}
