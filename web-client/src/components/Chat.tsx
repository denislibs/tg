// Известное исключение из нормы «корень бандла не владеет непокрытой проводкой»
// (../CLAUDE.md, раздел «Тесты», статус по файлам этой роли) — самый большой
// компонент клиента, ни один тест его не импортирует. Осознанный долг, не
// переписывается ради самой нормы; при следующем содержательном касании файла —
// приводить затронутую проводку в соответствие (тест либо пометка с причиной у
// неё), а не расширять непокрытую площадь дальше.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import StickyIntersector from './stickyIntersector'
import { observeNewSections, pickStickyDateKey, pruneEvictedSections } from './chatStickyDates'
import { useAvatarSrc } from './useAvatarSrc'
import { chatThemeVariant } from '../chatThemes'
import { PRESET_MODE, resolvePreset } from '../theme'
import { applyChatTheme, clearChatTheme } from '../core/theme/themeController'
import { useSettingsStore } from '../settings'
import { CallProvider } from './call/CallProvider'
import { startOutgoing } from '../core/calls/callEngine'
import NowPlayingBar from './NowPlayingBar'
import ProgressivePreloader from './preloader'
import type { Chat } from '../data'
import { useT, useLang } from '../i18n'
import { useTypingLabel } from '../core/hooks/useTypingLabel'
import { lastSeenLabel } from '../core/presence'
import { useManagers } from '../core/hooks/useManagers'
import { useNavigationActions } from '../core/hooks/useNavigationActions'
import { useChatStackStore } from '../stores/chatStackStore'
import { useMessageWindow } from '../core/hooks/useMessageWindow'
import { useEvent } from '../core/hooks/useEvent'
import { useFeedPageHotkeys } from '../core/hooks/useFeedPageHotkeys'
import { useMiddlewareHelper } from '../core/hooks/useMiddlewareHelper'
import rootScope from '@lib/rootScope'
import { markMediaPlayed } from '../core/mediaRead'
import type { GifItem } from '../core/gifs'
import { useChatSelection } from '../core/hooks/useChatSelection'
import { useSetTransition } from '../core/hooks/useSetTransition'
import { useChatInfoCard } from '../core/hooks/useChatInfoCard'
import { usePinnedBar } from '../core/hooks/usePinnedBar'
import { useChatSend } from '../core/hooks/useChatSend'
import { useSendAs } from '../core/hooks/useSendAs'
import { useSlowmode } from '../core/hooks/useSlowmode'
import { useChatScroll } from '../core/hooks/useChatScroll'
import { useConvMessages } from '../core/hooks/useConvMessages'
import { useVoiceQueue } from '../core/hooks/useVoiceQueue'
import { collectLightboxItems, messageToViewerItem } from './mediaViewer/collectLightboxItems'
import { closeMediaViewer, openMediaViewer } from './mediaViewer/openMediaViewer'
import type { ViewerItem } from './mediaViewer/appMediaViewer'
import { useMessageActions } from '../core/hooks/useMessageActions'
import { useChannelExtras } from '../core/hooks/useChannelExtras'
import { useMountTransition } from '../core/hooks/useMountTransition'
import { useFeedReveal } from '../core/hooks/useFeedReveal'
import { animateLadder, type LadderStep } from '../core/dom/ladder'
import { shiftGradientWithScroll } from '../core/chat/activeGradient'
import liteMode from '../helpers/liteMode'
import Composer from './Composer'
import ChatFeed from './messages/ChatFeed'
import EmptyChatGreeting from './messages/EmptyChatGreeting'
import SimilarChannels from './messages/SimilarChannels'
import { useChatAutoDownload } from '../core/hooks/useChatAutoDownload'
import { useDrafts } from '../stores/draftsStore'
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
import CornerButton from './conversation/CornerButton'
import ChatInputControl, { isControlNeeded, type ControlFlags } from './conversation/ChatInputControl'
import { useChatInputCenter } from './conversation/useChatInputCenter'
import SelectionBar from './conversation/SelectionBar'
import ChatDrops from './conversation/ChatDrops'
import { useChatsStore } from '../stores/chatsStore'
import { useSecretChatStore } from '../stores/secretChatStore'
import { type Message, type MessageEntity } from '../core/models'
import type { InlineResult } from '../core/managers/botsManager'
import { openWebApp } from '../core/webapp'
import { useSearchStore } from '../stores/searchStore'
import { useAudioStore } from '../stores/audioStore'
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
import useMeasuredHeight from '../shared/lib/useMeasuredHeight'

// Инфо-панель — не первый кадр; ленивый чанк.
const UserInfoPanel = lazy(() => import('./UserInfoPanel'))

// Распорки ленты (.bubbles-padding-top/-bottom) — 1:1 из tweb chat.ts
// recomputePaddings(): десктоп резервирует 4.5rem сверху и 4rem снизу под
// плавающие плейты и композер, handheld схлопывает обе до 3.5rem; сверху
// добавляется суммарная высота плейтов, снизу — «излишек» композера
// (reply-плашка / многострочный инпут). Маску фейдов считает CSS
// (styles/tweb/_chat.scss `.bubbles-scrollable`), а не JS.
const REM = 16
const padTop = (narrow: boolean, floatingPx: number) => Math.round((narrow ? 3.5 : 4.5) * REM) + floatingPx
const padBottom = (narrow: boolean, surplusPx: number) => Math.round((narrow ? 3.5 : 4) * REM) + surplusPx
// tweb topbar.setFloating: зазор между топбаром и стеком плейтов.
const TOPBAR_GAP = 8
// Плашка плеера стоит НАД топбаром и сдвигает его вниз на
// --topbar-floating-audio-height = --topbar-audio-height (3rem) + --plates-gap
// (0.5rem) — _chatTopbar.scss:7-9 по body.is-pinned-audio-shown (класс ставит
// NowPlayingBar). Высота плашки в tweb захардкожена там же: createChatAudio →
// createTopbarPlate({modifier: 'audio', height: 48}).
// отступление от tweb: tweb отдаёт в chat.updatePinnedFloatingHeight только
// floatingHeight (стек .topbar-floating-plates), хотя его же
// --pinned-floating-height (topbar.ts:1571-1574), --chat-padding-top и
// .bubbles-viewport считают плашки плеера/звонка. Из-за этого распорка ленты
// недобирает ровно высоту плеера, и при играющем аудио верхнее сообщение
// уезжает под топбар (проверено на референсе :8099: топбар 16→72, распорка
// осталась 72px). Считаем распорку по тому же набору, что и CSS-переменная.
const AUDIO_PLATE_FLOATING_HEIGHT = 56

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
  const onCloseThread = useCallback(() => { useChatStackStore.getState().closeTop() }, [])
  // Ветка комментариев под постом канала (tweb setPeer({peerId, threadId})) —
  // кладём поверх стека (tweb setInnerPeer).
  const onOpenThread = useCallback((args: { chatId: number; rootMsgId: number; title: string; subtitle?: string }) => {
    useChatStackStore.getState().setInnerPeer({
      peerId: args.chatId,
      threadId: args.rootMsgId,
      type: 'discussion',
      thread: { rootMsgId: args.rootMsgId, title: args.title, subtitle: args.subtitle, kind: 'comments' },
    })
  }, [])
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
  // Сколько тегов реально есть — от этого зависит, показывать ли стек плейтов.
  const [savedTagsCount, setSavedTagsCount] = useState(0)
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
  // toggle re-renders the menu; fall back to the chat prop.
  const dialogMuted = useChatsStore((s) =>
    isRealChat ? s.dialogs.find((d) => d.chatId === numericChatId)?.muted : undefined,
  )
  const muted = dialogMuted ?? !!chat.muted
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()

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
  const { playVoice, attachRound } = useVoiceQueue({
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
  // Search is owned by ChatHeader now; here we only read whether it's open (single-sourced
  // in searchStore) to hide the pinned bar + adjust the sticky-date offset.
  const searchOpen = useSearchStore((s) => s.byChat[numericChatId]?.open ?? false)
  // tweb chat.ts:795 onActive → `.chat.is-search-active`: строка тегов-реакций
  // топбар-поиска раздвигает ленту (_chat.scss:527 — распорка 3.75rem сверху).
  const searchReactionsShown = useSearchStore((s) => s.byChat[numericChatId]?.reactionsShown ?? false)
  // Запланированные сообщения: счётчик (календарик в композере); оверлей списка — в popups.
  const [scheduledCount, setScheduledCount] = useState(0)
  useEffect(() => {
    setScheduledCount(0)
    if (!isRealChat) return
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    void managers.messages.listScheduled(numericChatId)
      .then((l) => { if (middleware()) setScheduledCount(l.length) })
      .catch(() => undefined)
    return () => scope.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericChatId, isRealChat])
  // Идущий видеочат этого чата (для баннера Join): снимок при открытии + live
  const groupCallActive = useGroupCallStore((st) => st.activeByChat[numericChatId] ?? EMPTY_IDS)
  const myGroupCallChat = useGroupCallStore((st) => st.chatId)
  useEffect(() => {
    if (!isRealChat || chat.type === 'private' || chat.type === 'saved') return
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    void managers.messages.groupCallParticipants(numericChatId)
      .then((ids) => { if (middleware()) useGroupCallStore.getState().setActive(numericChatId, ids) })
      .catch(() => undefined)
    return () => scope.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericChatId, isRealChat])

  // Идущая RTMP-трансляция этого чата (плашка LIVE): снимок при открытии + live
  const livestreamActive = useLivestreamStore((st) => st.activeByChat[numericChatId] ?? false)
  const myWatchingChat = useLivestreamStore((st) => st.watchingChatId)
  useEffect(() => {
    if (!isRealChat || chat.type === 'private' || chat.type === 'saved') return
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    void managers.livestream.status(numericChatId)
      .then((st) => { if (middleware()) useLivestreamStore.getState().setActive(numericChatId, st.active) })
      .catch(() => undefined)
    return () => scope.destroy()
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

  // Высота стека плавающих плейтов под топбаром (tweb topbar.setFloating):
  // измеряем контейнер .topbar-floating-plates — он уже включает 1px-разделители
  // между плашками — и добавляем зазор до топбара. От неё зависят и распорка
  // ленты, и --pinned-floating-height (маска фейдов, sticky-дата).
  const [platesHeight, setPlatesHeight] = useState(0)
  const platesRef = useMeasuredHeight((h) => setPlatesHeight(h > 0 ? h + TOPBAR_GAP : 0))
  // Излишек композера над базовой строкой (reply-плашка, многострочный ввод) —
  // tweb --chat-input-height-surplus (chat.ts setChatInputSurplus).
  const [inputSurplus, setInputSurplus] = useState(0)
  const chatInputRef = useMeasuredHeight((h) => setInputSurplus(Math.max(0, h - REM * 3)))
  // Плашка плеера — не часть стека .topbar-floating-plates: она лежит выше
  // топбара и двигает его вниз (см. AUDIO_PLATE_FLOATING_HEIGHT). В резерв
  // ленты она входит так же, как в --pinned-floating-height.
  const audioPlateShown = useAudioStore((st) => st.track != null)
  const floatingHeight = platesHeight + (audioPlateShown ? AUDIO_PLATE_FLOATING_HEIGHT : 0)

  const padTopPx = padTop(narrow, floatingHeight)
  const padBottomPx = padBottom(narrow, inputSurplus)

  const {
    scrollRef, contentRef, atBottomRef, userScrolledUpRef,
    highlightSeq, showScrollDown, unreadBelow, jumpToSeq, onScrollDownClick,
  } = useChatScroll({ numericChatId, isRealChat, win, paddingTop: padTopPx, unreadDividerSeq, unreadStickyTop: padTopPx })
  // Pinned messages in this chat (newest pin first) + индекс показанного пина
  // (tweb pinnedMessage: перелистывание кликом + выбор по скроллу ленты).
  const { pins, index: pinIndex, follow: followPin } = usePinnedBar(numericChatId, isRealChat, scrollRef)
  // Контейнер ленты tweb (.bubbles): класс has-sticky-dates ставится по замеру, см. эффект ниже.
  const bubblesRef = useRef<HTMLDivElement>(null)
  // Ключ дня прилипшей даты (tweb `.bubble.is-date.is-sticky`) — считаем по
  // скроллу и отдаём в ChatFeed: класс рендерит React, иначе его стёр бы
  // ближайший ре-рендер ленты.
  const [stickyDateKey, setStickyDateKey] = useState<string | null>(null)
  // Multi-select state + press-and-drag selection (extracted view-model hook).
  const { selected, setSelected, setSelectionMode, selecting, toggleSelect, clearSelection, dragSelect } =
    useChatSelection(scrollRef)
  // Enter selection mode from the header menu with nothing selected yet.
  const startSelectMode = () => setSelectionMode(true)
  // Классы режима выделения на `.bubbles` — ровно как tweb SetTransition в
  // ChatSelection.onToggleSelection (selection.ts:1019-1030): `is-selecting` +
  // `forwards`/`backwards` + `animating` на 200 мс. От `forwards` зависят сдвиг
  // входящих баблов и масштаб аватарки группы (_chat.scss:1181-1204).
  const selectingCls = useSetTransition(selecting, 'is-selecting', 200)

  // Удаление чата / выход. Владелец группы/канала удаляет для всех (DELETE
  // /chats/{id}); иначе — выхожу сам (DELETE members/me), приватный чат так же
  // покидается.
  const owned = !!chat.owned
  const doDeleteChat = () => {
    if (!isRealChat || meId == null) return
    // Task 4 (действия без оптимистики, fix ревью Important): локальный
    // апдейт применяет владелец сразу после успеха, не дожидаясь WS
    // chat_removed (порт tweb appChatsManager.leaveChat/leaveChannel →
    // onChatUpdated). deleteGroup зовёт dialogs.applyRemoved сам
    // (groupsManager.ts); здесь — self-leave (removeMember(chatId, meId) —
    // ВСЕГДА я сам, не кик другого участника), применяем явно. Сознательно
    // без отдельного теста именно на этой строке — Chat.tsx документирован в
    // web-client/CLAUDE.md («Тесты», «известное исключение и долг») как файл
    // без единого теста; идентичная проводка (self-leave → applyRemoved после
    // успеха, no-op на ошибке) покрыта на уровне того же паттерна —
    // core/hooks/useGroupEdit.deleteOrLeave.test.tsx.
    const op = owned && (isGroup || isChannel)
      ? managers.groups.deleteGroup(numericChatId)
      : managers.groups.removeMember(numericChatId, meId).then(() => managers.dialogs.applyRemoved(numericChatId))
    void op.catch(() => {})
    onBack?.()
  }
  // «Очистить историю» у себя: сервер поднимает персональный горизонт, затем
  // перезагружаем окно (станет пустым) и список диалогов (превью очистится).
  const doClearHistory = () => {
    if (!isRealChat) return
    void managers.chats.clearHistory(numericChatId)
      .then(() => win.reloadNewest())
      .then(() => managers.dialogs.refresh())
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
  const drafts = useDrafts()
  const draftReplyToId = isRealChat && !thread ? drafts[numericChatId]?.replyToId ?? null : null
  const replyRestoredRef = useRef(false)
  useEffect(() => {
    if (replyRestoredRef.current || draftReplyToId == null || msgs.length === 0) return
    replyRestoredRef.current = true
    if (reply) return
    const rs = draftReplyState(msgs, draftReplyToId, chat.name, accentColor, { meId: meId ?? undefined, peerId: chat.peerId })
    if (rs) setReply(rs)
  }, [draftReplyToId, msgs, reply, chat.name, chat.peerId, meId, accentColor, setReply])

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
  // Спиннер держится в DOM до конца обратного перехода — tweb снимает узел в
  // onTransitionEnd у SetTransition (preloader.ts:248-256).
  const { mounted: spinnerMount, cls: spinnerCls } = useMountTransition(showSpinner, 'is-visible', 200)
  // Кольцо в оверлей спиннера — vanilla ProgressivePreloader (порт tweb;
  // инстанс на монтирование узла, умирает вместе с ним — как tweb detach).
  const chatSpinnerHost = useCallback((el: HTMLDivElement | null) => {
    if (el) new ProgressivePreloader({ cancelable: false }).attach(el)
  }, [])

  // Лестница появления баблов при открытии чата — порт tweb
  // `bubbles.ts:10363-10460` (animateAsLadder), см. `core/dom/ladder.ts`.
  // Анимируются НЕ ряды `.bubble`, а их обёртки `.bubble-content-wrapper`
  // (tweb `bubble.lastElementChild`) плюс аватар группы у последнего сообщения
  // серии (bubbles.ts:10386-10390). Порядок — снизу вверх: у tweb это `topIds`,
  // список сообщений «выше целевого», отсортированный от целевого к старым
  // (bubbles.ts:10347), а при открытии чата целевое — самое новое.
  // Аналог tweb-овского `chatInner` — `.bubbles-inner`, он же `contentRef`.
  useLayoutEffect(() => {
    if (!ladderActive) return
    const inner = contentRef.current
    if (!inner) return
    const steps: LadderStep[] = []
    for (const bubble of inner.querySelectorAll<HTMLElement>('.bubble')) {
      const wrapper = bubble.lastElementChild as HTMLElement | null
      // у дата-разделителя обёртки нет (последний ребёнок — сразу .bubble-content),
      // в tweb он тоже не участвует в лестнице
      if (!wrapper?.classList.contains('bubble-content-wrapper')) continue
      const group = bubble.parentElement
      const avatar = group?.classList.contains('bubbles-group') && group.lastElementChild === bubble
        ? group.querySelector<HTMLElement>('.bubbles-group-avatar')
        : null
      steps.push(avatar ? [wrapper, avatar] : wrapper)
    }
    steps.reverse()
    void animateLadder(inner, steps)
  }, [ladderActive, contentRef])

  // Сдвиг градиента обоев. В tweb он привязан НЕ к отправке, а к появлению нового
  // сообщения, и едет вместе с прокруткой к нему:
  //   • флаг ставится в обработчике `history_append` (bubbles.ts:1859-1864) — любое
  //     новое сообщение в этом чате, входящее тоже, и только если
  //     `liteMode.isAvailable('chat_background')`;
  //   • применяется в `startCallback` прокрутки (bubbles.ts:4710-4714):
  //     `gradientRenderer?.toNextPosition(dimensions.getProgress)` — прогресс
  //     градиента равен прогрессу прокрутки, свободной самоанимации нет;
  //   • флаг одноразовый (bubbles.ts:4713 `updateGradient = undefined`): если
  //     прокрутки не было (мы не у низа ленты), сдвиг просто не случается.
  // До этого мы слали событие `tg-send` из 13 точек отправки, а обои по нему звали
  // `toNextPosition()` БЕЗ аргумента — ветку самоанимации (gradientRenderer.ts:258-288);
  // отсюда и жалоба «много нажимаешь — фон сам меняется».
  const updateGradientRef = useRef(false)
  const lastFeedKeyRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    // 1. tweb history_append — взвести флаг на новое сообщение в открытом чате.
    const last = feedMsgs[feedMsgs.length - 1]
    const key = last ? last.clientId ?? (last.id != null ? `m-${last.id}` : null) : null
    const prev = lastFeedKeyRef.current
    lastFeedKeyRef.current = key
    // первый коммит ленты (открытие чата) и подгрузка истории вверх новым
    // сообщением не считаются — там хвост ленты не меняется
    if (prev != null && key != null && key !== prev && liteMode.isAvailable('chat_background')) {
      updateGradientRef.current = true
    }

    // 2. tweb startCallback — применить флаг, если лента реально едет к низу.
    // Не у низа (пользователь ушёл в историю) — прокрутки не будет, флаг ждёт.
    if (!updateGradientRef.current || !atBottomRef.current) return
    const sc = scrollRef.current
    if (sc && shiftGradientWithScroll(sc)) updateGradientRef.current = false
  }, [feedMsgs, scrollRef, atBottomRef])

  // (Scroll correction, prepend-restore, jump-scroll, down-arrow pin, and player-offset
  // compensation all live in useChatScroll.)

  // Channel-only wiring: live subscribe + catch-up, pts persistence, the open
  // discussion-thread overlay, and per-post comment counts.
  const { commentCounts, commentRepliers } = useChannelExtras({
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
  // Клик по баблу-контейнеру альбома выделяет/снимает всю группу разом
  // (tweb selection.ts:906-920).
  const selectAlbumE = useEvent((ids: number[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) select ? next.add(id) : next.delete(id)
      return next
    })
  })
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
  // ── Просмотрщик медиа (Task 16): vanilla-вьювер (mediaViewer/*) вместо
  // снесённого React-лайтбокса. Сбор items — из окна сообщений
  // (collectLightboxItems — чистая логика бывшего useLightbox), действия —
  // существующие флоу чата, дозагрузка соседей — REST /chats/{id}/media. ──
  const mediaPagesRef = useRef<{ msgs: Message[]; complete: boolean } | null>(null)
  // close-колбэк вьювера на время открытого попапа удаления/пересылки:
  // подтверждение попапа закрывает вьювер (tweb PopupDeleteMessages/
  // showForwardPopup зовут this.close() по действию), отмена — снимает колбэк
  // (проводка — обёртка msgActions у <ChatMsgActionPopups> ниже).
  const viewerActionCloseRef = useRef<(() => void) | null>(null)
  const lightboxCtx = () => ({ meId, meName: me?.displayName, peers, chatName: chat.name, lang })
  // Миниатюра сообщения в отрендеренных баблах (tweb собирает targets из
  // баблов селектором '.attachment', bubbles.ts:3744-3800; у нас строки ленты
  // адресуются data-mid, у секретных медиа контейнер без .attachment — img).
  const findBubbleMedia = (id: number): HTMLElement | null =>
    bubblesRef.current?.querySelector<HTMLElement>(
      `[data-mid="${id}"] .attachment, [data-mid="${id}"] img, [data-mid="${id}"] video`,
    ) ?? null
  // Дозагрузка соседей листания (наш источник вместо tweb SearchListLoader):
  // REST отдаёт newest-first постранично — докручиваем страницы, пока не найдём
  // якорь и не наберём loadCount за ним; кэш живёт одно открытие вьювера.
  const loadMoreMedia = async (older: boolean, anchor: ViewerItem | undefined, loadCount: number): Promise<ViewerItem[]> => {
    if (!anchor || !isRealChat) return []
    const cache = (mediaPagesRef.current ??= { msgs: [], complete: false })
    const fetchNext = async () => {
      const r = await managers.messages.mediaHistory(numericChatId, 'media', cache.msgs.length, 50)
      cache.msgs.push(...r.messages)
      if (!r.messages.length || cache.msgs.length >= r.count) cache.complete = true
    }
    try {
      const idxOf = () => cache.msgs.findIndex((m) => m.id === anchor.mid)
      while (idxOf() === -1 && !cache.complete) await fetchNext()
      const i = idxOf()
      if (i === -1) return [] // якоря нет в фильтре media (секретный чат) — край
      if (older) {
        while (cache.msgs.length - i - 1 < loadCount && !cache.complete) await fetchNext()
      }
      const ctx = lightboxCtx()
      const slice = older
        ? cache.msgs.slice(i + 1, i + 1 + loadCount)
        : cache.msgs.slice(Math.max(0, i - loadCount), i)
      // порядок newest-first сохраняем — ListLoader (reverse: true) сам разложит
      return slice.map((m) => messageToViewerItem(m, ctx, findBubbleMedia(m.id)))
    } catch {
      return [] // ошибка сети = край списка: вьювер листает уже загруженное
    }
  }
  const openLightboxE = useEvent((mediaId: number, el: HTMLElement) => {
    if (!isRealChat) return
    const { items, index } = collectLightboxItems({
      msgs: winV.msgs, mediaId, ctx: lightboxCtx(), findElement: (m) => findBubbleMedia(m.id),
    })
    if (!items[index]) return
    items[index].element = el // источник полёта — сама кликнутая миниатюра
    mediaPagesRef.current = null
    void openMediaViewer({
      items, index, target: el, reverse: true, // порядок окна по возрастанию — tweb bubbles.ts:3843
      jumpToMessage: (it) => { if (it.seq != null) jumpToSeqE(it.seq) },
      onForward: (mid, close) => {
        viewerActionCloseRef.current = () => { void close() }
        openForwardFor([mid])
      },
      onDelete: (mid, closeFromMedia) => {
        viewerActionCloseRef.current = closeFromMedia
        openDeleteFor([mid])
      },
      loadMoreMedia,
    })
  })
  // Смена чата / unmount: vanilla-вьювер живёт в body — закрываем сами.
  useEffect(() => () => closeMediaViewer(), [numericChatId])
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
      rootScope.dispatchEvent('ui:toast', t('Not enough Stars to unlock'))
    }
  })
  // Кнопка «переслать» сбоку поста канала (tweb .bubble-beside-button.forward).
  const forwardMsgE = useEvent((msgId: number) => openForwardFor([msgId]))
  const feedFns = useMemo(
    () => ({
      openSender: openSenderE,
      playVoice: playVoiceE,
      toggleSelect: toggleSelectE,
      selectAlbum: selectAlbumE,
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
      forwardMsg: forwardMsgE,
    }),
    [openSenderE, playVoiceE, toggleSelectE, selectAlbumE, openMsgMenuE, jumpToSeqE, openDatePickerE, openLightboxE, recallE, mediaPlayedE, roundPlayingE, toggleReaction, showReactedUsers, openStarReaction, cancelUploadE, unlockPaidE, forwardMsgE],
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
  // Task 4 (действия без оптимистики): локальный апдейт применяет владелец
  // (dialogsManager.applyMute) ПОСЛЕ успешного REST-ответа (groupsManager.ts).
  const applyMute = (next: boolean, seconds?: number | null) => {
    if (!isRealChat) return
    const until = next && seconds ? Math.floor(Date.now() / 1000) + seconds : undefined
    void managers.groups.setMute(numericChatId, next, until).catch(() => {})
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
  const scrollDownFab = <ScrollDownFab unreadBelow={unreadBelow} onClick={onScrollDownClick} />

  // ── Плашка вместо строки ввода (tweb .chat-input-control) ──
  // Цепочка условий повторяет приоритет прежних веток футера; в самой плашке она
  // раскладывается в `haveSomethingInControl` из finishPeerChange (input.ts:2448-2567).
  const composerUsable = canType && canSendText
  const threadClosed = !!thread?.closed
  const botStartPlate = !threadClosed && botStart
  const secretPlate = !threadClosed && !botStartPlate && secretLocked
  const groupRestricted = !threadClosed && !botStartPlate && !secretPlate && !composerUsable && isGroup && !canSendText
  const channelMutePlate = !threadClosed && !botStartPlate && !secretPlate && !groupRestricted && !composerUsable
  const controlFlags = useMemo<ControlFlags>(() => ({
    // tweb unblockBtn: `!isBot && peerId.isUser()`. Разблокировки у нас нет —
    // кнопка структурная, но её `hide` считается тем же условием, что в оригинале.
    canUnblock: chat.type === 'private' && !isBotChat,
    botStart: botStartPlate,
    channelMute: channelMutePlate,
    gift: channelMutePlate,
    groupRestricted,
    threadClosed,
    // статус ещё не приехал (secret.sync в полёте) — это «ожидание», а не «можно писать»
    secret: secretPlate
      ? { status: secretStatus === 'requested' ? 'requested' : secretStatus === 'rejected' ? 'rejected' : 'awaiting',
          busy: secretBusy, onAccept: onSecretAccept, onReject: onSecretReject }
      : null,
  }), [chat.type, isBotChat, botStartPlate, channelMutePlate, groupRestricted, threadClosed, secretPlate, secretStatus, secretBusy, onSecretAccept, onSecretReject])
  const onBotStartClick = useEvent(() => onComposerSend('/start'))
  const onControlMuteClick = useEvent(() => { if (isRealChat) applyMute(!muted) })
  const onControlGiftClick = useEvent(() => pop.openGift())
  const onSuggestPostClick = useEvent(() => pop.openSuggest())

  // Порт _center(): подмена строки ввода панелью выделения / плашкой —
  // классы `is-centering` + `is-centering-to-control` и морф `.rows-wrapper`.
  const inputContainerRef = useRef<HTMLDivElement | null>(null)
  useChatInputCenter(inputContainerRef, selecting ? 'selection' : isControlNeeded(controlFlags) ? 'control' : null)

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
      const rs = convMsgReplyState(m, winV.msgs[i]?.id, chat.name, accentColor, { meId: meId ?? undefined, peerId: chat.peerId })
      if (rs) { setReply(rs); setEditing(null); return }
    }
  })
  // Ctrl/Cmd+PageUp / PageDown — к началу / концу истории (tweb). PageUp скроллит
  // к верху загруженного окна (старые подгрузит штатный scroll-листенер); PageDown
  // переиспользует «вниз» (reloadNewest + пин к низу). Активно при открытом чате.
  // Слушатель вынесен в useFeedPageHotkeys и гейтится useIsActiveChat — в стеке
  // инстансов чата смонтировано несколько копий одновременно (см. Chat.tsx выше).
  useFeedPageHotkeys({
    enabled: isRealChat,
    onPageUp: useEvent(() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })),
    onPageDown: useEvent(() => onScrollDownClick()),
  })

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

  // tweb bubbles.ts:4207-4230 — во время скролла на `.bubbles-inner` висит
  // `is-scrolling`, и только тогда липкая дата видна (_chat.scss:1345:
  // `.is-scrolling .is-sticky { opacity: .99999 }`); через 1.35s после
  // последнего события класс снимается и дата плавно гаснет. Само прилипание
  // (какая дата is-sticky) считает отдельный эффект ниже, на StickyIntersector.
  useEffect(() => {
    const sc = scrollRef.current
    const inner = contentRef.current
    if (!sc || !inner) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      inner.classList.add('is-scrolling')
      clearTimeout(timer)
      timer = setTimeout(() => inner.classList.remove('is-scrolling'), 1350)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => { sc.removeEventListener('scroll', onScroll); clearTimeout(timer) }
  }, [scrollRef, contentRef])

  // tweb bubbles.ts:1382-1408 (колбэк StickyIntersector) + 4867
  // (observeStickyHeaderChanges на каждой `.bubbles-date-group`) — какая дата
  // прилипла, считает портированный StickyIntersector по sentinel-узлам, а не
  // обход `.bubble.is-date` с getBoundingClientRect на каждое событие скролла.
  // ChatFeed рендерит секции `.bubbles-date-group` прямыми детьми contentRef;
  // выбор «нижней» застрявшей секции и обвязка «наблюдать новую секцию ровно
  // один раз» вынесены в chatStickyDates.ts (там же — почему они тестируемы
  // отдельно от Chat, который нигде не рендерится в vitest).
  //
  // Инстанс интерсектора живёт в рефе на весь срок жизни scrollRef/contentRef
  // (как this.stickyIntersector в tweb — заводится один раз в setListeners,
  // а не пересоздаётся на каждое сообщение): пересоздание на каждый ререндер
  // плодило бы новые sentinel-узлы поверх старых в каждой уже наблюдаемой
  // секции (StickyIntersector.observeStickyHeaderChanges не идемпотентна —
  // см. chatStickyDates.test.ts).
  const stickyIntersectorRef = useRef<StickyIntersector | null>(null)
  const stickyObservedRef = useRef<Set<HTMLElement>>(new Set())
  const stuckSectionsRef = useRef<Set<HTMLElement>>(new Set())

  useEffect(() => {
    const sc = scrollRef.current
    const inner = contentRef.current
    if (!sc || !inner) return

    const stuckSections = stuckSectionsRef.current
    const observedSections = stickyObservedRef.current
    const intersector = new StickyIntersector(sc, (stuck, target) => {
      if (stuck) stuckSections.add(target)
      else stuckSections.delete(target)
      setStickyDateKey((prev) => {
        const key = pickStickyDateKey(inner.children, stuckSections)
        return prev === key ? prev : key
      })
    })
    stickyIntersectorRef.current = intersector

    return () => {
      intersector.disconnect()
      stickyIntersectorRef.current = null
      stuckSections.clear()
      observedSections.clear()
      // Same class of leak as Б-4 (useChatScroll.ts's `.scrollable-thumb-container`
      // cleanup): StickyIntersector.disconnect() clears its own element→sentinel Map
      // but doesn't remove the `.sticky_sentinel` divs addSentinel() appended into
      // each date-group section — tweb's own container is throwaway so it never
      // needed to; ours (`inner`) is React's persistent node. Belt-and-braces against
      // StrictMode's dev mount→unmount→mount doubling up leftover sentinels.
      inner.querySelectorAll('.sticky_sentinel').forEach((el) => el.remove())
    }
  }, [scrollRef, contentRef])

  // Новые дата-секции (загрузка страницы истории, новое сообщение сменило
  // день) — наблюдаем только те, что ещё не видели; уже наблюдаемые трогать
  // нельзя (см. комментарий выше). Перед этим — секции, которых больше нет в
  // DOM (jumpTo/reloadNewest подменяют win.msgs целиком, см.
  // chatStickyDates.ts's pruneEvictedSections): снять с обоих observer'ов и
  // вычистить из реестров, иначе они удерживаются бессрочно (утечка).
  useEffect(() => {
    const inner = contentRef.current
    const intersector = stickyIntersectorRef.current
    if (!inner || !intersector) return
    pruneEvictedSections(inner, intersector, stickyObservedRef.current, stuckSectionsRef.current)
    observeNewSections(inner, intersector, stickyObservedRef.current)
  }, [contentRef, feedMsgs, feedLoading])

  // tweb bubbles.ts:4900-4905 (updateStickyIntersectorRootMargin) — тот же
  // паддинг топбара/инпута, что резервируют распорки `.bubbles-padding-top/bottom`;
  // меняется независимо от ленты, поэтому отдельный эффект и `setRootMargin`
  // (переподписывает существующие сентинелы, а не плодит новые).
  useEffect(() => {
    stickyIntersectorRef.current?.setRootMargin(`-${padTopPx}px 0px -${padBottomPx}px 0px`)
  }, [padTopPx, padBottomPx])

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

  // Стек плавающих плашек под топбаром (tweb .topbar-floating-plates): пин-бар и
  // панель тегов «Избранного». Пустой стек прячется классом .hide, как в tweb
  // topbar.setFloating — и тогда лента не резервирует под него место.
  // Число видимых плашек — tweb topbar.setFloating пишет его в
  // `topbar.container.dataset.floating` и по нему же решает, прятать ли обёртку.
  const platesCount = (!thread && !searchOpen && pins.length > 0 ? 1 : 0) +
    (isSaved && !thread && savedTagsCount > 0 ? 1 : 0)
  const plates = (
    <>
      {!thread && (
        <PinnedBar
          pins={pins}
          index={pinIndex}
          searchOpen={searchOpen}
          onFollow={onPinFollow}
          onUnpin={onUnpin}
          onOpenList={onOpenPinList}
        />
      )}
      {isSaved && !thread && (
        <SavedTagsPanel activeTag={savedTagFilter} onFilter={setSavedTagFilter} onCountChange={setSavedTagsCount} />
      )}
    </>
  )

  return (
    <CallProvider chat={chat}>
      {/* Колонка чата = tweb `.chat.tabs-tab.active`; `can-click-date` включает
          клик по дате-разделителю (_chatBubble.scss:511-514, bubbles.ts:3058-3090).
          Геометрия — из styles/tweb/_chat.scss (topbar/bubbles/chat-input внутри
          позиционируются абсолютом относительно #column-center).
          `tabs-tab` (переключение display:none/flex + transform-переход между
          инстансами стека) с этого узла УБРАН — им теперь владеет обёртка
          ChatsContainer (`.chat.tabs-tab[data-type]`, ChatsContainer.tsx), у
          которой и лежит настоящий класс `.active` активного инстанса. `chat` +
          `active` здесь оставлены НЕ дублем: `.chat:not(.active)` и парные
          компаунд-селекторы `.chat.is-go-down-visible`/`.chat.is-search-active`
          (_chat.scss:486,1217,527) требуют оба класса на ОДНОМ узле — без
          локального `chat.active` кнопка «вниз» и паддинг поиска молча
          перестали бы работать. */}
      <div
        ref={rootRef}
        className={classNames(
          'chat', 'active',
          isRealChat ? 'can-click-date' : '',
          // tweb _chat.scss:1217 — видимость угловых кнопок даёт класс на колонке
          showScrollDown ? 'is-go-down-visible' : '',
          searchReactionsShown ? 'is-search-active' : '',
        )}
        style={{
          // tweb topbar.setFloating: высота стека плейтов + плавающие плашки
          // плеера/звонка. Отсюда --chat-padding-top и верх маски фейдов.
          ['--pinned-floating-height' as string]:
            `calc(${platesHeight}px + var(--topbar-floating-call-height) + var(--topbar-floating-audio-height))`,
          ['--chat-input-height-surplus' as string]: `${inputSurplus}px`,
          // Текст границы непрочитанных — CSS-контент (tweb
          // `.is-first-unread:before { content: var(--unread-messages-text) }`),
          // поэтому значение подаётся строкой в кавычках.
          ['--unread-messages-text' as string]: JSON.stringify(t('Unread Messages')),
        }}
      >
        {/* Плейт «сейчас играет» — tweb .pinned-container.pinned-audio: абсолют
            у верха #column-center, топбар уезжает вниз на --topbar-floating-audio-height
            (класс body.is-pinned-audio-shown ставит сам NowPlayingBar). */}
        <NowPlayingBar />

        {thread ? (
        <div className={classNames('sidebar-header', 'topbar', 'has-avatar')} data-floating="0">
          <div className="chat-info-container">
            <IconButton onClick={onCloseThread} color="var(--secondary-text-color)" className="sidebar-close-button">
              <TgIcon name="back" />
            </IconButton>
            <div className="chat-info" onClick={() => setInfoOpen(true)} style={{ cursor: 'pointer' }}>
              <div className="person">
                {thread.kind === 'topic' ? (
                  <TopicIcon color={thread.iconColor ?? 0} title={thread.title} size={30} />
                ) : (
                  <TgIcon name="comments" size={26} color="var(--primary-color)" />
                )}
                <div className="content">
                  <div className="top">
                    <div className="user-title">
                      <span className="peer-title">{thread.title}</span>
                      {thread.closed && <TgIcon name="lock" size={18} color="var(--secondary-text-color)" />}
                    </div>
                  </div>
                  <div className="bottom">
                    <span className="info">{thread.subtitle ?? chat.name}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="chat-utils">
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
          <div ref={platesRef} className={classNames('topbar-floating-plates', 'hide')} />
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
          plates={plates}
          platesCount={platesCount}
          platesRef={platesRef}
          onJumpToSeq={jumpToSeqE}
          onBack={onBack}
          onToggleInfo={onToggleInfo}
          onOpenMenu={onOpenHeaderMenu}
        />
        )}

        {/* Спиннер первой загрузки (только после grace-задержки, на попадании в
            кэш пропускается). Кольцо — vanilla ProgressivePreloader (Task 16
            снёс React-стенд-ин SpinnerArc; в tweb история грузится под тем же
            прелоадером — bubbles.ts:752 `new ProgressivePreloader(...)`). */}
        {spinnerMount && (
          <div className={classNames(s.spinnerOverlay, spinnerCls)} ref={chatSpinnerHost} />
        )}

        {/* Лента — дерево tweb: .bubbles > .scrollable.bubbles-scrollable >
            .bubbles-padding-top + .bubbles-inner + .bubbles-padding-bottom
            (bubbles.ts:4178-4186). Распорки заменяют паддинги контента: их высота
            меняется вместе с плейтами, и скролл компенсируется по дельте. */}
        {/* `no-select` — как в tweb (selection.ts:433): гасит `user-select: text`
            у .bubble-content, чтобы drag-выделение не красило текст. */}
        <div
          ref={bubblesRef}
          className={classNames('bubbles', feedMsgs.length ? 'has-groups' : '', selecting ? 'no-select' : '', selectingCls)}
        >
        <div
          ref={scrollRef}
          onMouseDown={dragSelect.onMouseDown}
          className={classNames(s.scroll, 'scrollable', 'scrollable-y', 'bubbles-scrollable')}
        >
          <div className="bubbles-padding bubbles-padding-top" style={{ height: `${padTopPx}px` }} />
          <div
            ref={contentRef}
            className={classNames(s.content, 'bubbles-inner', isGroup ? 'is-chat' : '', feedMsgs.length ? '' : 'no-messages')}
            // fade messages in once the first page has loaded (tweb-like)
            style={{ opacity: feedLoading ? 0 : 1 }}
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
                // Быстрая реакция по ховеру: в «Избранном» её нет (tweb
                // onBubblesMouseMove: `this.peerId !== rootScope.myId`), в
                // секретных чатах реакций нет вовсе.
                canQuickReact={isRealChat && chat.type !== 'saved' && chat.type !== 'secret'}
                discussionsEnabled={discussionsEnabled}
                commentCounts={commentCounts}
                commentRepliers={commentRepliers}
                highlightSeq={highlightSeq}
                unreadDividerSeq={unreadDividerSeq}
                selecting={selecting}
                selected={selected}
                stickyDateKey={stickyDateKey}
                feedFns={feedFns}
                onOpenDiscussion={openDiscussionThread}
              />
            )}

            {/* Похожие каналы под лентой канала (tweb chat/similarChannels). */}
            {!feedLoading && isChannel && isRealChat && !thread && (
              <SimilarChannels chatId={numericChatId} onOpen={onOpenChannel} />
            )}
          </div>
          <div className="bubbles-padding bubbles-padding-bottom" style={{ height: `${padBottomPx}px` }} />
          {!feedLoading && emptyGreeting && (
            <EmptyChatGreeting onGreet={() => onComposerSend('👋')} />
          )}
        </div>
        </div>

        {/* Композер и его замены — tweb .chat-input.chat-input-main (absolute
            bottom 0 внутри #column-center) > .chat-input-container (max-width
            --chat-width, центрируется). Высота этого узла задаёт
            --chat-input-height-surplus и нижнюю распорку ленты.

            Порядок детей контейнера — ровно как в input.ts (construct(): 471-490,
            :566-568, constructGoDownButton :615, constructMentionButton :827):
              .rows-wrapper-wrapper (композер) · два .fake-wrapper · «вниз» ·
              .chat-input-control · три угловые кнопки упоминаний/реакций.
            Композер и плашка живут в DOM ОДНОВРЕМЕННО, видимую выбирает _center()
            (useChatInputCenter) — поэтому здесь нет ветвления рендера. */}
        <div ref={chatInputRef} className={classNames('chat-input', 'chat-input-main', selectingCls)}>
        <div ref={inputContainerRef} className="chat-input-container chat-input-main-container">
            {/* Composer: owns the draft text locally so typing re-renders only it. */}
            <Composer
              key={chat.id}
              peerId={chat.peerId}
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

            {/* Невидимые эталоны геометрии для _center() — input.ts:484-490. */}
            <div className="fake-wrapper fake-rows-wrapper" />
            <div className="fake-wrapper fake-selection-wrapper" />

            {/* tweb input.ts:615-616 — кнопка «вниз» живёт прямо в .chat-input-container */}
            {scrollDownFab}

            <ChatInputControl
              peerId={chat.peerId}
              muted={muted}
              onBotStart={onBotStartClick}
              onToggleMute={onControlMuteClick}
              onGift={onControlGiftClick}
              onSuggestPost={isChannel && isRealChat ? onSuggestPostClick : undefined}
              {...controlFlags}
            />

            {/* Три угловые кнопки «к следующему упоминанию / реакции / голосованию»
                (input.ts:827). Данных о непрочитанных упоминаниях у нас нет —
                узлы структурные, `is-visible` никто не ставит, как и в tweb до
                прихода счётчика. */}
            <CornerButton icon="mention" role="bubbles-go-mention bubbles-go-reaction" />
            <CornerButton icon="reactions" role="bubbles-go-mention bubbles-go-reaction" />
            <CornerButton icon="poll" role="bubbles-go-mention bubbles-go-reaction" />

            {/* Панель выделения в tweb добавляется последним ребёнком контейнера
                и снимается по окончании обратной анимации (selection.ts:1130). */}
            {selecting && (
              <SelectionBar
                count={selected.size}
                onClear={clearSelection}
                onForward={() => openForwardFor([...selected])}
                onDelete={() => openDeleteFor([...selected])}
                canForward={!isSecret}
              />
            )}

            {/* отступление от tweb: reply-клавиатура бота у оригинала живёт внутри
                строки ввода (btnToggleReplyMarkup + replyKeyboard), у нас — своя
                плавающая панель над композером. Рендерится только когда есть. */}
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
        </div>
        </div>

        {/* Скрытый файловый пикер attach-меню (openPicker). Держим ВНЕ
            `.chat-input-container`: у tweb в строке ввода ровно один `input[file]`,
            и он уже есть в композере — второй сломал бы совпадение дерева. */}
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

        {/* Зона перетаскивания файлов. tweb приклеивает `.drops-container`
            последним ребёнком колонки чата (`this.chat.container.append(...)`,
            appImManager.ts:2394) — здесь то же место в дереве. */}
        <ChatDrops
          enabled={isRealChat && canSendMedia}
          onDropFiles={(files, asFile) => setPendingMedia({ files, asFile })}
        />
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

      {/* Попапы действий над сообщением (state-driven из useMessageActions).
          Обёртка doDelete/doForward — Task 16: действие, начатое из вьювера,
          по подтверждению закрывает вьювер (см. viewerActionCloseRef выше). */}
      <ChatMsgActionPopups
        msgActions={{
          ...msgActions,
          doDelete: (revoke) => {
            msgActions.doDelete(revoke)
            viewerActionCloseRef.current?.()
            viewerActionCloseRef.current = null
          },
          doForward: async (chatIds) => {
            await msgActions.doForward(chatIds)
            viewerActionCloseRef.current?.()
            viewerActionCloseRef.current = null
          },
          closeDelete: () => { viewerActionCloseRef.current = null; msgActions.closeDelete() },
          closeForward: () => { viewerActionCloseRef.current = null; msgActions.closeForward() },
        }}
        numericChatId={numericChatId}
        isRealChat={isRealChat}
      />
    </CallProvider>
  )
}
