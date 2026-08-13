// src/components/ChatList.tsx
// Список диалогов сайдбара: контейнер прокрутки + слайд при смене папки +
// ВИРТУАЛЬНЫЙ список строк (`DeferredSortedVirtualList`, порт tweb
// `deferredSortedVirtualList.tsx` / `verticalVirtualList.tsx`). Строки лежат в
// `ul.chatlist.virtual-chatlist` абсолютом, в DOM живут только видимые; архив —
// закреплённый элемент ВНУТРИ списка (аналог `CustomPinnedDialog`,
// `sortedDialogList.ts`), а не отдельный узел над `ul`.
//
// Компонент вынесен из Sidebar и мемоизирован, чтобы его собственное переходное
// состояние (сворачивание историй на скролле, тоглы оверлеев) не перерисовывало
// список. Контейнер прокрутки прокидывается обратно в Sidebar — там на нём
// висят слушатели fold/reveal.
import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import classNames from '../shared/lib/classNames'
import { TabSlide } from '../shared/ui/Tabs'
import ChatListItem from './ChatListItem'
import ArchiveRow from './ArchiveRow'
import { DialogsPlaceholder } from './chatlist/dialogsPlaceholder'
import DeferredSortedVirtualList, {
  type DeferredSortedVirtualListItem,
  type DeferredSortedVirtualListRenderItemProps,
} from './virtual/DeferredSortedVirtualList'
import { useDialogListSource } from '../core/hooks/useDialogListSource'
import { useEvent } from '../core/hooks/useEvent'
import type { Chat } from '../data'
import s from './ChatList.module.scss'

export interface ChatListProps {
  /**
   * Витрина зеркала целиком (`useChatList()` в Sidebar) — НЕ отфильтрованная по
   * папке: фильтр папки живёт в `useDialogListSource` и там он ровно один
   * (иначе строки и размер набора считались бы разными правилами).
   */
  chats: Chat[]
  selectedId: string
  onSelect: (id: string) => void
  loaded: boolean
  folder: number // id выбранной папки (0 = «Все чаты»)
  folderOrder: readonly number[] // порядок табов для направления слайда
  /** архивные чаты (только в папке «Все») → закреплённый ряд «Архив» в начале списка */
  archived?: Chat[]
  onOpenArchive?: () => void
  /** свернуть список в узкую колонку аватаров (открыта панель форум-тем, tweb .is-collapsed) */
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

const ChatList = forwardRef<HTMLDivElement, ChatListProps>(function ChatList(
  { chats, selectedId, onSelect, loaded, folder, folderOrder, archived, onOpenArchive, collapsed },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Виртуальному списку хост нужен ЗНАЧЕНИЕМ (он вешает на него слушатель скролла
  // и ResizeObserver), а ref о своём заполнении не уведомляет — поэтому рядом с
  // ref держим состояние: первый рендер идёт с null, второй — с живым узлом
  // (штатная ветка `scrollableHost === null` в `VerticalVirtualList`).
  const [scrollHost, setScrollHost] = useState<HTMLDivElement | null>(null)
  const placeholderRef = useRef<DialogsPlaceholder | null>(null)

  // Контейнер скролла нужен и Sidebar'у (fold/reveal на скролле), и плейсхолдеру,
  // и виртуальному списку, поэтому ref разветвлён. Мемоизация обязательна: смена
  // идентичности callback-ref заставила бы React переприсваивать его
  // (null → element) на каждом рендере.
  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    setScrollHost(el)
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }, [ref])

  const { items, totalCount, wasAtLeastOnceFetched, animate, requestItemForIdx } =
    useDialogListSource(folder, chats)

  // Порт `appDialogsManager.onTabChange` (`lib/appDialogsManager.ts:1101`) →
  // `AutonomousDialogList.onChatsScroll()` (`base.ts:144-146` — `requestItemForIdx(0)`):
  // показанная папка просит нулевой индекс. Это ЕДИНСТВЕННЫЙ старт её первой
  // загрузки — без него список не узнает ни `totalCount`, ни
  // `wasAtLeastOnceFetched`, останется в режиме `forceHostHeight` и никогда не
  // прокрутится дальше первого экрана.
  useEffect(() => {
    requestItemForIdx(0)
  }, [folder, requestItemForIdx])

  // Канвас-скелетон показываем только на «первом в жизни» заходе — когда
  // IDB-кэша диалогов не было (гейт tweb loadedDialogsAtLeastOnce,
  // autonomousDialogList/base.ts:210-214). Ставим до первой отрисовки, чтобы
  // пустой список не мигнул. `loaded` уже покрывает случай гидрации из кэша:
  // Task 2 (перенос владения диалогами) — ответ владельца на fillMirror()
  // (кэш прошлой сессии, поднятый воркером) applyDialogOps'ится в reset →
  // loaded=true (chatsStore.ts), а весь холодный старт awaited в boot.ts
  // (applyDialogsMirror) до первого рендера — отдельного флага «подняли из
  // кэша» тут не нужно (он недостижим без loaded=true; мёртвый
  // bootData.hydratedFromCache снесён финальным ревью, Minor #1).
  //
  // Цепляется к контейнеру ПРОКРУТКИ, а не к `ul` (tweb: `container:
  // sortedList.list.parentElement`, base.ts:156) — переезд списка на
  // виртуальный этого не изменил.
  useLayoutEffect(() => {
    if (loaded || !scrollRef.current) return
    const placeholder = new DialogsPlaceholder()
    placeholderRef.current = placeholder
    placeholder.attach({ container: scrollRef.current, blockScrollable: scrollRef.current })
    return () => placeholder.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только на монтировании
  }, [])

  // Строки уже в DOM (тот же коммит, что и loaded=true) — волна стирания
  // открывает их, а не пустой список. Число строк берётся у источника
  // (`sortedList.itemsLength()`, base.ts:184), а не у витрины всех чатов.
  useEffect(() => {
    if (!loaded) return
    placeholderRef.current?.detach(items.length)
    placeholderRef.current = null
  }, [loaded, items.length])

  // Условие показа архива прежнее: только когда список поднят, только не в
  // свёрнутой колонке и только при непустом архиве (папку отсекает Sidebar —
  // `archived` приезжает лишь для «Все чаты»). Ссылка на массив стабильна
  // (мемо в `useSidebarFolders`), поэтому `pinnedItems` не пересоздаётся на
  // каждом рендере — а он входит в `list` виртуального списка, по смене ссылки
  // которого пересчитывается решение анимировать переезд.
  const pinnedArchive = loaded && !collapsed && !!onOpenArchive && archived && archived.length > 0
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

  return (
    // tweb appDialogsManager.setFilterId → `scrollable.container.classList.add(
    // 'tabs-tab', 'chatlist-parts', 'folders-scrollable')` внутри #folders-container.
    // Геометрию и скроллбар даёт `.scrollable.scrollable-y` (_scrollable.scss),
    // верхний отступ под оверлеем табов — `padding-top: var(--chatlist-overlay-height)`
    // у `.folders-scrollable` (_leftSidebar.scss:418).
    //
    // Отступление: в tweb на КАЖДУЮ папку свой .folders-scrollable (свой scrollTop,
    // слайд даёт .tabs-container). У нас пока один контейнер + TabSlide внутри;
    // прежняя причина («список не виртуализирован, N копий по M строк не потянуть»)
    // снята этой задачей — переезд на скроллер каждой папки идёт отдельным шагом
    // (Task 8 плана «Виртуальный список чатов»).
    <div
      ref={setScrollRef}
      className={classNames(
        'scrollable', 'scrollable-y', 'tabs-tab', 'chatlist-parts', 'folders-scrollable', 'active',
        s.scroll, collapsed ? s.collapsed : '',
      )}
    >
      <TabSlide tab={folder} order={folderOrder} className={s.slide}>
        {/* tweb: строки лежат в `ul.chatlist` — от неё наследуется половина правил
            ряда (`.user-title { display: flex }`, цвета статуса/бейджей,
            `.dialog-subtitle` и т.д., _chatlist.scss). `virtual-chatlist`
            (_chatlist.scss:471) переносит боковой отступ с `padding` на `margin`:
            containing block абсолютной строки — padding-box, поэтому боковой
            padding у `ul` визуально не работал бы. Список в DOM ВСЕГДА (пустой,
            пока строк нет) — скелетон лежит поверх канвасом, и между ними нет
            кадра пустого списка. */}
        <DeferredSortedVirtualList<ChatListRowValue>
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
      </TabSlide>
    </div>
  )
})

export default memo(ChatList)
