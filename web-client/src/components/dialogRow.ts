// Строка чатлиста — узкий порт `DialogElement` / `addDialogNew` / `createChatList`
// из tweb `src/lib/appDialogsManager.ts` (:120, :177-181, :207-420, :1952-1980,
// :2636-2652). Самого `appDialogsManager` у нас нет (список чатов — React), а
// строку строит РОВНО он; сюда вынесено то, что нужно строкам вне списка чатов:
// участникам (`components/sortedUserList.ts`) и, дальше, «общим группам».
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
//     `onlyFirstName`/`noIcons`/`meAsSaved`/`autoDeletePeriod`/`withStories`/
//     `loadPromises`/`dontSetActive`/`controlled` — параметры СПИСКА ЧАТОВ
//     (темы форума, монофорум, «Избранное» как заметки, истории на аватаре,
//     активный диалог `appImManager.isSamePeer`, `href`), у строк участников
//     предмета нет; вместе с ними — `is-forum-open`/`setDialogActive`;
//   • `lazyLoadQueue` в `wrapOptions` — наш `avatarNew` очередь не принимает
//     (шапка `components/avatar.ts`);
//   • бейджи (`createPinnedBadge`/`createUnreadBadge`/…, :387-420) — атрибуты
//     диалога, не участника; сами `dialog-subtitle-badge` в подписи не рисуются;
//   • `titleWrapOptions`/`textColor`/`iconsColor` — цвета активного диалога.
//
// Имя строится `PeerTitle` (`components/chat/peerTitle.ts`), аватар —
// `avatarNew` (`components/avatar.ts`): оба читают зеркало карточек и
// объявляют пробел владельцу через `managers.peers.fillMirror`, как оригинал.
import Row, { type RowMediaSizeType } from '@components/row'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import PeerTitle from '@components/chat/peerTitle'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'

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
}

/** tweb `:186-206` в портированном объёме (см. шапку). */
export type DialogElementOptions = {
  peerId: PeerId,
  rippleEnabled?: boolean,
  avatarSize?: DialogElementSize,
  /** строка НЕ в главном списке чатов: без `href` (tweb `:300-302`) */
  autonomous?: boolean,
  wrapOptions: { middleware?: Middleware },
  managers: DialogRowManagers,
}

export class DialogElement extends Row {
  public dom: DialogDom
  public middlewareHelper?: MiddlewareHelper

  constructor({
    peerId,
    rippleEnabled = true,
    avatarSize = 'bigger',
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
    const peerTitle = new PeerTitle({ peerId, middleware, managers })
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
  })

  if(options.container) {
    const method = options.append === false ? 'prepend' : 'append'
    options.container[method](d.container)
  }

  return d
}
