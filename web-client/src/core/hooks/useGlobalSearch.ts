import { useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import { useMiddlewareHelper } from './useMiddlewareHelper'
import type { Message } from '../models'

export type SearchFilter = '' | 'media' | 'links' | 'files' | 'music' | 'voice'

const PAGE = 30

// Глобальный поиск сообщений (managers.messages.searchGlobal) для SearchView:
// таб «Чаты» ищет по тексту (нужен q), медиа-табы листают по типу (filter), q
// дополнительно сужает. Дебаунс 250мс, смена таба/запроса сбрасывает список;
// onScroll подгружает следующую страницу у нижнего края. null = ещё грузится.
// Актуальность — @helpers/middleware: смена q/tab/filter (cleanup эффекта)
// гасит и первую страницу, и висящую пагинацию onScroll.
export function useGlobalSearch(q: string, tab: number, filter: SearchFilter): {
  msgs: Message[] | null
  msgCount: number
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void
} {
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()
  const [msgs, setMsgs] = useState<Message[] | null>(null)
  const [msgCount, setMsgCount] = useState(0)
  const loadingMore = useRef(false)

  useEffect(() => {
    const need = tab === 0 ? q !== '' : filter !== ''
    setMsgs(null)
    setMsgCount(0)
    if (!need) return
    const middleware = middlewareHelper.get()
    const id = window.setTimeout(() => {
      managers.messages.searchGlobal(q, filter, 0, PAGE)
        .then((r) => { if (middleware()) { setMsgs(r.messages); setMsgCount(r.count) } })
        .catch(() => { if (middleware()) { setMsgs([]); setMsgCount(0) } })
    }, 250)
    return () => {
      window.clearTimeout(id)
      middlewareHelper.clean()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab, filter])

  // Подгрузка следующей страницы у нижнего края скролла.
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 600) return
    if (loadingMore.current || msgs == null || msgs.length >= msgCount) return
    loadingMore.current = true
    const middleware = middlewareHelper.get()
    managers.messages.searchGlobal(q, filter, msgs.length, PAGE)
      .then((r) => { if (middleware()) setMsgs((cur) => [...(cur ?? []), ...r.messages]) })
      .catch(() => undefined)
      .finally(() => { loadingMore.current = false })
  }

  return { msgs, msgCount, onScroll }
}
