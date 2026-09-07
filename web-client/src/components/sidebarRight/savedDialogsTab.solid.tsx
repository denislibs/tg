/** @jsxImportSource solid-js */
// Вкладка «Чаты» (savedDialogs) правой колонки — список источников
// «Избранного». Порт того, что `AppSearchSuper.loadSavedDialogs` собирает из
// классов (tweb `src/components/appSearchSuper.ts:1890-1941`):
// `AutonomousSavedDialogList` + `SortedDialogList` (`sortedDialogList.ts:59-118`)
// поверх Solid-ядра `createDeferredSortedVirtualList`
// (`deferredSortedVirtualList.tsx`) и `VerticalVirtualList`
// (`verticalVirtualList.tsx`, у нас — `components/verticalVirtualList.solid.tsx`,
// порт 1:1). Строка — `DialogElement` (`appDialogsManager.ts:207-350`,
// `addListDialog` с дефолтным `avatarSize: 'bigger'`).
//
// Геометрия — буквально из `loadSavedDialogs`: `itemSize: 72` (`:1905`),
// `extraPaddingBottom: 0` (`:1906`), `scrollable` — ТОТ ЖЕ, что у всей панели
// (`:1897`, `:1904`), `thresholdPadding: 72 * 4`
// (`deferredSortedVirtualList.tsx:328`).
//
// ── Что НЕ портировано, и почему ──────────────────────────────────────────────
//  • Пагинация и «дырки» (`requestItemForIdx`, `onListShrinked`, скелетоны
//    `LoadingDialogSkeleton`, волна раскрытия `revealIdx`): у нас набор приезжает
//    ОДНИМ RPC (`chats.savedDialogs`, `GET /saved/dialogs` без курсора) — дырок
//    не бывает, просить страницу некому, а скелетон у нас React-компонент
//    (`components/virtual/LoadingDialogSkeleton.tsx`). До ответа `ul` ростом с
//    хост (`forceHostHeight`), как у оригинала до `wasAtLeastOnceFetched`.
//  • Живые апдейты (`dialogs_multiupdate`/`dialog_drop` в
//    `autonomousDialogList/savedDialogs.ts:22-43`): у `rootScope` нет событий
//    сохранённых диалогов, владелец их не объявляет.
//  • `sortWith`/`getDialogIndex`: порядок приходит готовым от владельца
//    (`stores/noManualOrder.test.ts` запрещает второе правило сортировки).
//  • Клик открывает ОРИГИНАЛЬНЫЙ чат пира, а не под-окно «Избранного»
//    (`ChatType.Saved`, `openInner` → `setInnerPeer` c `threadId = peerId`):
//    окна сохранённого диалога у нас нет вовсе (`core/models.ts`, докблок
//    `isOutMessage`); правило открытия — общее `core/navigation/openPeer.ts`.
//    Строка «Мои заметки» (источник — сам зритель) не открывает ничего.
//  • Контекстное меню строки (`withContext: true`, `:1913`) — `createContextMenu`
//    у нас не портирован (шапка `components/row.ts`).
import { createSignal, createMemo, onMount, onCleanup, type Component } from 'solid-js'
import type { Managers } from '@/client/bootstrap'
import type { SavedDialog } from '@core/managers/chatsManager'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import VerticalVirtualList, { type VerticalVirtualListItemProps } from '@components/verticalVirtualList.solid'
import ripple from '@components/ripple'
import { getMiddleware } from '@helpers/middleware'
import { formatDateAccordingToTodayNew } from '@helpers/date'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import { i18n } from '@lib/langPack'
import { usePeer } from '@stores/peers.solid'
import { useChatsStore } from '@stores/chatsStore'
import { previewOf } from '@core/dialogToChat'
import { getPeerTitle } from '@core/peers/getPeerTitle'
import { getPeerPhoto, getPeerPhotoId } from '@core/peers/peer'
import { openPeer, type OpenPeerManagers } from '@core/navigation/openPeer'
import classNames from '@helpers/string/classNames'
import styles from '@components/virtual/DeferredSortedVirtualList.module.scss'

/** `itemSize: 72` — `tweb/src/components/appSearchSuper.ts:1905`. */
const ITEM_SIZE = 72
/** `extraPaddingBottom: 0` — `:1906`, единственное геометрическое отличие от списка чатов. */
const EXTRA_PADDING_BOTTOM = 0
/** `deferredSortedVirtualList.tsx:328` — overscan в четыре строки. */
const THRESHOLD_PADDING = 72 * 4

export type SavedDialogsManagers = {
  chats: Pick<Managers['chats'], 'savedDialogs'>
  peers: AvatarManagers['peers']
  presence: OpenPeerManagers['presence']
}

export type SavedDialogsTabProps = {
  /** скроллер ВСЕЙ панели (`tweb:1897`), окно строк считается от его `scrollTop` */
  scrollableHost: HTMLElement
  managers: SavedDialogsManagers
  /** `getCount` → `setCounter` оригинала (`:1922-1932`) — размер набора наружу */
  onCountChange?: (count: number) => void
}

/**
 * Строка — разметка `DialogElement` (`Row` с `clickable`/`havePadding`/`title`/
 * `titleRightSecondary`/`subtitle`/`noWrap`, `appDialogsManager.ts:231-241`), в
 * порядке детей оригинала (дамп `docs/tweb/dom/dumps/02-chatlist.json`):
 * ripple, ряд подзаголовка, ряд заголовка, аватар.
 */
const SavedDialogRow: Component<VerticalVirtualListItemProps<SavedDialog> & { managers: SavedDialogsManagers }> = (props) => {
  const meId = subscribeExternal(useChatsStore.subscribe, () => useChatsStore.getState().meId)
  // «Мои заметки» — строка, чей ИСТОЧНИК это сам зритель: вида строкой
  // (`kind`) на проводе нет, его отвечает сам ключ.
  const isSelf = createMemo(() => props.item.peerId === meId())
  const peer = usePeer(() => props.item.peerId)
  // Имя и аватарку даёт КАРТОЧКА пира (она приезжает векторами того же
  // контейнера), а не снимок, подклеенный сервером в строку.
  const title = createMemo(() => getPeerTitle({ peerId: props.item.peerId, peer: peer() }))
  // фото ЛЮБОГО пира одним входом (`getPeerPhoto`, порт `utils/peers/getPeerPhoto.ts`)
  const photoId = () => getPeerPhotoId(getPeerPhoto(peer())) || undefined

  // Аватар — императивный `avatarNew` (порт tweb `avatarNew`), как у
  // `DialogElement` (`:261-283`): `dialog-avatar` + `row-media-bigger`
  // (`applyMediaElement(avatarEl, 'bigger')`), размер 54 (`avatarSizeMap.bigger`).
  const middlewareHelper = getMiddleware()
  onCleanup(() => middlewareHelper.destroy())
  const avatar = avatarNew({
    peerId: props.item.peerId,
    size: 54,
    middleware: middlewareHelper.get(),
    managers: props.managers,
  }).node
  avatar.classList.add('dialog-avatar', 'row-media', 'row-media-bigger')

  const lm = props.item.lastMessage
  // Дата — живой узел ядра локализации (порт tweb `appDialogsManager.ts:2242`),
  // как в списке чатов: строка застыла бы в языке момента рендера.
  const dateNode = lm ? formatDateAccordingToTodayNew(new Date(lm.date * 1000)) : undefined

  // `Row` с `clickable: true` и `noRipple: false` (`:232-233`) — ripple на
  // строке; у «Моих заметок» клика нет, значит и ripple не нужен.
  const attachRipple = (el: HTMLDivElement) => {
    if(!isSelf()) ripple(el)
  }

  // Ключ ЗНАКОВЫЙ и уже посчитан на проводе — различать «человек это или
  // чат» вторым полем рядом больше не нужно: знак и есть ответ. «Мои заметки»
  // (ключ зрителя) отсеивает сам `openPeer` — второго гварда здесь нет.
  const onClick = () => openPeer(props.managers, { id: props.item.peerId, title: title(), photoId: photoId() })

  return (
    <div
      ref={attachRipple}
      class={classNames(
        'row no-wrap row-with-padding row-clickable hover-effect chatlist-chat chatlist-chat-bigger row-big',
        styles.Item,
      )}
      data-peer-id={props.item.peerId}
      style={{
        top: props.top + 'px',
        // `deferredSortedVirtualList.tsx:189-194` — на время переезда строка
        // непрозрачна, чтобы не просвечивать соседей.
        '--background': props.animating ? 'var(--surface-color)' : undefined,
      }}
      onClick={onClick}
    >
      <div class="row-row row-subtitle-row dialog-subtitle">
        <div class="row-subtitle">{previewOf(lm).text}</div>
      </div>
      <div class="row-row row-title-row dialog-title">
        <div class="row-title">{isSelf() ? i18n('MyNotes') : title()}</div>
        <div class="row-title row-title-right row-title-right-secondary">
          {dateNode ? <span class="message-time">{dateNode}</span> : null}
        </div>
      </div>
      {avatar}
    </div>
  )
}

export default function SavedDialogsTab(props: SavedDialogsTabProps) {
  const [dialogs, setDialogs] = createSignal<SavedDialog[]>([])
  // `wasAtLeastOnceFetched` оригинала: до первого ответа `ul` ростом с хост.
  const [fetched, setFetched] = createSignal(false)

  onMount(() => {
    let alive = true
    onCleanup(() => { alive = false })
    // `xd.onChatsScroll()` (`:1940`) — первая (и у нас единственная) страница;
    // `getCount` → `setCounter` (`:1922-1932`).
    void props.managers.chats.savedDialogs().then((list) => {
      if(!alive) return
      setDialogs(list)
      setFetched(true)
      props.onCountChange?.(list.length)
    })
  })

  return (
    <VerticalVirtualList<SavedDialog>
      class="chatlist virtual-chatlist"
      list={dialogs()}
      scrollableHost={props.scrollableHost}
      itemHeight={ITEM_SIZE}
      thresholdPadding={THRESHOLD_PADDING}
      extraPaddingBottom={EXTRA_PADDING_BOTTOM}
      forceHostHeight={!fetched()}
      // `blockedAnimationCount() === 0` (`deferredSortedVirtualList.tsx:270`):
      // глушилку держит владелец ПЕРВОЙ ЗАГРУЗКИ, которой у этого списка нет.
      animate
      ListItem={(itemProps) => <SavedDialogRow {...itemProps} managers={props.managers} />}
    />
  )
}
