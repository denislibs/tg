// Порт tweb `src/components/chat/topbar.ts` (812502980, 1873 строки) — ЯДРО шапки чата,
// шаг К-3 ускоренного плана волны 7 (`docs/superpowers/plans/2026-10-02-wave-7-carcass-first.md`).
//
// Что портировано:
//  - `construct` (`:132-307`): `.sidebar-header.topbar`, стрелка «назад» с бейджем
//    непрочитанного, `.chat-info-container` → `.chat-info` → `.person` → `.content`
//    (`.top` → `.user-title`, `.bottom` → `.info`), `.chat-utils`, `.topbar-floating-plates`;
//    клик по шапке → `appSidebarRight.toggleSidebar` (`:259-286`), «назад» → `chat.pop()`
//    (`:288-306`);
//  - `constructPeerHelpers` (`:1030-1175`) в объёме подписи и бейджа «назад»;
//  - `finishPeerChange` (`:1383-1549`): аватар, заголовок, статус; `cleanup`/`destroy`
//    (`:1238-1254`);
//  - `setTitleManual`/`setTitle` (`:1550-1641`), `messagesCounter` (`:1685-1716`),
//    `createStatus` (`:1718-1845`).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Меню ⋮ и лупа поиска (`constructUtils` `:462-903`, `verify*` `:309-461`) — бэклог
//     Б-18/Б-20; кнопки звонков (`btnCall`/`btnGroupCall`/`btnGroupCallMenu`,
//     `:1035-1057`) — Б-55. `.chat-utils` поэтому пуст.
//  2. Плашки (`createTopbarPlates`, `:180`, `:1093-1131`), закреп (`setupPinnedMessageForPeer`/
//     `revealPreparedPinnedMessage` `:1256-1381`), `setFloating` (`:1647-1683`) — Б-19/Б-21.
//     Без плашек `--pinned-floating-height` берёт ноль из `_chat.scss:485`, а обёртка
//     `.topbar-floating-plates` остаётся `hide`.
//  3. `chat.isPreview`, `ChatType.Search` (`resetSearch`), монофорум, `autoDeletePeriod`
//     аватарки, `welcome_*`, ветки заголовка `Pinned`/`Scheduled`/`Welcome` — предметов нет.
//     Ветка статуса темы форума (`TopicProfileStatus`, `:1736-1742`) и заголовок темы
//     (`wrapPeerTitle({threadId})`) — Б-57, с форумом: наш `PeerTitle` темы не знает.
//  4. Статус (`appImManager.setPeerStatus`, `:3677-3797`) — функции модуля ниже, ВРЕМЕННО до
//     П-4 (Б-29): у tweb они в `appImManager`. Источники — зеркала, а не события:
//     набор и присутствие — `chatsStore.typing`/`presence` (вместо `peer_typings`/
//     `user_update`), карточка — `peerCache`, число участников — `participants_count`
//     краткой карточки; «N онлайн» (`getOnlines`) нет — Б-29.
//  5. Счёт истории (`historyStorage.count`, `createEffect` в `messagesCounter`) — зеркало
//     `messagesMirror.mirrorHistoryCount` с подпиской `subscribeMirror`. Пока счёт не
//     объявлен, счётчик показывает `Loading` во всех ветках (у tweb — только у «Избранного»
//     и комментариев, `displayLoading`/`:1590-1594`), поэтому параметра `displayLoading` нет.
//  6. Бейдж «назад» (`folder_unread` по `FOLDER_ID_ALL`, `:1066-1076`) — подписка на
//     `chatsStore.dialogs` и `countUnmutedUnreadPeers` (`client/appBadge.ts`, тот же
//     подсчёт, что у бейджа приложения): события `folder_unread` у нас нет.
//  7. `Chat` описан срезом `TopbarChat` — ровно теми членами класса `chat.ts`, которые
//     читает шапка.
import type { AppSidebarRight } from '@components/sidebarRight'
import { RIGHT_COLUMN_ACTIVE_CLASSNAME } from '@components/sidebarRight'
import type { Managers } from '@/client/bootstrap'
import { getPeerTyping, LEFT_COLUMN_ACTIVE_CLASSNAME } from '@lib/appImManager'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import rootScope from '@lib/rootScope'
import ButtonIcon from '@components/buttonIcon'
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
import { cachedChat, cachedPeer, cachedUser, subscribePeerMirror } from '@core/peerCache'
import { isAnyChat } from '@core/peers/peerId'
import { getUserStatusString } from '@core/presence'
import { getChatMembersString } from '@components/wrappers/getChatMembersString'
import { mirrorHistoryCount, subscribeMirror, winKey } from '@core/history/messagesMirror'
import { ChatType } from './chatType'

/** Расхождение 7: члены `Chat` (`chat.ts`), которые читает шапка. */
export interface TopbarChat {
  container: HTMLElement
  peerId: PeerId
  threadId?: number
  type: ChatType
  isForum?: boolean
  pop(): void
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

  public listenerSetter: ListenerSetter

  private chatInfoContainer!: HTMLDivElement
  private person!: HTMLDivElement

  private titleMiddlewareHelper?: MiddlewareHelper
  private status?: ReturnType<ChatTopbar['createStatus']>

  constructor(
    private chat: TopbarChat,
    public appSidebarRight: AppSidebarRight,
    private managers: Managers,
  ) {
    this.listenerSetter = new ListenerSetter()
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

  private get peerId() {
    return this.chat.peerId
  }

  public constructPeerHelpers() {
    this.subtitle = document.createElement('div')
    this.subtitle.classList.add('info')

    // расхождение 6: `folder_unread` по папке «Все»
    this.listenerSetter.addCleanup(useChatsStore.subscribe((state, prev) => {
      if(state.dialogs !== prev.dialogs) {
        this.updateBackBadge()
      }
    }))

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
        return setPeerStatus({
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

// ═══ СТАТУС ПИРА — ВРЕМЕННО до П-4 (Б-29): tweb `appImManager.ts:3677-3797` ═══

type StatusOptions = {
  peerId: PeerId,
  middleware: Middleware,
  managers: Managers
}

/** tweb `:3677-3710` без `getOnlines` (расхождение 4). */
function getChatStatus({ peerId, middleware, managers }: StatusOptions): HTMLElement | string {
  const typingEl = getPeerTyping(peerId, { middleware, managers })
  if(typingEl) {
    return typingEl
  }

  return getChatMembersString(cachedChat(peerId), (key, args) => I18n.format(key, true, args))
}

/** tweb `:3712-3741`; присутствие — `chatsStore.presence`, иначе статус карточки. */
function getUserStatus({ peerId, middleware, managers }: StatusOptions): HTMLElement | undefined {
  const user = cachedUser(peerId)
  const real = user?._ === 'user' ? user : undefined
  const status = useChatsStore.getState().presence[peerId] ?? real?.status
  if((!user && !status) || real?.pFlags?.self) {
    return
  }

  const subtitle = getUserStatusString(user, status)

  if(!real?.pFlags?.bot && !real?.pFlags?.support) {
    let typingEl = getPeerTyping(peerId, { middleware, managers })
    if(!typingEl && status?._ === 'userStatusOnline') {
      typingEl = document.createElement('span')
      typingEl.classList.add('online')
      typingEl.append(subtitle)
    }

    if(typingEl) {
      return typingEl
    }
  }

  return subtitle
}

/** tweb `:3755-3797` (`useWhitespace: false`). Данные синхронные — ответ всегда «из кэша». */
async function setPeerStatus(options: StatusOptions & {
  element: HTMLElement,
  needClear: boolean
}): Promise<(() => void) | undefined> {
  const { peerId, element, needClear, middleware, managers } = options

  if(!needClear) {
    // * good good good
    const typingContainer = element.querySelector<HTMLElement>('.peer-typing-container')
    if(typingContainer && getPeerTyping(peerId, { container: typingContainer, middleware, managers })) {
      return
    }
  }

  const subtitle = isAnyChat(peerId) ?
    getChatStatus({ peerId, middleware, managers }) :
    getUserStatus({ peerId, middleware, managers })
  if(!middleware()) {
    return
  }

  return () => replaceContent(element, subtitle || '')
}
