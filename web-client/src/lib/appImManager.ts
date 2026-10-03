// Порт tweb `src/lib/appImManager.ts` (812502980, 3991 строка) — ядро шага К-2
// ускоренного плана волны 7 (`docs/superpowers/plans/2026-10-02-wave-7-carcass-first.md`,
// карта блоков A–M — план `2026-09-30-wave-7-shell-sidebars.md`, этап 4).
//
// Что портировано:
//  A, B — типы `ChatSetPeerOptions`/`ChatSetInnerPeerOptions`, `APP_TABS`, события
//         `chat_changing`/`peer_changed`/`peer_changing`/`tab_changing`/`premium_toggle`,
//         поля, синглтон (`:3989-3991`);
//  J    — `selectTab` (`:3137-3197`), `updateColumnAccessibility` (`:3203-3208`), стек
//         чатов: `createNewChat` `:3219`, `spliceChats` `:3233-3290`, `setPeer` `:3292-3390`,
//         `setInnerPeer` `:3392-3434`, `chatsSelectTab` `:2766-2805`, `isSamePeer` `:3809`;
//  G    — `overrideHash` `:3127`, `onHashChange` `:1912-2031`, `open`/`op` `:2050-2157`,
//         `openUsername` `:2165`, `openThread` `:2186`, `openUrl` `:1897`;
//  I    — `setCurrentBackground`/`setBackground`/`applyCurrentTheme` `:2607-2713`,
//         `setSettings` `:2715-2762`;
//  C    — `construct` (`:324-1018`) в объёме предметов, которые у нас есть;
//  L    — статус и набор (`:3454-3807`, пачка П-4): `getTypingElement`, `getPeerTyping`,
//         `getChatStatus`/`getUserStatus`/`getPeerStatus`/`setPeerStatus`, «N онлайн»
//         (`appProfileManager.getOnlines`), расхождения Н1–Н6 — у таблицы ключей ниже;
//  H    — звонки (`:2227-2605`, пачка П-4): `callUser`, `discardCurrentCall` и
//         подтверждения, `joinGroupCall`, `joinLiveStream`, очередь переходов
//         (`lib/calls/callTransitionCoordinator.ts`), расхождения З1–З5 — у секции.
//  K    — `init` `:2807`, `attachDragAndDropListeners` `:2815-3035`, `canDrag` `:3037`,
//         `onDocumentPaste` `:3052-3125` (П-4, Б-24); зона — `components/chat/dragAndDrop.ts`.
//
// Инстанс стека — класс `Chat` (`components/chat/chat.ts`, шаг К-3): `createNewChat`
// строит `new Chat(this, managers, true)` (tweb `:3220`). Позицию ленты (`chatPositions`,
// `saveChatPosition`/`getChatSavedPosition`, `:2640-2688`) держит класс, как у tweb.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. `columnEl` берётся в `construct`, а не инициализатором поля: модуль
//     импортируется тестами и соседями до того, как в документе есть `#column-center`.
//  2. (снято П-4: ссылка «пропустить к чату» и имена ориентиров — `attachSkipToContent`,
//     `setStaticLandmarkLabels`, `:349-352`, `:3199-3201`, Б-47.)
//  3. Нет предмета у подписок `construct`: `appMediaPlaybackController.construct` (у нас модуль без конструктора),
//     `idleController` → `updateStatus`/`goOffline` (Б-14), предкэш обоев
//     `SETTINGS_INIT.themes` (наш фон резолвит обои сам), `chatTips` (Б-13),
//     `join_chat_webview_decision` (П-4), `topbarCall`/`chatAudio` (П-5); подписки
//     звонков (`:880-947`): попап входящего — остров `CallOverlay` по `callStore`,
//     `acceptCallOverride` и `incompatible` — бэклог Б-95,
//     `peer_typings` (эмодзи-интеракций нет), `peer_title_edit` (события нет),
//     `message_error` слоумода (П-6), `ephemeral_*`/`service_notification`/…
//     (Б-16), `singleInstance`/t.me (Б-17), autologin/цвета
//     пиров/шаринг (П-4), `savedReactionTags`.
//  4. `useHeavyAnimationCheck` (`:436-442`) не нужен здесь: `animationIntersector`
//     подписан на тяжёлую анимацию сам (`components/animationIntersector.ts:177`).
//  5. `appChatBackground.attach` и первый `setBackground` делает `client/boot.ts`
//     (фон нужен ещё экрану входа); `theme_changed` (`:494-504`) фон переигрывает
//     сам (`chatBackground.solid.tsx`, подписка на `theme_changed`); тему чата
//     публикует `Chat.publishBackground` (`chat.ts`).
//  6. Позиция ленты (`ChatSavedPosition`) — без `pinnedMessages` (закреп — Б-19), без
//     персиста (у tweb он тоже закомментирован, `:845`).
//  7. `settings_updated` → подписка на `useSettingsStore` (единственный владелец
//     настроек). `--messages-text-size`, `customEmojiSize`, формат времени живут у
//     своих настроек; из `setSettings` — `animation-level-*`, `no-backdrop`,
//     автоплей/зацикливание стикеров и тема по выбору (бывший `client/liteModeSettings.ts`
//     и `useThemeToggle`). `chatsSelectTabDebounced` (закреп, очередь загрузок) — нет
//     предмета до К-3.
//  8. Хэш: `story`/`community`/`call` в `#/im` — нет предметов. `op()` без `migrated_to` и ботфорума. В канал, где мы не состоим, `op()` ВСТУПАЕТ: наш
//     `GET /chats/{id}/history` не-участнику отдаёт 403 (перенесено из прежнего
//     `useUrlSync.applyHash`, долг — `docs/readiness/port-divergences.md`).
//  9. `setPeer` без `getPeerMigratedTo` и `min`-пиров (`:3293-3317`) — в нашей
//     модели их нет; `spliceChats` не закрывает `AppPrivateSearchTab` (вкладки нет).
// 10. Звонки (блок H) — расхождения З1–З5 у секции `── H. Звонки ──`.
// 11. `notificationBuild` (`:805-822`) — `client/uiNotifications.ts` спрашивает
//     `appImManager.chat` сам; звук отправки (`:857-877`) — `soundSubscriber.ts`.
// 12. Клик по системному уведомлению (`sw.js` → `open-chat`) открывает чат здесь
//     (у tweb — `uiNotificationsManager` через `appImManager.setInnerPeer`).
// 13. Узел левой колонки — `#column-left` из документа, а не `appSidebarLeft.sidebarEl`:
//     модуль класса колонки тянет за собой поиск и регистрирует custom elements при
//     импорте, а `appImManager` импортируют и лёгкие подписчики (`uiNotifications`,
//     `soundSubscriber`). Узел тот же (`sidebarLeft/index.ts`, `super({sidebarEl})`).
// K-1. `init` (`:2807-2813`) — без `MarkupTooltip.handleSelection` и
//     `showDatePickerPopup`: тултип разметки — бэклог Б-33.
// K-2. Права по видам вложений (`canSendNewMedia`, `send_photos`/`send_videos`/
//     `send_docs`) не сужают зоны: гранулярных прав у нас нет (`core/peers/rights.ts`),
//     а с `onlyVisible: true` оригинал и сам отвечает «можно» на все. Отладочный лог
//     (`this.log.bindPrefix('dragAndDrop')`, `debug = false`) снят.
// K-3. Нет предметов у `ChatInput`: правка с заменой медиа (`editMessage`,
//     `canUploadAsWhenEditing`, Б-38), эфемерный композер (`isEphemeralComposerMode`,
//     `getEphemeralSendingSnapshot`, тост `Ephemeral.SingleAttachment`), тултип
//     медленного режима (`showSlowModeTooltipIfNeeded`, Б-37), монофорум (`canPaste`) —
//     бэклог Б-82. `.mov` считается медиа без `isConvertibleMov` (конвертера в mp4
//     у нас нет: файл уходит видео как есть).
// K-4. Попап медиа — мост `components/popups/newMedia.ts` (React `SendMediaPopup`
//     через `popupStore`, ВРЕМЕННО до порта newMedia.tsx, решение Р-2). Зон сброса внутри открытого попапа (`mediaDropsContainer`,
//     `appendDrops`, `Preview.Dragging.AddItems`) нет — бэклог Б-83; вставка в открытый
//     попап дописывает файлы (`addFiles`).
// 14. Блок F (`attachKeydownListener` `:1703-1852`, `attachCopyListener` `:1854-1895`):
//     F1. Правка последнего и ответ на предыдущее по ↑/Ctrl+↑ (`:1758-1846`) не
//         портированы — Б-80: нужны члены `ChatInput` К-4 (`editMsgId`, `replyToMsgId`,
//         `isInputEmpty`, `onHelperCancel`) и `getFirstMessageToEdit` воркера. Ветка
//         стрелок осталась (нет права писать — прокрутка ленты, иначе клавиша гаснет).
//     F2. `chat.input.recording` (`:1841`) — записи голоса у класса `ChatInput` нет
//         (Б-30): условие «не во время записи» снято.
//     F3. `appDialogsManager.contextMenu?.hasAddToFolderOpen()` (`:1767`) — только в
//         ветке правки (F1).
//     F4. Защита копирования инертна, пока у баблов нет класса `no-forwards` — Б-81.
//     Автоблокировка (`:630` рядом — только сочетание) — как у tweb, в воркере
//     (`lib/mainWorker/useAutoLock.ts`, проводка `core/workerCore.ts`).
import PeerTitle, { type PeerTitleManagers } from '@components/chat/peerTitle'
import { generateMessageId } from '@core/history/messageId'
import type { Middleware } from '@helpers/middleware'
import I18n, { i18n, type FormatterArguments } from '@lib/langPack'
import type { LangPackKey } from '@/lang'
import type { SendMessageAction } from '@core/realtime/events'
import { cachedChat, cachedPeer, cachedUser } from '@core/peerCache'
import { isAnyChat, isUser } from '@core/peers/peerId'
import { useChatsStore } from '@stores/chatsStore'
import { MOUNT_CLASS_TO } from '@config/debug'
import EventListenerBase from '@helpers/eventListenerBase'
import liteMode, { type LiteModeKey } from '@helpers/liteMode'
import pause from '@helpers/schedulers/pause'
import { doubleRaf } from '@helpers/schedulers'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import disableTransition from '@helpers/dom/disableTransition'
import whichChild from '@helpers/dom/whichChild'
import parseUriParams from '@helpers/string/parseUriParams'
import { IS_FIREFOX } from '@environment/userAgent'
import type { Managers } from '@/client/bootstrap'
import { dispatchHeavyAnimationEvent } from '@core/dom/heavyAnimation'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import appNavigationController, { USE_NAVIGATION_API } from '@core/navigation/appNavigationController'
import { isPeerId, NULL_PEER_ID } from '@core/peers/peerId'
import { peerKey, type Chat as MTChat, type User } from '@core/peers/peer'
import { isBroadcast, isForum } from '@core/peers/predicates'
import { setTheme } from '@core/theme/themeController'
import internalLinkProcessor from '@lib/internalLinkProcessor'
import { getAnchorListener } from '@helpers/addAnchorListener'
import { wrapUrl } from '@lib/richtext/url'
import { openWebApp } from '@core/webapp'
import animationIntersector from '@components/animationIntersector'
import appChatBackground, { type AppChatBackground } from '@components/chat/bubbles/chatBackground.solid'
import { ChatType } from '@components/chat/chatType'
import Chat from '@components/chat/chat'
import { splitFullMid } from '@components/chat/bubbles'
import { hangup, startOutgoing } from '@core/calls/callEngine'
import { joinGroupCall as joinGroupCallEngine, leaveGroupCall } from '@core/calls/groupCallEngine'
import { leaveLivestream, watchLivestream } from '@core/calls/livestreamEngine'
import callTransitionCoordinator from '@lib/calls/callTransitionCoordinator'
import type { CallType } from '@lib/calls/types'
import type { AckedResult } from '@lib/twebMessagePort'
import { useCallStore } from '@stores/callStore'
import { useGroupCallStore } from '@stores/groupCallStore'
import { useLivestreamStore } from '@stores/livestreamStore'
import { confirmationPopup } from '@components/popups/popupPeer'
import { getChatStatusString, getParticipantsCount } from '@components/wrappers/getChatMembersString'
import { getUserStatusString } from '@core/presence'
import { hasRights as hasChatRights } from '@core/peers/rights'
import replaceContent from '@helpers/dom/replaceContent'
import { getMiddleware } from '@helpers/middleware'
import { getUserTitle } from '@core/peers/getPeerTitle'
import { getPeerPhotoId } from '@core/peers/peer'
import { gradientFor } from '@core/dialogToChat'
import appSidebarRight, { RIGHT_COLUMN_ACTIVE_CLASSNAME } from '@components/sidebarRight'
import appDialogsManager from '@lib/appDialogsManager'
import { toast, toastNew } from '@components/toast'
import rootScope from '@lib/rootScope'
import { useSettingsStore } from '@/settings'
import { resolvePreset } from '@/theme'
// блок K — drag&drop и вставка файлов
import ChatDragAndDrop from '@components/chat/dragAndDrop'
import showNewMediaPopup, { getCurrentNewMediaPopup, type WillAttachType } from '@components/popups/newMedia'
import { bindActiveWindowListener, getOverlayRoot } from '@helpers/appWindow'
import overlayCounter from '@helpers/overlayCounter'
import cancelEvent from '@helpers/dom/cancelEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import partition from '@helpers/array/partition'
import getFileMimeType from '@helpers/files/getFileMimeType'
import getFilesFromEvent from '@helpers/files/getFilesFromEvent'
import { setTransition } from '@core/dom/setTransition'
import MEDIA_MIME_TYPES_SUPPORTED from '@environment/mediaMimeTypesSupport'
// блок F (хоткеи, копирование, ориентиры) и сочетание блокировки
import useLockScreenShortcut from '@lib/appManagers/utils/useLockScreenShortcut'
import { attachSkipToContent, setLandmarkLabels } from '@helpers/dom/appLandmarks'
import { shouldPreserveKeyboardFocus } from '@helpers/dom/isKeyboardControl'
import isTargetAnInput from '@helpers/dom/isTargetAnInput'
import getSelectedNodes from '@helpers/dom/getSelectedNodes'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'

// ═══ СТАТУС И НАБОР (блок L, `:3454-3816`) — методы класса ниже ═════════════
//
// Расхождения блока L с оригиналом:
//  Н1. Набор пира — синхронно из зеркала `chatsStore.typing` (мост чтения п. 2 плана
//      волны 7), а не `appProfileManager.getPeerTypings`; срок жизни записи ведёт
//      проектор (`client/realtime/storeProjection.ts`, `TYPING_TTL`). Бот — по
//      `pFlags.bot` карточки зеркала (`appUsersManager.isBot`). Поэтому
//      `getPeerTyping` синхронен, а не `async`.
//  Н2. Таблица ключей — только действия, которые производит наш клиент
//      (`core/realtime/events.ts::SendMessageAction`): игры, стикеры, кружки и
//      эмодзи-интеракции на проводе не бывают, их ключей и веток
//      (`peer-typing-choosing-sticker`, `peer-typing-flex`) нет; нет и
//      `setChoosingStickerTyping` (`:3805`).
//  Н3. Имя печатающего — узел нашего `PeerTitle` (синхронный, сам перерисуется,
//      когда карточка доедет); ему нужны зона и менеджеры — они приходят опцией
//      (строка чатлиста и шапка живут и в тестах без `construct`).
//  Н4. Карточка пользователя и его присутствие — зеркала (`peerCache`,
//      `chatsStore.presence`), а не `appUsersManager.getUser`; присутствие из
//      `presence` новее `user.status` карточки и идёт первым.
//  Н5. Подпись чата — краткая карточка (`participants_count` зеркала,
//      `getChatMembersString`), а не `getChatFull`: полной карточки чата в этом
//      слое нет. «N онлайн» (`getOnlines`, у tweb — `appProfileManager.ts:1170-1210`)
//      считается здесь по присутствию «недавних» участников, страница которых
//      кэшируется на 60 с, как `invokeApiCacheable` оригинала. Ручки
//      `messages.getOnlines` у бэкенда нет — у группы больше 100 участников
//      онлайн не считается (бэклог Б-84). Фильтра «недавние» у ручки участников
//      нет — берётся её первая страница из 100.
//  Н6. `setPeerStatus` без `useWhitespace` (`NBSP` вместо пустой подписи): все наши
//      вызывающие (шапка, форум-таб) передают `false`, как и у tweb.

type ActivityKeys = { [action in SendMessageAction['_']]: LangPackKey }

/** tweb `:3538-3595` в объёме наших действий (Н2). */
const langPackKeys: { [peerType in 'private' | 'chat' | 'multi' | 'pair']: ActivityKeys } = {
  private: {
    sendMessageTypingAction: 'Peer.Activity.User.TypingText',
    sendMessageUploadAudioAction: 'Peer.Activity.User.SendingFile',
    sendMessageUploadDocumentAction: 'Peer.Activity.User.SendingFile',
    sendMessageUploadPhotoAction: 'Peer.Activity.User.SendingPhoto',
    sendMessageUploadVideoAction: 'Peer.Activity.User.SendingVideo',
    sendMessageRecordVideoAction: 'Peer.Activity.User.RecordingVideo',
    sendMessageRecordAudioAction: 'Peer.Activity.User.RecordingAudio',
  },
  chat: {
    sendMessageTypingAction: 'Peer.Activity.Chat.TypingText',
    sendMessageUploadAudioAction: 'Peer.Activity.Chat.SendingFile',
    sendMessageUploadDocumentAction: 'Peer.Activity.Chat.SendingFile',
    sendMessageUploadPhotoAction: 'Peer.Activity.Chat.SendingPhoto',
    sendMessageUploadVideoAction: 'Peer.Activity.Chat.SendingVideo',
    sendMessageRecordVideoAction: 'Peer.Activity.Chat.RecordingVideo',
    sendMessageRecordAudioAction: 'Peer.Activity.Chat.RecordingAudio',
  },
  multi: {
    sendMessageTypingAction: 'Peer.Activity.Chat.Multi.TypingText1',
    sendMessageUploadAudioAction: 'Peer.Activity.Chat.Multi.SendingFile1',
    sendMessageUploadDocumentAction: 'Peer.Activity.Chat.Multi.SendingFile1',
    sendMessageUploadPhotoAction: 'Peer.Activity.Chat.Multi.SendingPhoto1',
    sendMessageUploadVideoAction: 'Peer.Activity.Chat.Multi.SendingVideo1',
    sendMessageRecordVideoAction: 'Peer.Activity.Chat.Multi.RecordingVideo1',
    sendMessageRecordAudioAction: 'Peer.Activity.Chat.Multi.RecordingAudio1',
  },
  pair: {
    sendMessageTypingAction: 'Peer.Activity.Chat.Pair.TypingText',
    sendMessageUploadAudioAction: 'Peer.Activity.Chat.Pair.SendingFile',
    sendMessageUploadDocumentAction: 'Peer.Activity.Chat.Pair.SendingFile',
    sendMessageUploadPhotoAction: 'Peer.Activity.Chat.Pair.SendingPhoto',
    sendMessageUploadVideoAction: 'Peer.Activity.Chat.Pair.SendingVideo',
    sendMessageRecordVideoAction: 'Peer.Activity.Chat.Pair.RecordingVideo',
    sendMessageRecordAudioAction: 'Peer.Activity.Chat.Pair.RecordingAudio',
  },
}

// ═══ AppImManager ═══════════════════════════════════════════════════════════

/** tweb `sidebarLeft/index.ts:110` */
export const LEFT_COLUMN_ACTIVE_CLASSNAME = 'is-left-column-shown'

/** tweb `:182-202` в объёме наших предметов (расхождения 8, 10 шапки). */
export type ChatSetPeerOptions = {
  peerId: PeerId,
  lastMsgId?: number,
  threadId?: number,
  monoforumThreadId?: PeerId,
  commentId?: number,
  type?: ChatType,
  isDeleting?: boolean,
  /** tweb `ChatSearchKeys` (`chat.ts:73`) — у нас из ключей поиска только тег «Избранного» */
  savedReaction?: string
}

/** tweb `:148-165` — расхождение 6 шапки. */
export type ChatSavedPosition = {
  mids: number[],
  top: number
}

/** tweb `:204-207` */
export type ChatSetInnerPeerOptions = Omit<ChatSetPeerOptions, 'peerId' | 'type'> & {
  peerId: PeerId,
  type?: ChatType
}

/** tweb `:209-213` */
export enum APP_TABS {
  CHATLIST,
  CHAT,
  PROFILE,
}

type SamePeerOptions = { peerId: PeerId, threadId?: number, monoforumThreadId?: PeerId, type?: ChatType }

/** Зона подписи и менеджеры её узлов (Н3); `groups` — для «N онлайн» (Н5). */
type StatusOptions = {
  middleware: Middleware,
  managers: PeerTitleManagers & Pick<Managers, 'groups'>
}

type StatusElement = HTMLElement | string | undefined

/** `invokeApiCacheable(..., {cacheSeconds: 60})` у `getChannelParticipants` (Н5). */
const ONLINES_CACHE_SECONDS = 60

/** Тип звонка в подтверждении «покинуть текущий» (tweb `:2269`) — расхождение З4. */
type DiscardCallType = 'Live' | 'Voice' | 'Call'

/** `callsController.currentCall` (З1): закрывающийся звонок (`ended`, у tweb `isClosing`) не в счёт. */
function getCurrentCall() {
  const call = useCallStore.getState().call
  return call && call.phase !== 'ended' ? call : undefined
}

/** tweb `:250` */
class CallSwitchCancelledError extends Error {}

export class AppImManager extends EventListenerBase<{
  chat_changing: (details: { from: Chat, to: Chat }) => void,
  peer_changed: (chat: Chat) => void,
  peer_changing: (chat: Chat) => void,
  tab_changing: (tabId: number) => void,
  premium_toggle: (premium: boolean) => void
}> {
  /** расхождение 1 шапки */
  public columnEl!: HTMLDivElement
  /** `appSidebarLeft.sidebarEl` (расхождение 13 шапки) */
  private columnLeftEl: HTMLElement | null = null
  public chatsContainer!: HTMLElement
  public appChatBackground!: AppChatBackground

  private tabId: APP_TABS | undefined

  public chats: Chat[] = []
  /** tweb `:278` */
  private callTransitions = callTransitionCoordinator
  /** участники для «N онлайн» на время кэша (Н5) */
  private onlinesParticipants = new Map<PeerId, { userIds: number[], expires: number }>()
  /** tweb `:292`, `:846` */
  private chatPositions: { [key: string]: ChatSavedPosition } = {}
  private prevTab: HTMLElement | undefined

  public managers!: Managers

  /** tweb `:288` — пишет `useLockScreenShortcut`, читает `attachKeydownListener` */
  public isShiftLockShortcut = false

  get myId() {
    return rootScope.myId
  }

  get chat(): Chat {
    return this.chats[this.chats.length - 1]
  }

  public construct(managers: Managers) {
    this.managers = managers
    // `:326`
    internalLinkProcessor.construct(managers)
    this.columnEl = document.getElementById('column-center') as HTMLDivElement
    this.columnLeftEl = document.getElementById('column-left')

    void this.selectTab(APP_TABS.CHATLIST)

    // `:349-352`
    const skipLink = document.getElementById('skip-to-content')
    if(skipLink) attachSkipToContent(skipLink, this.columnEl)
    this.setStaticLandmarkLabels()
    rootScope.addEventListener('language_change', this.setStaticLandmarkLabels)

    this.appChatBackground = appChatBackground

    this.chatsContainer = document.createElement('div')
    this.chatsContainer.classList.add('chats-container', 'tabs-container')
    this.chatsContainer.dataset.animation = 'navigation'

    this.columnEl.append(this.chatsContainer)

    this.createNewChat()
    this.chatsSelectTab(this.chat)

    appNavigationController.onHashChange = this.onHashChange

    // `:384-386` — `settings_updated` (расхождение 7)
    this.setSettings()
    useSettingsStore.subscribe((state, prev) => {
      if(state.liteMode !== prev.liteMode || state.loopStickers !== prev.loopStickers) {
        this.setSettings()
      }

      if(state.themeChoice !== prev.themeChoice) {
        void this.applyCurrentTheme()
      }
    })

    // `:388-397`, `:432-433` — признак Premium у нас в карточке `me` зеркала
    const isPremium = () => !!useChatsStore.getState().me?.user.pFlags?.premium
    const onPremiumToggle = (premium: boolean) => {
      if(document.body.classList.contains('is-premium') === premium) {
        return
      }

      document.body.classList.toggle('is-premium', premium)
      this.dispatchEvent('premium_toggle', premium)
    }
    useChatsStore.subscribe(() => onPremiumToggle(isPremium()))
    onPremiumToggle(isPremium())

    void this.applyCurrentTheme({ noSetTheme: true })

    // `:458-467` — fix simultaneous opened both sidebars, can happen when floating sidebar is opened with left sidebar
    mediaSizes.addEventListener('changeScreen', () => {
      if(document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME) &&
        document.body.classList.contains(RIGHT_COLUMN_ACTIVE_CLASSNAME)) {
        void appSidebarRight.toggleSidebar(false)
      }

      this.updateColumnAccessibility()
    })

    // `:479-486`
    const onPeerChanging = (chat: Chat) => {
      this.saveChatPosition(chat)
    }

    const onPeerChanged = () => {
      this.addEventListener('peer_changing', onPeerChanging, { once: true })
    }

    this.addEventListener('peer_changed', onPeerChanged)

    // `:835-843`
    this.addEventListener('peer_changed', ({ peerId }) => {
      document.body.classList.toggle('has-chat', !!peerId)

      this.overrideHash(peerId)
    })

    // `:630`
    useLockScreenShortcut()

    // Глобальный тост приложения (`ui:toast`) — бывший `useGlobalToast` шелла.
    rootScope.addEventListener('ui:toast', (text) => toast(String(text)))

    // расхождение 12 шапки
    if('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
        const d = e.data as { type?: string, chatId?: number } | null
        if(d && d.type === 'open-chat' && d.chatId != null) {
          void this.setInnerPeer({ peerId: d.chatId })
        }
      })
    }

    this.checkForLoginToken()
    this.onHashChange(true)
    this.init()
    this.attachKeydownListener()
    this.attachCopyListener()
  }

  // ── G. Хэш и открытие пиров ─────────────────────────────────────────────

  /** tweb `:1897-1910`; `window[onclick]` оригинала — реестр `addAnchorListener`. */
  public openUrl(url: string, newWindowIfNoClick?: boolean) {
    const { url: wrappedUrl, action } = wrapUrl(url)
    const callback = getAnchorListener(action)
    if(!callback) {
      if(newWindowIfNoClick) {
        window.open(wrappedUrl, '_blank', 'noopener,noreferrer')
      }

      return
    }

    const a = document.createElement('a')
    a.href = wrappedUrl
    return callback(a)
  }

  private onHashChange = (saveState?: boolean) => {
    try {
      this.onHashChangeUnsafe(saveState)
    } catch(err) {
      console.error('hash change error', err)
    }
  }

  private onHashChangeUnsafe = (saveState?: boolean) => {
    const hash = location.hash
    if(!saveState) {
      if(!USE_NAVIGATION_API) {
        appNavigationController.replaceState()
      }
    }

    const splitted = hash.split('?')
    const params = parseUriParams(hash, splitted)
    if(!hash) {
      return
    }

    if(params.tgaddr) {
      appNavigationController.replaceState()
      this.openUrl(params.tgaddr)
      return
    }

    // tweb `switch(splitted[0])` с проваливанием `default` → `'#/im'`: наш tsconfig
    // запрещает fallthrough, поэтому `default` — условием до общей ветки.
    if(splitted[0] !== '#/im') {
      const p = splitted[0].slice(1)
      // Only a username or a peer id is a route. Any other bare fragment (an
      // in-page anchor such as the skip link's #column-center) would otherwise
      // fall through to '#/im' and open a NaN peer.
      if(p[0] !== '@' && !isPeerId(p)) {
        return
      }

      params.p = p
    }

    if(!Object.keys(params).length) {
      return
    }

    const p: string = params.p
    if(!p) {
      return
    }

    const postId = params.post !== undefined ? +params.post : undefined
    const messageId = postId || (params.message !== undefined ? +params.message : undefined)
    const threadId = params.thread !== undefined ? +params.thread : undefined

    switch(p[0]) {
      case '@': {
        void this.openUsername({
          userName: p,
          lastMsgId: messageId,
          threadId,
        })
        break
      }

      default: { // peerId
        const peerId = postId ? -Math.abs(+p) : +p
        void this.managers.peers.getPeers([peerId]).then(([peer]) => {
          return this.op({
            peer,
            lastMsgId: messageId,
            threadId,
          })
        })
        break
      }
    }
  }

  /** tweb `:2050-2060` */
  public async open(options: Omit<Parameters<AppImManager['op']>[0], 'peer'> & { peerId: PeerId }) {
    const [peer] = await this.managers.peers.getPeers([options.peerId])
    return this.op({ ...options, peer })
  }

  /** tweb `:2062-2157` — расхождение 8 шапки */
  public async op(options: { peer: User | MTChat | undefined } & Omit<ChatSetPeerOptions, 'peerId'>) {
    const { peer, ...rest } = options
    if(!peer) {
      return
    }

    const peerId = peerKey(peer)
    // tweb `:2084-2096`: номера из ссылки — серверные, в ленту идут клиентские
    // (`core/history/messageId.ts`, порт `appMessagesIdsManager.generateMessageId`)
    for(const key of ['commentId', 'lastMsgId', 'threadId'] as const) {
      if(rest[key]) rest[key] = generateMessageId(rest[key])
    }
    const { commentId, threadId, lastMsgId } = rest

    // расхождение 8 шапки: вступить в публичный канал, где мы не состоим
    if(peer._ !== 'user' && 'username' in peer && peer.username && !(await this.managers.dialogs.hasDialog(peerId))) {
      try {
        await this.managers.channels.join(peer.username)
      } catch{ /* приватный / уже вступил */ }
      void this.managers.dialogs.refresh().catch(() => { /* список догонит следующий refresh */ })
    }

    const peerIsForum = isForum(peer._ === 'user' || peer._ === 'userEmpty' ? undefined : peer)

    // `:2107-2111` — open forum tab
    if(!commentId && !threadId && !lastMsgId && peerIsForum) {
      void appDialogsManager.toggleForumTabByPeerId(peerId, true, true)
      return
    }

    if(threadId) {
      return this.openThread({ ...rest, peerId, lastMsgId, threadId, isForum: peerIsForum })
    } else if(commentId) {
      // `openComment` (`:2212`) — ручки `getDiscussionMessage` нет, открываем пост
      return this.setInnerPeer({ ...rest, peerId, lastMsgId })
    }

    return this.setInnerPeer({ ...rest, peerId })
  }

  /** tweb `:2165-2181` */
  public openUsername(options: { userName: string } & Omit<ChatSetPeerOptions, 'peerId'>) {
    const { userName, ...rest } = options
    return this.managers.peers.resolveUsername(userName).then((peer) => {
      return this.op({ peer, ...rest })
    }, (err: unknown) => {
      const type = (err as { type?: string } | null)?.type
      if(type === 'USERNAME_NOT_OCCUPIED') {
        toastNew({ langPackKey: 'NoUsernameFound' })
      } else if(type === 'USERNAME_INVALID') {
        toastNew({ langPackKey: 'Alert.UserDoesntExists' })
      } else {
        // наша ветка: отказ сети — не ответ директории (бывший `useUrlSync.toastUsernameError`)
        toastNew({ langPackKey: 'Error.SomethingWentWrong' })
      }
    })
  }

  /** tweb `:2186-2206`: тема форума — `Chat`, тред комментариев — `Discussion`. */
  public openThread(options: Omit<ChatSetPeerOptions, 'type'> & { threadId: number, isForum?: boolean }) {
    const { isForum, ...rest } = options
    return this.setInnerPeer({
      ...rest,
      type: isForum ? ChatType.Chat : ChatType.Discussion,
    })
  }

  /** tweb `:3127-3135` */
  private overrideHash(peerId?: PeerId) {
    let str: string | undefined
    if(peerId) {
      const peer = cachedPeer(peerId)
      const username = peer && 'username' in peer ? peer.username : undefined
      str = username ? '@' + username : '' + peerId
    }

    appNavigationController.overrideHash(str)
  }

  // ── D. Боты, вебапп (`:1024-1609`) ────────────────────────────────────
  //
  // ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ БЛОКА (строки бэклога Б-76, Б-79):
  //  D1. `openWebApp` (`:1200-1331`): ручек `requestWebView`/`requestMainWebView`
  //      (подписанные `initData`, `query_id`), attach-меню ботов
  //      (`getAttachMenuBot`/`toggleBotInAttachMenu` `:1124-1170`) и подтверждений
  //      (`confirmBotWebView*` `:1050-1110`, `appState.confirmedWebViews`) у нас нет:
  //      адрес приложения приходит готовым (кнопка-меню бота `bots.menuButton`), окно —
  //      React `WebAppModal` острова оверлеев (`core/webapp.ts`, ВРЕМЕННО до программы
  //      вебаппа), `startParam` в него не доезжает (его кладёт сервер в `initData`).
  //  D2. `checkForShare` (`:1024-1048`, Web Share Target `apiManagerProxy.share`),
  //      `openJoinChatWebView`/`JoinChatFlow` (`:1333-1392`, бот-страж вступления),
  //      `playGame` (`:1394`), `handleUrlAuth` (`:1419`), `handleAutologinDomains`
  //      (`:1511`), `handlePeerColors` (`:1594`) — предметов нет (бэкенд), не портированы.

  /** tweb `:1200-1331` — расхождение D1. */
  public openWebApp(options: {
    botId: PeerId,
    url: string,
    startParam?: string,
    main?: boolean,
  }) {
    const user = cachedUser(options.botId)
    openWebApp({
      url: options.url,
      botName: getUserTitle(user),
      botId: +options.botId,
    })
  }

  /**
   * НАШЕ РАСШИРЕНИЕ: подтверждение QR-входа. Код в QR — адрес клиента
   * `/qr/<token>` (`auth/cards/SignQRCard.solid.tsx`); у tweb QR-подтверждения нет
   * вовсе (веб не подтверждает вход). Адрес зачищается единственным писателем
   * истории (`overrideAddress`), вопрос задаёт `internalLinkProcessor`.
   */
  private checkForLoginToken() {
    const m = location.pathname.match(/^\/qr\/([\w-]+)$/)
    if(!m) {
      return
    }

    appNavigationController.overrideAddress(new URL('/' + location.hash, location.origin))
    void internalLinkProcessor.processLoginTokenLink(m[1])
  }

  // ── I. Фон, тема, настройки ─────────────────────────────────────────────

  /** tweb `:2607-2627` — обои темы резолвит наш фон сам (расхождение 3 шапки). */
  public setCurrentBackground(broadcastEvent = false, skipAnimation?: boolean): Promise<void> {
    return this.setBackground(broadcastEvent, skipAnimation)
  }

  /** tweb `:2629-2638`; события `background_change` у нас нет — подписчиков у него тоже. */
  public setBackground(_broadcastEvent = true, skipAnimation?: boolean): Promise<void> {
    return this.appChatBackground.setBackground({
      transition: skipAnimation ? 'instant' : 'fade',
    })
  }

  /** tweb `:2640-2678` — расхождение 6 шапки. */
  public saveChatPosition(chat: Chat) {
    if(!([ChatType.Chat, ChatType.Discussion, ChatType.Saved] as ChatType[]).includes(chat.type) || !chat.peerId || !chat.bubbles) {
      return
    }

    const chatBubbles = chat.bubbles
    const key = chat.peerId + (chat.threadId ? '_' + chat.threadId : '')

    const chatPositions = this.chatPositions
    const shouldSavePosition =
      !(chatBubbles.scrollable.getDistanceToEnd() <= 16 && chatBubbles.scrollable.loadedAll.bottom) &&
      chatBubbles.getRenderedLength() &&
      !chatBubbles.savedReaction &&
      chatBubbles.getViewportSlice().invisibleBottom.length // * don't save if we're close to the end (or sponsored is below)

    if(shouldSavePosition) {
      chatBubbles.sliceViewport(true)
      const position: ChatSavedPosition = {
        mids: chatBubbles.getRenderedHistory('desc', true).map((fullMid) => splitFullMid(fullMid).mid),
        top: chatBubbles.scrollable.scrollPosition,
      }
      chatPositions[key] = position
    } else {
      delete chatPositions[key]
    }

    this.chatPositions = chatPositions
  }

  /** tweb `:2680-2688` */
  public getChatSavedPosition(chat: Chat): ChatSavedPosition | undefined {
    if(!([ChatType.Chat, ChatType.Discussion, ChatType.Saved] as ChatType[]).includes(chat.type) || !chat.peerId) {
      return
    }

    const threadId = chat.threadId || chat.monoforumThreadId
    const key = chat.peerId + (threadId ? '_' + threadId : '')
    return this.chatPositions[key]
  }

  // ── H. Звонки (`:2227-2605`) ────────────────────────────────────────────
  //
  // Расхождения блока H с оригиналом:
  //  З1. Движок звонков — наш (`core/calls/*`: 1:1 — `callEngine`, видеочат — mesh
  //      `groupCallEngine`, RTMP-зритель — `livestreamEngine`), состояние — их сторы
  //      (`callStore`, `groupCallStore`, `livestreamStore`) вместо `callsController`/
  //      `groupCallsController`/`rtmpCallsController`. Экраны звонка — React-остров
  //      `#react-overlays` (`CallOverlay`, `GroupCallScreen`, `LivestreamScreen`): они
  //      открываются сами по сторам, поэтому `showCallPopup`/`openRtmpCallViewer` не зовутся.
  //  З2. `callUser` без ветки `phone_calls_private` (`Call.PrivacyErrorMessage`): такого
  //      признака в `userFull` нет — бэкенд гасит `phone_calls_available` и отвечает на
  //      звонок `call_decline reason=privacy` (бэклог Б-96).
  //  З3. `joinGroupCall` без `groupCallId`/`getGroupCallFull` (`VoiceChat.Chat.Ended`/
  //      `StartNew`) и без `getChatFull().call`: полной карточки звонка нет, видеочат идёт,
  //      пока в нём кто-то есть (`groupCallStore.activeByChat`, кадр `group_call_update`), а
  //      заводит его тот же вход движка (`groupCallEngine.joinGroupCall`). Право
  //      `manage_call` — `hasRights(chat, 'just_admin')`: бита `manage_call` у нас нет
  //      (`core/peers/rights.ts`), ближайшее — «создатель или любой админ».
  //  З4. Конференции (`joinConference`/`createConference`, `:2344-2582`) — бэкенда нет
  //      (бэклог Б-46); `discardCurrentCall` поэтому без типа `Conference` и без
  //      параметров `ignore*` — их передаёт только `acceptCallOverride` (Б-95).
  //  З5. `joinLiveStream` — `watchLivestream` регистрирует зрителя без медиа (своего
  //      RTMP-ingest нет, шапка `core/calls/livestreamEngine.ts`); его ошибок нет — ветки
  //      `Error.AnError` тоже.

  /** tweb `:2227-2267` — расхождения З1, З2. */
  public callUser(userId: PeerId, type: CallType): Promise<void> {
    return this.callTransitions.run(async() => {
      const call = getCurrentCall()
      if(call?.peer.id === userId) { // * `callsController.getCallByUserId`
        return
      }

      await this.discardCurrentCall(userId, 'Call')

      const user = cachedUser(userId)
      const name = getUserTitle(user)
      startOutgoing(
        {
          id: userId,
          name,
          avatar: gradientFor(userId),
          avatarText: name.charAt(0).toUpperCase(),
          photoId: user?._ === 'user' ? getPeerPhotoId(user.photo) : 0,
        },
        type === 'video',
      )
    })
  }

  /** tweb `:2269-2274` — расхождение З4. */
  private discardCurrentCall(toPeerId: PeerId, toType: DiscardCallType): Promise<void> {
    if(useGroupCallStore.getState().peerId != null) return this.discardGroupCallConfirmation(toPeerId, toType)
    else if(getCurrentCall()) return this.discardCallConfirmation(toPeerId, toType)
    else if(useLivestreamStore.getState().watchingPeerId != null) return this.discardLiveConfirmation(toPeerId, toType)
    else return Promise.resolve()
  }

  /** tweb `:2276-2299` */
  private async discardAnyCallConfirmation(fromPeerId: PeerId, toPeerId: PeerId, fromType: DiscardCallType, toType: DiscardCallType) {
    // * `wrapPeerTitle` — узел нашего `PeerTitle` живёт, пока открыт попап
    const middlewareHelper = getMiddleware()
    const middleware = middlewareHelper.get()
    const [title1, title2] = [fromPeerId, toPeerId].map((peerId) => new PeerTitle({
      peerId,
      middleware,
      managers: this.managers,
    }).element)

    try {
      await confirmationPopup({
        titleLangKey: `Call.Confirm.Discard.${fromType}.Header`,
        descriptionLangKey: `Call.Confirm.Discard.${fromType}.To${toType}.Text`,
        descriptionLangArgs: [title1, title2],
        button: {
          langKey: 'OK',
        },
      })
    } catch{
      // confirmationPopup rejects when the user cancels/closes it. Give that
      // expected outcome its own identity so a later hangUp/leave rejection
      // is not mistaken for cancellation.
      throw new CallSwitchCancelledError()
    } finally {
      middlewareHelper.destroy()
    }
  }

  /** tweb `:2308-2324` */
  private async discardGroupCallConfirmation(toPeerId: PeerId, toType: DiscardCallType) {
    const currentPeerId = useGroupCallStore.getState().peerId
    if(currentPeerId != null) {
      await this.discardAnyCallConfirmation(currentPeerId, toPeerId, 'Voice', toType)

      if(useGroupCallStore.getState().peerId === currentPeerId) {
        leaveGroupCall()
      }
    }
  }

  /** tweb `:2326-2335` */
  private async discardCallConfirmation(toPeerId: PeerId, toType: DiscardCallType) {
    const currentCall = getCurrentCall()
    if(currentCall) {
      await this.discardAnyCallConfirmation(currentCall.peer.id, toPeerId, 'Call', toType)

      if(getCurrentCall()?.callId === currentCall.callId) { // * `!currentCall.isClosing`
        hangup()
      }
    }
  }

  /** tweb `:2337-2346` */
  private async discardLiveConfirmation(toPeerId: PeerId, toType: DiscardCallType) {
    const currentPeerId = useLivestreamStore.getState().watchingPeerId
    if(currentPeerId != null) {
      await this.discardAnyCallConfirmation(currentPeerId, toPeerId, 'Live', toType)

      if(useLivestreamStore.getState().watchingPeerId === currentPeerId) {
        leaveLivestream()
      }
    }
  }

  /** tweb `:2348-2389` — расхождение З3. */
  public joinGroupCall(peerId: PeerId): Promise<void> {
    return this.callTransitions.run(async() => {
      const hasRights = hasChatRights(cachedChat(peerId), 'just_admin')
      const next = async() => {
        const isCallActive = !!useGroupCallStore.getState().activeByChat[peerId]?.length
        if(!isCallActive && !hasRights) {
          return
        }

        await joinGroupCallEngine(peerId)
      }

      await this.discardCurrentCall(peerId, 'Voice')
      await next()
    })
  }

  /** tweb `:2584-2605` — расхождения З1, З5. */
  public joinLiveStream(peerId: PeerId): Promise<void> {
    return this.callTransitions.run(async() => {
      await this.discardCurrentCall(peerId, 'Live')

      watchLivestream(peerId)
    })
  }

  /** tweb `:2690-2713` */
  public applyCurrentTheme({
    broadcastEvent,
    noSetTheme,
    skipAnimation,
  }: {
    broadcastEvent?: boolean,
    noSetTheme?: boolean,
    skipAnimation?: boolean
  } = {}) {
    if(!noSetTheme) setTheme(resolvePreset(useSettingsStore.getState().themeChoice))

    return this.setCurrentBackground(!!broadcastEvent, skipAnimation)
  }

  /** tweb `:2715-2762` — расхождение 7 шапки */
  private setSettings = () => {
    const { loopStickers } = useSettingsStore.getState()

    document.body.classList.toggle('animation-level-0', !liteMode.isAvailable('animations'))
    document.body.classList.toggle('animation-level-1', false)
    document.body.classList.toggle('animation-level-2', liteMode.isAvailable('animations'))

    // Firefox keeps no-backdrop unconditionally — it renders backdrop-filter poorly.
    document.documentElement.classList.toggle('no-backdrop', !liteMode.isAvailable('blur') || IS_FIREFOX)

    const c: LiteModeKey[] = ['stickers_chat', 'stickers_panel']
    const changedLoop = animationIntersector.setLoop(loopStickers)
    const changedAutoplay = !!c.filter((key) => animationIntersector.setAutoplay(liteMode.isAvailable(key), key)).length
    if(changedLoop || changedAutoplay) {
      animationIntersector.checkAnimations2(false)
    }
  }

  // ── J. Стек чатов и колонки ─────────────────────────────────────────────

  // * не могу использовать тут TransitionSlider, так как мне нужен отрисованный блок рядом
  // * (или под текущим чатом) чтобы правильно отрендерить чат (напр. scrollTop)
  /** tweb `:2766-2805` */
  private chatsSelectTab(chat: Chat, animate?: boolean) {
    const tab = chat.container
    if(this.prevTab === tab) {
      return
    }

    if(animate === false && this.prevTab) { // * will be used for Safari iOS history swipe
      disableTransition([tab, this.prevTab].filter(Boolean))
    }

    if(this.prevTab) {
      this.prevTab.classList.remove('active')

      // ! нужно переделать на animation, так как при лаге анимация будет длиться не 250мс
      if(liteMode.isAvailable('animations') && animate !== false) {
        void dispatchHeavyAnimationEvent(pause(250 + 150), 250 + 150)
      }

      const prevIdx = whichChild(this.prevTab)
      const idx = whichChild(tab)
      if(idx > prevIdx) {
        const found = appNavigationController.findItem((item) => item.context === chat)
        appNavigationController.spliceItems(
          found ? found.index : appNavigationController.getNextIndex(),
          0,
          {
            type: 'chat',
            onPop: (canAnimate) => {
              void this.setPeer({}, canAnimate)
              blurActiveElement()
            },
          },
        )
      }
    }

    tab.classList.add('active')
    this.prevTab = tab
  }

  // ── K. Drag&drop и вставка файлов (`:2807-3125`) ───────────────────────

  /** tweb `:2807-2813` — расхождение K-1 шапки */
  private init() {
    // Follow the active app window so paste-to-send keeps working in a Document PiP window.
    bindActiveWindowListener((w) => w.document, 'paste', this.onDocumentPaste, true)
    this.attachDragAndDropListeners()
  }

  /** tweb `:2815-3035` — расхождения K-2…K-4 шапки */
  private attachDragAndDropListeners() {
    const drops: ChatDragAndDrop[] = []
    let mounted = false, lastDialogElement: HTMLElement | undefined

    function clearLastDialogElement() {
      if(!lastDialogElement) {
        return
      }

      lastDialogElement.classList.remove('is-dragover')
      lastDialogElement = undefined
    }

    const toggle = async(e: DragEvent, mount: boolean) => {
      if(mount === mounted) {
        return
      }

      const _types = e.dataTransfer!.types
      const isFiles = _types.indexOf('Files') >= 0

      const newMediaPopup = getCurrentNewMediaPopup()
      const types = await getFilesFromEvent(e, true)
      if(mount) {
        // * skip dragging text case; зоны внутри открытого попапа — Б-83
        if(!isFiles || !(await this.canDrag()) || newMediaPopup) {
          mount = false
        }

        if(mount === mounted) {
          return
        }
      }

      if(mount && !drops.length) {
        const force = isFiles && !types.length // * can't get file items not from 'drop' on Safari

        // * a .mov counts as media — it gets converted to mp4 in the send popup
        const [foundMedia, foundDocuments] = partition(types, (t) => MEDIA_MIME_TYPES_SUPPORTED.has(t) || t === 'video/quicktime')
        foundDocuments.push(...foundMedia)

        if(foundDocuments.length || force) {
          drops.push(new ChatDragAndDrop(dropsContainer, {
            icon: 'dragfiles',
            header: 'Chat.DropTitle',
            subtitle: 'Chat.DropAsFilesDesc',
            onDrop: (e: DragEvent) => {
              void toggle(e, false)
              void this.onDocumentPaste(e, 'document')
            },
          }))
        }

        if(foundMedia.length || force) {
          drops.push(new ChatDragAndDrop(dropsContainer, {
            icon: 'dragmedia',
            header: 'Chat.DropTitle',
            subtitle: 'Chat.DropQuickDesc',
            onDrop: (e: DragEvent) => {
              void toggle(e, false)
              void this.onDocumentPaste(e, 'media')
            },
          }))
        }

        this.chat.container.append(dropsContainer)
      }

      setTransition({
        element: dropsContainer,
        className: 'is-visible',
        forwards: mount,
        duration: 200,
        onTransitionEnd: () => {
          if(!mount) {
            drops.forEach((drop) => {
              drop.destroy()
            })

            drops.length = 0
          }
        },
      })

      if(mount) {
        drops.forEach((drop) => {
          drop.setPath()
        })
      } else {
        counter = 0
        clearTimeout(dragTimeout)
        clearLastDialogElement()
      }

      getOverlayRoot().classList.toggle('is-dragging', mount)
      mounted = mount
    }

    let counter = 0
    let dragTimeout: number | undefined
    // Drag-and-drop listeners follow the active app window so dropping a file onto the popped-out
    // Document PiP client still sends it (the drag events fire on the PiP body, not the tab's).
    bindActiveWindowListener((w) => w.document.body, 'dragenter', () => {
      ++counter
    })

    bindActiveWindowListener((w) => w.document.body, 'dragover', (e) => {
      void toggle(e, true)
      cancelEvent(e)

      // 'dragover' keeps firing (at least every ~350ms) while a drag is held over the
      // page, and stops the instant the drag leaves the window or is released outside it.
      // For an external file drag there is no in-document source, so neither 'drop' nor
      // 'dragend' fires in that case — without this watchdog the overlay (and the
      // body.is-dragging pointer-events lock) would stay stuck over the chat. Re-arm on
      // every 'dragover' so a lapse force-hides it; a still-active drag re-shows it at once.
      clearTimeout(dragTimeout)
      dragTimeout = window.setTimeout(() => {
        counter = 0
        void toggle(e, false)
      }, 500)

      const target = e.target as HTMLElement
      const dialogElement = findUpClassName(target, 'chatlist-chat')
      if(dialogElement && !dialogElement.dataset.communityId) {
        if(lastDialogElement !== dialogElement) {
          dialogElement.classList.add('is-dragover')
          lastDialogElement = dialogElement
        }
      } else {
        clearLastDialogElement()
      }
    })

    bindActiveWindowListener((w) => w.document.body, 'dragleave', (e) => {
      if(--counter === 0) {
        void toggle(e, false)
      }

      clearLastDialogElement()
    })

    bindActiveWindowListener((w) => w.document.body, 'drop', async(e) => {
      if(lastDialogElement) {
        cancelEvent(e)
        const peerId = +lastDialogElement.dataset.peerId!
        const files = await getFilesFromEvent(e)
        void this.setPeer({
          peerId,
        }).then(() => {
          void this.onDocumentPaste(e, undefined, files)
          clearLastDialogElement()
        })
      }

      void toggle(e, false)
    })

    const dropsContainer = document.createElement('div')
    dropsContainer.classList.add('drops-container')
  }

  /** tweb `:3037-3050` — расхождение K-3 шапки */
  private async canDrag() {
    const chat = this.chat
    const peerId = chat?.peerId
    return !(!peerId || overlayCounter.isOverlayActive || !(await chat.canSend('send_media')))
  }

  /** tweb `:3052-3125` — расхождение K-3 шапки */
  private onDocumentPaste = async(
    e: ClipboardEvent | DragEvent,
    attachType?: WillAttachType,
    files?: File[],
  ) => {
    const newMediaPopup = getCurrentNewMediaPopup()

    if('dataTransfer' in e && e.dataTransfer) { // cross-realm-safe `instanceof DragEvent` (Document PiP window)
      const _types = e.dataTransfer.types
      const isFiles = _types.indexOf('Files') >= 0
      if(isFiles) {
        cancelEvent(e)
      }
    }

    files ??= await getFilesFromEvent(e)
    if(!(await this.canDrag()) && !newMediaPopup) {
      return
    }

    if(!files.length) {
      return
    }

    if(newMediaPopup) {
      newMediaPopup.addFiles(files)
      return
    }

    const chatInput = this.chat.input
    const mimeType = getFileMimeType(files[0])
    chatInput.willAttachType = attachType || ((MEDIA_MIME_TYPES_SUPPORTED.has(mimeType) || mimeType === 'video/quicktime') ? 'media' : 'document')
    showNewMediaPopup(
      this.chat,
      files,
      chatInput.willAttachType,
    )
  }

  /** tweb `:3137-3197` */
  public selectTab(id: APP_TABS, animate?: boolean) {
    if(animate === false) { // * will be used for Safari iOS history swipe
      disableTransition([this.columnLeftEl, this.columnEl, appSidebarRight?.sidebarEl].filter((el): el is HTMLElement => !!el))
    }

    document.body.classList.toggle(LEFT_COLUMN_ACTIVE_CLASSNAME, id === APP_TABS.CHATLIST)

    const prevTabId = this.tabId
    if(prevTabId !== undefined) {
      this.overrideHash(id > APP_TABS.CHATLIST ? this.chat?.peerId : undefined)
      this.dispatchEvent('tab_changing', id)
    }

    let animationPromise: Promise<unknown> = liteMode.isAvailable('animations') ? doubleRaf() : Promise.resolve()
    if(
      prevTabId !== undefined &&
      prevTabId !== id &&
      liteMode.isAvailable('animations') &&
      animate !== false &&
      mediaSizes.activeScreen !== ScreenSize.large
    ) {
      const transitionTime = (mediaSizes.isMobile ? 250 : 200) + 100 // * cause transition time could be > 250ms
      animationPromise = pause(transitionTime)
      void dispatchHeavyAnimationEvent(animationPromise, transitionTime)
    }

    this.tabId = id
    this.updateColumnAccessibility()
    blurActiveElement()
    if(mediaSizes.isMobile && prevTabId === APP_TABS.PROFILE && id < APP_TABS.PROFILE) {
      appSidebarRight.hide()
    }

    if(prevTabId !== undefined && id > prevTabId) {
      if(id < APP_TABS.PROFILE || !appNavigationController.findItemByType('im')) {
        appNavigationController.pushItem({
          type: 'im',
          onPop: (canAnimate) => {
            // this.selectTab(prevTabId, !isSafari);
            void this.setPeer({}, canAnimate)
          },
        })
      }
    }

    return animationPromise
  }

  /** tweb `:3199-3201` (узел левой колонки — расхождение 13 шапки) */
  private setStaticLandmarkLabels = () => {
    setLandmarkLabels(this.columnLeftEl, document.getElementById('column-right'))
  }

  /** tweb `:3203-3208` */
  private updateColumnAccessibility() {
    // On mobile these columns slide outside the viewport but stay mounted.
    // Match their keyboard/AT visibility to the selected screen, including PiP.
    if(this.columnLeftEl) this.columnLeftEl.inert = mediaSizes.isMobile && this.tabId !== APP_TABS.CHATLIST
    if(this.columnEl) this.columnEl.inert = mediaSizes.isMobile && this.tabId !== APP_TABS.CHAT
  }

  // ── F. Хоткеи и защита копирования (расхождение 14 шапки) ───────────────

  /** tweb `:1703-1852` */
  private attachKeydownListener() {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key
      const isSelectionCollapsed = document.getSelection()?.isCollapsed ?? true
      if(
        shouldPreserveKeyboardFocus(e) ||
        overlayCounter.isOverlayActive ||
        !e.isTrusted // * ignore synthetic events
      ) return

      const target = e.target as HTMLElement

      const targetIsInput = isTargetAnInput(target)

      const chat = this.chat
      const input = chat?.input
      if(targetIsInput && target !== input?.messageInput) return

      // Hand keyboard focus to the bubbles scroll container so the browser scrolls it natively.
      // (overflow:auto + outline:none → focus is invisible.)
      const handoffScroll = () => {
        const container = chat?.bubbles?.scrollable?.container
        if(container && document.activeElement !== container) {
          container.focus({ preventScroll: true })
        }
      }

      if(this.isShiftLockShortcut && e.shiftKey) return

      if((key.startsWith('Arrow') || (e.shiftKey && key === 'Shift')) && !isSelectionCollapsed) {
        return
      } else if(e.code === 'KeyC' && (e.ctrlKey || e.metaKey) && !targetIsInput) {
        return
      } else if(
        (key === 'PageUp' || key === 'PageDown') &&
        !targetIsInput &&
        !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
      ) {
        handoffScroll()
        return
      } else if(e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
        cancelEvent(e)
        void this.managers.dialogs.getNextDialog(
          this.chat.peerId,
          key === 'ArrowDown',
          appDialogsManager.filterId,
        ).then((dialog) => {
          if(dialog) {
            void this.setPeer({ peerId: dialog.peerId })
          }
        })
        return
      } else if((key === 'ArrowUp' || key === 'ArrowDown') && this.chat?.type !== ChatType.Scheduled && this.chat?.type !== ChatType.Welcome) {
        // In chats/channels where the user can't post (read-only broadcasts, restricted groups,
        // unjoined chats), there's no message to edit, so let ArrowUp/Down scroll the chat instead.
        if(input && !input.canSendPlain()) {
          handoffScroll()
          return
        }

        // правка последнего / ответ на предыдущее (`:1766-1846`) — Б-80 (F1)
        return
      } else if(key === 'ArrowDown') {
        return
      }

      if(
        input?.messageInput &&
        target !== input.messageInput &&
        !targetIsInput &&
        !IS_TOUCH_SUPPORTED &&
        (!mediaSizes.isMobile || this.tabId === APP_TABS.CHAT) &&
        !chat.selection.isSelecting &&
        // `!chat.input.recording` — расхождение 14 F2
        input.messageInput.isContentEditable
      ) {
        input.passEventToInput(e)
      }
    }

    // Follow the active app window so the global "type anywhere → focus input" + shortcut handler
    // keeps firing when the client is popped into a Document PiP window.
    bindActiveWindowListener((w) => w.document.body, 'keydown', onKeyDown)
  }

  /** tweb `:1854-1895` — restrict copying no forwards content (F4) */
  private attachCopyListener() {
    // Follow the active app window so the restricted-copy guard still fires in a Document PiP window
    // (SECURITY: if it never rebinds there, no-forwards text becomes copyable out of PiP).
    bindActiveWindowListener((w) => w.document, 'copy', (e) => {
      let peerId: PeerId | undefined
      const nodes = getSelectedNodes()
      const foundRestrictedNode = nodes.some((node) => {
        let element = node as HTMLElement | null
        if(node.nodeType !== node.ELEMENT_NODE) {
          element = node.parentElement
        }

        if(!element || !findUpClassName(element, 'no-forwards')) {
          return false
        }

        const bubble = findUpClassName(element, 'bubble')
        if(!bubble) {
          return false
        }

        peerId = Number(bubble.dataset.peerId)
        return true
      })

      if(foundRestrictedNode && peerId !== undefined) {
        e.preventDefault()

        let langPackKey: LangPackKey
        if(isUser(peerId)) {
          langPackKey = 'CopyRestricted.User'
        } else {
          const chat = cachedChat(peerId)
          langPackKey = chat?._ === 'channel' && chat.pFlags?.broadcast ?
            'CopyRestricted.Channel' :
            'CopyRestricted.Group'
        }

        toastNew({ langPackKey })
      }
    })
  }

  /** tweb `:3219-3231` */
  private createNewChat() {
    const chat = new Chat(this, this.managers, true)

    this.chatsContainer.append(chat.container)

    this.chats.push(chat)

    return chat
  }

  /** tweb `:3233-3290` — расхождение 9 шапки */
  private spliceChats(fromIndex: number, justReturn = true, animate?: boolean, spliced?: Chat[]) {
    if(fromIndex >= this.chats.length) return

    // When `spliced` is passed in, the caller already trimmed the stack (so `this.chat` is
    // already the destination); the chat we're actually leaving is the top of `spliced`.
    const chatFrom = spliced?.length ? spliced[spliced.length - 1] : this.chat
    if(this.chats.length > 1 && justReturn) {
      this.dispatchEvent('peer_changing', this.chat)
    }

    if(!spliced) {
      spliced = this.chats.splice(fromIndex, this.chats.length - fromIndex)
    }

    const chatTo = this.chat
    this.dispatchEvent('chat_changing', { from: chatFrom, to: chatTo })

    // * -1 because one item is being sliced when closing the chat by calling .removeByType
    for(let i = 0; i < spliced.length - 1; ++i) {
      appNavigationController.removeByType('chat', true)
    }

    // * fix middle chat z-index on animation
    if(spliced.length > 1) {
      spliced.slice(0, -1).forEach((chat) => {
        chat.container.remove()
      })
    }

    this.chatsSelectTab(chatTo, animate)

    // Re-publish the destination's background when returning to it — the chat we left may have
    // applied its own theme/wallpaper to the global background. Skip when `justReturn` is false:
    // the caller is rebuilding the stack and its recursive `setPeer` publishes the new background.
    if(justReturn && chatTo !== chatFrom && chatTo.peerId) {
      void chatTo.publishBackground(animate === false ? 'auto' : 'crossfade-backwards')
    }

    if(justReturn) {
      this.dispatchEvent('peer_changed', chatTo)

      appSidebarRight.replaceSharedMediaTab(chatTo.sharedMediaTab)
    }

    const toDestroy = spliced
    toDestroy.forEach((chat) => {
      chat.beforeDestroy()
    })

    setTimeout(() => {
      toDestroy.forEach((chat) => {
        chat.destroy()
      })
    }, 250 + 100)
  }

  /** tweb `:3292-3390` — расхождение 9 шапки */
  public async setPeer(options: Partial<ChatSetInnerPeerOptions> = {}, animate?: boolean): Promise<boolean | undefined> {
    options.peerId ??= NULL_PEER_ID

    const { peerId } = options

    const chat = this.chat
    const chatIndex = this.chats.indexOf(chat)
    const isSamePeer = this.isSamePeer(chat, options as SamePeerOptions)
    if(!peerId) {
      if(options.isDeleting) {
        await this.selectTab(APP_TABS.CHATLIST, animate)
        await chat.setPeer(options as ChatSetPeerOptions)
        return
      }

      if(chatIndex > 0) {
        this.spliceChats(chatIndex, undefined, animate)
        return
      } else if(mediaSizes.isFloatingLeftSidebar) {
        void this.selectTab(+!this.tabId, animate)
        return
      }
    } else if(chatIndex > 0 && chat.peerId && !isSamePeer) {
      const spliced = this.chats.splice(1, this.chats.length - 1)
      if(this.chat.peerId === peerId) {
        this.spliceChats(0, true, true, spliced)
        return
      } else {
        const ret = this.setPeer(options)
        this.spliceChats(0, false, false, spliced)
        return ret
      }
    }

    // * don't reset peer if returning
    if(isSamePeer && mediaSizes.activeScreen <= ScreenSize.medium && document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)) {
      void this.selectTab(APP_TABS.CHAT, animate)
      return false
    }

    if(peerId || mediaSizes.activeScreen !== ScreenSize.mobile) {
      const result = await chat.setPeer(options as ChatSetPeerOptions)

      // * wait for cached render
      const promise = result?.cached ? result.promise : Promise.resolve()
      if(peerId) {
        void Promise.all([
          promise,
          this.appChatBackground.getReadyPromise(),
        ]).then(() => {
          setTimeout(() => { // * setTimeout is better here
            setTimeout(() => {
              this.chatsSelectTab(this.chat, undefined)
            }, 0)
            void this.selectTab(APP_TABS.CHAT, animate)
          }, 0)
        })
      }
    }

    if(!peerId) {
      void this.selectTab(APP_TABS.CHATLIST, animate)
      return false
    }
  }

  /** tweb `:3392-3434` */
  public async setInnerPeer(options: ChatSetInnerPeerOptions) {
    const { peerId } = options
    if(peerId === NULL_PEER_ID || !peerId) {
      return
    }

    if(!options.type) {
      if(options.threadId) {
        if(options.peerId === rootScope.myId) {
          options.type = ChatType.Saved
        } else if(!isForum(cachedChat(options.peerId))) {
          options.type = ChatType.Discussion
        }
      }

      options.type ??= ChatType.Chat
    }

    // * reuse current chat
    const existingIndex = this.chats.findIndex((chat) => this.isSamePeer(chat, options) || (mediaSizes.activeScreen === ScreenSize.mobile && this.tabId === 0))
    if(existingIndex !== -1) {
      this.spliceChats(existingIndex + 1)
      return this.setPeer(options)
    }

    const oldChat = this.chat
    let chat = oldChat
    if(oldChat.inited) { // * use first not inited chat
      chat = this.createNewChat()
    }

    this.dispatchEvent('chat_changing', { from: oldChat, to: chat })

    return this.setPeer(options)
  }

  // ── L. Статус и набор (`:3454-3807`) — расхождения Н1–Н6 у таблицы ключей ──

  /** tweb `:3454-3506` без веток стикера и эмодзи (Н2). */
  public getTypingElement(action: SendMessageAction) {
    const el = document.createElement('span')
    let c = 'peer-typing'
    el.classList.add(c)
    el.dataset.action = action._
    switch(action._) {
      case 'sendMessageTypingAction': {
        c += '-text'
        for(let i = 0; i < 3; ++i) {
          const cc = c + '-dot'
          const dot = document.createElement('span')
          dot.className = cc + (i === 0 ? ' ' + cc + '-first' : (i === 2 ? ' ' + cc + '-last' : ''))
          el.append(dot)
        }
        break
      }

      case 'sendMessageUploadAudioAction':
      case 'sendMessageUploadDocumentAction':
      case 'sendMessageUploadVideoAction':
      case 'sendMessageUploadPhotoAction': {
        c += '-upload'
        break
      }

      case 'sendMessageRecordAudioAction':
      case 'sendMessageRecordVideoAction': {
        c += '-record'
        break
      }
    }

    el.classList.add(c)

    return el
  }

  /**
   * tweb `:3508-3675` (Н1, Н3). Возвращает `span.online.peer-typing-container` (либо
   * переиспользует переданный `container`), если пир что-то делает и его можно
   * назвать, иначе `undefined`.
   */
  public getPeerTyping(peerId: PeerId, options: {
    container?: HTMLElement,
    middleware: Middleware,
    managers: PeerTitleManagers,
  }) {
    // * asked for every dialog element that gets built, so the cheap check that
    // * answers "no" for almost every peer goes first
    const typing = useChatsStore.getState().typing[peerId]
    const allTypings = typing ?
      Object.entries(typing).map(([userId, entry]) => ({ userId: +userId, action: entry.action })) :
      []
    if(!allTypings.length) {
      return
    }

    const isUserPeer = isUser(peerId)
    const peer = cachedPeer(peerId)
    if(isUserPeer && peer?._ === 'user' && peer.pFlags?.bot) {
      return
    }

    // * a peer that hasn't reached the mirror yet has no title to render and would be
    // * named "Deleted", so it doesn't get counted either — a private chat never names anyone
    const typings = isUserPeer ?
      allTypings :
      allTypings.filter(({ userId }) => !!cachedPeer(userId))
    if(!typings.length) {
      return
    }

    const first = typings[0]

    // * with exactly two typings there's no point in hiding the second one behind "1 other"
    const isPair = typings.length === 2
    const mapa = isUserPeer ? langPackKeys.private : (isPair ? langPackKeys.pair : (typings.length > 1 ? langPackKeys.multi : langPackKeys.chat))
    let action = first.action

    if(typings.length > 1) {
      const s = new Set(typings.map((typing) => typing.action._))
      if(s.size > 1) {
        action = { _: 'sendMessageTypingAction' }
      }
    }

    const langPackKey = mapa[action._]

    let args: FormatterArguments | undefined
    if(isAnyChat(peerId)) {
      args = typings.slice(0, isPair ? 2 : 1).map((typing) => new PeerTitle({
        peerId: typing.userId,
        onlyFirstName: true,
        middleware: options.middleware,
        managers: options.managers,
      }).element)
      if(!isPair) {
        args.push(typings.length - 1)
      }
    }

    let { container } = options
    if(!container) {
      container = document.createElement('span')
      container.classList.add('online', 'peer-typing-container')
    }

    let typingElement = container.firstElementChild as HTMLElement | null
    if(!typingElement) {
      typingElement = this.getTypingElement(action)
      container.prepend(typingElement)
    } else if(typingElement.dataset.action !== action._) {
      typingElement.replaceWith(this.getTypingElement(action))
    }

    const descriptionElement = i18n(langPackKey, args)
    descriptionElement.classList.add('peer-typing-description')

    if(container.childElementCount > 1) container.lastElementChild!.replaceWith(descriptionElement)
    else container.append(descriptionElement)

    return container
  }

  /** tweb `:3677-3710` (Н5). */
  private getChatStatus(peerId: PeerId, options: StatusOptions & { noTyping?: boolean }): AckedResult<StatusElement> {
    const typingEl = options.noTyping ? undefined : this.getPeerTyping(peerId, options)
    if(typingEl) {
      return { cached: true, result: Promise.resolve(typingEl) }
    }

    const onlinesResult = this.getOnlines(peerId, options.managers)
    return {
      cached: onlinesResult.cached,
      result: onlinesResult.result.then((onlines) => {
        return getChatStatusString(cachedChat(peerId), onlines, (key, args) => I18n.format(key, true, args))
      }),
    }
  }

  /** tweb `:3712-3741` (Н4). */
  private getUserStatus(peerId: PeerId, options: StatusOptions & { ignoreSelf?: boolean }): AckedResult<StatusElement> {
    const result: AckedResult<StatusElement> = {
      cached: true,
      result: Promise.resolve(undefined),
    }

    const user = cachedUser(peerId)
    const real = user?._ === 'user' ? user : undefined
    const status = useChatsStore.getState().presence[peerId] ?? real?.status
    if((!user && !status) || (real?.pFlags?.self && !options.ignoreSelf)) {
      return result
    }

    const subtitle = getUserStatusString(user, status)

    if(!real?.pFlags?.bot && !real?.pFlags?.support) {
      let typingEl = this.getPeerTyping(peerId, options)
      if(!typingEl && status?._ === 'userStatusOnline') {
        typingEl = document.createElement('span')
        typingEl.classList.add('online')
        typingEl.append(subtitle)
      }

      if(typingEl) {
        result.result = Promise.resolve(typingEl)
        return result
      }
    }

    result.result = Promise.resolve(subtitle)
    return result
  }

  /** tweb `:3743-3753` */
  private getPeerStatus(peerId: PeerId, options: StatusOptions & { ignoreSelf?: boolean, noTyping?: boolean }) {
    if(!peerId) return
    if(isAnyChat(peerId)) {
      return this.getChatStatus(peerId, options)
    } else {
      return this.getUserStatus(peerId, options)
    }
  }

  /** tweb `:3755-3803` (Н6). */
  public async setPeerStatus(options: StatusOptions & {
    peerId: PeerId,
    element: HTMLElement,
    needClear: boolean,
    ignoreSelf?: boolean,
    noTyping?: boolean
  }): Promise<(() => unknown) | undefined> {
    const { peerId, element, needClear, middleware } = options

    if(!needClear) {
      // * good good good
      const typingContainer = element.querySelector<HTMLElement>('.peer-typing-container')
      if(typingContainer && this.getPeerTyping(peerId, { ...options, container: typingContainer })) {
        return
      }
    }

    const result = this.getPeerStatus(peerId, options)
    if(!middleware()) {
      return
    }

    const set = async() => {
      const subtitle = result && await result.result
      if(!middleware()) {
        return
      }

      return () => replaceContent(element, subtitle || placeholder)
    }

    const placeholder = '' // * `useWhitespace` (Н6)
    if(!result || result.cached || needClear === undefined) {
      return set()
    } else if(needClear) {
      return () => {
        element.textContent = placeholder
        return set().then((callback) => callback?.())
      }
    }
  }

  /**
   * `appProfileManager.getOnlines` (`appProfileManager.ts:1159-1210`) — Н5. Участников
   * спрашивает фильтром «недавние» (`channelParticipantsRecent`, первая страница из 100),
   * онлайн каждого читает в момент подсчёта (`verifyParticipantForOnlineCount`).
   */
  private getOnlines(peerId: PeerId, managers: Pick<Managers, 'groups'>): AckedResult<number> {
    const minOnline = 1
    const chat = cachedChat(peerId)
    if(isBroadcast(chat) || getParticipantsCount(chat) < 2 || getParticipantsCount(chat) > 100) {
      return { cached: true, result: Promise.resolve(minOnline) }
    }

    const reduce = (userIds: number[]) => {
      const presence = useChatsStore.getState().presence
      return userIds.reduce((acc, userId) => {
        const user = cachedUser(userId)
        const status = presence[userId] ?? (user?._ === 'user' ? user.status : undefined)
        return acc + +(!!user && status?._ === 'userStatusOnline')
      }, 0)
    }

    const cached = this.onlinesParticipants.get(peerId)
    if(cached && cached.expires > Date.now()) {
      return { cached: true, result: Promise.resolve(reduce(cached.userIds)) }
    }

    return {
      cached: false,
      result: managers.groups.channelParticipants(peerId, 0, 100).then((r) => {
        const userIds = (r.participants ?? []).map((p) => 'user_id' in p ? p.user_id : 0).filter(Boolean)
        this.onlinesParticipants.set(peerId, { userIds, expires: Date.now() + ONLINES_CACHE_SECONDS * 1000 })
        return reduce(userIds)
      }, () => minOnline),
    }
  }

  /** tweb `:3809-3816` */
  public isSamePeer(options1: SamePeerOptions, options2: SamePeerOptions) {
    return options1.peerId === options2.peerId &&
      options1.threadId === options2.threadId &&
      options1.monoforumThreadId === options2.monoforumThreadId &&
      (options1.type !== ChatType.Static && options2.type !== ChatType.Static) &&
      (options1.type !== ChatType.Logs && options2.type !== ChatType.Logs) &&
      (typeof(options1.type) !== typeof(options2.type) || options1.type === options2.type)
  }
}

const appImManager = new AppImManager()
if(MOUNT_CLASS_TO) MOUNT_CLASS_TO.appImManager = appImManager
export default appImManager
