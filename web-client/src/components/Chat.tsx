import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Text from '../shared/ui/Text'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { useAvatarSrc } from './useAvatarSrc'
import { chatThemeVariant } from '../chatThemes'
import { PRESET_MODE, resolvePreset } from '../theme'
import { applyChatTheme, clearChatTheme } from '../core/theme/themeController'
import { useSettingsStore } from '../settings'
import { CallProvider } from './call/CallProvider'
import { startOutgoing } from '../core/calls/callEngine'
import NowPlayingBar from './NowPlayingBar'
import Preloader from './Preloader'
import type { Chat } from '../data'
import { useT, useLang } from '../i18n'
import { useTypingLabel } from '../core/hooks/useTypingLabel'
import { lastSeenLabel } from '../core/presence'
import { useManagers } from '../core/hooks/useManagers'
import { useNavigationActions } from '../core/hooks/useNavigationActions'
import { useNavigationStore } from '../stores/navigationStore'
import { useMessageWindow } from '../core/hooks/useMessageWindow'
import { useEvent } from '../core/hooks/useEvent'
import { uiEvents } from '../core/hooks/uiEvents'
import { markMediaPlayed } from '../core/mediaRead'
import type { GifItem } from '../core/gifs'
import { useChatSelection } from '../core/hooks/useChatSelection'
import { useChatInfoCard } from '../core/hooks/useChatInfoCard'
import { usePinnedBar } from '../core/hooks/usePinnedBar'
import { useChatSend } from '../core/hooks/useChatSend'
import { useSendAs } from '../core/hooks/useSendAs'
import { useSlowmode } from '../core/hooks/useSlowmode'
import { useChatScroll } from '../core/hooks/useChatScroll'
import { useConvMessages } from '../core/hooks/useConvMessages'
import { useVoiceQueue } from '../core/hooks/useVoiceQueue'
import { useLightbox } from '../core/hooks/useLightbox'
import { useMessageActions } from '../core/hooks/useMessageActions'
import { useChannelExtras } from '../core/hooks/useChannelExtras'
import { useFeedReveal } from '../core/hooks/useFeedReveal'
import Composer from './Composer'
import ChatFeed from './messages/ChatFeed'
import EmptyChatGreeting from './messages/EmptyChatGreeting'
import SimilarChannels from './messages/SimilarChannels'
import { useChatAutoDownload } from '../core/hooks/useChatAutoDownload'
import { useDraftsStore } from '../stores/draftsStore'
import { draftReplyState, convMsgReplyState } from '../core/draftReply'
import { useComposerDraft } from '../core/hooks/useComposerDraft'
import { useMentionPeers } from '../core/hooks/useMentionPeers'
import { useGroupCallStore } from '../stores/groupCallStore'
import { useLivestreamStore } from '../stores/livestreamStore'

const EMPTY_IDS: number[] = []
import { useUploadsStore } from '../stores/uploadsStore'
import ChatHeader from './conversation/ChatHeader'
import IconButton from '../shared/ui/IconButton'
import { TopicIcon } from './TopicsPanel'
import PinnedBar from './conversation/PinnedBar'
import SavedTagsPanel from './conversation/SavedTagsPanel'
import ScrollDownFab from './conversation/ScrollDownFab'
import SelectionBar from './conversation/SelectionBar'
import { useChatsStore, loadChats } from '../stores/chatsStore'
import { useSecretChatStore } from '../stores/secretChatStore'
import { type MessageEntity } from '../core/models'
import type { InlineResult } from '../core/managers/botsManager'
import { openWebApp } from '../core/webapp'
import { useSearchStore } from '../stores/searchStore'
import { useChatPopups } from '../core/hooks/useChatPopups'
import { clearPopups, openPopup } from '../stores/popupStore'
import DatePickerPopup, { DATE_PICKER_POPUP_KIND } from './DatePickerPopup'
import ChatMsgActionPopups from './conversation/ChatMsgActionPopups'
import SendMediaPopup from './messages/SendMediaPopup'
import { joinGroupCall } from '../core/calls/groupCallEngine'
import { watchLivestream } from '../core/calls/livestreamEngine'
import classNames from '../shared/lib/classNames'
import s from './Chat.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'

// Инфо-панель и просмотрщик медиа — не первый кадр; ленивые чанки.
const UserInfoPanel = lazy(() => import('./UserInfoPanel'))
const MediaLightbox = lazy(() => import('./messages/MediaLightbox'))

// tweb's exact bubbles-scrollable fade: a pure alpha mask on the scroll viewport
// (no blur, no colour) so messages simply fade out to a 0.24 floor behind the
// floating header/composer, eased iOS-style (cubic-bezier sampled at 0/.2/.4/.6/.8/1).
// tweb: fade = 3.5rem + page-chats-padding, контент-паддинг ленты =
// chat-input-height + page-chats-padding; page-chats-padding = 16px desktop /
// 8px handheld — см. _chat.scss:447,1104 и updateColumnWidths.ts.
const padTop = (narrow: boolean) => (narrow ? 76 : 84) // clearance под хедером + 16px зазор до первого сообщения
// Верхний фейд глубже клиренса: приглушение начинается заранее, ещё до того как
// сообщение уйдёт под хедер (как в tweb — верх ленты приглушён уже в статике).
const fadeTop = (narrow: boolean) => (narrow ? 100 : 108)
const fadeBottom = (narrow: boolean) => (narrow ? 64 : 72) // mask only
const padBottom = (narrow: boolean) => (narrow ? 64 : 72) // clearance над композером + 16px зазор от последнего сообщения

// Local start-of-day in ms (the date "bucket"), and a friendly day label for the
// date divider — tweb shows Today / Yesterday / "14 June" (with year if not this year).
const FLOOR = 'rgba(255,255,255,0.24)'
// Both edges keep the same faint floor (tweb --bubbles-scrollable-fade-color):
// messages stay slightly visible behind the floating header AND composer.
const mix = (k: number) => `color-mix(in srgb, #000 ${k}%, ${FLOOR})`
const feedMask = (fadeT: number, fadeB: number) => `linear-gradient(to bottom, ${FLOOR} 0, ${mix(8.6)} ${fadeT * 0.2}px, ${mix(33.4)} ${fadeT * 0.4}px, ${mix(66.6)} ${fadeT * 0.6}px, ${mix(91.4)} ${fadeT * 0.8}px, #000 ${fadeT}px, #000 calc(100% - ${fadeB}px), ${mix(91.4)} calc(100% - ${fadeB * 0.8}px), ${mix(66.6)} calc(100% - ${fadeB * 0.6}px), ${mix(33.4)} calc(100% - ${fadeB * 0.4}px), ${mix(8.6)} calc(100% - ${fadeB * 0.2}px), ${FLOOR} 100%)`

// Telegram's per-peer color palette (used to tint reply previews by their author)

// Тред в колонке чата (tweb setPeer({peerId, threadId})): форум-топик или
// комментарии поста канала. rootMsgId — корневое сообщение треда.
export interface ThreadInfo {
  rootMsgId: number
  title: string
  /** подпись под названием (имя группы/канала) */
  subtitle?: string
  iconColor?: number
  closed?: boolean
  /** id темы (для «Закрыть тему» из меню треда) */
  topicId?: number
  kind: 'topic' | 'comments'
}

interface Props {
  chat: Chat
  onBack?: () => void
  /** режим треда (tweb setPeer({peerId, threadId})): окно/отправка ограничены
   * тредом, вместо ChatHeader — плашка темы, пины/анрид-плашка/звонки скрыты */
  thread?: ThreadInfo
}

export default function Chat({ chat, onBack, thread }: Props) {
  const t = useT()
  // Навигация — из navigationStore/useNavigationActions напрямую (инвариант: View
  // читает из стора, а не через проброс из Shell). Имена локальные совпадают с
  // прежними пропсами, чтобы не менять места использования ниже.
  const { openPeer: onOpenPeer, onChatCreated, openPublicChannel: onOpenChannel } = useNavigationActions()
  const onCloseThread = useNavigationStore((s) => s.closeThread)
  const onOpenThread = useNavigationStore((s) => s.openCommentsThread)
  const headerAvatarSrc = useAvatarSrc(chat.avatarUrl)
  const [lang] = useLang()

  // Контейнер колонки чата — applyChatTheme (Task 1/2) переопределяет --primary-color
  // инлайном именно на этом элементе, так что accentColor ниже читается chat-specific,
  // а не глобальный пресетный акцент.
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Реальное значение accent (нужно как цвет в JS: reply.color → hex, не var()).
  // Читаем из CSS-переменной темы контейнера чата (см. rootRef выше); обновляется
  // при смене темы/чата.
  const accentColor = (rootRef.current && getComputedStyle(rootRef.current).getPropertyValue('--primary-color').trim()) || '#3390ec'

  const narrow = useMediaQuery('(max-width:900px)')
  const isChannel = chat.type === 'channel'
  const isGroup = chat.type === 'group'
  const isSecret = chat.type === 'secret'
  const isSaved = chat.type === 'saved'
  // Активный фильтр по тегу-реакции «Избранного».
  const [savedTagFilter, setSavedTagFilter] = useState<string | null>(null)
  // Автозагрузка медиа для этого чата (tweb chat.autoDownload)
  const autoDownload = useChatAutoDownload(chat.type, chat.peerId)

  const numericChatId = Number(chat.id)
  const isRealChat = Number.isFinite(numericChatId) && String(numericChatId) === chat.id
  // Сброс фильтра тегов «Избранного» при смене чата.
  useEffect(() => { setSavedTagFilter(null) }, [numericChatId])
  // Кандидаты @упоминаний — участники группы (tweb mentionsHelper)
  const mentionPeers = useMentionPeers(isRealChat ? numericChatId : null, isRealChat && isGroup)

  // Тема оформления чата (messages.setChatTheme): id читаем реактивно из стора
  // диалогов (chat_theme_update его патчит), с фолбэком на пропс. Тема
  // применяется ЛОКАЛЬНО к колонке чата (tweb chat.ts:367-371 — applyTheme на
  // this.container, а не на сайдбары): деривация — та же формула tweb, что и
  // для глобальных пресетов (core/theme/themeController.ts:deriveChatThemeVars),
  // применяется инлайном на .root через applyChatTheme/clearChatTheme ниже.
  const dialogThemeId = useChatsStore((st) => st.dialogs.find((d) => d.chatId === numericChatId)?.themeId)
  const activeThemeId = dialogThemeId ?? chat.themeId
  const themeChoice = useSettingsStore((st) => st.themeChoice)
  const preset = resolvePreset(themeChoice)
  const themeMode = PRESET_MODE[preset]
  const themeVariant = chatThemeVariant(activeThemeId, themeMode)

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    if (themeVariant) {
      applyChatTheme(el, preset, themeVariant.accent, themeVariant.messageColors)
    } else {
      clearChatTheme(el)
    }
  }, [preset, themeVariant])

  const draftPeerId = chat.id.startsWith('draft:') ? Number(chat.id.slice('draft:'.length)) : null
  const meId = useChatsStore((s) => s.meId)
  const me = useChatsStore((s) => s.me)

  const typingLabel = useTypingLabel(numericChatId, isGroup)
  const peerPresence = useChatsStore((s) => (chat.peerId != null ? s.presence[chat.peerId] : undefined))
  const setDialogMuted = useChatsStore((s) => s.setDialogMuted)
  // toggle re-renders the menu; fall back to the chat prop.
  const dialogMuted = useChatsStore((s) =>
    isRealChat ? s.dialogs.find((d) => d.chatId === numericChatId)?.muted : undefined,
  )
  const muted = dialogMuted ?? !!chat.muted
  const managers = useManagers()

  // Секретный чат: наблюдаемый статус E2E-handshake (secretChatStore ← realtimeBridge).
  // При открытии чата восстанавливаем состояние с сервера (reload-safe): secret.sync
  // либо доводит ключ инициатора, либо возвращает 'requested'/'awaiting'/'rejected'.
  const secretStatus = useSecretChatStore((st) => st.byChat[numericChatId]?.status)
  useEffect(() => {
    if (!isSecret || !isRealChat) return
    void managers.secret.sync(numericChatId, useChatsStore.getState().meId ?? -1)
  }, [isSecret, isRealChat, numericChatId, managers])
  // Пока handshake не завершён — отправка запрещена (иначе sendText/sendMedia падают
  // с «key missing»), а вместо композера показываем бар accept/await/rejected.
  const secretLocked = isSecret && secretStatus !== 'established'
  const [secretBusy, setSecretBusy] = useState(false)
  const onSecretAccept = useEvent(async () => {
    if (secretBusy) return
    setSecretBusy(true)
    try {
      const res = await managers.secret.accept(numericChatId)
      useSecretChatStore.getState().setStatus(numericChatId, 'established')
      useSecretChatStore.getState().setFingerprint(numericChatId, res.fingerprint)
    } finally {
      setSecretBusy(false)
    }
  })
  const onSecretReject = useEvent(async () => {
    if (secretBusy) return
    setSecretBusy(true)
    try {
      await managers.secret.reject(numericChatId)
      useSecretChatStore.getState().setStatus(numericChatId, 'rejected')
    } finally {
      setSecretBusy(false)
    }
  })
  const threadRootId = thread?.rootMsgId
  const win = useMessageWindow(isRealChat ? numericChatId : -1, 40, threadRootId)
  // Тред комментариев: после корневого поста канала (подшит бэком с seq=0)
  // вставляем клиентскую сервис-плашку «Обсуждение началось» (tweb
  // generateThreadServiceStartMessage — messageActionDiscussionStarted).
  const winV = useMemo(() => {
    if (!thread) return win
    const idx = win.msgs.findIndex((m) => m.seq === 0 && m.chatId !== numericChatId)
    if (idx < 0) return win
    const svc = {
      id: -900, chatId: numericChatId, seq: 0.5, senderId: 0, type: 'service',
      text: t('Discussion started'), replyToId: null, mediaId: null,
      createdAt: win.msgs[idx].createdAt, threadRootId: null, clientId: 'discussion-start',
    } as (typeof win.msgs)[number]
    const msgs = [...win.msgs]
    msgs.splice(idx + 1, 0, svc)
    return { ...win, msgs }
  }, [win, thread, numericChatId, t])

  // Register the active chat so chatsStore suppresses unread bumps while it's open.
  const setActiveChat = useChatsStore((s) => s.setActiveChat)
  useEffect(() => {
    if (isRealChat) setActiveChat(numericChatId)
    return () => setActiveChat(null)
  }, [isRealChat, numericChatId, setActiveChat])

  // Real group/channel header card (type/counts/rights) + member presence seeding +
  // post/type permission + discussion wiring + live online count — view-model hook.
  const { card, canType, canSendText, canSendMedia, discussionChatId, discussionsEnabled, onlineCount } =
    useChatInfoCard({ isRealChat: isRealChat && !thread, isChannel, numericChatId })
  // Message read-model: window Message[] → ConvMsg[] (sender/forward/reply names +
  // stable-ref cache) plus the resolved peers map (reused below for voice/lightbox).
  const { msgs, peers } = useConvMessages({ numericChatId, isRealChat, isGroup, win: winV, meId, foreignRootName: thread?.kind === 'comments' ? thread.subtitle : undefined })
  // Фильтр «Избранного» по тегу-реакции: клиентская выборка по загруженному окну
  // (реакции в самочате = теги). msgs и winV.msgs идут параллельно — фильтруем по
  // общим индексам, чтобы ChatFeed не рассинхронизировал ряды.
  const [feedMsgs, feedWinMsgs] = useMemo(() => {
    if (!savedTagFilter || msgs.length !== winV.msgs.length) return [msgs, winV.msgs] as const
    const fm: typeof msgs = []
    const fw: typeof winV.msgs = []
    winV.msgs.forEach((wm, i) => {
      if (wm.reactions?.some((r) => r.emoji === savedTagFilter)) { fm.push(msgs[i]); fw.push(wm) }
    })
    return [fm, fw] as const
  }, [msgs, winV.msgs, savedTagFilter])
  // Open a private chat with a group message's sender (avatar/name click).
  const openSender = (senderId: number, fallbackName: string) => {
    const p = peers.get(senderId)
    onOpenPeer?.({
      id: senderId,
      displayName: p?.displayName || fallbackName,
      username: p?.username,
      avatarUrl: p?.avatarUrl,
    })
  }
  // Voice/audio play queue for the global player + the player plate offset.
  const { playVoice, attachRound, playerOffset } = useVoiceQueue({
    win, isRealChat, meId, meName: me?.displayName, peers, chatName: chat.name, numericChatId, lang,
  })
  // Инфо-панель — локальный toggle (сосуществует с gift-попапом поверх профиля).
  // Остальные попапы колонки открываются императивно через popupStore (useChatPopups).
  const [infoOpen, setInfoOpen] = useState(false)
  // Ленивый чанк панели монтируем при первом открытии и больше НЕ размонтируем
  // (tweb #column-right: колонка всегда в DOM, закрыта transform'ом + inert) —
  // повторное открытие не перезапрашивает профиль.
  const [infoMounted, setInfoMounted] = useState(false)
  useEffect(() => { if (infoOpen) setInfoMounted(true) }, [infoOpen])
  // Попапы чат-скоупные: снимаем их со стека при уходе с чата (колонка ремаунтится по key).
  useEffect(() => () => clearPopups(), [])
  // ⋮-меню тред-шапки требует права «Закрыть тему»
  const [canManageTopic, setCanManageTopic] = useState(false)
  useEffect(() => {
    if (!thread || thread.kind !== 'topic' || !isRealChat) return
    let alive = true
    void managers.groups.card(numericChatId).then((c) => {
      if (alive) setCanManageTopic(c.myRole === 'creator' || (c.myRights & 64) !== 0)
    }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.kind, numericChatId, isRealChat])
  // Pinned messages in this chat (newest pin first) + индекс перелистывания
  // плашки (tweb pinnedMessage) — drives the pinned bar.
  const { pins, index: pinIndex, follow: followPin } = usePinnedBar(numericChatId, isRealChat)
  // Search is owned by ChatHeader now; here we only read whether it's open (single-sourced
  // in searchStore) to hide the pinned bar + adjust the sticky-date offset.
  const searchOpen = useSearchStore((s) => s.byChat[numericChatId]?.open ?? false)
  // Запланированные сообщения: счётчик (календарик в композере); оверлей списка — в popups.
  const [scheduledCount, setScheduledCount] = useState(0)
  useEffect(() => {
    setScheduledCount(0)
    if (!isRealChat) return
    void managers.messages.listScheduled(numericChatId).then((l) => setScheduledCount(l.length)).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericChatId, isRealChat])
  // Идущий видеочат этого чата (для баннера Join): снимок при открытии + live
  const groupCallActive = useGroupCallStore((st) => st.activeByChat[numericChatId] ?? EMPTY_IDS)
  const myGroupCallChat = useGroupCallStore((st) => st.chatId)
  useEffect(() => {
    if (!isRealChat || chat.type === 'private' || chat.type === 'saved') return
    void managers.messages.groupCallParticipants(numericChatId)
      .then((ids) => useGroupCallStore.getState().setActive(numericChatId, ids))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericChatId, isRealChat])

  // Идущая RTMP-трансляция этого чата (плашка LIVE): снимок при открытии + live
  const livestreamActive = useLivestreamStore((st) => st.activeByChat[numericChatId] ?? false)
  const myWatchingChat = useLivestreamStore((st) => st.watchingChatId)
  useEffect(() => {
    if (!isRealChat || chat.type === 'private' || chat.type === 'saved') return
    void managers.livestream.status(numericChatId)
      .then((st) => useLivestreamStore.getState().setActive(numericChatId, st.active))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericChatId, isRealChat])

  const onComposerSchedule = useEvent((text: string, entities: MessageEntity[] | undefined, sendAtUnix: number) => {
    void managers.messages
      .scheduleMessage(numericChatId, { text, entities, sendAt: sendAtUnix })
      .then(() => {
        setScheduledCount((c) => c + 1)
        pop.openScheduled() // tweb: после планирования открывает scheduled-вид
      })
  })
  // «Отправить, когда онлайн» (tweb canSendWhenOnline): личный чат (не сам с собой),
  // статус собеседника виден (lastSeen>0) и он НЕ онлайн. Планирование без даты —
  // send_at 0, флаг when_online (бэк ждёт presence).
  const canSendWhenOnline =
    isRealChat && !thread && chat.type === 'private' &&
    chat.peerId != null && chat.peerId !== meId &&
    peerPresence != null && !peerPresence.online && peerPresence.lastSeen > 0
  const onComposerSendWhenOnline = useEvent((text: string, entities: MessageEntity[] | undefined) => {
    void managers.messages
      .scheduleMessage(numericChatId, { text, entities, sendAt: 0, whenOnline: true })
      .then(() => {
        setScheduledCount((c) => c + 1)
        pop.openScheduled()
      })
  })
  // Scroll state machine (refs + bottom-pin intent + history pagination + scroll-restore
  // + jump-to-message + scroll-to-bottom + read-marker) — extracted view-model hook.
  // Owns atBottomRef/userScrolledUpRef (passed into useChatSend so a send pins to bottom).
  // Плашка «Непрочитанные сообщения» (tweb is-first-unread): горизонт чтения
  // снимается ОДИН раз на маунте (markRead на открытии тут же сдвигает
  // lastReadSeq в сторе), первый входящий с seq выше горизонта фиксируется и
  // больше не пересчитывается (tweb attachedUnreadBubble) — live-сообщения и
  // прочтение плашку не двигают. Компонент ремаунтится на смену чата (key).
  const openReadRef = useRef<{ lastReadSeq: number; unread: number } | null>(null)
  if (openReadRef.current === null) {
    const d = useChatsStore.getState().dialogs.find((x) => x.chatId === numericChatId)
    openReadRef.current = { lastReadSeq: d?.lastReadSeq ?? 0, unread: d?.unread ?? 0 }
  }
  const unreadDividerRef = useRef<number | null>(null)
  if (unreadDividerRef.current === null && isRealChat && !thread && meId != null && openReadRef.current.unread > 0) {
    const horizon = openReadRef.current.lastReadSeq
    const first = win.msgs.find((m) => m.seq > horizon && m.senderId !== meId)
    if (first) unreadDividerRef.current = first.seq
  }
  const unreadDividerSeq = unreadDividerRef.current

  // Верхний отступ sticky-плашек (хедер + плейт плеера + пин-бар): его же
  // использует скролл к плашке непрочитанных, чтобы она не пряталась под хедером.
  const dateStickyTop = playerOffset + (pins.length > 0 && !searchOpen ? 122 : 66) - (narrow ? 8 : 0)

  const {
    scrollRef, contentRef, atBottomRef, userScrolledUpRef,
    highlightSeq, showScrollDown, unreadBelow, jumpToSeq, onScrollDownClick,
  } = useChatScroll({ numericChatId, isRealChat, win, playerOffset, unreadDividerSeq, unreadStickyTop: dateStickyTop })
  // Контейнер ленты tweb (.bubbles): класс has-sticky-dates ставится по замеру, см. эффект ниже.
  const bubblesRef = useRef<HTMLDivElement>(null)
  // Multi-select state + press-and-drag selection (extracted view-model hook).
  const { selected, setSelected, setSelectionMode, selecting, toggleSelect, clearSelection, dragSelect } =
    useChatSelection(scrollRef)
  // Enter selection mode from the header menu with nothing selected yet.
  const startSelectMode = () => setSelectionMode(true)

  // Удаление чата / выход. Владелец группы/канала удаляет для всех (DELETE
  // /chats/{id}); иначе — выхожу сам (DELETE members/me), приватный чат так же
  // покидается. chat_removed по WS уберёт чат из списка; закрываем колонку.
  const owned = !!chat.owned
  const doDeleteChat = () => {
    if (!isRealChat || meId == null) return
    const op = owned && (isGroup || isChannel)
      ? managers.groups.deleteGroup(numericChatId)
      : managers.groups.removeMember(numericChatId, meId)
    void op.catch(() => {})
    onBack?.()
  }
  // «Очистить историю» у себя: сервер поднимает персональный горизонт, затем
  // перезагружаем окно (станет пустым) и список диалогов (превью очистится).
  const doClearHistory = () => {
    if (!isRealChat) return
    void managers.chats.clearHistory(numericChatId)
      .then(() => win.reloadNewest())
      .then(() => loadChats(managers))
      .catch(() => {})
  }
  const deleteLabels = (() => {
    if (isSecret) return { title: 'Leave chat', text: 'This chat will be deleted from your chat list.', action: 'Delete' }
    if (chat.type === 'private') return { title: 'Delete Chat', text: 'This chat will be deleted from your chat list.', action: 'Delete' }
    if (isChannel) return owned
      ? { title: 'Delete Channel', text: 'The channel will be deleted for all subscribers.', action: 'Delete' }
      : { title: 'Leave Channel', text: 'Are you sure you want to leave this channel?', action: 'Leave' }
    return owned
      ? { title: 'Delete Group', text: 'The group will be deleted for all members.', action: 'Delete' }
      : { title: 'Leave Group', text: 'Are you sure you want to leave this group?', action: 'Leave' }
  })()

  // (Scroll state machine — pagination, scroll-restore, pin-to-bottom, jump-to-message,
  // read-marker — lives in useChatScroll; see the hook call above.)

  // No chat-switch reset effect needed: App renders <Chat key={selectedId}>,
  // so switching chats fully remounts this component and every useState/useRef (here and
  // in useChatSend/useChatSelection/useChatSearch) re-initialises to its default. A manual
  // reset effect keyed on `chat` was not only redundant but harmful — `chat` gets a new
  // object identity on every dialog update (e.g. a message arriving in the open chat),
  // which would wipe the reply draft / selection / open discussion mid-session.

  // Outgoing side (text/media/voice + optimistic + draft creation + typing throttle)
  // and the reply/editing composer state — extracted view-model hook. Scroll intent
  // (atBottomRef/userScrolledUpRef) is owned here and passed in. Declared before
  // useMessageActions, which needs setReply/setEditing for its reply/edit actions.
  // Send-as (Telegram send_as): «личности отправителя» доступны в реальных группах
  // (супергруппа-обсуждение с привязанным каналом / анонимный админ). Выбор per-chat.
  const sendAs = useSendAs(numericChatId, isRealChat && isGroup && !thread, meId)
  const sendAsChatId = sendAs.currentId !== 0 && sendAs.currentId !== meId ? sendAs.currentId : null
  const sendAsTitle = sendAsChatId != null ? sendAs.peers.find((p) => p.peerId === sendAsChatId)?.title : undefined

  const {
    reply, setReply, editing, setEditing,
    forward, setForward,
    rec,
    send,
    onComposerTyping,
    pendingMedia, setPendingMedia, sendPendingMedia,
    openPicker, fileInputRef, pickAsFileRef,
    sendGeo, sendContact, sendSticker, sendGif,
  } = useChatSend({
    chat, numericChatId, isRealChat, isChannel, draftPeerId, canType, secretLocked,
    meId, win, threadRootId, sendAsChatId, sendAsTitle, atBottomRef, userScrolledUpRef,
    onChatCreated,
  })

  // Облачный черновик: восстановление в композер + сейв с дебаунсом; вместе с
  // текстом сохраняется reply_to_id текущего reply-стейта (tweb draft).
  const { initialDraft, onDraftChange } = useComposerDraft(isRealChat && !thread ? numericChatId : null, reply?.msgId ?? null)
  // Восстановление reply-бара из черновика (draft.reply_to_id): один раз после
  // загрузки окна; сообщение ищем в окне, вне окна — скип (getById у бэка нет).
  const draftReplyToId = useDraftsStore((s) => (isRealChat && !thread ? s.byChat[numericChatId]?.replyToId ?? null : null))
  const replyRestoredRef = useRef(false)
  useEffect(() => {
    if (replyRestoredRef.current || draftReplyToId == null || msgs.length === 0) return
    replyRestoredRef.current = true
    if (reply) return
    const rs = draftReplyState(msgs, draftReplyToId, chat.name, accentColor)
    if (rs) setReply(rs)
  }, [draftReplyToId, msgs, reply, chat.name, accentColor, setReply])

  // Кросс-чат ответ (tweb ReplyToAnotherChat): целевой чат открыт → ставим
  // reply-плашку из pending-reply (исходный чат + снимок оригинала) и чистим стор.
  const pendingReply = useSearchStore((s) => s.pendingReply)
  useEffect(() => {
    if (!pendingReply || pendingReply.targetChatId !== numericChatId) return
    setReply({
      msgId: pendingReply.msgId,
      name: pendingReply.name,
      text: pendingReply.text,
      color: pendingReply.color,
      chatId: pendingReply.sourceChatId,
      snapshotName: pendingReply.name,
      snapshotText: pendingReply.text,
    })
    useSearchStore.getState().clearPendingReply()
  }, [pendingReply, numericChatId, setReply])

  // Пересылка в один чат (tweb initMessagesForward): целевой чат открыт → ставим
  // плашку форварда из pending-forward (исходный чат + id + превью) и чистим стор.
  // Reply/edit взаимоисключимы с форвардом — сбрасываем их.
  const pendingForward = useSearchStore((s) => s.pendingForward)
  useEffect(() => {
    if (!pendingForward || pendingForward.targetChatId !== numericChatId) return
    setForward({
      sourceChatId: pendingForward.sourceChatId,
      msgIds: pendingForward.msgIds,
      count: pendingForward.count,
      text: pendingForward.text,
      hasCaption: pendingForward.hasCaption,
      dropAuthor: false,
      dropCaption: false,
    })
    setReply(null)
    setEditing(null)
    useSearchStore.getState().clearPendingForward()
  }, [pendingForward, numericChatId, setForward, setReply, setEditing])

  // Message context menu + its actions (reply/edit/copy/pin/delete/forward/select/
  // download/viewers) and the delete-confirm / forward-picker / viewers-popup state.
  // Меню сообщения + действия (reply/edit/copy/pin/delete/forward/select/…). Весь
  // рендер попапов этого бэга (context-menu, delete/forward-пикеры, viewers, перевод…)
  // — в ConversationOverlays; тут разбираем лишь то, что нужно самому контроллеру
  // (feedFns + панель выделения + «переслать из…»).
  const msgActions = useMessageActions({
    chat, numericChatId, isRealChat,
    // Пост канала + зритель админ/владелец → пункт «Статистика» (tweb can_view_stats).
    canViewPostStats: isChannel && isRealChat && (card?.myRole === 'creator' || card?.myRole === 'admin'),
    // Канал + автор/админ → пункты «проверки фактов» (tweb canUpdateFactCheck).
    canEditFactCheck: isChannel && isRealChat && (card?.myRole === 'creator' || card?.myRole === 'admin'),
    win: winV, msgs, meId, pins, accent: accentColor,
    setReply, setEditing, setSelectionMode, setSelected, clearSelection, onChatCreated,
  })
  const { openMsgMenu, toggleReaction, showReactedUsers, openStarReaction, openDeleteFor, openForwardFor, openForwardFrom } = msgActions

  // First-load reveal policy: grace-delayed spinner (no flash on cache hits),
  // `feedLoading` to gate the list, and the open-chat ladder arming.
  const { showSpinner, feedLoading, ladderActive } = useFeedReveal({ isRealChat, win, numericChatId })

  // (Scroll correction, prepend-restore, jump-scroll, down-arrow pin, and player-offset
  // compensation all live in useChatScroll.)

  // Full-screen media viewer (collect loaded photos/videos, zoom from the thumb).
  const { lightbox, openLightbox, closeLightbox } = useLightbox({
    win: winV, isRealChat, meId, meName: me?.displayName, peers, chatName: chat.name, lang,
  })

  // Channel-only wiring: live subscribe + catch-up, pts persistence, the open
  // discussion-thread overlay, and per-post comment counts.
  const { commentCounts } = useChannelExtras({
    isRealChat, isChannel, numericChatId, win, discussionsEnabled,
  })
  // Клик по «N комментариев» под постом канала — тред комментариев в этой же
  // колонке (tweb: setPeer(discussion group, threadId=postId)).
  const openDiscussionThread = useEvent((postId: number) => {
    if (discussionChatId > 0) onOpenThread?.({ chatId: discussionChatId, rootMsgId: postId, title: t('Comments'), subtitle: chat.name })
  })

  // Stable handler identities for the memoized feed: the feed closes over
  // `feedFns`, whose members never change reference, so toggling transient state
  // (context menu, viewer, composer text, hover) doesn't bust the feed's useMemo —
  // while each handler still reads fresh state via useEvent.
  const openSenderE = useEvent(openSender)
  const playVoiceE = useEvent(playVoice)
  const toggleSelectE = useEvent(toggleSelect)
  const openMsgMenuE = useEvent(openMsgMenu)
  const jumpToSeqE = useEvent(jumpToSeq)
  // Клик по дате-разделителю открывает пикер (tweb bubbles.ts:3058-3090 →
  // showDatePickerPopup с onPick = onDatePick). Выбор дня резолвится в seq
  // (ручка message_by_date) и отдаётся той же машинерии прыжка.
  const openDatePickerE = useEvent((dayMs: number) => {
    openPopup((p) => (
      <DatePickerPopup
        open={p.open}
        onClose={p.requestClose}
        onExitComplete={p.onExitComplete}
        initDate={dayMs}
        chatId={numericChatId}
        onPick={(timestamp) => {
          void managers.messages.messageByDate(numericChatId, timestamp).then((seq) => {
            if (seq != null) jumpToSeqE(seq)
          })
        }}
      />
    ), DATE_PICKER_POPUP_KIND)
  })
  // Сайдбар-поиск открыл чат «вокруг сообщения» → прыгаем к найденному seq
  const pendingJump = useSearchStore((s) => s.pendingJump)
  useEffect(() => {
    if (pendingJump && pendingJump.chatId === numericChatId) {
      useSearchStore.getState().clearPendingJump()
      jumpToSeqE(pendingJump.seq)
    }
  }, [pendingJump, numericChatId, jumpToSeqE])
  const openLightboxE = useEvent(openLightbox)
  const roundPlayingE = useEvent(attachRound)
  // Перезвон по клику на бабл звонка (tweb: клик по messageMediaCall → startCall)
  const recallE = useEvent((video: boolean) => {
    if (chat.type !== 'private' || chat.peerId == null) return
    startOutgoing(
      { id: chat.peerId, name: chat.name, avatar: chat.avatar, avatarText: chat.avatarText, avatarUrl: chat.avatarUrl },
      video,
      isRealChat ? numericChatId : null,
    )
  })
  // Кружок воспроизведён со звуком → снять media_unread (сервер разошлёт media_read)
  const mediaPlayedE = useEvent((msgId: number) => {
    if (isRealChat) markMediaPlayed(numericChatId, msgId)
  })
  // Отмена аплоада с бабла (tweb ProgressivePreloader cancel): убрать бабл сразу,
  // затем оборвать PUT в воркере (upload() кинет 'aborted' — fail будет no-op).
  const cancelUploadE = useEvent((clientId: string) => {
    useUploadsStore.getState().clear(clientId)
    // Убрать бабл через воркер-funnel (storeProjection единственный писатель окна).
    void managers.realtime.removePending({ chatId: numericChatId, threadRootId: threadRootId ?? null, clientMsgId: clientId })
    void managers.media.cancelUpload(clientId)
  })
  // Разблокировать платное медиа за звёзды (Telegram paid media): списание +
  // раскрытие бабла приезжают кадром paid_media_unlock (store), баланс —
  // balance_update. Нехватка звёзд → тост.
  const unlockPaidE = useEvent(async (msgId: number) => {
    try {
      await managers.stars.unlockPaidMedia(msgId)
    } catch {
      uiEvents.emit('ui:toast', t('Not enough Stars to unlock'))
    }
  })
  const feedFns = useMemo(
    () => ({
      openSender: openSenderE,
      playVoice: playVoiceE,
      toggleSelect: toggleSelectE,
      openMsgMenu: openMsgMenuE,
      jumpToSeq: jumpToSeqE,
      openDatePicker: openDatePickerE,
      openLightbox: openLightboxE,
      recall: recallE,
      mediaPlayed: mediaPlayedE,
      roundPlaying: roundPlayingE,
      toggleReaction,
      showReactedUsers,
      openStarReaction,
      cancelUpload: cancelUploadE,
      unlockPaid: unlockPaidE,
    }),
    [openSenderE, playVoiceE, toggleSelectE, openMsgMenuE, jumpToSeqE, openDatePickerE, openLightboxE, recallE, mediaPlayedE, roundPlayingE, toggleReaction, showReactedUsers, openStarReaction, cancelUploadE, unlockPaidE],
  )

  // (Ack reconcile + send-rejection run in realtimeBridge → messagesStore; live
  // edit/delete keyed by chat_id; pinned-bar state in usePinnedBar. The read-marker
  // for a live/open chat — markRead vs unread-below pill — and mark-read-on-open /
  // on-refocus all live in useChatScroll (they need scroll/focus state).)

  // Incoming typing is centralized in the store (see realtimeBridge + useTypingLabel).

  // (Header card + member presence seeding now live in useChatInfoCard.)

  // (Live online updates need no local listener: realtimeBridge writes every
  // presence frame into chatsStore.presence, and onlineCount below derives from it.)

  // (Peer read horizon now comes straight from the store dialog — see peerReadSeq
  // above. chatsStore.applyRead advances it on every live rt:read, so no local
  // listener is needed here.)

  // Mute как в tweb: включение mute из меню — через попап длительности
  // (PopupMute, монтируется в ConversationOverlays), снятие — сразу.
  const applyMute = (next: boolean, seconds?: number | null) => {
    if (!isRealChat) return
    setDialogMuted(numericChatId, next) // optimistic
    const until = next && seconds ? Math.floor(Date.now() / 1000) + seconds : undefined
    void managers.groups.setMute(numericChatId, next, until).catch(() => setDialogMuted(numericChatId, !next))
  }
  const toggleMute = () => {
    if (!isRealChat) return
    if (muted) applyMute(false)
    else pop.openMute()
  }

  // Добавление участников: полноценный под-экран живёт в UserInfoPanel
  const canAddMember = isRealChat && isGroup

  // Header subtitle for real group/channel chats: derive a member/online (or
  // subscriber) count from the card + live online count. Private and draft chats
  // keep the existing chat.status text (returned as null here).
  const realSubtitle: string | null = (() => {
    if (!isRealChat || !card) return null
    if (card.type === 'channel') return `${card.memberCount} подписчиков`
    if (card.type === 'group')
      return `${card.memberCount} участников${onlineCount > 0 ? `, ${onlineCount} онлайн` : ''}`
    return null
  })()

  // Header status line: typing/recording wins; then group member counts; then
  // private online / last-seen; then any static status.
  const headerTypingActive = typingLabel.active
  const headerTypingText = typingLabel.label
  const headerTypingKind = typingLabel.kind
  const presenceLabel =
    chat.type === 'private' && peerPresence
      ? peerPresence.online
        ? t('online')
        : lastSeenLabel(peerPresence.lastSeen, lang)
      : null
  const headerStatus = realSubtitle ?? presenceLabel ?? (chat.status ? t(chat.status) : '')
  const headerOnline = !!peerPresence?.online || chat.status === 'online'

  // Бот-собеседник (для кнопки «Начать», reply-клавиатуры и кнопки-меню) — по профилю.
  const [isBotChat, setIsBotChat] = useState(false)
  const [botMenu, setBotMenu] = useState<{ text: string; url: string } | null>(null)
  useEffect(() => {
    if (chat.type !== 'private' || chat.peerId == null) { setIsBotChat(false); setBotMenu(null); return }
    let alive = true
    const peerId = chat.peerId
    setBotMenu(null)
    void managers.privacy.profile(peerId).then((p) => {
      if (!alive) return
      setIsBotChat(!!p.isBot)
      if (p.isBot) {
        void managers.bots.menuButton(peerId).then((mb) => { if (alive && mb.text && mb.url) setBotMenu(mb) }).catch(() => {})
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [chat.type, chat.peerId, managers])
  // reply-клавиатура: последнее сообщение бота с непустым keyboard (пустой = скрыть).
  const replyKeyboard = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const k = msgs[i].replyMarkup?.keyboard
      if (k) return k.length > 0 ? k : null
    }
    return null
  }, [msgs])
  // Бот без истории → кнопка «Начать» вместо композера (шлёт /start).
  const botStart = isBotChat && isRealChat && msgs.length === 0
  // Пустой приватный чат (не бот, не группа) → плейсхолдер-приветствие (tweb).
  const emptyGreeting = isRealChat && msgs.length === 0 && chat.type === 'private' && !isBotChat

  // Floating "scroll to bottom" button (tweb .bubbles-go-down), shown above the composer.
  // onScrollDownClick (reload-newest + pin, or smooth scroll) lives in useChatScroll.
  const scrollDownFab = (
    <ScrollDownFab show={showScrollDown} unreadBelow={unreadBelow} onClick={onScrollDownClick} />
  )

  // Sticky date-pill offset: below the floating header, plus the player plate
  // and the pinned-message bar when shown. На мобилке хедер на 8px выше (top 8 vs 16).

  // Stable handlers for the extracted header/pinned bars so their memo holds
  // across the parent's transient re-renders.
  const onToggleInfo = useEvent(() => setInfoOpen((o) => !o))
  const onOpenHeaderMenu = useEvent((r: DOMRect) => pop.openHeaderMenu({ top: r.bottom + 6, right: window.innerWidth - r.right }))
  const onUnpin = useEvent((id: number) => { void managers.messages.unpin(numericChatId, id) })
  // Клик по пин-плашке (tweb followPinnedMessage): прыжок к показанному пину,
  // бар перелистывается на следующий (более старый, циклически).
  const onPinFollow = useEvent(() => {
    const m = followPin()
    if (m) jumpToSeqE(m.seq)
  })
  const onOpenPinList = useEvent(() => pop.openPinned())
  // Право «Открепить все» (tweb canPinMessage): приватный/личный чат — всегда;
  // группа/канал — создатель или админ с RightPinMessages (1<<5).
  const canUnpinAll = chat.type === 'private' || chat.type === 'saved' ||
    card?.myRole === 'creator' || ((card?.myRights ?? 0) & 32) !== 0
  // Создавать розыгрыш может владелец канала или админ с RightPostMessages (1<<0).
  const canCreateGiveaway = isChannel && isRealChat &&
    (card?.myRole === 'creator' || ((card?.myRights ?? 0) & 1) !== 0)
  // Stable composer callbacks so the memoized <Composer> doesn't re-render on
  // unrelated parent renders (e.g. the scroll handler toggling showScrollDown).
  // Медленный режим: обычный участник группы блокируется на N сек после отправки
  const slowmodeExempt = !isGroup || card?.myRole === 'creator' || card?.myRole === 'admin'
  const { left: slowmodeLeft, markSent: slowmodeMarkSent } = useSlowmode(card?.slowmodeSeconds ?? 0, slowmodeExempt)
  // Платные сообщения (Telegram paid messages): плашка в композере только для
  // не-админа платной группы (владелец/админ пишут бесплатно).
  const composerChargeStars = isGroup && card && card.myRole !== 'creator' && card.myRole !== 'admin' ? (card.chargeStars ?? 0) : 0
  const onComposerSend = useEvent((text: string, entities?: MessageEntity[], ttlSeconds?: number | null, silent?: boolean, effect?: import('../core/effects/emojiEffects').EmojiEffectKind | null) => { send(text, entities, ttlSeconds, silent ?? false, effect ?? null); slowmodeMarkSent() })
  // Inline-режим: резолв «@username» → id бота (кэш), затем выдача бэком (он сам
  // проверит is_bot). Выбор результата шлёт его текст обычным сообщением.
  const inlineBotCache = useRef<Map<string, number | null>>(new Map())
  const onComposerInlineQuery = useEvent(async (username: string, query: string): Promise<InlineResult[] | null> => {
    const uname = username.toLowerCase()
    let botId = inlineBotCache.current.get(uname)
    if (botId === undefined) {
      try {
        const res = await managers.channels.search(uname)
        const u = res.users.find((x) => x.username.toLowerCase() === uname)
        botId = u ? u.id : null
      } catch { botId = null }
      inlineBotCache.current.set(uname, botId)
    }
    if (botId == null) return null
    try { return (await managers.bots.inline(botId, query)).results } catch { return null }
  })
  const onComposerPickInline = useEvent((r: InlineResult) => { send(r.messageText); slowmodeMarkSent() })
  // Стикер из пикера/саджестов; каналы постят через REST (стикеры не шлём),
  // секретные чаты — E2E-путь без обычного медиа.
  const onComposerPickSticker = useEvent((st: { id: number; mediaId: number; emoji: string }) => { sendSticker(st); slowmodeMarkSent() })
  // GIF из вкладки пикера — те же ограничения, что у стикеров (не канал, не секретный).
  const onComposerPickGif = useEvent((g: GifItem) => { sendGif(g); slowmodeMarkSent() })
  const onComposerCancelReply = useEvent(() => setReply(null))
  const onComposerCancelEdit = useEvent(() => setEditing(null))
  // Плашка форварда: отмена, тоггл опций меню (скрыть отправителя/подпись),
  // «переслать в другой чат» (переоткрываем пикер с исходным чатом + снимком превью).
  const onComposerCancelForward = useEvent(() => setForward(null))
  const onComposerForwardOption = useEvent((opt: { dropAuthor?: boolean; dropCaption?: boolean }) =>
    setForward((f) => (f ? { ...f, ...opt } : f)))
  const onComposerForwardAnother = useEvent(() => {
    if (!forward) return
    openForwardFrom(forward.sourceChatId, forward.msgIds, { count: forward.count, text: forward.text, hasCaption: forward.hasCaption })
    setForward(null)
  })
  const onComposerOpenAttach = useEvent((r: DOMRect) => pop.openAttach({ left: r.left, bottom: window.innerHeight - r.top + 8 }))
  // Files pasted/dropped into the composer → open the same media-preview popup as
  // the attach button (lets the user add a caption + choose media/file).
  const onComposerPasteFiles = useEvent((files: File[]) => setPendingMedia({ files, asFile: false }))
  // ↑ на пустом инпуте — правка своего последнего сообщения (tweb editLastMessage):
  // ищем с конца окна первое своё редактируемое сообщение и ставим editing тем же
  // путём, что «Изменить» из меню (setEditing).
  const onComposerEditLast = useEvent(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (!m.out || m.deleted || m.type === 'date' || m.type === 'service') continue
      const raw = winV.msgs[i]
      if (raw?.id == null) continue
      setEditing({ msgId: raw.id, text: m.text ?? '', entities: raw.entities })
      setReply(null)
      return
    }
  })
  // Ctrl/Cmd+↑ — ответ на последнее подходящее сообщение окна (tweb): с конца
  // ищем первое несервисное/неудалённое сообщение и ставим reply как из меню.
  const onComposerReplyPrev = useEvent(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.deleted || m.type === 'date' || m.type === 'service') continue
      const rs = convMsgReplyState(m, winV.msgs[i]?.id, chat.name, accentColor)
      if (rs) { setReply(rs); setEditing(null); return }
    }
  })
  // Ctrl/Cmd+PageUp / PageDown — к началу / концу истории (tweb). PageUp скроллит
  // к верху загруженного окна (старые подгрузит штатный scroll-листенер); PageDown
  // переиспользует «вниз» (reloadNewest + пин к низу). Активно при открытом чате.
  useEffect(() => {
    if (!isRealChat) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      if (e.key === 'PageUp') {
        e.preventDefault()
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      } else if (e.key === 'PageDown') {
        e.preventDefault()
        onScrollDownClick()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isRealChat, scrollRef, onScrollDownClick])

  // tweb bubbles.ts:10166-10180 (onRenderScrollSet): `has-sticky-dates` на
  // контейнере ленты появляется, когда история прокручиваема — без него
  // _chatBubble.scss прячет липкий дата-разделитель (`.bubbles:not(.has-sticky-dates)
  // .bubble.is-date { visibility: hidden }`) и показывает его is-fake-двойник.
  useEffect(() => {
    const box = bubblesRef.current
    const sc = scrollRef.current
    if (!box || !sc) return
    box.classList.toggle('has-sticky-dates', sc.scrollHeight > sc.clientHeight)
  })

  // Форум-группы здесь НЕ перехватываются: как в tweb, клик по форуму открывает
  // панель топиков в ЛЕВОМ сайдбаре (Sidebar → TopicsPanel); тред топика — этот же
  // компонент в thread-режиме, а «Показать как сообщения» — обычный чат.

  // Фасад открытия императивных попапов колонки (меню/пикеры/подтверждения/попапы
  // канала) через popupStore. Объявлен после всех зависимостей; хендлеры выше
  // зовут его лениво (по событию), так что порядок не важен.
  const pop = useChatPopups({
    chat, numericChatId, isRealChat, isChannel,
    activeThemeId, muted, owned, thread, canManageTopic,
    canAddMember, canCreateGiveaway, canUnpinAll, pins, deleteLabels, livestreamActive,
    setInfoOpen,
    applyMute, toggleMute, startSelectMode, setSelectionMode,
    doDeleteChat, doClearHistory, openPicker, sendGeo, sendContact, setPendingMedia,
    slowmodeMarkSent, jumpToSeq: jumpToSeqE, setScheduledCount,
    onOpenPeer, onCloseThread,
  })

  return (
    <CallProvider chat={chat}>
    <div className={s.root} ref={rootRef}>
      {/* Колонка чата = tweb `.chat`; `can-click-date` включает клик по дате-
          разделителю (_chatBubble.scss:511-514, bubbles.ts:3058-3090). */}
      <div className={classNames(s.column, 'chat', isRealChat ? 'can-click-date' : '', narrow ? s.columnNarrow : '', infoOpen && !narrow ? s.columnInfoOpen : '')}>
        {/* Обои темы чата рисует глобальный ChatBackground (App), чтобы весь shell был
            в теме, а не только эта колонка — локальный слой убран. */}
        {/* Global "now playing" plate — a floating pill above the header (tweb:
            the topbar slides down to make room). Matches the header geometry. */}
        <div className={classNames(s.nowPlaying, narrow ? s.nowPlayingNarrow : '')}>
          <div className={s.nowPlayingInner}>
            <NowPlayingBar />
          </div>
        </div>

        {thread ? (
        <div className={s.threadHeaderBar} style={{ top: (narrow ? 8 : 16) + playerOffset }}>
          <div className={s.threadHeaderCard}>
            <IconButton onClick={onCloseThread} color="var(--secondary-text-color)" style={{ marginLeft: '-4px' }}>
              <TgIcon name="back" />
            </IconButton>
            {thread.kind === 'topic' ? (
              <TopicIcon color={thread.iconColor ?? 0} title={thread.title} size={30} />
            ) : (
              <TgIcon name="comments" size={26} color="var(--primary-color)" />
            )}
            <div className={s.threadHeaderBody} onClick={() => setInfoOpen(true)} style={{ cursor: 'pointer' }}>
              <Text noWrap weight={600} size={15.5} color="var(--primary-text-color)">{thread.title}</Text>
              <Text noWrap size={12.5} color="var(--secondary-text-color)">{thread.subtitle ?? chat.name}</Text>
            </div>
            {thread.closed && <TgIcon name="lock" size={18} color="var(--secondary-text-color)" />}
            <IconButton
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                pop.openThreadMenu({ top: r.bottom + 6, right: window.innerWidth - r.right })
              }}
              color="var(--secondary-text-color)"
            >
              <TgIcon name="more" />
            </IconButton>
          </div>
        </div>
        ) : (
        <ChatHeader
          chat={chat}
          avatarSrc={headerAvatarSrc}
          peerOnline={peerPresence?.online}
          typingActive={headerTypingActive}
          typingText={headerTypingText}
          typingKind={headerTypingKind}
          status={headerStatus}
          online={headerOnline}
          isBot={isBotChat}
          playerOffset={playerOffset}
          onJumpToSeq={jumpToSeqE}
          onBack={onBack}
          onToggleInfo={onToggleInfo}
          onOpenMenu={onOpenHeaderMenu}
        />
        )}

        {!thread && <PinnedBar
          pins={pins}
          index={pinIndex}
          searchOpen={searchOpen}
          playerOffset={playerOffset}
          onFollow={onPinFollow}
          onUnpin={onUnpin}
          onOpenList={onOpenPinList}
        />}

        {/* Панель тегов-реакций «Избранного» (Telegram saved reaction tags). */}
        {isSaved && !thread && (
          <SavedTagsPanel activeTag={savedTagFilter} onFilter={setSavedTagFilter} />
        )}

        {/* First-load spinner — only after the grace delay (skipped on cache hits) */}
        <AnimatePresence>
          {showSpinner && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={s.spinnerOverlay}
            >
              <div className={s.spinnerBox}>
                <Preloader size={30} stroke={2.5} color="#fff" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Лента — дерево tweb: .bubbles > .scrollable.bubbles-scrollable >
            .bubbles-inner (bubbles.ts:1441, 5787-5791). Стили самих обёрток
            приедут с _chat.scss (фаза 3); классы нужны уже сейчас, потому что
            правила баблов селектят предков (.bubbles.is-selecting,
            .bubbles.has-groups, .bubbles-inner.is-chat, .bubbles-inner.is-scrolling).
            scrolled-down/has-sticky-dates — состояния скролла, приходят в Task 3.4. */}
        <div ref={bubblesRef} className={classNames('bubbles', feedMsgs.length ? 'has-groups' : '', selecting ? 'is-selecting' : '')}>
        <div
          ref={scrollRef}
          onMouseDown={dragSelect.onMouseDown}
          className={classNames(s.scroll, 'scrollable', 'scrollable-y', 'bubbles-scrollable')}
          style={{ maskImage: feedMask(fadeTop(narrow), fadeBottom(narrow)), WebkitMaskImage: feedMask(fadeTop(narrow), fadeBottom(narrow)) }}
        >
          <div
            ref={contentRef}
            className={classNames(s.content, 'bubbles-inner', isGroup ? 'is-chat' : '', feedMsgs.length ? '' : 'no-messages')}
            style={{
              // fade messages in once the first page has loaded (tweb-like)
              opacity: feedLoading ? 0 : 1,
              // clear the floating header/composer
              paddingTop: `${padTop(narrow) + playerOffset}px`,
              paddingBottom: `${padBottom(narrow)}px`,
              // те же величины под именами tweb: от них считают sticky-top даты
              // (.bubble.is-date) и низ sticky-аватара группы (_chatBubble.scss:47-49).
              ['--chat-padding-top' as string]: `${padTop(narrow) + playerOffset}px`,
              ['--chat-padding-bottom' as string]: `${padBottom(narrow)}px`,
              // Текст границы непрочитанных — CSS-контент (tweb
              // `.is-first-unread:before { content: var(--unread-messages-text) }`),
              // поэтому значение подаётся строкой в кавычках.
              ['--unread-messages-text' as string]: JSON.stringify(t('Unread Messages')),
            }}
          >
            {/* Render the list only once revealed, so rows mount at reveal time
                and the ladder is seen (not played hidden behind the spinner). */}
            {!feedLoading && (
              <ChatFeed
                msgs={feedMsgs}
                winMsgs={feedWinMsgs}
                autoDownload={autoDownload}
                isRealChat={isRealChat}
                isGroup={isGroup}
                discussionsEnabled={discussionsEnabled}
                commentCounts={commentCounts}
                highlightSeq={highlightSeq}
                unreadDividerSeq={unreadDividerSeq}
                selecting={selecting}
                selected={selected}
                ladderActive={ladderActive}
                dateStickyTop={dateStickyTop}
                feedFns={feedFns}
                onOpenDiscussion={openDiscussionThread}
              />
            )}

            {/* Похожие каналы под лентой канала (tweb chat/similarChannels). */}
            {!feedLoading && isChannel && isRealChat && !thread && (
              <SimilarChannels chatId={numericChatId} onOpen={onOpenChannel} />
            )}
          </div>
          {!feedLoading && emptyGreeting && (
            <EmptyChatGreeting onGreet={() => onComposerSend('👋')} />
          )}
        </div>
        </div>

        {/* Footer */}
        {selecting ? (
          <SelectionBar
            count={selected.size}
            onClear={clearSelection}
            onForward={() => openForwardFor([...selected])}
            onDelete={() => openDeleteFor([...selected])}
            canForward={!isSecret}
          />
        ) : thread?.closed ? (
          <div className={classNames(s.footer, s.footerCompose)}>
            <div className={s.threadClosedBar}>
              <TgIcon name="lock" size={16} color="var(--secondary-text-color)" />
              <Text size={14.5} color="var(--secondary-text-color)">{t('Topic is closed')}</Text>
            </div>
          </div>
        ) : botStart ? (
          <div className={classNames(s.footer, s.footerMuted)}>
            {scrollDownFab}
            <motion.div whileTap={{ scale: 0.99 }} className={s.muteBtn} onClick={() => onComposerSend('/start')}>
              <Text weight={600} size={15.5} color="var(--primary-color)">{t('Start')}</Text>
            </motion.div>
          </div>
        ) : secretLocked ? (
          // Секретный чат до завершения handshake: бар вместо композера (гейтинг
          // отправки — сам факт, что <Composer> тут не рендерится + secretLocked в useChatSend).
          <div className={classNames(s.footer, s.footerCompose)}>
            {scrollDownFab}
            <div className={s.secretBar}>
              {secretStatus === 'requested' ? (
                <>
                  <Text size={14.5} style={{ textAlign: 'center' }} color="var(--secondary-text-color)">
                    {t('Пользователь приглашает вас в секретный чат')}
                  </Text>
                  <div className={s.secretBarBtns}>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.98 }}
                      className={classNames(s.secretBtn, s.secretBtnPrimary)}
                      disabled={secretBusy}
                      onClick={onSecretAccept}
                    >
                      <Text weight={600} size={15} color="#fff">{t('Принять')}</Text>
                    </motion.button>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.98 }}
                      className={s.secretBtn}
                      disabled={secretBusy}
                      onClick={onSecretReject}
                    >
                      <Text weight={600} size={15} color="var(--secondary-text-color)">{t('Отклонить')}</Text>
                    </motion.button>
                  </div>
                </>
              ) : (
                <Text size={14.5} style={{ textAlign: 'center' }} color="var(--secondary-text-color)">
                  {secretStatus === 'rejected'
                    ? t('Секретный чат отклонён')
                    : t('Ожидание, пока собеседник примет секретный чат…')}
                </Text>
              )}
            </div>
          </div>
        ) : canType && canSendText ? (
          <div className={classNames(s.footer, s.footerCompose)}>
            {scrollDownFab}
            {replyKeyboard && (
              <div className={s.replyKeyboard}>
                {replyKeyboard.map((row, ri) => (
                  <div key={ri} className={s.replyKeyboardRow}>
                    {row.map((label, bi) => (
                      <button key={bi} type="button" className={s.replyKeyboardBtn} onClick={() => onComposerSend(label)}>
                        {label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {/* Hidden file picker — triggered by the attach menu (openPicker). */}
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.currentTarget.value = ''
                if (files.length) setPendingMedia({ files, asFile: pickAsFileRef.current })
              }}
            />
            {/* Composer: owns the draft text locally so typing re-renders only it. */}
            <Composer
              key={chat.id}
              reply={reply}
              editing={editing}
              forward={forward}
              rec={rec}
              onSend={onComposerSend}
              onTyping={onComposerTyping}
              onPickSticker={canType && canSendMedia && !isChannel && chat.type !== 'secret' ? onComposerPickSticker : undefined}
              onPickGif={canType && canSendMedia && !isChannel && chat.type !== 'secret' ? onComposerPickGif : undefined}
              onCancelReply={onComposerCancelReply}
              onCancelEdit={onComposerCancelEdit}
              onCancelForward={onComposerCancelForward}
              onForwardOption={onComposerForwardOption}
              onForwardAnother={onComposerForwardAnother}
              onOpenAttach={onComposerOpenAttach}
              onPasteFiles={isRealChat && canSendMedia ? onComposerPasteFiles : undefined}
              initialDraft={initialDraft}
              onDraftChange={isRealChat ? onDraftChange : undefined}
              mentions={isGroup && mentionPeers.length > 0 ? mentionPeers : undefined}
              onInlineQuery={isRealChat ? onComposerInlineQuery : undefined}
              onPickInline={onComposerPickInline}
              botMenuButton={botMenu ? { text: botMenu.text, onClick: () => openWebApp({ url: botMenu.url, botName: chat.name }) } : undefined}
              onSchedule={isRealChat ? onComposerSchedule : undefined}
              canSendWhenOnline={canSendWhenOnline}
              onSendWhenOnline={canSendWhenOnline ? onComposerSendWhenOnline : undefined}
              scheduledCount={scheduledCount}
              onOpenScheduled={() => pop.openScheduled()}
              slowmodeLeft={slowmodeLeft}
              secret={chat.type === 'secret'}
              canSendMedia={canSendMedia}
              chargeStars={composerChargeStars}
              sendAs={sendAs.peers.length > 1 ? { peers: sendAs.peers, currentId: sendAs.currentId, onSelect: sendAs.select } : undefined}
              onEditLast={onComposerEditLast}
              onReplyPrev={onComposerReplyPrev}
            />
          </div>
        ) : isGroup && !canSendText ? (
          /* Группа запрещает участникам писать (дефолт-права) — плашка вместо
             композера, как в tweb (вместо «молчаливого» отказа на бэке). */
          <div className={classNames(s.footer, s.footerMuted)}>
            {scrollDownFab}
            <div className={s.muteBtn} style={{ cursor: 'default' }}>
              <TgIcon name="permissions" size={20} color="var(--secondary-text-color)" />
              <Text weight={600} size={15.5} color="var(--secondary-text-color)">{t('Sending messages is not allowed in this group')}</Text>
            </div>
          </div>
        ) : (
          <div className={classNames(s.footer, s.footerMuted)}>
            {scrollDownFab}
            {/* Нижняя кнопка канала (tweb ChatInput) переключает mute напрямую, без попапа */}
            <motion.div whileTap={{ scale: 0.995 }} className={s.muteBtn} onClick={() => isRealChat && applyMute(!muted)}>
              <TgIcon name={muted ? 'unmute' : 'volume_off'} size={20} color="var(--secondary-text-color)" />
              <Text weight={600} size={15.5}>{t(muted ? 'Unmute' : 'Mute')}</Text>
            </motion.div>
            {/* Не-постер канала предлагает пост админам (Telegram suggested posts) */}
            {isChannel && isRealChat && (
              <motion.div whileTap={{ scale: 0.995 }} className={s.muteBtn} onClick={() => pop.openSuggest()}>
                <TgIcon name="add" size={20} color="var(--primary-color)" />
                <Text weight={600} size={15.5} color="var(--primary-color)">{t('Suggest a Post')}</Text>
              </motion.div>
            )}
            <div className={s.giftBtn}>
              <TgIcon name="gift" color="var(--secondary-text-color)" />
            </div>
          </div>
        )}
      </div>

      {/* Инфо-панель (private / group / channel) — после первого открытия всегда
          смонтирована; открытие/закрытие — сдвиг transform самой панели (tweb
          #column-right), поверх неё может открыться gift-попап (стек popupStore). */}
      <Suspense fallback={null}>
        {infoMounted && (
          <UserInfoPanel
            open={infoOpen}
            chat={chat}
            onClose={() => setInfoOpen(false)}
            onOpenPeer={onOpenPeer}
            canAddMembers={canAddMember}
            onEditContact={() => { setInfoOpen(false); pop.openEditContact() }}
            onSendGift={chat.type === 'private' && chat.peerId != null && chat.peerId !== meId ? pop.openGift : undefined}
          />
        )}
      </Suspense>

      {/* Баннер идущего видеочата (tweb topbar-call): Join, пока сам не в звонке */}
      {isRealChat && !thread && groupCallActive.length > 0 && myGroupCallChat !== numericChatId && (
        <div className={s.groupCallBanner} onClick={() => void joinGroupCall(numericChatId)}>
          <TgIcon name="videochat" size={18} color="#fff" />
          <Text size={14} weight={600} color="#fff" style={{ flex: 1 }}>
            {t('Video Chat')} · {groupCallActive.length} {t('participants')}
          </Text>
          <Text size={14} weight={700} color="#fff">{t('Join')}</Text>
        </div>
      )}

      {/* Баннер идущей RTMP-трансляции (tweb topbarLive): смотреть, пока сам не смотришь */}
      {isRealChat && !thread && livestreamActive && myWatchingChat !== numericChatId && (
        <div className={s.groupCallBanner} onClick={() => watchLivestream(numericChatId)}>
          <TgIcon name="livestream" size={18} color="#fff" />
          <Text size={14} weight={600} color="#fff" style={{ flex: 1 }}>
            {t('Live Stream')}
          </Text>
          <Text size={14} weight={700} color="#fff">{t('Join')}</Text>
        </div>
      )}

      {/* Превью-отправка медиа (буфер обмена/attach) — state-driven из useChatSend */}
      {pendingMedia && (
        <SendMediaPopup
          files={pendingMedia.files}
          initialAsFile={pendingMedia.asFile}
          onClose={() => setPendingMedia(null)}
          onSend={(caption, asFile, paidPrice) => { void sendPendingMedia(caption, asFile, paidPrice); slowmodeMarkSent() }}
        />
      )}

      {/* Просмотрщик медиа (lightbox) — state-driven из useLightbox */}
      {lightbox && (
        <Suspense fallback={null}>
          <MediaLightbox
            items={lightbox.items}
            index={lightbox.index}
            originRect={lightbox.originRect}
            originSrc={lightbox.originSrc}
            originEl={lightbox.originEl}
            onClosingStart={() => { lightbox.originEl.style.visibility = '' }}
            onClose={closeLightbox}
          />
        </Suspense>
      )}

      {/* Попапы действий над сообщением (state-driven из useMessageActions) */}
      <ChatMsgActionPopups msgActions={msgActions} numericChatId={numericChatId} isRealChat={isRealChat} />

    </div>
    </CallProvider>
  )
}
