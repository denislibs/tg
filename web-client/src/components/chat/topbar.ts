// Порт tweb `src/components/chat/topbar.ts` (812502980, 1873 строки) — ЯДРО шапки чата,
// шаг К-3 ускоренного плана волны 7 (`docs/superpowers/plans/2026-10-02-wave-7-carcass-first.md`).
//
// Что портировано:
//  - `construct` (`:132-307`): `.sidebar-header.topbar`, стрелка «назад» с бейджем
//    непрочитанного, `.chat-info-container` → `.chat-info` → `.person` → `.content`
//    (`.top` → `.user-title`, `.bottom` → `.info`), `.chat-utils`, `.topbar-floating-plates`;
//    клик по шапке → `appSidebarRight.toggleSidebar` (`:259-286`), «назад» → `chat.pop()`
//    (`:288-306`);
//  - `constructPeerHelpers` (`:1030-1175`) в объёме подписи, бейджа «назад» и кнопок
//    звонка (`btnCall`/`btnGroupCall`/`btnGroupCallMenu`, `:1039-1060`, пачка П-4);
//  - проверка кнопок (`pushButtonToVerify`/`verifyButtons` `:309-338`,
//    `verifyRtmpButton`/`verifyVideoChatButton`/`verifyCallButton` `:340-415`),
//    `onCallClick`/`onJoinGroupCallClick` (`:969-998`) — пачка П-4;
//  - `finishPeerChange` (`:1383-1549`): аватар, заголовок, статус; `cleanup`/`destroy`
//    (`:1238-1254`);
//  - `setTitleManual`/`setTitle` (`:1550-1641`), `messagesCounter` (`:1685-1716`),
//    `createStatus` (`:1718-1845`).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Меню ⋮ и лупа поиска (`constructUtils` `:462-903`, `verifyIfCan*` `:417-461`) —
//     бэклог Б-18/Б-20; в `.chat-utils` пока только кнопки звонка.
//  2. Плашки (`createTopbarPlates`, `:180`, `:1093-1131`), закреп (`setupPinnedMessageForPeer`/
//     `revealPreparedPinnedMessage` `:1256-1381`), `setFloating` (`:1647-1683`) — Б-19/Б-21.
//     Без плашек `--pinned-floating-height` берёт ноль из `_chat.scss:485`, а обёртка
//     `.topbar-floating-plates` остаётся `hide`.
//  3. `chat.isPreview`, `ChatType.Search` (`resetSearch`), монофорум, `autoDeletePeriod`
//     аватарки, `welcome_*`, ветки заголовка `Pinned`/`Scheduled`/`Welcome` — предметов нет.
//     Ветка статуса темы форума (`TopicProfileStatus`, `:1736-1742`) и заголовок темы
//     (`wrapPeerTitle({threadId})`) — Б-57, с форумом: наш `PeerTitle` темы не знает.
//  4. Статус — `appImManager.setPeerStatus` (блок L, его расхождения Н1–Н6). Поводы
//     перерисовки — зеркала, а не события: набор и присутствие — `chatsStore.typing`/
//     `presence` (вместо `peer_typings`/`user_update`), карточка — `peerCache`.
//  5. Счёт истории (`historyStorage.count`, `createEffect` в `messagesCounter`) — зеркало
//     `messagesMirror.mirrorHistoryCount` с подпиской `subscribeMirror`. Пока счёт не
//     объявлен, счётчик показывает `Loading` во всех ветках (у tweb — только у «Избранного»
//     и комментариев, `displayLoading`/`:1590-1594`), поэтому параметра `displayLoading` нет.
//  6. Бейдж «назад» (`folder_unread` по `FOLDER_ID_ALL`, `:1066-1076`) — подписка на
//     `chatsStore.dialogs` и `countUnmutedUnreadPeers` (`client/appBadge.ts`, тот же
//     подсчёт, что у бейджа приложения): события `folder_unread` у нас нет.
//  7. `Chat` описан срезом `TopbarChat` — ровно теми членами класса `chat.ts`, которые
//     читает шапка; `chat.peer` — карточка зеркала (`cachedChat`).
//  8. Кнопки звонка (расхождения З1, З3 блока H `lib/appImManager.ts`): `call_active` —
//     идущий видеочат или эфир чата из сторов звонков (`groupCallStore.activeByChat`,
//     `livestreamStore.activeByChat`), `groupCallsController.groupCall` — `groupCallStore.peerId`,
//     `rtmp_stream` звонка — `livestreamStore.activeByChat`, `manage_call` —
//     `hasRights(chat, 'just_admin')`, `IS_GROUP_CALL_SUPPORTED` — `IS_CALL_SUPPORTED` (оба
//     движка просят у браузера одно и то же), `getCachedFullUser` — `cachedPeerFull`.
//     Поводы перепроверки: `peer_full_update` — зеркало полных карточек, `chat_update` —
//     зеркало кратких, а смена `call_active` (у tweb едет в `chat_update`) — подписка на
//     сторы звонков. Пункт меню «Stream With...» (`showRtmpStartStreamPopup`) — нет попапа
//     (`StreamSettingsPopup` снят на К-3, Б-18), в меню эфира только «Начать видеочат».
import type { AppSidebarRight } from '@components/sidebarRight'
import { RIGHT_COLUMN_ACTIVE_CLASSNAME } from '@components/sidebarRight'
import type { Managers } from '@/client/bootstrap'
import { LEFT_COLUMN_ACTIVE_CLASSNAME, type AppImManager } from '@lib/appImManager'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import rootScope from '@lib/rootScope'
import ButtonIcon from '@components/buttonIcon'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import ListenerSetter from '@helpers/listenerSetter'
import PeerTitle from '@components/chat/peerTitle'
import I18n, { type LangPackKey } from '@lib/langPack'
import findUpClassName from '@helpers/dom/findUpClassName'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import replaceContent from '@helpers/dom/replaceContent'
import { avatarNew, findUpAvatar } from '@components/avatar'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import setBadgeContent from '@helpers/setBadgeContent'
import createBadge from '@helpers/createBadge'
import formatNumber from '@helpers/number/formatNumber'
import { useChatsStore } from '@stores/chatsStore'
import { countUnmutedUnreadPeers } from '@/client/appBadge'
import { cachedChat, cachedPeer, subscribePeerMirror } from '@core/peerCache'
import { isUser } from '@core/peers/peerId'
import { isBroadcast } from '@core/peers/predicates'
import { hasRights } from '@core/peers/rights'
import { cachedPeerFull, subscribeChatFullMirror } from '@core/chatFullCache'
import IS_CALL_SUPPORTED from '@environment/callSupport'
import { useGroupCallStore } from '@stores/groupCallStore'
import { useLivestreamStore } from '@stores/livestreamStore'
import type { CallType } from '@lib/calls/types'
import { mirrorHistoryCount, subscribeMirror, winKey } from '@core/history/messagesMirror'
import { ChatType } from './chatType'

/** Расхождение 7: члены `Chat` (`chat.ts`), которые читает шапка. */
export interface TopbarChat {
  container: HTMLElement
  peerId: PeerId
  threadId?: number
  type: ChatType
  isForum?: boolean
  isBroadcast?: boolean
  isAnyGroup?: boolean
  appImManager: Pick<AppImManager, 'setPeerStatus' | 'callUser' | 'joinGroupCall'>
  pop(): void
}

type ButtonToVerify = { element: HTMLElement, verify: () => boolean | Promise<boolean> }

/** `chat.pFlags.call_active` (расхождение 8): идёт видеочат или эфир. */
function isCallActive(peerId: PeerId) {
  return !!useGroupCallStore.getState().activeByChat[peerId]?.length ||
    !!useLivestreamStore.getState().activeByChat[peerId]
}

export default class ChatTopbar {
  public container!: HTMLDivElement
  public floatingPlatesWrapper!: HTMLDivElement
  private btnBack!: HTMLButtonElement
  private btnBackBadge!: HTMLElement
  private chatInfo!: HTMLDivElement
  private avatar?: ReturnType<typeof avatarNew>
  private avatarMiddlewareHelper?: MiddlewareHelper
  private title!: HTMLDivElement
  private subtitle!: HTMLDivElement
  private chatUtils!: HTMLDivElement
  private btnCall!: HTMLButtonElement
  private btnGroupCall!: HTMLButtonElement
  private btnGroupCallMenu!: HTMLElement

  public listenerSetter: ListenerSetter

  private chatInfoContainer!: HTMLDivElement
  private person!: HTMLDivElement

  private titleMiddlewareHelper?: MiddlewareHelper
  private status?: ReturnType<ChatTopbar['createStatus']>

  private buttonsToVerify: ButtonToVerify[]

  constructor(
    private chat: TopbarChat,
    public appSidebarRight: AppSidebarRight,
    private managers: Managers,
  ) {
    this.listenerSetter = new ListenerSetter()

    this.buttonsToVerify = []
  }

  public construct() {
    this.container = document.createElement('div')
    this.container.classList.add('sidebar-header', 'topbar', 'hide')
    this.container.dataset.floating = '0'

    this.btnBack = ButtonIcon('left sidebar-close-button', { noRipple: true, ariaLabel: 'Close' })
    this.btnBackBadge = createBadge('span', 20, 'primary')
    this.btnBackBadge.classList.add('back-unread-badge')
    this.btnBack.append(this.btnBackBadge)

    // * chat info section
    this.chatInfoContainer = document.createElement('div')
    this.chatInfoContainer.classList.add('chat-info-container')

    this.chatInfo = document.createElement('div')
    this.chatInfo.classList.add('chat-info')

    const person = this.person = document.createElement('div')
    person.classList.add('person')

    const content = document.createElement('div')
    content.classList.add('content')

    const top = document.createElement('div')
    top.classList.add('top')

    this.title = document.createElement('div')
    this.title.classList.add('user-title')

    top.append(this.title)

    const bottom = document.createElement('div')
    bottom.classList.add('bottom')

    if(this.subtitle) {
      bottom.append(this.subtitle)
    }

    content.append(top, bottom)

    person.append(content)
    this.chatInfo.append(person)

    // * chat utils section (расхождение 1)
    this.chatUtils = document.createElement('div')
    this.chatUtils.classList.add('chat-utils')

    this.chatUtils.append(...[
      this.btnCall,
      this.btnGroupCall,
      this.btnGroupCallMenu,
    ].filter(Boolean))

    this.pushButtonToVerify(this.btnCall, this.verifyCallButton.bind(this, 'voice'))
    this.pushButtonToVerify(this.btnGroupCall, this.verifyVideoChatButton.bind(this, 'nonadmin'))
    this.pushButtonToVerify(this.btnGroupCallMenu, this.verifyRtmpButton.bind(this))

    this.chatInfoContainer.append(this.btnBack, this.chatInfo, this.chatUtils)
    this.container.append(this.chatInfoContainer)

    // расхождение 2: плашкам негде появиться до П-5, обёртка остаётся скрытой
    this.floatingPlatesWrapper = document.createElement('div')
    this.floatingPlatesWrapper.classList.add('topbar-floating-plates', 'hide')
    this.container.append(this.floatingPlatesWrapper)

    // * construction end

    this.updateBackBadge()

    attachClickEvent(this.container, (e) => {
      if(
        findUpClassName(e.target!, 'topbar-search-container') ||
        !(e.target as HTMLElement).isConnected ||
        findUpClassName(e.target!, 'chat-search-top')
      ) {
        return
      }

      const container = findUpClassName(e.target!, 'pinned-container')
      blurActiveElement()
      if(container) {
        return
      } else {
        const avatar = findUpAvatar(e.target!)
        if(mediaSizes.activeScreen === ScreenSize.medium && document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)) {
          onBtnBackClick()
        } else if(avatar) {
          if(avatar.classList.contains('has-stories')) {
            return
          }

          void this.appSidebarRight.toggleSidebar(!document.body.classList.contains(RIGHT_COLUMN_ACTIVE_CLASSNAME))
        } else {
          void this.appSidebarRight.toggleSidebar(true)
        }
      }
    }, { listenerSetter: this.listenerSetter })

    const onBtnBackClick = (e?: Event) => {
      if(e) {
        cancelEvent(e)
      }

      this.chat.pop()
    }

    attachClickEvent(this.btnBack, onBtnBackClick, { listenerSetter: this.listenerSetter })
  }

  private pushButtonToVerify(element: HTMLElement, verify: ButtonToVerify['verify']) {
    if(!element) {
      return
    }

    element.classList.add('hide')
    this.buttonsToVerify.push({ element, verify })
  }

  /** tweb `:318-338`; `menuButtons` ⋮ — П-5 (расхождение 1). */
  private verifyButtons = (e?: Event) => {
    if(e) cancelEvent(e)

    const r = async() => {
      const buttons = this.buttonsToVerify
      const results = await Promise.all(buttons.map(async(button) => {
        return {
          result: await button.verify(),
          button,
        }
      }))

      results.forEach(({ button, result }) => {
        button.element?.classList.toggle('hide', !result)
      })
    }

    void r()
  }

  /** tweb `:340-362` — расхождение 8. */
  private verifyRtmpButton = () => {
    if(!this.chat.isBroadcast || this.chat.type !== ChatType.Chat) {
      return false
    }

    if(useGroupCallStore.getState().peerId === this.peerId) {
      return false
    }

    const chat = cachedChat(this.peerId)
    if(!chat) {
      return false
    }

    if(isCallActive(this.peerId)) {
      return false
    }

    return hasRights(chat, 'just_admin')
  }

  /** tweb `:364-407` — расхождение 8. */
  public verifyVideoChatButton = (type?: 'group' | 'broadcast' | 'nonadmin') => {
    if(
      !IS_CALL_SUPPORTED ||
      isUser(this.peerId) ||
      this.chat.type !== ChatType.Chat ||
      this.chat.threadId
    ) return false

    if(useGroupCallStore.getState().peerId === this.peerId) {
      return false
    }

    if(type) {
      if(((type === 'group' && !this.chat.isAnyGroup)) ||
        ((type === 'broadcast' && !this.chat.isBroadcast))) {
        return false
      }
    }

    const chat = cachedChat(this.peerId)
    const canManageCall = hasRights(chat, 'just_admin')
    if(type === 'nonadmin' && canManageCall && isBroadcast(chat)) {
      return false // * hide live stream top button
    }
    const needActiveCall = !canManageCall
    if(!isCallActive(this.peerId)) {
      return !needActiveCall
    }

    // * `groupCall.pFlags.rtmp_stream`
    return !useLivestreamStore.getState().activeByChat[this.peerId]
  }

  /** tweb `:409-415` — расхождение 8. */
  public verifyCallButton = (type?: CallType) => {
    if(!IS_CALL_SUPPORTED || !isUser(this.peerId) || this.chat.type !== ChatType.Chat) return false
    const userFull = cachedPeerFull(this.peerId)

    return userFull?._ === 'userFull' && !!(type === 'voice' ? userFull.pFlags?.phone_calls_available : userFull.pFlags?.video_calls_available)
  }

  /** tweb `:961-967` */
  public attachClickEvent(el: HTMLElement, cb: (e: MouseEvent) => void, noBlur?: boolean) {
    attachClickEvent(el, (e) => {
      cancelEvent(e)
      if(!noBlur) blurActiveElement()
      cb(e as MouseEvent)
    }, { listenerSetter: this.listenerSetter })
  }

  /** tweb `:969-971` */
  public onCallClick(type: CallType) {
    void this.chat.appImManager.callUser(this.peerId, type)
  }

  /** tweb `:996-998` */
  public onJoinGroupCallClick = () => {
    void this.chat.appImManager.joinGroupCall(this.peerId)
  }

  private get peerId() {
    return this.chat.peerId
  }

  public constructPeerHelpers() {
    this.subtitle = document.createElement('div')
    this.subtitle.classList.add('info')

    this.btnCall = ButtonIcon('phone', { ariaLabel: 'Call' })
    this.btnGroupCall = ButtonIcon('videochat', { ariaLabel: 'PeerInfo.Action.VoiceChat' })
    this.btnGroupCallMenu = ButtonMenuToggle({
      buttonOptions: { ariaLabel: 'PeerInfo.Action.VoiceChat' },
      listenerSetter: this.listenerSetter,
      direction: 'bottom-left',
      buttons: [{
        icon: 'videochat',
        text: 'Rtmp.Topbar.StartVideoChat',
        onClick: this.onJoinGroupCallClick,
      }],
      icon: 'videochat',
    })
    this.attachClickEvent(this.btnCall, this.onCallClick.bind(this, 'voice'))
    this.attachClickEvent(this.btnGroupCall, this.onJoinGroupCallClick)

    // расхождение 6: `folder_unread` по папке «Все»
    this.listenerSetter.addCleanup(useChatsStore.subscribe((state, prev) => {
      if(state.dialogs !== prev.dialogs) {
        this.updateBackBadge()
      }
    }))

    // * `chat_update` (`:1081-1090`) — расхождение 8
    let chat = cachedChat(this.peerId)
    this.listenerSetter.addCleanup(subscribePeerMirror(() => {
      const newChat = cachedChat(this.peerId)
      if(newChat === chat) {
        return
      }

      chat = newChat
      if(!isBroadcast(chat)) {
        return
      }

      this.verifyButtons()
    }))

    // * `peer_full_update` (`:1092-1096`) — расхождение 8
    let full = cachedPeerFull(this.peerId)
    this.listenerSetter.addCleanup(subscribeChatFullMirror(() => {
      const newFull = cachedPeerFull(this.peerId)
      if(newFull === full) {
        return
      }

      full = newFull
      this.verifyButtons()
    }))

    // * `call_active` чата — расхождение 8
    const onCallsChange = <T extends { activeByChat: Record<number, unknown> }>(state: T, prev: T) => {
      if(state.activeByChat[this.peerId] !== prev.activeByChat[this.peerId]) {
        this.verifyButtons()
      }
    }
    this.listenerSetter.addCleanup(useGroupCallStore.subscribe((state, prev) => {
      if(state.peerId !== prev.peerId) {
        this.verifyButtons()
        return
      }

      onCallsChange(state, prev)
    }))
    this.listenerSetter.addCleanup(useLivestreamStore.subscribe(onCallsChange))

    return this
  }

  private updateBackBadge() {
    if(!this.btnBackBadge) {
      return
    }

    const size = countUnmutedUnreadPeers(useChatsStore.getState().dialogs)
    setBadgeContent(this.btnBackBadge, size ? '' + formatNumber(size, 1) : '')
  }

  public destroy() {
    this.listenerSetter.removeAll()

    this.status?.destroy()
    this.titleMiddlewareHelper?.destroy()
    this.avatarMiddlewareHelper?.destroy()
  }

  public cleanup() {
    if(!this.chat.peerId) {
      this.container.classList.add('hide')
    }
  }

  public async finishPeerChange(options: { middleware: () => boolean }) {
    const { peerId, threadId } = this.chat
    const { middleware } = options

    let newAvatar: ChatTopbar['avatar'], newAvatarMiddlewareHelper: ChatTopbar['avatarMiddlewareHelper']
    const isSaved = this.chat.type === ChatType.Saved
    const needArrowBack = this.chat.type === ChatType.Search
    if([ChatType.Chat, ChatType.Static, ChatType.Logs].includes(this.chat.type) || isSaved) {
      const usePeerId = isSaved ? threadId as PeerId : peerId
      const avatar = this.avatar

      if(
        !avatar ||
        avatar.node.dataset.peerId !== '' + usePeerId ||
        peerId === rootScope.myId
      ) {
        newAvatar = avatarNew({
          middleware: (newAvatarMiddlewareHelper = getMiddleware()).get(),
          isDialog: true,
          size: 40,
          peerId: usePeerId,
          meAsNotes: isSaved,
          managers: this.managers,
        })
        newAvatar.node.classList.add('person-avatar')
      } else {
        newAvatar = this.avatar
      }
    }

    this.status?.destroy()
    const status = this.status = this.createStatus()

    const [, setTitleCallback, setStatusCallback] = await Promise.all([
      Promise.resolve(newAvatar?.readyThumbPromise),
      this.setTitleManual(),
      Promise.resolve(status?.prepare(true)),
    ] as const)

    if(!middleware() && newAvatarMiddlewareHelper) {
      newAvatarMiddlewareHelper.destroy()
    }

    return () => {
      if(this.avatar !== newAvatar) {
        if(newAvatar) {
          this.person.prepend(newAvatar.node)
        }

        if(this.avatar) {
          this.avatarMiddlewareHelper?.destroy()
          this.avatar.node.remove()
        }

        this.avatar = newAvatar
        this.avatarMiddlewareHelper = newAvatarMiddlewareHelper
        this.container.classList.toggle('has-avatar', !!newAvatar)
      }

      setTitleCallback()
      setStatusCallback?.()

      this.subtitle.classList.toggle('hide', !setStatusCallback)

      this.verifyButtons()

      this.container.classList.remove('hide')

      this.container.classList.toggle('show-back-button', needArrowBack)
    }
  }

  public async setTitleManual() {
    const { peerId, threadId } = this.chat
    let titleEl: HTMLElement | undefined
    this.titleMiddlewareHelper?.destroy()
    const middlewareHelper = this.titleMiddlewareHelper = getMiddleware()
    const middleware = middlewareHelper.get()
    if(this.chat.type === ChatType.Discussion) {
      titleEl = this.messagesCounter({
        middleware,
        key: 'Chat.Title.Comments',
        minusFirst: this.chat.isForum,
      }).element
    } else if(this.chat.type === ChatType.Chat || this.chat.type === ChatType.Saved || this.chat.type === ChatType.Static || this.chat.type === ChatType.Logs) {
      const usePeerId = this.chat.type === ChatType.Saved ? threadId as PeerId : peerId

      titleEl = new PeerTitle({
        peerId: usePeerId,
        dialog: true,
        withIcons: !threadId,
        meAsNotes: this.chat.type === ChatType.Saved,
        middleware,
        managers: this.managers,
      }).element
    }

    // всегда колбэк, не `undefined` (tweb :1617-1619)
    return () => {
      // заголовком уже владеет более новый `setTitleManual` — он погасил нашу зону
      if(!middleware()) {
        return
      }

      replaceContent(this.title, titleEl ?? '')
    }
  }

  public setTitle() {
    void this.setTitleManual().then((setTitleCallback) => setTitleCallback())
  }

  /** Ключ окна этого чата — у tweb `historyStorage` (`chat.getHistoryStorage()`). */
  private get storageKey() {
    return winKey(this.chat.peerId, this.chat.threadId)
  }

  /** tweb `:1685-1716`, расхождение 5. */
  private messagesCounter({
    middleware,
    key,
    minusFirst,
  }: {
    middleware: Middleware,
    key: LangPackKey,
    minusFirst?: boolean
  }) {
    const storageKey = this.storageKey
    let count = mirrorHistoryCount(storageKey)
    const el = new I18n.IntlElement(count === undefined ? {
      key: 'Loading',
    } : {
      key,
      args: [count - (minusFirst ? 1 : 0)],
    })

    middleware.onDestroy(subscribeMirror(() => {
      const newCount = mirrorHistoryCount(storageKey)
      if(newCount === count || newCount === undefined) {
        return
      }

      count = newCount
      el.compareAndUpdate({ key, args: [count - (minusFirst ? 1 : 0)] })
    }))

    return el
  }

  private createStatus() {
    if(!this.subtitle || (this.chat.type !== ChatType.Chat && this.chat.type !== ChatType.Saved)) return
    const middlewareHelper = getMiddleware()
    const middleware = middlewareHelper.get()
    const listenerSetter = new ListenerSetter()

    let prepare: (needClear: boolean) => Promise<(() => void) | undefined>
    if(this.chat.type === ChatType.Saved || this.peerId === rootScope.myId) {
      const el = this.messagesCounter({
        middleware,
        key: 'messages',
      })

      prepare = async() => {
        return () => replaceContent(this.subtitle, el.element)
      }
    } else {
      const peerId = this.peerId

      // * `peer_typings` / `user_update` (расхождение 4)
      listenerSetter.addCleanup(useChatsStore.subscribe((state, prev) => {
        if(state.typing[peerId] !== prev.typing[peerId] || state.presence[peerId] !== prev.presence[peerId]) {
          setAuto()
        }
      }))

      let peer = cachedPeer(peerId)
      listenerSetter.addCleanup(subscribePeerMirror(() => {
        const newPeer = cachedPeer(peerId)
        if(newPeer !== peer) {
          peer = newPeer
          setAuto()
        }
      }))

      const interval = window.setInterval(() => setAuto(), 60e3)

      middleware.onDestroy(() => {
        clearInterval(interval)
      })

      prepare = (needClear) => {
        return this.chat.appImManager.setPeerStatus({
          peerId,
          element: this.subtitle,
          needClear,
          middleware,
          managers: this.managers,
        })
      }
    }

    middleware.onDestroy(() => {
      listenerSetter.removeAll()
    })

    const setAuto = () => {
      void prepare(false).then((callback) => middleware() && callback?.())
    }

    return {
      prepare,
      destroy: () => middlewareHelper.destroy(),
    }
  }
}
