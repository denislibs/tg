// Строка чатлиста — узкий порт `DialogElement` / `addDialogNew` / `createChatList`
// из tweb `src/lib/appDialogsManager.ts` (:120, :177-181, :207-420, :1952-1980,
// :2636-2652) плюс клик по списку (`setListClickListener`, :1751-1949) и превью
// найденного сообщения (`setLastMessageN`/`setLastMessage`, :1983-2244). Самого
// `appDialogsManager` у нас нет (список чатов — React), а строку строит РОВНО
// он; сюда вынесено то, что нужно строкам вне списка чатов: участникам
// (`components/sortedUserList.ts`), группам глобального поиска
// (`components/searchGroup.solid.tsx`) и, дальше, «общим группам».
//
// Эталон разметки — живой дамп `docs/tweb/dom/dumps/15-right-14-group-members.json`
// (строка с полной глубиной) и `15-right-11-group-profile.json` (та же строка во
// вкладке «Участники»): `a.row.no-wrap.row-with-padding.row-clickable.hover-effect
// .chatlist-chat.chatlist-chat-abitbigger[data-peer-id]` с детьми в порядке
// подпись → заголовок → аватар. Порядок задаёт `Row`: подпись создаётся раньше
// заголовка (`row.ts`), аватар — `applyMediaElement` в конце.
//
// Что НЕ портировано из `DialogElement` (и почему):
//   • `threadId`/`monoforumParentPeerId`/`asAllChats`/`isMainList`/`fromName`/
//     `onlyFirstName`/`noIcons`/`autoDeletePeriod`/`withStories`/
//     `loadPromises`/`dontSetActive`/`controlled` — параметры СПИСКА ЧАТОВ
//     (темы форума, монофорум, «Избранное» как заметки, истории на аватаре,
//     активный диалог `appImManager.isSamePeer`, `href`), у строк участников
//     предмета нет; вместе с ними — `is-forum-open`/`setDialogActive`;
//   • `lazyLoadQueue` в `wrapOptions` — наш `avatarNew` очередь не принимает
//     (шапка `components/avatar.ts`);
//   • `meAsSaved` (свой пир — «Избранное», :301, :357, :401) портирован для
//     селектора пиров (`appSelectPeers.solid.tsx`); по умолчанию — `false`, а не
//     `true` (:301): прежние потребители строки (участники, группы поиска) его
//     не передавали, а у оригинала передают `false` (`sortedUserList.ts:84`);
//   • бейджи (`createPinnedBadge`/`createUnreadBadge`/…, :387-420) — атрибуты
//     диалога, не участника; сами `dialog-subtitle-badge` в подписи не рисуются;
//   • `titleWrapOptions`/`textColor`/`iconsColor` — цвета активного диалога.
//
// Что НЕ портировано из `setListClickListener` (:1751-1949):
//   1. истории на аватаре (`findAvatarWithStories`/`getOpenStoryCallback`,
//      клик-«открыть историю») и архив (`archiveDialogTagName`) — строки поиска
//      их не несут: `withStories`/архивной строки у нас нет (см. выше);
//   2. реклама (`dataset.sponsored`, чип `.sponsored-peer-chip`) — вне продукта;
//   3. Shift-клик → превью чата (`showChatPreviewPopup`), Ctrl/Cmd-клик → новая
//      вкладка (`openDialogInNewTab`, `#/im?p=…`) — ни попапа, ни такого
//      маршрута у нас нет;
//   4. монофорум, бот-форум и форум (`toggleForumTabByPeerId`) — форум-панель у
//      нас React (`useForumPanel`), а монофорумов нет; `data-thread-id`/
//      `data-monoforum-parent-peer-id` никто не ставит;
//   5. `toggleForumTab` главного списка (`this.xd.sortedList.list === list`) —
//      главный список не здесь;
//   6. `lastActiveElements` — реестр `appDialogsManager`, которым оригинал
//      гасит `active` при смене чата извне; у автономного списка `active`
//      переносится только кликом по соседней строке (`lastActiveListElement`);
//   7. `withContext`/`withArchiveContext`/`openInner` — контекст-меню строки
//      (`createContextMenu`) не портировано, под-окна «Избранного» нет;
//   8. `appImManager.setPeer({peerId, lastMsgId})` → `core/navigation/openPeer.ts`
//      + прыжок `core/messageLink.ts::requestMessageJump` для строки-сообщения
//      (`data-mid`); менеджеры приходят опцией `managers` (у оригинала — синглтон).
//
// Что НЕ портировано из `setLastMessage` (:2020-2244) — порт в объёме поиска
// (`isSearch`: `setUnread` не передан, `processEmptyFilter` отдаёт найденное
// сообщение сам):
//   1. `lastMessage` обязателен: ветки черновика (`getLastMessageForDialog`,
//      `Draft:`), «нет сообщений» (`NoMessagesYet`) и `setUnreadMessagesN`
//      принадлежат списку чатов, у поиска их не бывает;
//   2. `data-thread-id` для ответа в теме форума (:2075-2078) — читать его
//      некому (п. 4 выше);
//   3. `isSavedDialog`, `isMessageRestricted`/`isMessageSensitive`,
//      `ttl_seconds`, иконка `storyreply` — в нашей модели этих признаков нет;
//   4. заслонка миниатюры (`wrapMediaSpoiler`) получает middleware СТРОКИ, у
//      оригинала — `stateMiddlewareHelper` менеджера; `multiply: 0.1` не
//      передаётся — у оригинала он мёртв (`dotRenderer.ts:331`, вызов закомментирован);
//   5. `textColor` (цвет кастом-эмодзи активной строки) — рендерера нет;
//   6. ветка `flex === false` (`replaceContent(fragment)`) — у оригинала мертва
//      (`const flex = true`, :2211).
//
// Имя строится `PeerTitle` (`components/chat/peerTitle.ts`), аватар —
// `avatarNew` (`components/avatar.ts`): оба читают зеркало карточек и
// объявляют пробел владельцу через `managers.peers.fillMirror`, как оригинал.
import Row, { type RowMediaSizeType } from '@components/row'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import PeerTitle from '@components/chat/peerTitle'
import Icon from '@components/icon'
import wrapPhoto from '@components/wrappers/photo'
import wrapMediaSpoiler from '@components/wrappers/mediaSpoiler'
import wrapMessageForReply from '@components/wrappers/messageForReply'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import middlewarePromise from '@helpers/middlewarePromise'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import cancelEvent from '@helpers/dom/cancelEvent'
import findUpTag from '@helpers/dom/findUpTag'
import replaceContent from '@helpers/dom/replaceContent'
import { formatDateAccordingToTodayNew } from '@helpers/date'
import { i18n } from '@lib/langPack'
import { logger, LogTypes } from '@lib/logger'
import type { IconName } from '@core/tgico-icons'
import { choosePhotoSize, getMediaFromMessage, isMediaSpoiler, type MyDocument } from '@core/media/messageMedia'
import { getMessageText, type MyMessage } from '@core/models'
import { cachedPeer } from '@core/peerCache'
import { isAnyChat } from '@core/peers/peerId'
import { getPeerTitle } from '@core/peers/getPeerTitle'
import { getPeerPhoto, getPeerPhotoId } from '@core/peers/peer'
import { openPeer, type OpenPeerManagers } from '@core/navigation/openPeer'
import { requestMessageJump } from '@core/messageLink'
import { useChatsStore } from '@stores/chatsStore'

const log = logger('DIALOGS', LogTypes.Error)

/** tweb `:120` — строка чатлиста это `<a>`; по тегу её находит клик (`findUpTag`). */
export const DIALOG_LIST_ELEMENT_TAG = 'A'

export type DialogElementSize = RowMediaSizeType

/** tweb `:177-181` — размер аватарки по размеру строки. */
const avatarSizeMap: { [k in DialogElementSize]?: number } = {
  bigger: 54,
  abitbigger: 42,
  small: 32,
}

export type DialogRowManagers = AvatarManagers

/** tweb `:122-148` в объёме, который читают потребители строки. */
export type DialogDom = {
  avatarEl?: ReturnType<typeof avatarNew>,
  captionDiv: HTMLElement,
  titleSpan: HTMLElement,
  titleSpanContainer: HTMLElement,
  statusSpan: HTMLSpanElement,
  lastTimeSpan: HTMLSpanElement,
  lastMessageSpan: HTMLElement,
  containerEl: HTMLElement,
  listEl: HTMLElement,
  subtitleEl: HTMLElement,
  /** tweb `setPromiseMiddleware(dom, 'setLastMessagePromise')` — текущий прогон превью */
  setLastMessagePromise?: CancellablePromise<void>,
}

/** tweb `(d.container as any).dialogElement = d` (:2643) — по нему группа поиска снимает строку. */
export type DialogListElement = HTMLElement & { dialogElement?: DialogElement }

/** tweb `:186-206` в портированном объёме (см. шапку). */
export type DialogElementOptions = {
  peerId: PeerId,
  rippleEnabled?: boolean,
  avatarSize?: DialogElementSize,
  /** свой пир — «Избранное»: аватар `saved` и имя «Избранное» (tweb :301, :357, :401) */
  meAsSaved?: boolean,
  /** строка НЕ в главном списке чатов: без `href` (tweb `:300-302`) */
  autonomous?: boolean,
  wrapOptions: { middleware?: Middleware },
  managers: DialogRowManagers,
}

export class DialogElement extends Row {
  public dom: DialogDom
  public middlewareHelper?: MiddlewareHelper
  /** менеджеры строки: ими же `setLastMessageN` строит имя автора (у оригинала — синглтон) */
  public readonly managers: DialogRowManagers

  constructor({
    peerId,
    rippleEnabled = true,
    avatarSize = 'bigger',
    meAsSaved = false,
    autonomous,
    wrapOptions,
    managers,
  }: DialogElementOptions) {
    super({
      clickable: true,
      noRipple: !rippleEnabled,
      havePadding: true,
      title: true,
      titleRightSecondary: true,
      subtitle: true,
      subtitleRight: true,
      noWrap: true,
      asLink: true,
    })

    // tweb `:243` — правый слот подписи создаётся `Row` и тут же снимается.
    this.subtitleRight.remove()
    this.managers = managers

    // tweb `:246` — дочерний scope от переданного middleware; без него
    // (`controlled` не портирован) — свой корень, чтобы `destroy()` было что
    // гасить у аватара и имени.
    this.middlewareHelper = wrapOptions.middleware ? wrapOptions.middleware.create() : getMiddleware()
    const middleware = this.middlewareHelper.get()

    // tweb `:262-283`
    const avatar = avatarNew({
      middleware,
      size: avatarSizeMap[avatarSize]!,
      peerId,
      isDialog: !!meAsSaved,
      managers,
    })
    const avatarEl = avatar.node
    avatarEl.classList.add('dialog-avatar')
    this.applyMediaElement(avatarEl, avatarSize)

    const captionDiv = this.container

    // tweb `:287-290`
    const titleSpanContainer = this.title
    titleSpanContainer.classList.add('user-title')

    this.titleRow.classList.add('dialog-title')

    // tweb `:306-318` — имя пира узлом `.peer-title`
    const peerTitle = new PeerTitle({ peerId, dialog: meAsSaved, middleware, managers })
    titleSpanContainer.append(peerTitle.element)

    const span = this.subtitle

    // tweb `:340-355`
    const li = this.container
    li.classList.add('chatlist-chat', 'chatlist-chat-' + avatarSize)
    if(!autonomous) {
      (li as HTMLAnchorElement).href = '#' + peerId
    }

    if(avatarSize === 'bigger') {
      this.container.classList.add('row-big')
    } else if(avatarSize === 'small') {
      this.container.classList.add('row-small')
    }

    li.dataset.peerId = '' + peerId

    // tweb `:363-373`
    const statusSpan = document.createElement('span')
    statusSpan.classList.add('message-status', 'sending-status')

    const lastTimeSpan = document.createElement('span')
    lastTimeSpan.classList.add('message-time')

    const rightSpan = this.titleRight
    rightSpan.classList.add('dialog-title-details')
    rightSpan.append(statusSpan, lastTimeSpan)

    this.subtitleRow.classList.add('dialog-subtitle', 'has-multiple-badges')

    // tweb `:380-392`
    this.dom = {
      avatarEl: avatar,
      captionDiv,
      titleSpan: peerTitle.element,
      titleSpanContainer,
      statusSpan,
      lastTimeSpan,
      lastMessageSpan: span,
      containerEl: li,
      listEl: li,
      subtitleEl: this.subtitleRow,
    }
  }

  /** tweb `:408-410` */
  public destroy() {
    this.middlewareHelper?.destroy()
  }

  /** tweb `:412-415` */
  public remove() {
    this.destroy()
    this.dom.listEl.remove()
  }
}

/**
 * tweb `:1952-1980` — `ul.chatlist`. Опции оригинала (`new`, `dialogSize`) у
 * наших потребителей не читаются: `SortedUserList` зовёт его без аргументов.
 */
export function createChatList() {
  const list = document.createElement('ul')
  list.classList.add('chatlist')
  return list
}

/**
 * tweb `:2636-2652` — строка + вставка в контейнер. `container: false` —
 * «не вставлять» (потребитель расставит сам, как `SortedUserList.onSort`).
 * `autonomous` по умолчанию — «есть контейнер», как в оригинале (`:2638`).
 */
export function addDialogNew(options: DialogElementOptions & { container?: HTMLElement | false, append?: boolean }) {
  const d = new DialogElement({
    autonomous: !!options.container,
    avatarSize: 'bigger',
    ...options,
  });
  (d.container as DialogListElement).dialogElement = d

  if(options.container) {
    const method = options.append === false ? 'prepend' : 'append'
    options.container[method](d.container)
  }

  return d
}

/** tweb `:979-995` в портированном объёме — только класс `active` (см. шапку). */
function setDialogActiveStatus(listEl: HTMLElement, active: boolean) {
  listEl.classList.toggle('active', active)
}

/**
 * tweb `:1751-1949` — клик по строке списка. Строку ищет `mousedown` в фазе
 * захвата (раньше ripple и чужих обработчиков), а `click` по `a` гасится: у
 * строки главного списка есть `href`, переход по нему не нужен.
 */
export function setListClickListener({
  list,
  onFound,
  autonomous = false,
  managers,
}: {
  list: HTMLElement,
  onFound?: (target: HTMLElement) => void | boolean,
  autonomous?: boolean,
  managers: OpenPeerManagers,
}) {
  let lastActiveListElement: HTMLElement | undefined

  list.dataset.autonomous = '' + +autonomous
  list.addEventListener('mousedown', (e) => {
    if(e.button !== 0) {
      return
    }

    const elem = findUpTag(e.target!, DIALOG_LIST_ELEMENT_TAG)
    if(!elem) {
      return
    }

    const peerId: PeerId = +elem.dataset.peerId!
    const lastMsgId = +elem.dataset.mid! || undefined

    // tweb `setPeerFunc({peerId, lastMsgId})` — прыжок ставится до открытия:
    // лента потребляет `pendingJump`, когда чат откроется.
    const openChat = () => {
      if(lastMsgId) {
        requestMessageJump(peerId, lastMsgId)
      }

      const peer = cachedPeer(peerId)
      openPeer(managers, {
        id: peerId,
        title: getPeerTitle({ peerId, peer }),
        username: peer?._ === 'user' ? peer.username : undefined,
        photoId: getPeerPhotoId(getPeerPhoto(peer)) || undefined,
      })
    }

    if(onFound?.(elem) === false) {
      return
    }

    if(autonomous) {
      const sameElement = lastActiveListElement === elem
      if(lastActiveListElement && !sameElement) {
        setDialogActiveStatus(lastActiveListElement, false)
      }

      setDialogActiveStatus(elem, true)
      lastActiveListElement = elem
    }

    openChat()
  }, { capture: true })

  // cancel link click
  // ! do not change it to attachClickEvent
  list.addEventListener('click', (e) => {
    if(e.button === 0) {
      cancelEvent(e)
    }
  }, { capture: true })
}

/** tweb `:154-168` — новый прогон превью отменяет прежний на том же `dom`. */
function setPromiseMiddleware(obj: DialogDom, key: 'setLastMessagePromise') {
  const oldPromise = obj[key]
  oldPromise?.reject!()

  const deferred = obj[key] = deferredPromise<void>()
  deferred.catch(() => {}).finally(() => {
    if(obj[key] === deferred) {
      delete obj[key]
    }
  })

  const middleware = middlewarePromise(() => obj[key] === deferred)
  return { deferred, middleware }
}

export type SetLastMessageOptions = {
  dialog: { peerId: PeerId },
  lastMessage: MyMessage,
  dialogElement: DialogElement,
  highlightWord?: string,
  noForwardIcon?: boolean,
}

/** tweb `:1983-1990` */
export function setLastMessageN(options: SetLastMessageOptions) {
  return setLastMessage(options).catch((err: { type?: string }) => {
    if(err?.type !== 'MIDDLEWARE') {
      log.error('set last message error', err)
    }
  })
}

const VIDEO_TYPES: Set<MyDocument['type']> = new Set(['video', 'gif', 'round'])

/** tweb `:2020-2244` в объёме поиска (см. шапку). */
async function setLastMessage({
  dialog,
  lastMessage,
  dialogElement,
  highlightWord,
  noForwardIcon,
}: SetLastMessageOptions) {
  const { dom } = dialogElement
  const { peerId } = dialog

  const { deferred: promise, middleware } = setPromiseMiddleware(dom, 'setLastMessagePromise')

  // set it before content so won't have bug in appSearch
  dom.listEl.dataset.mid = '' + lastMessage.id

  let mediaContainer: HTMLElement | undefined
  let willPrepend: (Promise<HTMLElement> | HTMLElement)[] = []
  let icon: IconName | undefined
  if(lastMessage._ === 'message' && lastMessage.fwd_from && !noForwardIcon) {
    icon = 'forward_filled'
  }

  if(icon) {
    const span = Icon(icon, 'dialog-subtitle-ico', 'dialog-subtitle-ico-' + icon)
    willPrepend.push(span)
  }

  if(lastMessage._ === 'message') {
    const media = getMediaFromMessage(lastMessage)
    if(media && (media._ === 'photo' || VIDEO_TYPES.has(media.type))) {
      const spoiler = isMediaSpoiler(lastMessage)
      const size = choosePhotoSize(media, 20, 20)

      if(size) {
        const container = mediaContainer = document.createElement('div')
        container.classList.add('dialog-subtitle-media')

        if(media._ === 'document' && media.type === 'round') {
          container.classList.add('is-round')
        }

        willPrepend.push(wrapPhoto({
          photo: media,
          container,
          withoutPreloader: true,
          size,
        }).then(async() => {
          if(spoiler) {
            const el = await wrapMediaSpoiler({
              media,
              width: 20,
              height: 20,
              middleware: dialogElement.middlewareHelper!.get(),
              animationGroup: 'none',
            })
            if(el) container.append(el)
          }

          return container
        }))

        if(media._ === 'document' && VIDEO_TYPES.has(media.type)) {
          const playIcon = Icon('play_filled', 'dialog-subtitle-media-play')
          container.append(playIcon)
        }
      }
    }
  }

  // tweb `:2153-2178` — в чате чужое сообщение подписано автором, своё — «Вы».
  // `fromId` у поста канала у нас не выставлен (у оригинала он равен пиру).
  const fromId = lastMessage.fromId ?? lastMessage.peerId
  if(isAnyChat(peerId) && peerId !== fromId && lastMessage._ !== 'messageService') {
    const span = document.createElement('span')
    span.classList.add('primary-text')

    if(fromId === useChatsStore.getState().meId) {
      span.append(i18n('FromYou'))
    } else {
      const peerTitle = new PeerTitle({
        peerId: fromId,
        onlyFirstName: true,
        middleware: dialogElement.middlewareHelper!.get(),
        managers: dialogElement.managers,
      })
      span.prepend(peerTitle.element)
    }

    willPrepend.unshift(span)
    span.append(': ')
  }

  const withoutMediaType = !!mediaContainer && !!getMessageText(lastMessage)

  const fragment = highlightWord && getMessageText(lastMessage) ?
    wrapMessageForReply({ message: lastMessage, highlightWord, withoutMediaType, plain: false }) :
    wrapMessageForReply({ message: lastMessage, withoutMediaType, plain: false })

  if(willPrepend.length) {
    // `Promise.resolve` на каждой части — только под `await-thenable` линтера:
    // у оригинала в `Promise.all` уходят вперемешку узлы и промисы (:2204)
    willPrepend = await middleware(Promise.all(willPrepend.map((part) => Promise.resolve(part))))
  }

  dom.lastMessageSpan.classList.add('dialog-subtitle-flex')
  const parts = [...willPrepend as HTMLElement[], fragment].map((part, idx, arr) => {
    const span = document.createElement('span')
    span.classList.add('dialog-subtitle-span', 'dialog-subtitle-span-overflow')
    if(idx === (arr.length - 1)) {
      span.classList.add('dialog-subtitle-span-last')
      span.dir = 'auto'
    }

    span.append(part)
    return span
  })
  dom.lastMessageSpan.replaceChildren(...parts)

  replaceContent(dom.lastTimeSpan, formatDateAccordingToTodayNew(new Date(lastMessage.date * 1000)))

  promise.resolve!()
}
