// ViewModel топбар-поиска — presentation logic из tweb `components/chat/topbarSearch.tsx`
// (сигналы, мемо и эффекты компонента), без DOM. View — components/conversation/TopbarSearch.tsx.
//
// Сигналы tweb → состояние здесь (файл:строка в topbarSearch.tsx):
//   value/isInputFocused/filteringSender/filterPeerId/reaction/target  :351-366
//   choosingSender / shouldShowResults / lookingHashtag / isHashtag    :368-376
//   shouldShowReactions / shouldShowFromPlaceholder / isActive         :377-385
//   calculateResultsHeight / calculateReactionsHeight                  :1167-1204
//   onArrowButtonClick                                                 :659
//   onInputClear                                                       :461
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18nStore } from '../../i18n'
import { useManagers } from './useManagers'
import { openPopup } from '../../stores/popupStore'
import DatePickerPopup, { DATE_PICKER_POPUP_KIND } from '../../components/DatePickerPopup'
import { useMessageSearchLoader, useSenderSearchLoader } from './useChatSearch'
import { usePeers } from './usePeers'
import { useChatsStore } from '../../stores/chatsStore'
import { useSearchStore } from '../../stores/searchStore'
import type { SavedTag } from '../managers/messagesManager'
import type { Chat } from '../../data'
import { getPeerTitle } from '../peers/getPeerTitle'
import { getPeerPhotoId, type Chat as PeerChat, type User } from '../peers/peer'
import { getChatPhoto } from '../peers/predicates'

/** Фото пира: у пользователя `user.photo`, у чата — `chat.photo`. */
const peerPhoto = (peer: User | PeerChat | undefined) =>
  peer?._ === 'user' ? peer.photo : getChatPhoto(peer as PeerChat | undefined)

// tweb topbarSearch.tsx:656-657
const MIN_HEIGHT = 43
const MAX_HEIGHT = 271
// tweb topbarSearch.tsx:1195/:1203 — высота строки реакций / типов поиска
const REACTIONS_HEIGHT = 61

export function useChatHeaderSearch(chat: Chat, onJumpToSeq: (seq: number) => void) {
  const managers = useManagers()
  const meId = useChatsStore((s) => s.meId)
  const numericChatId = Number(chat.id)
  const isRealChat = Number.isFinite(numericChatId) && String(numericChatId) === chat.id

  // * сигналы компонента (tweb :351-366)
  // `text` — то, что в поле прямо сейчас; `value` — то же, но после дебаунса
  // (tweb InputSearch.onInput, debounceTime 300 + verifyDebounce: для пустой
  // строки и одиночного «#» дебаунс пропускается, topbarSearch.tsx:493).
  const [text, setText] = useState('')
  const [value, setValue] = useState('')
  useEffect(() => {
    if (text === '#' || !text.trim()) { setValue(text); return }
    const id = window.setTimeout(() => setValue(text), 300)
    return () => window.clearTimeout(id)
  }, [text])
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [filteringSender, setFilteringSender] = useState(false)
  const [filterPeerId, setFilterPeerId] = useState<number | undefined>(undefined)
  const [reaction, setReaction] = useState<string | undefined>(undefined)
  // tweb хранит target как DOM-узел строки; у нас список декларативный, поэтому
  // индекс строки — он же `whichChild(target)` из tweb (:851).
  const [targetIdx, setTargetIdx] = useState<number | undefined>(undefined)

  const close = useCallback(() => useSearchStore.getState().closeSearch(numericChatId), [numericChatId])

  // ── «* full search replacement» (tweb topbarSearch.tsx:403-407) ──
  // Внешние сигналы chat.ts засевают локальное состояние панели:
  //   inputSearch.onChange(inputSearch.value = props.query())
  //   setFilteringSender(!!props.filterPeerId()); setFilterPeerId(…); setReaction(…)
  // Присваивание `.value` кладёт текст в поле, а `onChange` (это `setValue`,
  // :485) зовётся НАПРЯМУЮ — минуя дебаунс, поэтому и `text`, и `value` ставим
  // разом. Сигналы созданы с {equals:false}, так что повтор с тем же значением
  // тоже перезасевает — за это отвечает `seed.nonce`.
  const seed = useSearchStore((s) => s.byChat[numericChatId]?.seed)
  useEffect(() => {
    if (!seed) return
    setText(seed.query)
    setValue(seed.query)
    setFilteringSender(seed.filterPeerId != null)
    setFilterPeerId(seed.filterPeerId)
    setReaction(seed.reaction)
  }, [seed])

  // * мемо (tweb :368-385)
  const choosingSender = filteringSender && filterPeerId == null
  const shouldShowResults = isInputFocused
  const lookingHashtag = !filteringSender && !reaction && value.startsWith('#') ? value.slice(1) : undefined
  const isHashtag = lookingHashtag !== undefined
  const shouldShowFromPlaceholder = filteringSender
  const canFilterSender = chat.type === 'group'

  // ── теги-реакции «Избранного» (tweb :974 — грузятся только в самочате) ──
  // Ключ пира И ЕСТЬ `Chat.id` строкой: у приватного диалога это id собеседника,
  // поэтому «самочат» — совпадение ключа с моим id. Отдельного поля `peerId`
  // рядом с `id` больше нет — это было одно число, записанное дважды.
  const isSaved = chat.type === 'saved' || Number(chat.id) === meId
  const [savedTags, setSavedTags] = useState<SavedTag[] | undefined>(undefined)
  useEffect(() => {
    if (!isSaved) { setSavedTags(undefined); return }
    let alive = true
    void managers.messages.getSavedTags()
      .then((tags) => { if (alive) setSavedTags(tags) })
      .catch(() => { if (alive) setSavedTags([]) })
    return () => { alive = false }
  }, [isSaved, managers])

  // tweb :377 — реакции прячутся в режиме хэштега и когда тегов нет
  const shouldShowReactions = !isHashtag && !!savedTags?.length
  const isActive = shouldShowReactions || shouldShowResults

  // tweb chat.ts:795 onActive → `.chat.is-search-active`
  const setReactionsShown = useSearchStore((s) => s.setReactionsShown)
  useEffect(() => {
    setReactionsShown(numericChatId, shouldShowReactions)
  }, [setReactionsShown, numericChatId, shouldShowReactions])

  // ── загрузчики (tweb :727 «* search») ──
  const senders = useSenderSearchLoader(numericChatId, {
    enabled: isRealChat && choosingSender,
    query: value,
  })
  const search = useMessageSearchLoader(numericChatId, {
    enabled: isRealChat && !choosingSender,
    query: value,
    fromPeerId: filterPeerId,
    reaction,
  })

  const listType: 'messages' | 'senders' = choosingSender ? 'senders' : 'messages'
  const count = choosingSender ? senders.count : search.count
  const totalCount = choosingSender ? senders.count : search.totalCount
  const loading = choosingSender ? senders.loading : search.loading

  // Сброс активной строки при смене выдачи (tweb :753 setTarget() внутри эффекта поиска)
  useEffect(() => { setTargetIdx(undefined) }, [value, filterPeerId, reaction, filteringSender])

  // ── высоты схлопывающихся секций (tweb :1167-1204) ──
  const resultsHeight = useMemo(() => {
    if (!shouldShowResults) return 0
    if (count === undefined && !isHashtag) return 0
    const paddingVertical = 8 * 2
    let height: number
    if (!count) height = MIN_HEIGHT
    else if (listType === 'senders') height = 1 + paddingVertical + count * 48
    else height = 1 + paddingVertical + count * 56
    return Math.min(MAX_HEIGHT, height)
  }, [shouldShowResults, count, isHashtag, listType])

  const reactionsHeight = isActive && shouldShowReactions ? REACTIONS_HEIGHT : 0
  // отступление от tweb: строка типов поиска (`Search.Types.*`) требует серверного
  // hashtagType (my/public posts) — у нас его нет, поэтому секция всегда схлопнута.
  const searchTypesHeight = 0

  // ── имена/аватары строк выдачи ──
  const resultPeerIds = useMemo(() => search.messages.map((m) => m.fromId ?? 0), [search.messages])
  const resultPeers = usePeers(resultPeerIds)
  const senderPeers = usePeers(senders.peerIds)
  const filterPeer = usePeers(useMemo(() => (filterPeerId != null ? [filterPeerId] : []), [filterPeerId]))

  // ── выбор строки (tweb :847 «* handle target change to jump to message») ──
  const pickTarget = useCallback(
    (idx: number) => {
      if (idx < 0) return
      setTargetIdx(idx)
      if (choosingSender) {
        setFilterPeerId(senders.peerIds[idx])
        setText('')
        return
      }
      const message = search.messages[idx]
      if (message) onJumpToSeq(message.id)
    },
    [choosingSender, senders.peerIds, search.messages, onJumpToSeq],
  )

  // ── стрелки вверх/вниз (tweb onArrowButtonClick :659) ──
  // Список идёт от новых к старым: `down` — к предыдущему брату (более новому),
  // `up` — к следующему (более старому). Первое нажатие выбирает первую строку.
  const onArrowButtonClick = useCallback(
    (direction: 'up' | 'down') => {
      if (!count) return
      if (targetIdx === undefined) { pickTarget(0); return }
      const next = direction === 'down' ? targetIdx - 1 : targetIdx + 1
      if (next < 0 || next >= count) return
      pickTarget(next)
    },
    [count, targetIdx, pickTarget],
  )

  // ── очистка/закрытие (tweb onInputClear :461) ──
  const onInputClear = useCallback(
    (wasEmpty: boolean) => {
      if (filterPeerId != null) { if (wasEmpty) setFilterPeerId(undefined); return }
      if (filteringSender) { if (wasEmpty) setFilteringSender(false); return }
      if (wasEmpty) close()
    },
    [filterPeerId, filteringSender, close],
  )

  // ── кнопка «от кого» (tweb pickUserBtn :1206) ──
  const startFilteringSender = useCallback(() => {
    setText('')
    setFilteringSender(true)
  }, [])

  // ── jump-to-date (tweb pickDateBtn :1222 → showDatePickerPopup) ──
  const openDatePicker = useCallback(() => {
    openPopup((p) =>
      createElement(DatePickerPopup, {
        open: p.open,
        onClose: p.requestClose,
        onExitComplete: p.onExitComplete,
        initDate: Date.now(),
        chatId: numericChatId,
        // DatePickerPopup отдаёт unix-секунды
        onPick: (timestamp: number) => {
          void managers.messages.messageByDate(numericChatId, timestamp).then((seq) => {
            if (seq != null) onJumpToSeq(seq)
          })
        },
      }),
      DATE_PICKER_POPUP_KIND,
    )
  }, [numericChatId, managers, onJumpToSeq])

  // ── переключение тега-реакции (tweb reactions listener :999) ──
  const toggleReaction = useCallback((r: string) => {
    setReaction((prev) => (prev === r ? undefined : r))
  }, [])

  // Докачка при доскролле списка (tweb Scrollable onScrolledBottom :1240)
  const loadMoreRef = useRef(search.loadMore)
  loadMoreRef.current = search.loadMore
  const onScrolledBottom = useCallback(() => { loadMoreRef.current?.() }, [])

  return {
    // ввод
    text, setText, value, isInputFocused, setIsInputFocused,
    isHashtag, lookingHashtag, shouldShowFromPlaceholder,
    // фильтры
    filteringSender, filterPeerId, filterPeerName: filterPeerId != null
      ? (filterPeerId === meId ? useI18nStore.getState().t('SavedMessages') : getPeerTitle({ peerId: filterPeerId, peer: filterPeer.get(filterPeerId) }))
      : undefined,
    // id медиа аватарки вместо строки `/media/N/content`: номер приезжает
    // готовым (`photo.photo_id`), выпарсивать его регуляркой больше не из чего.
    filterPeerPhotoId: filterPeerId != null ? getPeerPhotoId(peerPhoto(filterPeer.get(filterPeerId))) || undefined : undefined,
    canFilterSender, startFilteringSender, setFilterPeerId,
    reaction, toggleReaction, savedTags,
    // состояние панели
    isActive, shouldShowResults, shouldShowReactions,
    resultsHeight, reactionsHeight, searchTypesHeight,
    // выдача
    listType, count, totalCount, loading,
    messages: search.messages, resultPeers,
    senderPeerIds: senders.peerIds, senderPeers,
    targetIdx, pickTarget, onArrowButtonClick, onScrolledBottom,
    // прочее
    meId, chatName: chat.name,
    onInputClear, close, openDatePicker,
  }
}

export type ChatHeaderSearch = ReturnType<typeof useChatHeaderSearch>
