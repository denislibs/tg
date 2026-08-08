// Логика поиска в чате для шапки: открытие/запрос (single-sourced в searchStore),
// дебаунс-фетч, фильтры (от кого / тип / реакция), участники группы и результаты
// (имя отправителя + время резолвятся здесь из peers/me/lang). UI — в ChatSearchCard.
import { createElement, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useManagers } from './useManagers'
import { openPopup } from '../../stores/popupStore'
import DatePickerPopup, { DATE_PICKER_POPUP_KIND } from '../../components/DatePickerPopup'
import { useChatSearch } from './useChatSearch'
import { usePeers } from './usePeers'
import { useChatsStore } from '../../stores/chatsStore'
import { gradientFor } from '../dialogToChat'
import { friendlyMsgTime } from '../format/friendlyTime'
import { useT, useLang } from '../../i18n'
import { MEDIA_TYPES, type SearchResultRow } from '../../components/conversation/chatSearchMeta'
import type { Chat } from '../../data'

export type FilterKind = 'sender' | 'type' | 'reaction'

export function useChatHeaderSearch(chat: Chat, onJumpToSeq: (seq: number) => void) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  const meId = useChatsStore((s) => s.meId)

  const numericChatId = Number(chat.id)
  const isRealChat = Number.isFinite(numericChatId) && String(numericChatId) === chat.id
  const search = useChatSearch(numericChatId, isRealChat)
  const { filters, setFilters } = search

  const onPickResult = (seq: number) => { search.reset(); onJumpToSeq(seq) }

  // ── jump-to-date: тот же пикер, что открывается кликом по дате в ленте
  // (tweb showDatePickerPopup); свой нативный <input type=date> был отсебятиной ──
  const openDatePicker = () => {
    openPopup((p) =>
      createElement(DatePickerPopup, {
        open: p.open,
        onClose: p.requestClose,
        onExitComplete: p.onExitComplete,
        initDate: Date.now(),
        chatId: numericChatId,
        onPick: (timestamp: number) => {
          void search.jumpToDate(timestamp).then((seq) => {
            if (seq != null) {
              search.reset()
              onJumpToSeq(seq)
            }
          })
        },
      }),
      DATE_PICKER_POPUP_KIND,
    )
  }

  // ── фильтры поиска (чипы + выпадающие меню) ──
  const isGroup = chat.type === 'group'
  const [filterMenu, setFilterMenu] = useState<{ kind: FilterKind; style: CSSProperties } | null>(null)
  const openFilterMenu = (kind: FilterKind) => (rect: DOMRect) =>
    setFilterMenu({ kind, style: { top: rect.bottom + 6, left: rect.left, transformOrigin: 'top left' } })

  // Участники группы для фильтра «От кого» — грузим при открытии меню.
  const [members, setMembers] = useState<{ userId: number; role: string }[]>([])
  useEffect(() => {
    if (filterMenu?.kind !== 'sender' || !isGroup) return
    let alive = true
    void managers.groups.members(numericChatId).then((m) => { if (alive) setMembers(m) })
    return () => { alive = false }
  }, [filterMenu, isGroup, numericChatId, managers])
  const memberPeers = usePeers(useMemo(() => members.map((m) => m.userId), [members]))

  const senderName = filters.senderId != null
    ? (filters.senderId === meId ? 'Вы' : memberPeers.get(filters.senderId)?.displayName || String(filters.senderId))
    : t('Search from')
  const typeLabel = filters.mediaType != null
    ? t(MEDIA_TYPES.find((x) => x.value === filters.mediaType)?.labelKey ?? 'Search by type')
    : t('Search by type')

  // usePeers keys its fetch on peersKey(ids) internally, so a fresh array each render is fine.
  const resultPeers = usePeers(useMemo(() => search.results.map((m) => m.senderId), [search.results]))
  const searchResults: SearchResultRow[] = useMemo(
    () =>
      search.results.map((m) => ({
        id: m.id,
        seq: m.seq,
        sender: m.senderId === meId ? 'Вы' : resultPeers.get(m.senderId)?.displayName || chat.name,
        avatar: gradientFor(m.senderId),
        time: friendlyMsgTime(m.createdAt, lang),
        text: m.text ?? '',
        mediaId: m.mediaId ?? undefined,
        mediaType: m.type,
      })),
    [search.results, resultPeers, meId, chat.name, lang],
  )

  // Активный (последний открытый) результат — подсветка строки в списке.
  const [activeIdx, setActiveIdx] = useState(0)
  // Была ли уже навигация стрелками: первый up/down прыгает к текущему
  // (свежайшему) результату, дальше — листает (tweb topbarSearch: первый клик
  // по стрелке выбирает первую строку списка).
  const navigatedRef = useRef(false)
  useEffect(() => { setActiveIdx(0); navigatedRef.current = false }, [search.query])

  // Стрелки prev/next (tweb topbarSearch ArrowButton): список идёт от новых к
  // старым, «вверх» = к более старому сообщению (idx+1), «вниз» = к более
  // новому (idx-1). Прыжок к сообщению — без сброса поиска (панель остаётся).
  const navigateResult = (dir: 'up' | 'down') => {
    if (!searchResults.length) return
    let next = activeIdx
    if (navigatedRef.current) {
      next = dir === 'up' ? activeIdx + 1 : activeIdx - 1
      if (next < 0 || next >= searchResults.length) return
    }
    navigatedRef.current = true
    setActiveIdx(next)
    onJumpToSeq(searchResults[next].seq)
  }

  return {
    open: search.open,
    openSearch: () => search.setOpen(true),
    query: search.query,
    onSearchChange: search.setQuery,
    onSearchClear: () => search.setQuery(''),
    onSearchClose: () => search.setOpen(false),
    hasFilter: search.hasFilter,
    filters, setFilters,
    openDatePicker,
    isGroup, meId,
    filterMenu, setFilterMenu, openFilterMenu,
    members, memberPeers,
    senderName, typeLabel,
    searchResults, activeIdx, setActiveIdx, onPickResult, navigateResult,
  }
}

export type ChatHeaderSearch = ReturnType<typeof useChatHeaderSearch>
