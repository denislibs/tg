// src/components/ChatList.tsx
// Списки диалогов папок — React-половина роли tweb `AutonomousDialogList` (`xd`).
// Контейнеры папок (скроллер `.folders-scrollable`, `.chatlist-top`,
// `.chatlist-bottom`), их порядок и переключение — у TS-владельца
// `lib/appDialogsManager.ts` (порт папочного среза tweb `appDialogsManager.ts`);
// React владеет ТОЛЬКО `ul.chatlist.virtual-chatlist` и строками: на каждую
// отрисованную владельцем папку (`manager.subscribe/getRendered`) он порталом
// кладёт свой список в её `.chatlist-top` (задача 6 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`).
//
// Строки лежат в `ul` абсолютом, в DOM живут только видимые
// (`DeferredSortedVirtualList`, порт tweb `deferredSortedVirtualList.tsx` /
// `verticalVirtualList.tsx`); архив — закреплённый элемент ВНУТРИ списка «Всех
// чатов» (аналог `CustomPinnedDialog`, `sortedDialogList.ts`).
//
// Компонент мемоизирован, чтобы переходное состояние колонки (сворачивание
// историй на скролле, тоглы оверлеев) не перерисовывало списки.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import ChatListItem from './ChatListItem'
import ArchiveRow from './ArchiveRow'
import { DialogsPlaceholder } from './chatlist/dialogsPlaceholder'
import DeferredSortedVirtualList, {
  type DeferredSortedVirtualListItem,
  type DeferredSortedVirtualListRenderItemProps,
} from './virtual/DeferredSortedVirtualList'
import { useDialogListSource } from '../core/hooks/useDialogListSource'
import { useEvent } from '../core/hooks/useEvent'
import { ALL_FOLDER_ID } from '../core/folderIds'
import type { AppDialogsManager, FolderList } from '../lib/appDialogsManager'
import type { Chat } from '../data'

export interface ChatListProps {
  /** владелец контейнеров папок колонки — его списки ChatList и наполняет */
  manager: AppDialogsManager
  /**
   * Витрина зеркала целиком (`useChatList()` в Sidebar) — НЕ отфильтрованная по
   * папке: фильтр папки живёт в `useDialogListSource` и там он ровно один
   * (иначе строки и размер набора считались бы разными правилами).
   */
  chats: Chat[]
  selectedId: string
  onSelect: (id: string) => void
  loaded: boolean
  /** архивные чаты → закреплённый ряд «Архив» в начале списка «Всех чатов» */
  archived?: Chat[]
  onOpenArchive?: () => void
  /** свернуть строки в узкую колонку аватаров (открыта панель форум-тем, tweb .is-collapsed) */
  collapsed?: boolean
}

/**
 * Значение строки виртуального списка: обычный диалог либо закреплённый ряд
 * «Архив». Разделяются по наличию поля (`'archivedChats' in value`) — так же,
 * как tweb отличает `CustomPinnedDialog` от диалога.
 */
type ArchivePinnedValue = { archivedChats: Chat[] }
type ChatListRowValue = Chat | ArchivePinnedValue

/**
 * Высота строки — `.row-big { min-height: 4.5rem }` (_row.scss:131). Та же
 * константа зашита в canvas-плейсхолдер (`dialogsPlaceholder.ts`, TOTAL_HEIGHT).
 */
const DIALOG_ITEM_HEIGHT = 72

/** У закреплённого архива своё пространство id — с id чатов оно не пересекается. */
const ARCHIVE_ROW_ID = 'archive'

const NO_PINNED_ITEMS: readonly DeferredSortedVirtualListItem<ChatListRowValue>[] = []
const NO_ITEMS: readonly DeferredSortedVirtualListItem<Chat>[] = []

function ChatList({ manager, archived, ...rest }: ChatListProps) {
  const lists = useSyncExternalStore(
    useCallback((callback: () => void) => manager.subscribe(callback), [manager]),
    () => manager.getRendered(),
  )

  // Строку «Архив» несёт только список «Всех чатов» — как у tweb, где архив
  // закреплён в `xd` фильтра `FOLDER_ID_ALL`.
  return lists.map((list) => createPortal(
    <ChatListFolder
      key={list.id}
      list={list}
      archived={list.id === ALL_FOLDER_ID ? archived : undefined}
      {...rest}
    />,
    list.top,
    list.id,
  ))
}

/**
 * Список ОДНОЙ папки — React-хозяин `ul` для `FolderList` владельца: свой
 * курсор загрузки (`useDialogListSource`), свой `ul` в `.chatlist-top` и
 * хэндл `{clear, reset, onChatsScroll}`, который владелец зовёт при
 * переключении (`base.ts:144-146`, `:353-367`).
 */
function ChatListFolder({
  list, chats, selectedId, onSelect, loaded, archived, onOpenArchive, collapsed,
}: Omit<ChatListProps, 'manager'> & { list: FolderList }) {
  const scrollHost = list.container

  const source = useDialogListSource(list.id, chats)
  const { totalCount, wasAtLeastOnceFetched, animate, requestItemForIdx } = source
  // Окно — только после страницы владельца. У tweb список ВЛАДЕЕТ элементами:
  // до первой загрузки и после `clear()` (`setItems([])`,
  // `deferredSortedVirtualList.tsx:157-168`) в нём нет ничего; у нас строки —
  // производная зеркала, и в нём они остаются, поэтому окно пустое, пока
  // источник не получил страницу.
  const items = wasAtLeastOnceFetched ? source.items : NO_ITEMS

  // Показ папки у tweb — `clear()` + первая страница заново (поправка 1 плана:
  // памяти `scrollTop` у папок нет). Окно видимости списка считается от
  // прокрутки хоста, а её сброс браузер делает БЕЗ события `scroll`: у
  // неактивной папки `.tabs-tab { display: none }` (`_slider.scss:171-184`), и
  // позиция скроллера обнуляется вместе с его боксом. Поэтому на каждый `clear()`
  // `ul` пересоздаётся (ключ `showId`) и новый список берёт фактическую позицию
  // хоста при подключении (`VerticalVirtualList.tsx`, эффект слушателя скролла),
  // а не последнюю, что услышал до сброса.
  const [showId, setShowId] = useState(0)
  const clear = useEvent(() => {
    source.clear()
    setShowId((id) => id + 1)
  })

  // Хэндл отдаётся владельцу до отрисовки: его первый `onChatsScroll` на старте
  // (`:1064-1065`) ждёт регистрации (late binding `FolderList`). Первую страницу
  // просит ТОЛЬКО владелец (`onTabChange`) — своего запроса на монтировании у
  // списка нет, иначе на старте их было бы два.
  useLayoutEffect(() => list.register({
    clear,
    reset: source.reset,
    onChatsScroll: () => requestItemForIdx(0),
  }), [list, clear, source.reset, requestItemForIdx])

  // Канвас-скелетон показываем только на «первом в жизни» заходе — когда
  // IDB-кэша диалогов не было (гейт tweb loadedDialogsAtLeastOnce,
  // autonomousDialogList/base.ts:210-214). Ставим до первой отрисовки, чтобы
  // пустой список не мигнул. `loaded` уже покрывает случай гидрации из кэша:
  // ответ владельца на fillMirror() (кэш прошлой сессии, поднятый воркером)
  // applyDialogOps'ится в reset → loaded=true (chatsStore.ts), а весь холодный
  // старт awaited в boot.ts (applyDialogsMirror) до первого рендера.
  //
  // Цепляется к контейнеру ПРОКРУТКИ, а не к `ul` (tweb: `container:
  // sortedList.list.parentElement`, base.ts:156) — это скроллер владельца.
  const placeholderRef = useRef<DialogsPlaceholder | null>(null)
  useLayoutEffect(() => {
    if (loaded) return
    const placeholder = new DialogsPlaceholder()
    placeholderRef.current = placeholder
    placeholder.attach({ container: scrollHost, blockScrollable: scrollHost })
    return () => placeholder.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз, на монтировании списка папки
  }, [scrollHost])

  // Строки уже в DOM (тот же коммит, что и первая страница при loaded=true) —
  // волна стирания открывает их, а не пустой список (у tweb `detach` зовётся
  // по загрузке, `base.ts:184`). Число строк берётся у источника
  // (`sortedList.itemsLength()`, base.ts:184), а не у витрины всех чатов.
  useEffect(() => {
    if (!loaded || !wasAtLeastOnceFetched) return
    placeholderRef.current?.detach(items.length)
    placeholderRef.current = null
  }, [loaded, wasAtLeastOnceFetched, items.length])

  // Условие показа архива: только когда список поднят, только не в свёрнутой
  // колонке и только при непустом архиве (`archived` приезжает лишь списку «Всех
  // чатов»). До страницы владельца окна нет — и архива в нём тоже
  // (`setPinnedItems([])` у tweb, `deferredSortedVirtualList.tsx:160`). Ссылка на массив стабильна (мемо в Sidebar), поэтому
  // `pinnedItems` не пересоздаётся на каждом рендере — а он входит в `list`
  // виртуального списка, по смене ссылки которого пересчитывается решение
  // анимировать переезд.
  const pinnedArchive = loaded && !collapsed && wasAtLeastOnceFetched && !!onOpenArchive && archived && archived.length > 0
    ? archived
    : null

  const pinnedItems = useMemo<readonly DeferredSortedVirtualListItem<ChatListRowValue>[]>(
    () => (pinnedArchive ? [{ id: ARCHIVE_ROW_ID, value: { archivedChats: pinnedArchive } }] : NO_PINNED_ITEMS),
    [pinnedArchive],
  )

  // Обработчики Sidebar приезжают новыми ссылками на каждом его рендере
  // (инлайновые стрелки), а `renderItem` обязан быть стабильным: он входит в
  // пропсы `memo`-строки, и его смена перерисовывает ВСЁ окно.
  const selectChat = useEvent(onSelect)
  const openArchive = useEvent(() => onOpenArchive?.())

  // Меняется только на смене выделения и режима колонки — на кадре скролла нет.
  const renderItem = useCallback(
    ({ value, itemRef }: DeferredSortedVirtualListRenderItemProps<ChatListRowValue>) => (
      'archivedChats' in value ? (
        <ArchiveRow ref={itemRef} chats={value.archivedChats} onOpen={openArchive} />
      ) : (
        <ChatListItem
          ref={itemRef}
          chat={value}
          selected={value.id === selectedId}
          onSelect={selectChat}
          collapsed={collapsed}
        />
      )
    ),
    [selectedId, collapsed, selectChat, openArchive],
  )

  // tweb: строки лежат в `ul.chatlist` — от неё наследуется половина правил
  // ряда (`.user-title { display: flex }`, цвета статуса/бейджей,
  // `.dialog-subtitle` и т.д., _chatlist.scss). `virtual-chatlist`
  // (_chatlist.scss:471) переносит боковой отступ с `padding` на `margin`:
  // containing block абсолютной строки — padding-box, поэтому боковой padding у
  // `ul` визуально не работал бы. Список в DOM ВСЕГДА (пустой, пока строк нет) —
  // скелетон лежит поверх канвасом, и между ними нет кадра пустого списка.
  return (
    <DeferredSortedVirtualList<ChatListRowValue>
      key={showId}
      className="chatlist virtual-chatlist"
      scrollableHost={scrollHost}
      items={items}
      pinnedItems={pinnedItems}
      totalCount={totalCount}
      wasAtLeastOnceFetched={wasAtLeastOnceFetched}
      itemSize={DIALOG_ITEM_HEIGHT}
      animate={animate}
      requestItemForIdx={requestItemForIdx}
      renderItem={renderItem}
    />
  )
}

export default memo(ChatList)
