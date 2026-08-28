// src/core/hooks/useChatSearch.ts
// Загрузчики топбар-поиска — 1:1 по смыслу с tweb `components/chat/topbarSearch.tsx`:
//   • createSearchLoader (topbarSearch.tsx:98)      → useMessageSearchLoader
//   • createParticipantsLoader (topbarSearch.tsx:169) → useSenderSearchLoader
// Оба — «загружаемый список» (createLoadableList): values + count + loadMore,
// докачка страницами по 30, сброс при смене ключа запроса. Открытость панели
// живёт в searchStore (её видят пин-бар и колонка чата), сам запрос — в компоненте.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MyMessage } from '../models'
import { useManagers } from './useManagers'
import { usePeers } from './usePeers'
import { getPeerTitle } from '../peers/getPeerTitle'

// tweb topbarSearch.tsx:118 / :181 — limit: 30 у обоих загрузчиков
const LIMIT = 30

export interface MessageSearchLoader {
  messages: MyMessage[]
  /** tweb count() — сколько СТРОК уже отрисовано (от него считается высота списка) */
  count: number | undefined
  /** tweb totalCount() — сколько всего нашёл сервер */
  totalCount: number | undefined
  loading: boolean
  /** tweb loader().loadMore — undefined, когда достигнут конец выдачи */
  loadMore: (() => void) | undefined
}

/**
 * Поиск сообщений в чате (tweb createSearchLoader). Пустой запрос без фильтров
 * «от кого»/«реакция» ничего не грузит и оставляет count undefined — так tweb
 * держит список схлопнутым (topbarSearch.tsx:819).
 */
export function useMessageSearchLoader(
  peerId: number,
  o: { enabled: boolean; query: string; fromPeerId?: number; reaction?: string },
): MessageSearchLoader {
  const managers = useManagers()
  const { enabled, query, fromPeerId, reaction } = o

  const [messages, setMessages] = useState<MyMessage[]>([])
  const [count, setCount] = useState<number | undefined>(undefined)
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined)
  const [isEnd, setIsEnd] = useState(false)
  const [loading, setLoading] = useState(false)

  // tweb: isEmptyQuery = !query.trim() || query === '#'
  const isEmptyQuery = !query.trim() || query === '#'
  const idle = !enabled || (isEmptyQuery && !fromPeerId && !reaction)

  // Ключ запроса: его смена — это новый загрузчик (tweb пересоздаёт createSearchLoader).
  const key = `${peerId}|${query}|${fromPeerId ?? ''}|${reaction ?? ''}|${idle}`
  const keyRef = useRef(key)
  const busyRef = useRef(false)

  const fetchPage = useCallback(
    async (offset: number, forKey: string) => {
      if (busyRef.current) return
      busyRef.current = true
      setLoading(true)
      try {
        const r = await managers.messages.searchMessages(peerId, query.trim(), {
          senderId: fromPeerId,
          reaction,
          offset,
          limit: LIMIT,
        })
        if (keyRef.current !== forKey) return
        setMessages((prev) => (offset === 0 ? r.messages : [...prev, ...r.messages]))
        setCount((prev) => (offset === 0 ? r.messages.length : (prev ?? 0) + r.messages.length))
        setTotalCount(r.count)
        setIsEnd(r.messages.length < LIMIT)
      } finally {
        if (keyRef.current === forKey) setLoading(false)
        busyRef.current = false
      }
    },
    [managers, peerId, query, fromPeerId, reaction],
  )

  useEffect(() => {
    keyRef.current = key
    busyRef.current = false
    setMessages([])
    setCount(undefined)
    setTotalCount(undefined)
    setIsEnd(false)
    if (idle) {
      setLoading(false)
      return
    }
    void fetchPage(0, key)
    // fetchPage меняется ровно вместе с key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const loadMore = useMemo(() => {
    if (idle || isEnd) return undefined
    return () => void fetchPage(messages.length, key)
  }, [idle, isEnd, fetchPage, messages.length, key])

  return { messages, count, totalCount, loading, loadMore }
}

export interface SenderSearchLoader {
  peerIds: number[]
  count: number | undefined
  loading: boolean
}

/**
 * Подбор отправителя для фильтра «From:» (tweb createParticipantsLoader →
 * appProfileManager.getParticipants c фильтром channelParticipantsSearch).
 *
 * отступление от tweb: наш `/chats/:id/members` не принимает поисковую строку и
 * не пагинируется, поэтому список участников тянется целиком один раз, а отбор по
 * запросу идёт на клиенте по имени/@username. Серверный поиск по участникам —
 * в отчёте как требование к бэкенду.
 */
export function useSenderSearchLoader(peerId: number, o: { enabled: boolean; query: string }): SenderSearchLoader {
  const managers = useManagers()
  const [members, setMembers] = useState<number[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!o.enabled) {
      setMembers(null)
      return
    }
    let alive = true
    setLoading(true)
    void managers.groups
      .members(peerId)
      .then((m) => { if (alive) setMembers(m.map((x) => x.userId)) })
      .catch(() => { if (alive) setMembers([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [o.enabled, peerId, managers])

  const ids = useMemo(() => members ?? [], [members])
  const peers = usePeers(ids)

  const peerIds = useMemo(() => {
    if (members === null) return []
    const q = o.query.trim().toLowerCase()
    if (!q) return members
    return members.filter((id) => {
      const p = peers.get(id)
      // Имя собирает клиент; юзернейм есть только у конструктора `user`.
      return getPeerTitle({ peerId: id, peer: p }).toLowerCase().includes(q) ||
        (p?._ === 'user' ? p.username ?? '' : '').toLowerCase().includes(q)
    })
  }, [members, peers, o.query])

  return { peerIds, count: members === null ? undefined : peerIds.length, loading }
}
