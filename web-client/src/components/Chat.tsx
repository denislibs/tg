// Известное исключение из нормы «корень бандла не владеет непокрытой проводкой»
// (../CLAUDE.md, раздел «Тесты», статус по файлам этой роли) — самый большой
// компонент клиента, ни один тест его не импортирует. Осознанный долг, не
// переписывается ради самой нормы; при следующем содержательном касании файла —
// приводить затронутую проводку в соответствие (тест либо пометка с причиной у
// неё), а не расширять непокрытую площадь дальше.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { cachedPeerTheme, chatFullMirrorVersion, saveChatFull, subscribeChatFullMirror } from '@core/chatFullCache'
import { isPeerMuted } from '@core/dialogs/notifySettings'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import { chatThemeVariant } from '../chatThemes'
import { PRESET_MODE, resolvePreset } from '../theme'
import { applyChatTheme, clearChatTheme } from '../core/theme/themeController'
import { useSettingsStore } from '../settings'
import { CallProvider } from './call/CallProvider'
import NowPlayingBar from './NowPlayingBar'
import type { Chat } from '../data'
import { useT, useLang } from '../i18n'
import { useTypingLabel } from '../core/hooks/useTypingLabel'
import { lastSeenLabel } from '../core/presence'
import { useManagers } from '../core/hooks/useManagers'
import { useNavigationActions } from '../core/hooks/useNavigationActions'
import { useChatStackStore } from '../stores/chatStackStore'
import { useMirrorWindow } from '../core/hooks/useMirrorWindow'
import { replaceMirrorWindow, winKey } from '../core/history/messagesMirror'
import { useEvent } from '../core/hooks/useEvent'
import { useFeedPageHotkeys } from '../core/hooks/useFeedPageHotkeys'
import { useMiddlewareHelper } from '../core/hooks/useMiddlewareHelper'
import { findReplyKeyboardRows } from '../core/markup/replyMarkup'
import type { GifItem } from '../core/gifs'
import { useSetTransition } from '../core/hooks/useSetTransition'
import { useChatInfoCard } from '../core/hooks/useChatInfoCard'
import { hasRights } from '../core/peers/rights'
import { isBroadcast, isMegagroup } from '../core/peers/predicates'
import { usePinnedBar } from '../core/hooks/usePinnedBar'
import { useChatSend } from '../core/hooks/useChatSend'
import { useSendAs } from '../core/hooks/useSendAs'
import { useSlowmode } from '../core/hooks/useSlowmode'
import type { ViewerItem } from './mediaViewer/appMediaViewer'
import { useMessageActions } from '../core/hooks/useMessageActions'
import { useChannelLive } from '../core/hooks/useChannelLive'
import Composer from './Composer'
import VanillaFeed, { type ChatFeedApi } from './chat/VanillaFeed'
import { useChatAutoDownload } from '@core/hooks/useChatAutoDownload'
import { messageToViewerItem, type LightboxCtx } from './mediaViewer/collectLightboxItems'
import { closeMediaViewer } from './mediaViewer/openMediaViewer'
import { cachedPeer } from '../core/peerCache'
import { isUserStatusOnline, userStatusWasOnline } from '../core/peers/peer'
import { getUserTitle } from '../core/peers/getPeerTitle'
import { NULL_PEER_ID } from '../core/peers/peerId'
import { windowReplyState } from '../core/draftReply'
import { useComposerDraft } from '../core/hooks/useComposerDraft'
import { useMentionPeers } from '../core/hooks/useMentionPeers'
import { useGroupCallStore } from '../stores/groupCallStore'
import { useLivestreamStore } from '../stores/livestreamStore'

const EMPTY_IDS: number[] = []
/** `now` для предикатов присутствия — unix-СЕКУНДЫ (порт `appUsersManager.isUserOnline`). */
const nowSeconds = () => Math.floor(Date.now() / 1000)
import ChatHeader from './conversation/ChatHeader'
import IconButton from '../shared/ui/IconButton'
import { TopicIcon } from './TopicsPanel'
import PinnedBar from './conversation/PinnedBar'
import SavedTagsPanel from './conversation/SavedTagsPanel'
import ScrollDownFab from './conversation/ScrollDownFab'
import CornerButton from './conversation/CornerButton'
import ChatInputControl, { isControlNeeded, type ControlFlags } from './conversation/ChatInputControl'
import { useChatInputCenter } from './conversation/useChatInputCenter'
import { computeControlPlates } from './conversation/controlPlates'
import SelectionBar from './conversation/SelectionBar'
import ChatDrops from './conversation/ChatDrops'
import { useChatsStore } from '../stores/chatsStore'
import { useSecretChatStore } from '../stores/secretChatStore'
import { type MyMessage, type MessageEntity } from '../core/models'
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
import { draftReplyToId as draftReplyOf } from '../core/dialogs/draft'
import { messageToConvMsg } from '../core/messageToConvMsg'
import classNames from '../shared/lib/classNames'
import s from './Chat.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'
import useMeasuredHeight from '../shared/lib/useMeasuredHeight'
import type { Sticker } from '../core/managers/stickersManager'

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
  const { openPeer: onOpenPeer, onChatCreated } = useNavigationActions()
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
  // Ключ открытого чата — знаковый `PeerId` (tweb `chat.peerId`). Отдельного
  // «id собеседника» рядом больше НЕТ: у приватного диалога ключ и есть id
  // собеседника, прежняя пара описывала одно число дважды.
  const numericChatId = Number(chat.id)
  const isRealChat = Number.isFinite(numericChatId) && String(numericChatId) === chat.id
  // Аватарка — одно поле: id медиа приезжает готовым (`photo.photo_id`).
  const headerAvatarSrc = useMediaUrl(chat.photoId ?? null)
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
  // Активный фильтр по тегу-реакции «Избранного». Само состояние здесь только
  // ради подсветки активного чипа: ФИЛЬТРУЕТ лента — тег едет к ней ручкой
  // `ChatFeedApi.setSavedReaction`, и она перезапрашивает историю (порт tweb
  // `appImManager.chat.setMessageId({savedReaction})`, topbarSearch.tsx:1057).
  const [savedTagFilter, setSavedTagFilter] = useState<string | null>(null)
  // Настройки автозагрузки медиа открытого чата — порт tweb `chat.autoDownload`
  // (chat.ts:137, считается в `setPeer`: chat.ts:1055 `useAutoDownloadSettings
  // (this.peer, this.appSettings)` внутри `createEffect`, то есть пересчитывается
  // и на смену настроек). Считает их РОЛЬ `Chat` — то есть этот экран, а не
  // лента: лента про сторы не знает. Дальше они едут в ленту (`VanillaFeed`
  // → `ChatContext.autoDownload`), а та раздаёт их врапперам, как оригинал
  // раздаёт `this.chat.autoDownload` (bubbles.ts:7901/7919/8542/8561/8597).
  const autoDownload = useChatAutoDownload(chat.type, isRealChat ? numericChatId : null)

  // Сброс фильтра тегов «Избранного» при смене чата. Ленте его снимать не надо:
  // на смене пира она пересоздаётся целиком (`VanillaFeed` держит эффект по
  // `peerId`), то есть рождается без тега.
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
  // Тема живёт в ПОЛНОЙ КАРТОЧКЕ пира (`theme_emoticon`) — её место в схеме
  // (решение Р7); в строке диалога поля нет вовсе. Зеркало карточек
  // (`core/chatFullCache.ts`) наполняют загрузчики карточки чата и профиля, а
  // кадр `chat_theme_update` патчит его через проектор — подписка ниже и делает
  // перекраску реактивной.
  useSyncExternalStore(subscribeChatFullMirror, chatFullMirrorVersion)
  const activeThemeId = cachedPeerTheme(numericChatId)
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
  // `data-peer-id` инпута (tweb input.ts): у черновика реального диалога ещё
  // нет, но ключ будущего разговора уже известен — это id собеседника.
  const inputPeerId = isRealChat ? numericChatId : draftPeerId ?? undefined
  const meId = useChatsStore((s) => s.meId)
  const me = useChatsStore((s) => s.me)

  const typingLabel = useTypingLabel(numericChatId, isGroup)
  const peerPresence = useChatsStore((s) => s.presence[numericChatId])
  // toggle re-renders the menu; fall back to the chat prop.
  // Мьют — СРОК (`notify_settings.mute_until`), а не признак: считаем его тем
  // же единственным предикатом, что и список чатов.
  const dialogNotify = useChatsStore((s) =>
    isRealChat ? s.dialogs.find((d) => d.peerId === numericChatId)?.notify_settings : undefined,
  )
  const muted = dialogNotify ? isPeerMuted(dialogNotify, Math.floor(Date.now() / 1000)) : !!chat.muted
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
  // Окно из ЗЕРКАЛА (`core/history/messagesMirror.ts`) — источник для
  // НЕленточных потребителей окна: плашка ответа над композером (восстановление
  // из черновика, ответ жестом ленты, Ctrl/Cmd+↑), правка последнего своего
  // сообщения. Именно его читает императивная лента, поэтому по обе стороны
  // флага `VITE_VANILLA_FEED` композер и лента говорят об ОДНОМ окне; zustand-
  // копия остаётся только у самой React-ленты и уходит вместе с ней (этап 7).
  const mirrorMsgs = useMirrorWindow(isRealChat ? winKey(numericChatId, threadRootId) : null)
  // Плашка ответа по НОМЕРУ сообщения — общий путь для черновика, жеста ленты и
  // Ctrl/Cmd+↑ (в tweb это тоже одно место — `chat.input.
  // getChatInputReplyToFromMessage`).
  //
  // Проводка этого узла (как и всего файла) тестом не покрыта — `Chat.tsx` в
  // тесте не рендерится (см. «Тесты» в web-client/CLAUDE.md). Покрыты обе её
  // половины по отдельности: сборка плашки из окна — `core/draftReply.test.ts`
  // (`windowReplyState`), доставка окна из зеркала — `core/hooks/
  // useMirrorWindow.test.tsx`.
  const replyStateFor = useEvent((mid: number) =>
    windowReplyState(mirrorMsgs, mid, chat.name, accentColor, {
      meId: meId ?? undefined, peerId: numericChatId, isGroup,
    }))
  // ДОЛГ этапа 7: клиентская сервис-плашка «Обсуждение началось» (порт tweb
  // `generateThreadServiceStartMessage` — `messageActionDiscussionStarted`)
  // собиралась здесь, поверх zustand-окна React-ленты, и в зеркало не
  // попадала. Императивная лента её не рисует: её место — в разборе страницы
  // истории самой ленты (`chat/bubbles.ts::performHistoryResult`), как в tweb
  // это место менеджера сообщений. Фраза и конструктор уже есть
  // (`core/serviceMsg.ts:110`, `core/messages/messageAction.ts:249`).

  // Register the active chat so chatsStore suppresses unread bumps while it's open.
  const setActiveChat = useChatsStore((s) => s.setActiveChat)
  useEffect(() => {
    if (isRealChat) setActiveChat(numericChatId)
    return () => setActiveChat(null)
  }, [isRealChat, numericChatId, setActiveChat])

  // Real group/channel header card (type/counts/rights) + member presence seeding +
  // post/type permission + discussion wiring + live online count — view-model hook.
  // `chatPeer` — краткий конструктор `channel` из зеркала пиров: вид чата и
  // права зрителя. `full` — полная карточка (`channelFull`) с about/slowmode/
  // обсуждением. Поля `type`/`my_role`/`my_rights` исчезли с провода вместе с
  // плоской витриной — их вопросы задаются предикатами и `hasRights`.
  const { full: chatFull, chat: chatPeer, permissionsKnown, canType, canSendText, canSendMedia, onlineCount } =
    useChatInfoCard({ isRealChat: isRealChat && !thread, isChannel, numericChatId })
  // Окно рисует ИМПЕРАТИВНАЯ лента, витрины `ConvMsg[]` в React больше нет:
  // вью-модель бабла собирает сама лента (`chat/bubbles.ts` через
  // `core/messageToConvMsg.ts`), а окно она читает из зеркала.
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
      if (alive) setCanManageTopic(hasRights(c?.chat, 'change_info'))
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
  const myGroupCallChat = useGroupCallStore((st) => st.peerId)
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
  const myWatchingChat = useLivestreamStore((st) => st.watchingPeerId)
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
    numericChatId !== meId &&
    peerPresence != null && !isUserStatusOnline(peerPresence, nowSeconds()) && userStatusWasOnline(peerPresence) > 0
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
  // Плашку «Непрочитанные сообщения» ставит сама лента — порт
  // `setUnreadDelimiter` (`chat/bubbles.ts:3338`), как и в tweb.

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

  // Распорки ленты — порт tweb `Chat.recomputePaddings` (chat.ts:345): числа
  // считает окружение чата, применяет их сама лента (`ChatBubbles.setPaddings`).
  const padTopPx = padTop(narrow, floatingHeight)
  const padBottomPx = padBottom(narrow, inputSurplus)

  // Ручки императивной ленты (`chat/bubbles.ts`) — прыжок к сообщению и кнопка
  // «вниз». В tweb их зовёт `Chat`/`ChatTopbar` прямо в `chat.bubbles`, у нас
  // роль `Chat` исполняет этот экран, а мост — `VanillaFeed` (см. ChatFeedApi).
  const feedApi = useRef<ChatFeedApi | null>(null)
  // Скролл-контейнер ленты — им владеет лента, наружу отдаётся тем же способом,
  // что React отдаёт свои узлы.
  const feedScrollRef = useRef<HTMLElement | null>(null)
  // Значок «непрочитано ниже» на кнопке «вниз» (tweb .bubbles-go-down count):
  // ВЫВОДИТСЯ из стора, а не накапливается из потока событий. newestSeq (последнее
  // сообщение диалога) минус lastReadSeq (горизонт чтения зрителя) — это и есть
  // число сообщений ниже точки прочтения. Store-derived ⇒ переживает
  // ремаунт/ресинк без дрейфа. Саму кнопку показывает лента классом
  // `is-go-down-visible` на колонке чата (`bubbles.updateGoDownVisibility`).
  const unreadBelow = useChatsStore((s) => {
    const d = s.dialogs.find((x) => x.peerId === numericChatId)
    if (!d) return 0
    return Math.max(0, (d.lastMessage?.id ?? 0) - d.read_inbox_max_id)
  })
  // Pinned messages in this chat (newest pin first) + индекс показанного пина
  // (tweb pinnedMessage: перелистывание кликом + выбор по скроллу ленты).
  const { pins, index: pinIndex, follow: followPin } = usePinnedBar(numericChatId, isRealChat, feedScrollRef)
  // Выделение сообщений ведёт САМА лента (порт tweb `ChatSelection`,
  // `chat/selection.ts`); сюда оно приезжает одним отчётом — `onFeedSelection`
  // ниже. Здешний стейт — ВИТРИНА плашки действий, а не второй источник правды:
  // снять выбор можно только у ленты (`ChatFeedApi.cancelSelection`), как в
  // оригинале клик по счётчику зовёт `selection.cancelSelection`
  // (tweb selection.ts:1080-1082).
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [selecting, setSelecting] = useState(false)
  const clearSelection = useEvent(() => { feedApi.current?.cancelSelection() })
  // Вход в режим выделения из меню шапки — порт tweb topbar.ts:560
  // (`selection.toggleSelection(true, true)`): режим включает ЛЕНТА, иначе в
  // баблах не появились бы чекбоксы.
  const startSelectMode = useEvent(() => { feedApi.current?.startSelection() })
  // Клик по чипу тега «Избранного» — единственный вход фильтра: подсветка чипа
  // и выдача ленты меняются одним действием. Порт tweb topbarSearch.tsx:1044-1060
  // (эффект по сигналу `reaction` зовёт `setMessageId({savedReaction})`).
  const onSavedTagFilter = useEvent((reaction: string | null) => {
    setSavedTagFilter(reaction)
    feedApi.current?.setSavedReaction(reaction)
  })
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
  // выкидываем окно из зеркала, перезагружаем ленту и список диалогов
  // (превью очистится).
  //
  // `replaceMirrorWindow(..., [])` здесь обязателен и стоит ДО перезагрузки
  // ленты — это порт `flushStoragesByPeerId` (tweb appMessagesManager.ts:4709,
  // :4732-4742): владелец, очистивший историю, объявляет зеркалу `delete`, и
  // вкладка вычищает слайсы (tweb apiManagerProxy.ts:282 → :542-563), а не
  // ждёт, пока новая страница «вытеснит» старую. Вытеснить она и не может:
  // `putMirrorPage` умеет только СЛИТЬ, поэтому после очистки пустой ответ
  // сервера оставил бы в зеркале всю прошлую историю — Ctrl+↑ предложил бы
  // ответить на сообщение, которого на экране нет, а `mirrorMsgs.length === 0`
  // (приветствие бота, клавиатура ответа ниже) так и не стало бы истиной.
  const doClearHistory = () => {
    if (!isRealChat) return
    void managers.chats.clearHistory(numericChatId)
      .then(() => { replaceMirrorWindow(winKey(numericChatId, threadRootId), []) })
      .then(() => feedApi.current?.reload())
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

  // No chat-switch reset effect needed: App renders <Chat key={selectedId}>,
  // so switching chats fully remounts this component and every useState/useRef (here and
  // in useChatSend/useChatSearch) re-initialises to its default. A manual
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
  const sendAsPeerId = sendAs.currentId !== NULL_PEER_ID && sendAs.currentId !== meId ? sendAs.currentId : null

  const {
    reply, setReply, editing, setEditing,
    forward, setForward,
    rec,
    send,
    onComposerTyping,
    pendingMedia, setPendingMedia, sendPendingMedia,
    openPicker, fileInputRef, pickAsFileRef,
    sendGeo, sendContact, sendSticker, sendGif,
    getMessageSendingParams, onMessageSent,
  } = useChatSend({
    chat, numericChatId, isRealChat, isChannel, draftPeerId, canType, secretLocked,
    meId, threadRootId, sendAsPeerId,
    onChatCreated,
  })

  // Облачный черновик: восстановление в композер + сейв с дебаунсом; вместе с
  // текстом сохраняется reply_to_id текущего reply-стейта (tweb draft).
  const { initialDraft, onDraftChange } = useComposerDraft(isRealChat && !thread ? numericChatId : null, reply?.msgId ?? null)
  // Восстановление reply-бара из черновика (draft.reply_to_id): один раз после
  // загрузки окна; сообщение ищем в окне, вне окна — скип (getById у бэка нет).
  // Ответ черновика — поле САМОГО диалога (`draft.reply_to`), а не запись в
  // отдельном сторе рядом.
  const draftReplyToId = useChatsStore((st) => (isRealChat && !thread
    ? draftReplyOf(st.dialogs.find((d) => d.peerId === numericChatId)?.draft)
    : null))
  const replyRestoredRef = useRef(false)
  useEffect(() => {
    if (replyRestoredRef.current || draftReplyToId == null || mirrorMsgs.length === 0) return
    replyRestoredRef.current = true
    if (reply) return
    const rs = replyStateFor(draftReplyToId)
    if (rs) setReply(rs)
  }, [draftReplyToId, mirrorMsgs, reply, replyStateFor, setReply])

  // Кросс-чат ответ (tweb ReplyToAnotherChat): целевой чат открыт → ставим
  // reply-плашку из pending-reply (исходный чат + снимок оригинала) и чистим стор.
  const pendingReply = useSearchStore((s) => s.pendingReply)
  useEffect(() => {
    if (!pendingReply || pendingReply.targetPeerId !== numericChatId) return
    setReply({
      msgId: pendingReply.msgId,
      name: pendingReply.name,
      text: pendingReply.text,
      color: pendingReply.color,
      sourcePeerId: pendingReply.sourcePeerId,
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
    if (!pendingForward || pendingForward.targetPeerId !== numericChatId) return
    setForward({
      sourcePeerId: pendingForward.sourcePeerId,
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
    // Окно и цель действия читаются из ЗЕРКАЛА по НОМЕРУ; ключ окна слой
    // действий собирает сам из пары «пир + тред». Права на пункты меню сюда
    // больше не едут: пункты рисует ванильное меню и гейтит их само
    // (`chat/contextMenu.ts::verify`).
    threadRootId, meId,
    setReply, setEditing, clearSelection, onChatCreated,
  })
  const { showReactedUsers, openDeleteFor, openForwardFor, openForwardFrom } = msgActions
  const { pinMessage, openReportFor, openPostStatsFor, openFactCheckEditorFor, startEditFor, downloadMedia } = msgActions

  // Спиннер первой загрузки и лестница появления баблов — роль ленты (в tweb
  // это `ChatBubbles`: прелоадер bubbles.ts:752, `animateAsLadder` :10363).
  // React-обвязки под них больше нет.

  // Скролл-механика ленты (пагинация, восстановление позиции, прыжок, пин к
  // низу, отметка прочтения) — целиком в `chat/bubbles.ts`, как в tweb.

  // Channel-only wiring: live subscribe + catch-up, pts persistence, and the open
  // discussion-thread overlay. Счётчики поста (просмотры, комментарии) сюда
  // больше не приезжают: они параметры самого сообщения и читаются из окна.
  useChannelLive({ isRealChat, isChannel, numericChatId })
  // Клик по футеру «N комментариев» под постом канала — тред комментариев в
  // этой же колонке (tweb: setPeer(discussion group, threadId=postId)). Ключ
  // группы обсуждения приезжает СНИЗУ: лента берёт его из самого поста
  // (`replies.channel_id`), как tweb (bubbles.ts:3335
  // `replies.channel_id.toPeerId(true)`), а не из карточки канала. Данные
  // per-post и авторитетнее: карточка приезжает позже поста.
  const openFeedDiscussion = useEvent(({ peerId: groupPeerId, postMid }: { peerId: PeerId; postMid: number }) => {
    onOpenThread?.({ chatId: groupPeerId, rootMsgId: postMid, title: t('Comments'), subtitle: chat.name })
  })

  // Прыжок к сообщению — ручка ленты (порт `chat.setMessageId`). Зовут его
  // поиск, закреплённые, упоминания и медиавьювер; сама лента прыгает к
  // reply-оригиналу и к дате своими силами.
  const jumpToSeqE = useEvent((mid: number) => { feedApi.current?.jumpToMessage(mid) })
  // Клик по дате-разделителю открывает пикер (tweb bubbles.ts:3057-3078 →
  // `showDatePickerPopup({initDate, onPick: this.onDatePick})`). ПОКАЗ попапа —
  // роль владельца слоя попапов, то есть этого экрана; что делать с выбранным
  // днём — роль ленты: `bubbles.onDatePick` (порт tweb bubbles.ts:10205) сам
  // резолвит день в номер и зовёт `setMessageId`.
  const showDatePicker = useEvent((dayMs: number, onPick: (timestamp: number) => void) => {
    openPopup((p) => (
      <DatePickerPopup
        open={p.open}
        onClose={p.requestClose}
        onExitComplete={p.onExitComplete}
        initDate={dayMs}
        chatId={numericChatId}
        onPick={onPick}
      />
    ), DATE_PICKER_POPUP_KIND)
  })
  // Сайдбар-поиск открыл чат «вокруг сообщения» → прыгаем к найденному seq
  const pendingJump = useSearchStore((s) => s.pendingJump)
  useEffect(() => {
    if (pendingJump && pendingJump.peerId === numericChatId) {
      useSearchStore.getState().clearPendingJump()
      jumpToSeqE(pendingJump.seq)
    }
  }, [pendingJump, numericChatId, jumpToSeqE])
  // ── Просмотрщик медиа (Task 16): vanilla-вьювер (mediaViewer/*) вместо
  // снесённого React-лайтбокса. Сбор items — из окна сообщений
  // (collectLightboxItems — чистая логика бывшего useLightbox), действия —
  // существующие флоу чата, дозагрузка соседей — REST /chats/{id}/media. ──
  const mediaPagesRef = useRef<{ msgs: MyMessage[]; complete: boolean } | null>(null)
  // close-колбэк вьювера на время открытого попапа удаления/пересылки:
  // подтверждение попапа закрывает вьювер (tweb PopupDeleteMessages/
  // showForwardPopup зовут this.close() по действию), отмена — снимает колбэк
  // (проводка — обёртка msgActions у <ChatMsgActionPopups> ниже).
  const viewerActionCloseRef = useRef<(() => void) | null>(null)
  // Контекст подписи автора для вьювера. Карточки берутся точечно из зеркала
  // пиров (`cachedPeer`) — тем же способом, что их берёт лента
  // (`chat/bubbles.ts::openMediaViewerFor`): плоской витрины `peers` из
  // снесённой React-ленты больше нет.
  const lightboxCtx = (source: MyMessage[]): LightboxCtx => {
    const peers = new Map<PeerId, NonNullable<ReturnType<typeof cachedPeer>>>()
    for (const m of source) {
      const fromId = m.fromId
      if (fromId == null || peers.has(fromId)) continue
      const peer = cachedPeer(fromId)
      if (peer) peers.set(fromId, peer)
    }
    return { meId, meName: getUserTitle(me?.user), peers, chatName: chat.name, lang }
  }
  // Миниатюра сообщения в отрендеренных баблах (tweb собирает targets из
  // баблов селектором '.attachment', bubbles.ts:3744-3800; у секретных медиа
  // контейнер без .attachment — img). Узлы ленты императивные, поэтому спрашиваем
  // её скролл-контейнер.
  const findBubbleMedia = (id: number): HTMLElement | null =>
    feedScrollRef.current?.querySelector<HTMLElement>(
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
      const slice = older
        ? cache.msgs.slice(i + 1, i + 1 + loadCount)
        : cache.msgs.slice(Math.max(0, i - loadCount), i)
      const ctx = lightboxCtx(slice)
      // порядок newest-first сохраняем — ListLoader (reverse: true) сам разложит
      return slice.map((m) => messageToViewerItem(m, ctx, findBubbleMedia(m.id)))
    } catch {
      return [] // ошибка сети = край списка: вьювер листает уже загруженное
    }
  }
  // Сам вьювер открывает ЛЕНТА (порт `checkTargetForMediaViewer`,
  // `chat/bubbles.ts::openMediaViewerFor`); сюда остаётся то, чего у ленты быть
  // не может, — действия окружения `Chat`.
  // Пересоздаётся каждый рендер сознательно: лента читает эти ручки ЧЕРЕЗ РЕФ
  // (`VanillaFeed.gesture`), который обновляется тем же рендером, — мемоизация
  // ничего бы не сэкономила и только законсервировала бы устаревшее замыкание.
  const mediaViewerActions = {
    jumpToMessage: (it: ViewerItem) => { if (it.seq != null) jumpToSeqE(it.seq) },
    onForward: (mid: number, close: () => Promise<void> | null) => {
      viewerActionCloseRef.current = () => { void close() }
      openForwardFor(numericChatId, [mid])
    },
    onDelete: (mid: number, closeFromMedia: () => void) => {
      viewerActionCloseRef.current = closeFromMedia
      openDeleteFor(numericChatId, [mid])
    },
    loadMoreMedia,
  }
  // Смена чата / unmount: vanilla-вьювер живёт в body — закрываем сами.
  useEffect(() => () => closeMediaViewer(), [numericChatId])
  // Перезвон по баблу звонка, отметка «кружок/голосовое прослушано» и отмена
  // отдачи файла ПОРТИРОВАНЫ в саму ленту — там их владелец и в tweb
  // (`chat/bubbles.ts`: `renderCall` + ветка клика `.bubble-call`,
  // `uploadPromiseFor`, проброс `mediaUnread`/`out` в врапперы). Здесь остался
  // только адресат перезвона: `VanillaFeed` собирает карточку собеседника и
  // зовёт `startOutgoing` — роль `appImManager` в оригинале.
  //
  // Голосовая очередь плеера и разблокировка платного медиа — по-прежнему долги
  // этапа 7, см. web-client/CLAUDE.md.

  // (Ack reconcile + send-rejection run in realtimeBridge → зеркало окна; live
  // edit/delete keyed by chat_id; pinned-bar state in usePinnedBar. Отметка
  // прочтения — наблюдатель непрочитанных баблов в самой ленте
  // (`chat/bubbles.ts`, порт tweb bubbles.ts:2941-3012).)

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
    if (!isRealChat || !chatPeer) return null
    // Вид чата — предикат по конструктору, а не строка `type`.
    const members = chatPeer._ === 'channel' ? chatPeer.participants_count ?? 0 : 0
    if (isBroadcast(chatPeer)) return `${members} подписчиков`
    if (isMegagroup(chatPeer))
      return `${members} участников${onlineCount > 0 ? `, ${onlineCount} онлайн` : ''}`
    return null
  })()

  // Header status line: typing/recording wins; then group member counts; then
  // private online / last-seen; then any static status.
  const headerTypingActive = typingLabel.active
  const headerTypingText = typingLabel.label
  const headerTypingKind = typingLabel.kind
  const presenceLabel =
    chat.type === 'private' && peerPresence
      ? isUserStatusOnline(peerPresence, nowSeconds())
        ? t('online')
        : lastSeenLabel(userStatusWasOnline(peerPresence) * 1000, lang)
      : null
  const headerStatus = realSubtitle ?? presenceLabel ?? (chat.status ? t(chat.status) : '')
  const headerOnline = isUserStatusOnline(peerPresence, nowSeconds()) || chat.status === 'online'

  // Бот-собеседник (для кнопки «Начать», reply-клавиатуры и кнопки-меню) — по профилю.
  const [isBotChat, setIsBotChat] = useState(false)
  const [botMenu, setBotMenu] = useState<{ text: string; url: string } | null>(null)
  useEffect(() => {
    if (chat.type !== 'private' || !isRealChat) { setIsBotChat(false); setBotMenu(null); return }
    let alive = true
    const peerId = numericChatId
    setBotMenu(null)
    void managers.privacy.profile(peerId).then((p) => {
      if (!alive) return
      // Полная карточка собеседника — в общее зеркало: тема оформления
      // приватного чата живёт в `userFull.theme_emoticon` (решение Р7), и это
      // единственный загрузчик этой карточки для ОТКРЫТОГО чата.
      saveChatFull(peerId, p.fullUser)
      setIsBotChat(!!p.user.pFlags?.bot)
      if (p.user.pFlags?.bot) {
        void managers.bots.menuButton(peerId).then((mb) => { if (alive && mb.text && mb.url) setBotMenu(mb) }).catch(() => {})
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [chat.type, isRealChat, numericChatId, managers])
  // reply-клавиатура над композером — ряды последней подходящей разметки окна
  // (порт mergeReplyKeyboard + checkAvailability, core/markup/replyMarkup.ts).
  // Окно берётся из ЗЕРКАЛА — того же, что читает лента; поле разметки в сыром
  // сообщении зовётся `reply_markup` (в снесённой витрине `ConvMsg` оно было
  // переименовано, `core/messageToConvMsg.ts:151`).
  const replyKeyboard = useMemo(
    () => findReplyKeyboardRows(mirrorMsgs.map((m) => ({ replyMarkup: m._ === 'message' ? m.reply_markup : undefined }))),
    [mirrorMsgs],
  )
  // Бот без истории → кнопка «Начать» вместо композера (шлёт /start).
  const botStart = isBotChat && isRealChat && mirrorMsgs.length === 0

  // Floating "scroll to bottom" button (tweb .bubbles-go-down), shown above the
  // composer. Показ кнопки — класс `is-go-down-visible` на колонке чата, его
  // ставит сама лента (`bubbles.updateGoDownVisibility`); клик — порт
  // `onGoDownClick`.
  const scrollDownFab = <ScrollDownFab unreadBelow={unreadBelow} onClick={() => feedApi.current?.goDown()} />

  // ── Плашка вместо строки ввода (tweb .chat-input-control) ──
  // Цепочка условий — в computeControlPlates (порт haveSomethingInControl).
  const composerUsable = canType && canSendText
  const threadClosed = !!thread?.closed
  const { botStartPlate, secretPlate, groupRestricted, channelMutePlate } = computeControlPlates({
    composerUsable, permissionsKnown, isGroup, canSendText, botStart, secretLocked, threadClosed,
  })
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
    if (m) jumpToSeqE(m.id)
  })
  const onOpenPinList = useEvent(() => pop.openPinned())
  // Право «Открепить все» (tweb canPinMessage): приватный/личный чат — всегда;
  // группа/канал — создатель или админ с RightPinMessages (1<<5).
  const canUnpinAll = chat.type === 'private' || chat.type === 'saved' ||
    hasRights(chatPeer, 'pin_messages')
  // Создавать розыгрыш может владелец канала или админ с post_messages.
  const canCreateGiveaway = isChannel && isRealChat && hasRights(chatPeer, 'post_messages')
  // Stable composer callbacks so the memoized <Composer> doesn't re-render on
  // unrelated parent renders (e.g. the scroll handler toggling showScrollDown).
  // Медленный режим: обычный участник группы блокируется на N сек после отправки
  const slowmodeExempt = !isGroup || hasRights(chatPeer, 'just_admin')
  const { left: slowmodeLeft, markSent: slowmodeMarkSent } = useSlowmode(chatFull?.fullChat.slowmode_seconds ?? 0, slowmodeExempt)
  // Платные сообщения (Telegram paid messages): плашка в композере только для
  // не-админа платной группы (владелец/админ пишут бесплатно).
  const composerChargeStars = isGroup && chatPeer && !hasRights(chatPeer, 'just_admin') ? (chatFull?.fullChat.send_paid_messages_stars ?? 0) : 0
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
        const u = res.users.find((x) => x.username?.toLowerCase() === uname)
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
  const onComposerPickSticker = useEvent((st: Sticker) => { sendSticker(st); slowmodeMarkSent() })
  // Тот же гейт, что у кнопки стикеров композера (JSX ниже,
  // onPickSticker={canSendStickers ? onComposerPickSticker : undefined}):
  // держим оба входа (композер/поиск и клик по стикеру в бабле — попап
  // StickerSetModal из StickerRealBubble) идентичными по правам отправки.
  const canSendStickers = canType && canSendMedia && !isChannel && chat.type !== 'secret'
  // GIF из вкладки пикера — те же ограничения, что у стикеров (не канал, не секретный).
  const onComposerPickGif = useEvent((g: GifItem) => { sendGif(g); slowmodeMarkSent() })
  // Ответ жестом из императивной ленты (свайп на таче / даблклик на десктопе,
  // tweb bubbles.ts:1497-1542 и :1699). Лента отдаёт только НОМЕР — плашку
  // собирает владелец композера, тем же путём, которым её восстанавливает
  // черновик (`replyStateFor` → `windowReplyState`). В tweb граница ровно та же:
  // `chat.input.getChatInputReplyToFromMessage(message)` — дело инпута.
  const onFeedReply = useEvent((mid: number) => {
    const rs = replyStateFor(mid)
    if (rs) { setReply(rs); setEditing(null) }
  })
  // Выделение в императивной ленте. Владелец режима — сама лента (порт
  // `ChatSelection`), хост лишь рисует плашку: получает выбранные номера,
  // признак режима и способ его снять. Второго источника правды нет —
  // React-стейт здесь ВИТРИНА плашки, а не хранилище выбора.
  const onFeedSelection = useEvent((state: { mids: number[], selecting: boolean }) => {
    setSelected(new Set(state.mids))
    setSelecting(state.selecting)
  })
  // Пересылка из ванильного меню — порт `showForwardPopup({[peerId]: mids})`
  // (tweb contextMenu.ts:2028). У ленты ОДНО окно, поэтому пара в записи ровно
  // одна; разбираем её и зовём то же действие, что и пункт React-меню.
  const onFeedForward = useEvent((fromPeerIdsMids: Record<number, number[]>) => {
    for (const [fromPeerId, mids] of Object.entries(fromPeerIdsMids)) {
      if (mids.length) openForwardFor(Number(fromPeerId), mids)
    }
  })
  // «Кто отреагировал / просмотрел» из ванильного меню. tweb открывает
  // модальный `PopupReactedList` (contextMenu.ts:1251), а наш список —
  // позиционируемый попап, поэтому у пункта берётся точка клика (см. докблок
  // `ContextMenuPopups.showReactedList`).
  const onFeedReactedList = useEvent((peerId: number, mid: number, at: { x: number; y: number }) => {
    if (peerId !== numericChatId) return
    void showReactedUsers(mid, at.x, at.y)
  })
  // Носители попапов и вызовы композера для ванильного меню — ТЕ ЖЕ действия,
  // которыми пользуются пункты React-меню (`useMessageActions`). Объект новый на
  // каждый рендер, и это осознанно: лента читает его через реф, не пересобираясь.
  const feedMenuPopups = {
    showPinMessage: pinMessage,
    showDeleteMessages: openDeleteFor,
    showForward: onFeedForward,
    // ТРЕТИЙ аргумент порта (`onSuccess` — снять выделение после отправки
    // жалобы, tweb contextMenu.ts:1216-1220) сюда не доезжает: наш ReportPopup
    // завершения не объявляет вовсе, объявить его некому. Выделение после
    // жалобы останется — долг, не адаптация.
    showMessageReport: openReportFor,
    showReactedList: onFeedReactedList,
    showStatistics: openPostStatsFor,
    showFactCheckEditor: openFactCheckEditorFor,
  }
  const onComposerCancelReply = useEvent(() => setReply(null))
  const onComposerCancelEdit = useEvent(() => setEditing(null))
  // Плашка форварда: отмена, тоггл опций меню (скрыть отправителя/подпись),
  // «переслать в другой чат» (переоткрываем пикер с исходным чатом + снимком превью).
  const onComposerCancelForward = useEvent(() => setForward(null))
  const onComposerForwardOption = useEvent((opt: { dropAuthor?: boolean; dropCaption?: boolean }) =>
    setForward((f) => (f ? { ...f, ...opt } : f)))
  const onComposerForwardAnother = useEvent(() => {
    if (!forward) return
    openForwardFrom(forward.sourcePeerId, forward.msgIds, { count: forward.count, text: forward.text, hasCaption: forward.hasCaption })
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
    for (let i = mirrorMsgs.length - 1; i >= 0; i--) {
      const raw = mirrorMsgs[i]
      // Пилюля (`messageService`) не правится — у неё нет ни текста, ни сущностей.
      if (raw._ !== 'message') continue
      // «Своё» — то же правило стороны бабла, что у ленты (`isOutMessage`:
      // send-as в мегагруппе исходящий, пост вещательного канала — нет).
      const conv = messageToConvMsg(raw, meId, { isMegagroup: isGroup })
      if (!conv.out) continue
      setEditing({ msgId: raw.id, text: conv.text ?? '', entities: raw.entities })
      setReply(null)
      return
    }
  })
  // Ctrl/Cmd+↑ — ответ на последнее подходящее сообщение окна (tweb): с конца
  // ищем первое несервисное/неудалённое сообщение и ставим reply как из меню.
  const onComposerReplyPrev = useEvent(() => {
    for (let i = mirrorMsgs.length - 1; i >= 0; i--) {
      const raw = mirrorMsgs[i]
      if (raw._ !== 'message') continue
      const rs = replyStateFor(raw.id)
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
    onPageUp: useEvent(() => feedScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })),
    onPageDown: useEvent(() => feedApi.current?.goDown()),
  })

  // Липкие даты целиком у ленты: класс `has-sticky-dates` (порт
  // `onRenderScrollSet`, `chat/bubbles.ts:3087`), класс `is-scrolling` на
  // `.bubbles-inner` (`chat/bubbles.ts:3003-3008`) и сам `StickyIntersector`
  // (`chat/bubbles.ts:3427`) — как в tweb, где всё это тоже роль `ChatBubbles`.

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
    applyMute, toggleMute, startSelectMode,
    doDeleteChat, doClearHistory, openPicker, sendGeo, sendContact, setPendingMedia,
    getMessageSendingParams, onMessageSent,
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
        <SavedTagsPanel activeTag={savedTagFilter} onFilter={onSavedTagFilter} onCountChange={setSavedTagsCount} />
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
          // tweb _chat.scss:1217 — видимость угловых кнопок даёт класс на
          // колонке; ставит его сама лента (`bubbles.updateGoDownVisibility`).
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
          peerOnline={isUserStatusOnline(peerPresence, nowSeconds())}
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

        {/* Лента целиком императивная — порт tweb `chat/bubbles.ts`. Дерево
            (`.bubbles > .scrollable.bubbles-scrollable > .bubbles-padding-top +
            .bubbles-inner + .bubbles-padding-bottom`, tweb bubbles.ts:4178-4186)
            строит сама лента; React-хост `VanillaFeed` лишь подвешивает её узлы
            в колонку чата. Точка монтирования закреплена
            `Chat.feedMount.test.ts` (Chat.tsx нельзя отрендерить в тесте, см.
            «Тесты» в web-client/CLAUDE.md).

            `isMegagroup` — тот же признак «открыт групповой чат»: любая наша
            группа это `channel` с `pFlags.megagroup` (`core/peers/peer.ts:325`).
            Берётся из диалога, а не из карточки пира: карточка приезжает позже,
            и до неё баблы моргнули бы стороной. */}
        <VanillaFeed api={feedApi} scrollerRef={feedScrollRef} paddingTopPx={padTopPx} paddingBottomPx={padBottomPx} mediaViewerActions={mediaViewerActions} peerId={numericChatId} threadRootId={threadRootId} isLikeGroup={isGroup} isBroadcast={isChannel} isMegagroup={isGroup} autoDownload={autoDownload} canSend={canType} canSendPlain={composerUsable} onReply={onFeedReply} onEdit={startEditFor} onDownload={downloadMedia} onSendSticker={canSendStickers ? onComposerPickSticker : undefined} menuPopups={feedMenuPopups} onSelection={onFeedSelection} onOpenDatePicker={showDatePicker} onOpenDiscussion={openFeedDiscussion} />

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
              peerId={inputPeerId}
              reply={reply}
              editing={editing}
              forward={forward}
              rec={rec}
              onSend={onComposerSend}
              onTyping={onComposerTyping}
              onPickSticker={canSendStickers ? onComposerPickSticker : undefined}
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
              peerId={inputPeerId}
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
                onForward={() => openForwardFor(numericChatId, [...selected])}
                onDelete={() => openDeleteFor(numericChatId, [...selected])}
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
                    {/* Кнопка reply-клавиатуры шлёт свой текст сообщением —
                        ветка `default` в tweb getKeyboardButtonHandler
                        (keyboardButton.ts:290-296: sendText({text: button.text})). */}
                    {row.buttons.map((button, bi) => (
                      <button key={bi} type="button" className={s.replyKeyboardBtn} onClick={() => onComposerSend(button.text)}>
                        {button.text}
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
            onSendGift={chat.type === 'private' && isRealChat && numericChatId !== meId ? pop.openGift : undefined}
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
          onSend={(caption, asFile, paidPrice, spoilers) => { void sendPendingMedia(caption, asFile, paidPrice, spoilers); slowmodeMarkSent() }}
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
          doForward: async (peerIds) => {
            await msgActions.doForward(peerIds)
            viewerActionCloseRef.current?.()
            viewerActionCloseRef.current = null
          },
          closeDelete: () => { viewerActionCloseRef.current = null; msgActions.closeDelete() },
          closeForward: () => { viewerActionCloseRef.current = null; msgActions.closeForward() },
        }}
        numericChatId={numericChatId}
      />
    </CallProvider>
  )
}
