// Порт tweb `src/components/chat/chat.ts` (812502980, 1690 строк) — класс `Chat`: инстанс
// стека `appImManager.chats`, владелец шапки (`ChatTopbar`), ленты (`ChatBubbles`),
// композера (`ChatInput`), контекстного меню и выделения. Шаг К-3 ускоренного плана
// волны 7 (`docs/superpowers/plans/2026-10-02-wave-7-carcass-first.md`).
//
// Что портировано (адреса tweb):
//  - конструктор `:233-273`, распорки `:279-370` (`updateChatInputHeight`,
//    `updatePinnedFloatingHeight`, `preservePaddingScroll`, `recomputePaddings`);
//  - фон и `publishBackground` `:372-607` — в объёме нашего фона (расхождение 3);
//  - `init` `:613-835`: подкомпоненты `:616-648`, подписки `:650-709`;
//  - `beforeDestroy`/`destroy`/`cleanup` `:837-879`;
//  - `onChangePeer` `:893-1012`: тип, флаги, `sharedMediaTab`;
//  - `setPeer` `:1035-1156`, `setMessageId` `:1188`, `finishPeerChange` `:1198-1254`;
//  - `getMessage` `:1256`, `_isLikeGroup` `:1308`, `canSend` `:1342`, `isOurMessage`/
//    `isOutMessage` `:1375-1399`, `toggleChatIfMedium`/`pop`/`popIfMoreThanOne` `:1662-1690`.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Пакет параметров отправки (`getMessageSendingParams`, :1378) собирает `ChatInput`
//     (`components/chat/input.ts`, расхождение 1 его шапки).
//  2. Флаги `onChangePeer` — синхронно из зеркала пиров (`core/peerCache.ts`), а не
//     вызовами `appPeersManager`: карточку пира, если её нет, объявляет пробел
//     (`peers.fillMirror`) и ждёт. Нет предметов у `noForwards`, `isRestricted`,
//     `isAnonymousSending`, `isUserBlocked`, `isPremiumRequired`, `starsAmount`,
//     `isMonoforum`/`isBotforum`/`canManage*` (бэкенд их не отдаёт) — полей нет.
//  3. Фон: тема чата — встроенная `ChatTheme` (`chatThemes.ts`) по `theme_emoticon`
//     полной карточки (зеркало `core/chatFullCache.ts`), обоев пира (`wallpaper`) у нас
//     нет. `appChatBackground.setBackground` не знает колбэков одного чата
//     (`onCachedStatus`, `onHighlightColor` в контейнер, `deferReveal` — О-39 шапки
//     `bubbles/chatBackground.solid.tsx`), поэтому `publishBackground` ждёт сам фон, а
//     `revealPreparedBackground` применяет только тему контейнера. Тема контейнера —
//     `applyChatTheme`/`clearChatTheme` (`core/theme/themeController.ts`), а не
//     `themeController.applyTheme(theme, container)`.
//  4. Поиск по чату (`searchSignal`, `TopbarSearch`, `ChatSearchKeys` кроме
//     `savedReaction`) — бэклог Б-20: `initSearch` пуст. Ключ `savedReaction` держит
//     лента (`ChatBubbles.savedReaction`), как до К-3.
//  5. `historyStorage`/`changeHistoryStorageKey` (`:1129-1186`) — у нас окно — зеркало
//     `messagesMirror` по ключу `messagesStorageKey` (`winKey`), подписки воркеру не нужны.
//  6. Первая загрузка ленты повторяется при отказе (`FIRST_LOAD_RETRIES`): у tweb
//     повтор делает транспорт (`networker.resend()`, `mtproto/networker.ts:1701-1716`),
//     под нашим REST такого слоя нет (перенесено из снесённого `VanillaFeed.tsx`).
//  7. Нет предметов: `excludeParts`/`isPreview`/`isStandalone` (превью диалога и
//     самостоятельные чаты), `priceChangedInterceptor`, `dialog_migrate`,
//     `dialog_drop` (события нет: удаление закрывает чат само — `popups/deleteDialog.ts` →
//     `appImManager.setPeer({isDeleting})`), `monoforum_dialogs_drop`, `botforum_pending_topic_created`, `chat_update` →
//     звёзды, `sendReaction` (лента ставит реакции сама, `chat/reactions.ts`),
//     `getMessageSendingParams` (расхождение 1),
//     веб-аппы, автоудаление, `isStartButtonNeeded`.
import { createMemo, createRoot, createSignal, type Accessor, type Signal } from 'solid-js'
import type { Managers } from '@/client/bootstrap'
import type { AppImManager, ChatSetPeerOptions } from '@lib/appImManager'
import { APP_TABS, LEFT_COLUMN_ACTIVE_CLASSNAME } from '@lib/appImManager'
import rootScope from '@lib/rootScope'
import appSidebarRight from '@components/sidebarRight'
import type AppReactProfileTab from '@components/sidebarRight/reactProfileTab'
import animationIntersector, { type AnimationItemGroup } from '@components/animationIntersector'
import appNavigationController from '@core/navigation/appNavigationController'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import { mirrorWindow, winKey } from '@core/history/messagesMirror'
import { cachedChat, cachedPeer, hasRightsPeer, isAnyGroupPeer, isBroadcastPeer, isChannelPeer, isForumPeer, isMegagroupPeer } from '@core/peerCache'
import { isBot } from '@core/peers/predicates'
import { isUser, NULL_PEER_ID } from '@core/peers/peerId'
import type { ChatRights } from '@core/peers/rights'
import { isOurMessage, isOutMessage, type MyMessage } from '@core/models'
import { cachedPeerTheme, subscribeChatFullMirror, type PeerFull } from '@core/chatFullCache'
import { applyChatTheme, clearChatTheme } from '@core/theme/themeController'
import getAutoDownloadSettings, { type ChatAutoDownload } from '@core/chat/autoDownloadSettings'
import { useFullPeer } from '@stores/fullPeers.solid'
import { chatThemeById, type ChatTheme } from '@/chatThemes'
import { PRESET_MODE, resolvePreset } from '@/theme'
import { getChatThemeBackground } from '@/wallpapers'
import { useSettingsStore } from '@/settings'
import type { ChatBackgroundTransition } from '@components/chat/bubbles/chatBackground.solid'
import EventListenerBase from '@helpers/eventListenerBase'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import type middlewarePromise from '@helpers/middlewarePromise'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import { animateSingle } from '@helpers/animation'
import callbackify from '@helpers/callbackify'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import noop from '@helpers/noop'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import ChatBubbles, { PEER_CHANGED_ERROR } from './bubbles'
import ChatContextMenu from './contextMenu'
import ChatInput from './input'
import ChatSelection from './selection'
import ChatTopbar from './topbar'
import { ChatType } from './chatType'

// * after this long an in-flight peer change is treated as abandoned rather than as a reason to
// * ignore further attempts to open the same chat
const STUCK_SET_PEER_TIMEOUT = 15000

/** Расхождение 6 шапки: сколько раз повторить первую загрузку окна и с каким шагом. */
const FIRST_LOAD_RETRIES = 2
const FIRST_LOAD_RETRY_MS = 1000

export type ChatFinishPeerChangeOptions = {
  peerId: PeerId,
  isTarget?: boolean,
  isJump?: boolean,
  lastMsgId?: number,
  middleware: () => boolean
}

export default class Chat extends EventListenerBase<{
  setPeer: (mid: number, isTopMessage: boolean) => void
}> {
  public container: HTMLElement
  public bubblesViewport!: HTMLElement

  public topbar!: ChatTopbar
  public bubbles!: ChatBubbles
  public input!: ChatInput
  public selection!: ChatSelection
  public contextMenu!: ChatContextMenu

  public wasAlreadyUsed?: boolean

  public peerId: PeerId
  public threadId?: number
  public monoforumThreadId?: PeerId
  public peerIdSignal: Signal<PeerId>
  public chatPaddingTop: Signal<number>
  public chatPaddingBottom: Signal<number>

  public setPeerPromise?: Promise<void> | null
  private setPeerPromiseStartedAt = 0
  public peerChanged?: boolean

  public type: ChatType
  public messagesStorageKey = ''

  public inited?: boolean

  public sharedMediaTab?: AppReactProfileTab
  public sharedMediaTabs: AppReactProfileTab[]

  public isBot = false
  public isChannel = false
  public isBroadcast = false
  public isLikeGroup = false
  public isAnyGroup = false
  public isMegagroup = false
  public isForum = false

  public animationGroup: AnimationItemGroup

  /** tweb `:271` — полная карточка пира (`useFullPeer` грузит её и держит свежей по TTL). */
  public fullPeer!: Accessor<PeerFull | undefined>

  public destroyPromise?: CancellablePromise<void>

  public middlewareHelper: MiddlewareHelper
  public destroyMiddlewareHelper: MiddlewareHelper

  /** расхождение 3 шапки — встроенная тема чата вместо облачной `Theme` */
  public currentTheme?: ChatTheme
  public preferredBackgroundTransition?: ChatBackgroundTransition

  /**
   * True while this chat is off-screen on mobile (the chat list or profile tab is shown instead
   * of the chat). A theme that finishes loading in this window must NOT drive the global
   * background. Reset on peer change, re-asserted when the chat returns on screen (see
   * `setBackgroundHidden`). Driven by the `tab_changing` listener.
   */
  private backgroundHidden = false

  // tweb `:1053-1057` — `createEffect` держит поле свежим; у нас — чтение на каждый вызов
  // (расхождение 1 шапки `core/chat/autoDownloadSettings.ts`).
  public get autoDownload(): ChatAutoDownload {
    return getAutoDownloadSettings(this.peerId)
  }

  constructor(
    public appImManager: AppImManager,
    public managers: Managers,
    public isMainChat: boolean,
  ) {
    super()

    this.type = ChatType.Chat
    this.animationGroup = `chat-${Math.round(Math.random() * 65535)}`
    this.middlewareHelper = getMiddleware()
    this.destroyMiddlewareHelper = getMiddleware()

    this.container = document.createElement('div')
    this.container.classList.add('chat', 'tabs-tab')

    this.peerIdSignal = createSignal(this.peerId = NULL_PEER_ID)
    this.chatPaddingTop = createSignal(0)
    this.chatPaddingBottom = createSignal(0)
    this.recomputePaddings()

    this.sharedMediaTabs = []

    createRoot((dispose) => {
      this.destroyMiddlewareHelper.onDestroy(dispose)
      this.fullPeer = createMemo(() => {
        const peerId = this.peerIdSignal[0]()
        return peerId ? useFullPeer(peerId)() : undefined
      })
    })
  }

  private chatInputSurplusPx = 0
  private pinnedFloatingHeightPx = 0
  private preservePaddingScrollAbort?: () => void

  /** tweb `:283-289` */
  public updateChatInputHeight(surplus: number) {
    if(this.chatInputSurplusPx === surplus) return
    this.preservePaddingScroll()
    this.chatInputSurplusPx = surplus
    this.container.style.setProperty('--chat-input-height-surplus', surplus + 'px')
    this.recomputePaddings()
  }

  /** tweb `:291-310` */
  public updatePinnedFloatingHeight(value: number) {
    if(this.pinnedFloatingHeightPx === value) return
    const delta = value - this.pinnedFloatingHeightPx
    this.pinnedFloatingHeightPx = value
    const scrollable = this.bubbles?.scrollable
    const wasAtEnd = scrollable?.isScrolledToEnd
    this.recomputePaddings()
    // Mobile-faithful (verified against iOS ListView + Android ChatActivity):
    // leave a mid-scroll position anchored. Only re-pin when the chat was glued to the bottom,
    // so the newest message stays in view — otherwise the grown paddingTop drifts it off the end.
    if(scrollable && wasAtEnd && delta > 0) {
      scrollable.setScrollPositionSilently(scrollable.scrollPosition + delta)
    }
  }

  /** tweb `:312-337` */
  private preservePaddingScroll() {
    if(!this.bubbles || !this.bubbles.scrollable.isScrolledToEnd) return
    this.preservePaddingScrollAbort?.()
    let finished = false
    const timeout = setTimeout(() => {
      finished = true
    }, 250)
    this.preservePaddingScrollAbort = () => {
      finished = true
      clearTimeout(timeout)
      this.preservePaddingScrollAbort = undefined
    }
    void animateSingle(() => {
      if(finished) {
        return false
      }

      this.bubbles.scrollable.setScrollPositionSilently(99999)
      return true
    }, this.bubbles.scrollable.container)
  }

  /** tweb `:343-345` — hands scroll control to an imminent new-message reveal. */
  public cancelPreservePaddingScroll() {
    this.preservePaddingScrollAbort?.()
  }

  /**
   * tweb `:347-365`. Main chat reserves 4.5rem above + 4rem below for the floating topbar /
   * pinned-plate buffer and the chat-input plate; handhelds collapse both spacers to 3.5rem.
   * Распорки ленты пишет её же `setPaddings` (порт «ленточной» половины: высоты узлов
   * `.bubbles-padding-*` и `rootMargin` липких дат).
   */
  public recomputePaddings() {
    const rem = 16
    const collapse = mediaSizes.isMobile
    const topBase = collapse ? 3.5 : 4.5
    const bottomBase = collapse ? 3.5 : 4
    const top = Math.round(topBase * rem + this.pinnedFloatingHeightPx)
    const bottom = Math.round(bottomBase * rem + this.chatInputSurplusPx)
    this.chatPaddingTop[1](top)
    this.chatPaddingBottom[1](bottom)
    this.bubbles?.setPaddings(top, bottom)
  }

  /** tweb `:367-371` — расхождение 3 шапки. */
  public applyContainerTheme() {
    const preset = resolvePreset(useSettingsStore.getState().themeChoice)
    const variant = this.currentTheme?.[PRESET_MODE[preset]]
    if(variant) {
      applyChatTheme(this.container, preset, variant.accent, variant.messageColors)
    } else {
      clearChatTheme(this.container)
    }
  }

  /** tweb `:373-433` — расхождение 3 шапки. */
  public publishBackground(transition: ChatBackgroundTransition = 'auto'): Promise<void> {
    if(this !== this.appImManager.chat || this.backgroundHidden) {
      return Promise.resolve()
    }

    const finalTransition = this.preferredBackgroundTransition ?? transition
    this.preferredBackgroundTransition = undefined

    return this.appImManager.appChatBackground.setBackground({
      theme: this.currentTheme && getChatThemeBackground(this.currentTheme),
      transition: finalTransition,
    })
  }

  /** tweb `:435-448` */
  private setBackgroundHidden(hidden: boolean) {
    if(this.backgroundHidden === hidden) {
      return
    }

    this.backgroundHidden = hidden
    // Coming back on screen: re-assert our background. A theme that finished loading while we
    // were off-screen had its publish suppressed by `publishBackground`'s guard; surface it now.
    if(!hidden && this === this.appImManager.chat && this.peerId) {
      void this.publishBackground('auto')
    }
  }

  /**
   * tweb `:450-588` — расхождение 3 шапки. Тема — `theme_emoticon` полной карточки
   * (её грузит `this.fullPeer`, как у tweb); перепубликация — на приезд карточки и кадр
   * `chat_theme_update` (подписка на зеркало карточек) и на смену дня/ночи
   * (`theme_changed`). Возвращает колбэк, который `finishPeerChange` применяет вместе с
   * остальными: тему контейнера.
   */
  private _handleBackgrounds(): Promise<() => void> {
    const peerId = this.peerId
    const update = () => {
      const theme = chatThemeById(cachedPeerTheme(peerId))
      const changed = theme !== this.currentTheme
      this.currentTheme = theme
      return changed
    }

    update()

    const unsubscribe = subscribeChatFullMirror(() => {
      if(this.peerId !== peerId || !update()) return
      this.applyContainerTheme()
      void this.publishBackground('auto')
    })
    const onThemeChanged = () => {
      this.applyContainerTheme()
    }
    rootScope.addEventListener('theme_changed', onThemeChanged)
    this.middlewareHelper.get().onClean(() => {
      unsubscribe()
      rootScope.removeEventListener('theme_changed', onThemeChanged)
    })

    return this.publishBackground('auto').then(() => () => this.applyContainerTheme())
  }

  /** tweb `:600-607` — расхождение 3 шапки: слотов фона для отложенного показа у нас нет. */
  public revealPreparedBackground() {}

  /** tweb `:600-611` */
  private handleBackgrounds(): Promise<() => void> {
    return createRoot((dispose) => {
      this.middlewareHelper.get().onClean(dispose)
      return this._handleBackgrounds()
    })
  }

  public setType(type: ChatType) {
    this.type = type
  }

  /** tweb `:613-835` — расхождения 4, 7 шапки. */
  public init() {
    this.topbar = new ChatTopbar(this, appSidebarRight, this.managers)
    this.bubbles = new ChatBubbles(this, this.managers)
    this.input = new ChatInput(this, this.appImManager, this.managers, 'chat-input-main')
    this.contextMenu = new ChatContextMenu(this, this.managers)
    // менеджер прав (`cantForwardDeleteMids`) — нет предмета, задача #73 (`selection.ts`)
    this.selection = new ChatSelection(this, this.bubbles, this.input, { messages: {} })

    this.topbar.constructPeerHelpers()

    this.topbar.construct()
    this.input.construct()

    this.input.constructPeerHelpers()

    if(!IS_TOUCH_SUPPORTED) {
      this.bubbles.setReactionsHoverListeners()
    }

    this.bubbles.attachContainerListeners()

    this.bubblesViewport = document.createElement('div')
    this.bubblesViewport.classList.add('bubbles-viewport', 'disable-hover')

    this.container.append(this.topbar.container, this.bubbles.container, this.bubblesViewport, this.input.chatInput)
    this.recomputePaddings()

    // Spacer heights depend on the screen (desktop reserves a wider floating-plate buffer
    // than handheld), so recompute them when crossing the mobile boundary. See recomputePaddings().
    this.bubbles.listenerSetter.add(mediaSizes)('changeScreen', () => {
      this.recomputePaddings()
    })

    const freezeObservers = (freeze: boolean) => {
      // `observer.toggleObservingNew` (:715) не портирован в нашем
      // `superIntersectionObserver.ts` (его шапка) — замораживается только группа анимаций.
      const cb = () => {
        animationIntersector.toggleIntersectionGroup(this.animationGroup, freeze)
        if(freeze) {
          animationIntersector.checkAnimations(freeze, this.animationGroup)
        }
      }

      if(!freeze) {
        setTimeout(() => {
          cb()
        }, 400)
      } else {
        cb()
      }
    }

    this.bubbles.listenerSetter.add(this.appImManager)('chat_changing', ({ to }) => {
      freezeObservers(to !== this)
    })

    this.bubbles.listenerSetter.add(this.appImManager)('tab_changing', (tabId) => {
      const offScreenOnMobile = tabId !== APP_TABS.CHAT && mediaSizes.activeScreen === ScreenSize.mobile
      freezeObservers(this.appImManager.chat !== this || offScreenOnMobile)
      this.setBackgroundHidden(offScreenOnMobile)
    })
  }

  /** tweb `:837-841` */
  public beforeDestroy() {
    this.destroyPromise = deferredPromise()
    this.bubbles?.cleanup()
  }

  /** tweb `:843-869` */
  public destroy() {
    this.destroyPromise?.resolve?.()
    this.destroySharedMediaTab()
    this.topbar?.destroy()
    this.bubbles?.destroy()
    this.input?.destroy()
    this.contextMenu?.destroy()
    this.selection?.attachListeners(undefined, undefined)
    this.destroyMiddlewareHelper.destroy()
    // * The per-peer helper too, not just the destroy-scoped one: the roots hung off it - the
    // * theme_changed subscription among them - are disposed by its clean/destroy, and nothing else
    // * ever calls it once the chat is gone.
    this.middlewareHelper.destroy()

    this.container.remove()
  }

  /** tweb `:871-879` — расхождение 4 шапки (поиска нет). */
  public cleanup(helperToo = true) {
    this.input?.cleanup(helperToo)
    this.topbar?.cleanup()
    this.selection?.cleanup()
  }

  public get isForumTopic() {
    return !!(this.isForum && this.threadId)
  }

  /** tweb `:893-1012` — расхождение 2 шапки. */
  public async onChangePeer(options: Partial<ChatSetPeerOptions>, m: ReturnType<typeof middlewarePromise>) {
    const { peerId, threadId } = this

    // расхождение 2: карточка пира должна лежать в зеркале до флагов ниже
    if(!cachedPeer(peerId)) {
      await m(this.managers.peers.fillMirror([peerId]))
    }

    const isForum = isForumPeer(peerId)

    if(threadId && !isForum) {
      options.type = peerId === rootScope.myId ? ChatType.Saved : ChatType.Discussion
    }

    const type = options.type ?? ChatType.Chat
    this.setType(type)

    this.isLikeGroup = this._isLikeGroup(peerId)
    this.isAnyGroup = isAnyGroupPeer(peerId)
    this.isMegagroup = isMegagroupPeer(peerId)
    this.isBroadcast = isBroadcastPeer(peerId)
    this.isChannel = isChannelPeer(peerId)
    this.isBot = isBot(cachedPeer(peerId))
    this.isForum = isForum

    if(this.selection) {
      this.selection.isScheduled = type === ChatType.Scheduled
    }

    this.messagesStorageKey = winKey(this.peerId, this.threadId)

    this.sharedMediaTab = appSidebarRight.createSharedMediaTab()
    this.sharedMediaTabs.push(this.sharedMediaTab)
    this.sharedMediaTab.setPeer(peerId, threadId)

    this.input?.clearHelper() // костыль
    this.selection?.cleanup() // TODO: REFACTOR !!!!!!
  }

  /** tweb `:1035-1156` — расхождения 4, 5, 6 шапки. */
  public setPeer(options: ChatSetPeerOptions): Promise<{ cached: boolean, promise: Promise<void> } | null> | undefined {
    const { peerId, threadId, monoforumThreadId } = options
    if(!peerId) {
      this.inited = undefined
    } else if(!this.inited) {
      this.init()
      this.inited = true
    }

    const samePeer = this.appImManager.isSamePeer(this, options)
    if(!samePeer) {
      this.appImManager.dispatchEvent('peer_changing', this)
      this.peerIdSignal[1](this.peerId = peerId || NULL_PEER_ID)
      this.threadId = threadId
      this.monoforumThreadId = monoforumThreadId
      // `onChangePeer` (async) only assigns `isForum` later. Set it synchronously here too so
      // listeners don't compare the new peer against a stale `isForum` mid-transition.
      this.isForum = isForumPeer(this.peerId)
      this.middlewareHelper.clean()
      // A fresh peer change always shows the chat next, so its background must publish normally;
      // the off-screen suppression only guards a stale load from a peer we've already left.
      this.backgroundHidden = false
    } else if(this.setPeerPromise && (Date.now() - this.setPeerPromiseStartedAt) < STUCK_SET_PEER_TIMEOUT) {
      // Deduplicating a peer change that is already in flight is only correct while that change can
      // still finish. Past the deadline, fall through and start a fresh change — `bubbles.setPeer`
      // bumps `setPeerTempId`, which invalidates the abandoned flow.
      return
    }

    if(!peerId) {
      this.peerIdSignal[1](this.peerId = NULL_PEER_ID)
      let promise: Promise<void> | undefined

      if(this === this.appImManager.chat) {
        this.currentTheme = undefined
        promise = this.publishBackground('auto')
      }

      void callbackify(promise, () => {
        void appSidebarRight.toggleSidebar(false)
        this.cleanup(true)
        void this.bubbles?.setPeer({ ...options, samePeer: false })
        this.appImManager.dispatchEvent('peer_changed', this)

        appSidebarRight.replaceSharedMediaTab()
        this.destroySharedMediaTab()
        this.sharedMediaTab = undefined
      })

      return
    }

    this.peerChanged = samePeer

    const bubblesSetPeerPromise = this.setBubblesPeer(options, samePeer)
    this.setPeerPromiseStartedAt = Date.now()
    const setPeerPromise: Promise<void> = this.setPeerPromise = bubblesSetPeerPromise.then((result) => {
      return result?.promise
    }).catch(noop).finally(() => {
      if(this.setPeerPromise === setPeerPromise) {
        this.setPeerPromise = null
      }
    })

    return bubblesSetPeerPromise
  }

  /** Расхождение 6 шапки — `bubbles.setPeer` с повтором первой загрузки окна. */
  private setBubblesPeer(options: ChatSetPeerOptions, samePeer: boolean, attempt = 0): ReturnType<ChatBubbles['setPeer']> {
    const promise = this.bubbles.setPeer({ ...options, samePeer })
    if(samePeer) {
      return promise
    }

    const { peerId, threadId } = options
    return promise.then((result) => {
      if(!result) return result
      return {
        ...result,
        promise: result.promise.catch((err: unknown) => {
          if(err === PEER_CHANGED_ERROR || attempt >= FIRST_LOAD_RETRIES || this.peerId !== peerId || this.threadId !== threadId || !this.bubbles) {
            throw err
          }

          return new Promise<void>((resolve, reject) => {
            setTimeout(() => {
              if(this.peerId !== peerId || this.threadId !== threadId || !this.bubbles) {
                reject(err)
                return
              }

              this.peerChanged = false
              void this.setBubblesPeer(options, false, attempt + 1)
                .then((next) => next?.promise)
                .then(resolve, reject)
            }, FIRST_LOAD_RETRY_MS * (attempt + 1))
          })
        }),
      }
    })
  }

  /** tweb `:1178-1185` */
  public destroySharedMediaTab(tab = this.sharedMediaTab) {
    if(!tab) {
      return
    }

    indexOfAndSplice(this.sharedMediaTabs, tab)
    tab.destroy()
  }

  /** tweb `:1188-1196` */
  public setMessageId(options: Partial<Pick<ChatSetPeerOptions, 'lastMsgId' | 'type'>> & { savedReaction?: string } = {}) {
    return this.setPeer({
      peerId: this.peerId,
      threadId: this.threadId,
      monoforumThreadId: this.monoforumThreadId,
      ...options,
    })
  }

  /** tweb `:1198-1254` */
  public async finishPeerChange(options: ChatFinishPeerChangeOptions) {
    if(this.peerChanged) return

    this.peerChanged = true
    this.wasAlreadyUsed = true

    const { middleware } = options

    this.cleanup(false)

    const sharedMediaTab = this.sharedMediaTab

    const callbacks = await Promise.all([
      this.topbar?.finishPeerChange(options),
      this.bubbles?.finishPeerChange(),
      this.input?.finishPeerChange(options),
      sharedMediaTab?.fillProfileElements(),
      this.handleBackgrounds(),
    ])

    sharedMediaTab?.loadSidebarMedia(true)

    if(!middleware()) {
      return
    }

    callbacks.forEach((callback: unknown) => {
      if(typeof callback === 'function') callback()
    })

    if(sharedMediaTab) {
      appSidebarRight.replaceSharedMediaTab(sharedMediaTab)
      this.sharedMediaTabs.filter((tab) => tab !== sharedMediaTab).forEach((tab) => this.destroySharedMediaTab(tab))
    }

    this.container.dataset.type = this.type === ChatType.Search ? 'chat' : this.type
    this.container.classList.toggle('can-click-date', [ChatType.Chat, ChatType.Discussion, ChatType.Saved].includes(this.type))

    if(this.isMainChat) {
      this.appImManager.dispatchEvent('peer_changed', this)
    }
  }

  /** tweb `:1256-1271` — окно зеркала по ключу инстанса (расхождение 5 шапки). */
  public getMessage(mid: number): MyMessage | undefined {
    return mirrorWindow(this.messagesStorageKey)?.find((message) => message.id === mid)
  }

  /** tweb `:1308-1322` — `isLikeGroup` пира: «Избранное» и любая группа. */
  public _isLikeGroup(peerId: PeerId) {
    if(peerId === rootScope.myId) return true

    return isAnyGroupPeer(peerId)
  }

  /** tweb `:1333-1340` — расхождение 4 шапки. */
  public initSearch(_options: { query?: string, filterPeerId?: PeerId } = {}): void {}

  /**
   * tweb `:1342-1353` → `appMessagesManager.canSendToPeer` (`:8851-8863`): у чата —
   * `hasRights`, у пользователя — `canSendToUser` (не портирован: признака блокировки на
   * клиенте нет, оригинал обычному собеседнику отвечает «можно»).
   */
  public canSend(action: ChatRights = 'send_messages'): Promise<boolean> {
    if(this.type === ChatType.Saved && this.threadId !== this.peerId) {
      return Promise.resolve(false)
    }

    if(isUser(this.peerId)) {
      return Promise.resolve(true)
    }

    return Promise.resolve(!!cachedChat(this.peerId) && hasRightsPeer(this.peerId, action))
  }

  /** tweb `:1375-1397` — `core/models.ts::isOurMessage` */
  public isOurMessage(message: MyMessage) {
    return isOurMessage(message, { myId: rootScope.myId, isMegagroup: this.isMegagroup })
  }

  /** tweb `:1399-1403` */
  public isOutMessage(message: MyMessage) {
    return isOutMessage(message, { myId: rootScope.myId, isMegagroup: this.isMegagroup })
  }

  /** tweb `:1662-1669` */
  public toggleChatIfMedium() {
    if(mediaSizes.activeScreen === ScreenSize.medium && document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)) {
      void this.appImManager.setPeer({ peerId: this.peerId })
      return true
    }

    return false
  }

  /** tweb `:1671-1676` */
  public pop() {
    if(this.toggleChatIfMedium()) return

    const isFirstChat = this.appImManager.chats.indexOf(this) === 0
    appNavigationController.back(isFirstChat ? 'im' : 'chat')
  }

  /**
   * tweb `:1678-1689` — returns false if this is the only chat
   */
  public popIfMoreThanOne() {
    if(this.toggleChatIfMedium()) return true

    const isFirstChat = this.appImManager.chats.indexOf(this) === 0
    if(isFirstChat) return false

    appNavigationController.back('chat')
    return true
  }
}
