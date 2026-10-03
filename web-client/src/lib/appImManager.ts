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
//         `setInnerPeer` `:3392-3434`, `openScheduled` `:3436`, `chatsSelectTab` `:2766-2805`,
//         `isSamePeer` `:3809`;
//  G    — `overrideHash` `:3127`, `onHashChange` `:1912-2031`, `open`/`op` `:2050-2157`,
//         `openUsername` `:2165`, `openThread` `:2186`, `openUrl` `:1897`;
//  I    — `setCurrentBackground`/`setBackground`/`applyCurrentTheme` `:2607-2713`,
//         `setSettings` `:2715-2762`;
//  C    — `construct` (`:324-1018`) в объёме предметов, которые у нас есть.
// Статус набора (`getTypingElement`/`getPeerTyping`, блок L) — функции модуля ниже
// класса, как было до К-2 (их зовёт строка чатлиста); в класс их переносит П-4.
//
// Инстанс стека — класс `Chat` (`components/chat/chat.ts`, шаг К-3): `createNewChat`
// строит `new Chat(this, managers, true)` (tweb `:3220`). Позицию ленты (`chatPositions`,
// `saveChatPosition`/`getChatSavedPosition`, `:2640-2688`) держит класс, как у tweb.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. `columnEl` берётся в `construct`, а не инициализатором поля: модуль
//     импортируется тестами и соседями до того, как в документе есть `#column-center`.
//  2. Ссылка «пропустить к чату» и имена ориентиров (`attachSkipToContent`,
//     `setStaticLandmarkLabels`, `:349-352`, `:3199-3201`) не портированы: ключей
//     `AccDescr.*` в нашем лангпаке нет — бэклог Б-47. `inert` колонок
//     (`updateColumnAccessibility`) — портирован.
//  3. Нет предмета у подписок `construct`: `internalLinkProcessor` (Б-8),
//     `appMediaPlaybackController.construct` (у нас модуль без конструктора),
//     `idleController` → `updateStatus`/`goOffline` (Б-14), предкэш обоев
//     `SETTINGS_INIT.themes` (наш фон резолвит обои сам), `chatTips` (Б-13),
//     `join_chat_webview_decision`/звонки/`topbarCall` (П-4); `chatAudio` — портирован (П-5),
//     `peer_typings` (эмодзи-интеракций нет), `peer_title_edit` (события нет),
//     `message_error` слоумода (П-6), `ephemeral_*`/`service_notification`/…
//     (Б-16), `singleInstance`/t.me (Б-17), хоткеи/копирование/autologin/цвета
//     пиров/шаринг/drag&drop (Б-9, Б-24, П-4), `savedReactionTags`.
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
//  8. Хэш: `tgaddr` и чужие действия уходят в `openUrl` → `openSearchUrl`
//     (исполнителя внутренних ссылок нет, Б-8); `story`/`community`/`call` в
//     `#/im` — нет предметов. `op()` без `migrated_to` и ботфорума. В канал, где мы не состоим, `op()` ВСТУПАЕТ: наш
//     `GET /chats/{id}/history` не-участнику отдаёт 403 (перенесено из прежнего
//     `useUrlSync.applyHash`, долг — `docs/readiness/port-divergences.md`).
//  9. `setPeer` без `getPeerMigratedTo` и `min`-пиров (`:3293-3317`) — в нашей
//     модели их нет; `spliceChats` не закрывает `AppPrivateSearchTab` (вкладки нет).
// 10. `callUser` (`:2227`) — без `callTransitions`/`phone_calls_private`: наш движок
//     звонков (`core/calls/callEngine.ts::startOutgoing`) берёт карточку собеседника.
// 11. `notificationBuild` (`:805-822`) — `client/uiNotifications.ts` спрашивает
//     `appImManager.chat` сам; звук отправки (`:857-877`) — `soundSubscriber.ts`.
// 12. Клик по системному уведомлению (`sw.js` → `open-chat`) открывает чат здесь
//     (у tweb — `uiNotificationsManager` через `appImManager.setInnerPeer`).
// 13. Узел левой колонки — `#column-left` из документа, а не `appSidebarLeft.sidebarEl`:
//     модуль класса колонки тянет за собой поиск и регистрирует custom elements при
//     импорте, а `appImManager` импортируют и лёгкие подписчики (`uiNotifications`,
//     `soundSubscriber`). Узел тот же (`sidebarLeft/index.ts`, `super({sidebarEl})`).
import PeerTitle, { type PeerTitleManagers } from '@components/chat/peerTitle'
import { generateMessageId } from '@core/history/messageId'
import type { Middleware } from '@helpers/middleware'
import { i18n, type FormatterArguments } from '@lib/langPack'
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
import { isForum } from '@core/peers/predicates'
import { setTheme } from '@core/theme/themeController'
import { useAutoLock } from '@core/hooks/useAutoLock'
import { useLockScreenShortcut } from '@core/hooks/useLockScreenShortcut'
import { openSearchUrl } from '@core/hooks/openSearchUrl'
import animationIntersector from '@components/animationIntersector'
import appChatBackground, { type AppChatBackground } from '@components/chat/bubbles/chatBackground.solid'
import { ChatType } from '@components/chat/chatType'
import Chat from '@components/chat/chat'
import createChatAudio, { type ChatAudioController } from '@components/chat/audio.solid'
import { splitFullMid } from '@components/chat/bubbles'
import { startOutgoing } from '@core/calls/callEngine'
import { getUserTitle } from '@core/peers/getPeerTitle'
import { getPeerPhotoId } from '@core/peers/peer'
import { gradientFor } from '@core/dialogToChat'
import appSidebarRight, { RIGHT_COLUMN_ACTIVE_CLASSNAME } from '@components/sidebarRight'
import appDialogsManager from '@lib/appDialogsManager'
import { toast, toastNew } from '@components/toast'
import rootScope from '@lib/rootScope'
import { useSettingsStore } from '@/settings'
import { resolvePreset } from '@/theme'

// ═══ СТАТУС НАБОРА (блок L, `:3454-3675`) ═══════════════════════════════════
//
// Расхождения статуса набора с оригиналом:
//  Н1. Набор пира — синхронно из зеркала `chatsStore.typing` (мост чтения п. 2 плана
//      волны 7), а не `appProfileManager.getPeerTypings`; срок жизни записи ведёт
//      проектор (`client/realtime/storeProjection.ts`, `TYPING_TTL`). Бот — по
//      `pFlags.bot` карточки зеркала (`appUsersManager.isBot`).
//  Н2. Таблица ключей — только действия, которые производит наш клиент
//      (`core/realtime/events.ts::SendMessageAction`): игры, стикеры, кружки и
//      эмодзи-интеракции на проводе не бывают, их ключей и веток
//      (`peer-typing-choosing-sticker`, `peer-typing-flex`) нет.
//  Н3. Имя печатающего — узел нашего `PeerTitle` (синхронный, сам перерисуется,
//      когда карточка доедет); ему нужны зона и менеджеры — они приходят опцией.

/** tweb `:3454-3506` без веток стикера и эмодзи (Н2). */
export function getTypingElement(action: SendMessageAction) {
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

/** Набор пира из зеркала: кто и что делает (Н1). */
function getPeerTypings(peerId: PeerId) {
  const typing = useChatsStore.getState().typing[peerId]
  return typing ?
    Object.entries(typing).map(([userId, entry]) => ({ userId: +userId, action: entry.action })) :
    []
}

/**
 * tweb `:3508-3675`. Возвращает `span.online.peer-typing-container` (либо
 * переиспользует переданный `container`), если пир что-то делает и его можно
 * назвать, иначе `undefined`.
 */
export function getPeerTyping(peerId: PeerId, options: {
  container?: HTMLElement,
  middleware: Middleware,
  managers: PeerTitleManagers,
}) {
  // * asked for every dialog element that gets built, so the cheap check that
  // * answers "no" for almost every peer goes first
  const allTypings = getPeerTypings(peerId)
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

  const typing = typings[0]

  // * with exactly two typings there's no point in hiding the second one behind "1 other"
  const isPair = typings.length === 2
  const mapa = isUserPeer ? langPackKeys.private : (isPair ? langPackKeys.pair : (typings.length > 1 ? langPackKeys.multi : langPackKeys.chat))
  let action = typing.action

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
    typingElement = getTypingElement(action)
    container.prepend(typingElement)
  } else if(typingElement.dataset.action !== action._) {
    typingElement.replaceWith(getTypingElement(action))
  }

  const descriptionElement = i18n(langPackKey, args)
  descriptionElement.classList.add('peer-typing-description')

  if(container.childElementCount > 1) container.lastElementChild!.replaceWith(descriptionElement)
  else container.append(descriptionElement)

  return container
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
/** tweb `:148-165`: позиция ленты и/или подсказка плашки закрепа (`pinnedMessages`). */
export type ChatSavedPosition = {
  mids?: number[],
  top?: number,
  pinnedMessages?: { mid: number, index: number, count: number }
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
  /** tweb `:290` */
  public chatAudio?: ChatAudioController
  /** tweb `:292`, `:846` */
  private chatPositions: { [key: string]: ChatSavedPosition } = {}
  private prevTab: HTMLElement | undefined

  public managers!: Managers

  get myId() {
    return rootScope.myId
  }

  get chat(): Chat {
    return this.chats[this.chats.length - 1]
  }

  public construct(managers: Managers) {
    this.managers = managers
    this.columnEl = document.getElementById('column-center') as HTMLDivElement
    this.columnLeftEl = document.getElementById('column-left')

    void this.selectTab(APP_TABS.CHATLIST)

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

    // `:854-855` — плашка аудиоплеера над колонкой (П-5, Б-22)
    this.chatAudio = createChatAudio(this, managers)
    this.columnEl.append(this.chatAudio.container)

    // `:630` и автоблокировка (`lib/mainWorker/useAutoLock.ts` у tweb — в воркере)
    useLockScreenShortcut()
    useAutoLock()

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

    this.onHashChange(true)
  }

  // ── G. Хэш и открытие пиров ─────────────────────────────────────────────

  /** tweb `:1897-1910` — расхождение 8 шапки */
  public openUrl(url: string) {
    openSearchUrl(url)
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
      return this.openComment({ peerId, msgId: lastMsgId!, commentId })
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

  /**
   * tweb `:2208-2224` — комментарий прямо из канала: тред адресуется номером
   * ЗЕРКАЛА поста в группе обсуждения (`getDiscussionMessage`), тем же, которым
   * его открывает клик по футеру поста (`bubbles.openDiscussion`), — окно одно.
   */
  public openComment(options: { peerId: PeerId, msgId: number, commentId: number }) {
    return this.managers.messages.getDiscussionMessage(options.peerId, options.msgId).then((message) => {
      if(!message) return
      return this.openThread({
        peerId: message.peerId,
        lastMsgId: options.commentId,
        threadId: message.id,
      })
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
    const pinnedMessages = chat.topbar?.pinnedMessage?.pinnedMessages
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
        pinnedMessages,
      }
      chatPositions[key] = position
    } else if(pinnedMessages) {
      // Position itself isn't worth restoring, but the pinned hint is —
      // keep it so the next prepareInitial paints the plate with the
      // real count/index instead of the fullPeer fallback (count=1).
      chatPositions[key] = { pinnedMessages }
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

  /** tweb `:2227-2290` — расхождение 10 шапки. */
  public callUser(userId: PeerId, type: 'voice' | 'video') {
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

  /** tweb `:3203-3208` */
  private updateColumnAccessibility() {
    // On mobile these columns slide outside the viewport but stay mounted.
    // Match their keyboard/AT visibility to the selected screen, including PiP.
    if(this.columnLeftEl) this.columnLeftEl.inert = mediaSizes.isMobile && this.tabId !== APP_TABS.CHATLIST
    if(this.columnEl) this.columnEl.inert = mediaSizes.isMobile && this.tabId !== APP_TABS.CHAT
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

  /** tweb `:3436-3441` — лента отложенных пира (`ChatType.Scheduled`) поверх чата */
  public openScheduled(peerId: PeerId) {
    void this.setInnerPeer({
      peerId,
      type: ChatType.Scheduled,
    })
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
