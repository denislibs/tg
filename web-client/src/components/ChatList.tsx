// src/components/ChatList.tsx
// Список диалогов сайдбара: НА КАЖДУЮ ПАПКУ свой контейнер прокрутки со своим
// ВИРТУАЛЬНЫМ `ul` + слайд при смене папки. Строки лежат в
// `ul.chatlist.virtual-chatlist` абсолютом, в DOM живут только видимые
// (`DeferredSortedVirtualList`, порт tweb `deferredSortedVirtualList.tsx` /
// `verticalVirtualList.tsx`); архив — закреплённый элемент ВНУТРИ списка (аналог
// `CustomPinnedDialog`, `sortedDialogList.ts`), а не отдельный узел над `ul`.
//
// Компонент вынесен из Sidebar и мемоизирован, чтобы его собственное переходное
// состояние (сворачивание историй на скролле, тоглы оверлеев) не перерисовывало
// список. Наружу (в `ref`) отдаётся скроллер АКТИВНОЙ папки — Sidebar на него не
// подписывается, а ЧИТАЕТ его лениво: ряд историй спрашивает `scrollTop` в момент
// жеста (`useCollapsable.ts:124`, сам `wheel` висит на `.connection-status-bottom`)
// и скроллит его в ноль по клику (`Sidebar.tsx`, `onExpand`).
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
import { useManagers } from '../core/hooks/useManagers'
import { ARCHIVE_FOLDER_ID } from '../core/folderIds'
import type { Chat } from '../data'
import s from './ChatList.module.scss'

/** `archiveDialog.tsx:27` — страница архива, которой живёт строка «Архив»
 *  (там же её лимит показа имён, см. `ArchiveRow.LIMIT`). */
const ARCHIVE_ROW_LIMIT = 10

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
  /**
   * Все табы папок в порядке отображения. Определяет: (1) направление слайда
   * (вперёд/назад по этому порядку) и (2) состав живых кадров — папка, ушедшая
   * из `folderOrder`, уходит из DOM вместе со своим скроллером (`keepMounted`,
   * `shared/ui/Tabs/TabSlide.tsx`). Выбранная папка при этом остаётся
   * отрисованной, даже если её самой в списке уже нет: рассинхрон чинит владелец
   * выбора (`stores/foldersStore.ts::applyFolderUpdate`), а не список.
   */
  folderOrder: readonly number[]
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
  // Скроллеры живых папок: кадр слайда И ЕСТЬ скроллер папки, а `keepMounted`
  // держит в DOM все уже показанные кадры (см. `<TabSlide>` ниже).
  const scrollers = useRef(new Map<number, HTMLDivElement>())

  const setFolderScroller = useCallback((forFolder: number, el: HTMLDivElement | null) => {
    if (el) scrollers.current.set(forFolder, el)
    // Ветка снятия СОЗНАТЕЛЬНО не покрыта тестом: наблюдаемой разницы у неё нет
    // (у активной папки кадр всегда жив, а вернувшаяся папка перезапишет запись
    // своим новым узлом) — она о том, чтобы не держать мёртвые узлы удалённых
    // папок до размонтирования всего списка.
    else scrollers.current.delete(forFolder)
  }, [])

  const publishScroller = (el: HTMLDivElement | null) => {
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  // НАРУЖУ (Sidebar) отдаётся скроллер АКТИВНОЙ папки: ряд историй спрашивает
  // «прокручен ли список» (`useCollapsable`, порт tweb `scrollable`) и скроллит
  // его в ноль по клику — оба вопроса про тот список, который сейчас перед
  // глазами, а не про соседний кадр. Синхронизация — layout-эффектом БЕЗ deps:
  // ref-колбэк кадра успевает отработать в фазе мутации того же коммита, а
  // возврат на уже показанную папку своих ref-колбэков не рождает вовсе (узел
  // не пересоздаётся) — без эффекта наружу торчал бы скроллер прошлой папки.
  //
  // Cleanup обязателен: ref мы наполняем сами, и без него на размонтировании
  // снаружи остался бы оторванный от документа узел (настоящий ref React обнулил
  // бы). Между перезапусками эффекта обнуление не наблюдаемо — cleanup и эффект
  // идут в одной layout-фазе, без отрисовки между ними.
  useLayoutEffect(() => {
    publishScroller(scrollers.current.get(folder) ?? null)
    return () => publishScroller(null)
  })

  return (
    // tweb: на КАЖДЫЙ фильтр свой `new Scrollable`
    // (`autonomousDialogList/dialogs.ts:207-238`, `generateScrollable`), которому
    // `appDialogsManager.addFilter` вешает `tabs-tab chatlist-parts folders-scrollable`
    // и кладёт в `#folders-container` (`lib/appDialogsManager.ts:1262-1281`), —
    // то есть КАДР слайда и есть скроллер папки. Прежнее отступление (один общий
    // контейнер на все папки, «список не виртуализирован, N копий по M строк не
    // потянуть») снято: в DOM у каждой папки живут только строки её окна.
    //
    // Геометрию и скроллбар даёт `.scrollable.scrollable-y` (_scrollable.scss),
    // верхний отступ под оверлеем табов — `padding-top: var(--chatlist-overlay-height)`
    // у `.folders-scrollable` (_leftSidebar.scss:411-418): переменную Sidebar
    // ставит на общего предка (`.connection-status-bottom`), поэтому её видит
    // каждый кадр, сколько бы их ни было (пин — `Sidebar.chatlist.test.tsx`).
    <TabSlide
      tab={folder}
      order={folderOrder}
      // Показанная папка остаётся в DOM — иначе она теряла бы свой `scrollTop`
      // (в tweb скроллер фильтра создаётся один раз и живёт дальше сам).
      keepMounted
      className={classNames(
        'scrollable', 'scrollable-y', 'chatlist-parts', 'folders-scrollable',
        s.scroll, collapsed ? s.collapsed : '',
      )}
    >
      <ChatListFolder
        folder={folder}
        chats={chats}
        selectedId={selectedId}
        onSelect={onSelect}
        loaded={loaded}
        archived={archived}
        onOpenArchive={onOpenArchive}
        collapsed={collapsed}
        setScroller={setFolderScroller}
      />
    </TabSlide>
  )
})

/**
 * Список ОДНОЙ папки — аналог `AutonomousDialogList` одного фильтра
 * (`autonomousDialogList/dialogs.ts`): свой курсор загрузки
 * (`useDialogListSource`), свой `ul` и свой `scrollTop` (он на кадре слайда).
 */
function ChatListFolder({
  folder, chats, selectedId, onSelect, loaded, archived, onOpenArchive, collapsed, setScroller,
}: Omit<ChatListProps, 'folderOrder'> & {
  /** отдать свой скроллер наружу — из них ChatList выбирает активный */
  setScroller: (folder: number, el: HTMLDivElement | null) => void
}) {
  // Виртуальному списку хост нужен ЗНАЧЕНИЕМ (он вешает на него слушатель
  // скролла и ResizeObserver), поэтому это состояние: первый рендер идёт с null,
  // второй — с живым узлом (штатная ветка `scrollableHost === null` в
  // `VerticalVirtualList`).
  const [scrollHost, setScrollHost] = useState<HTMLDivElement | null>(null)
  const placeholderRef = useRef<DialogsPlaceholder | null>(null)

  // Скроллер папки — сам КАДР слайда (в tweb классы скроллера висят на узле
  // таба, `appDialogsManager.ts:1262`), а владеет им TabSlide; список берёт его
  // как родителя своего `ul`. Ref обязан быть СТАБИЛЬНЫМ: смена идентичности
  // заставила бы React переприсваивать его (null → element) на каждом рендере,
  // то есть на каждом рендере пересобирать окно видимости.
  const setListEl = useCallback((ul: HTMLUListElement | null) => {
    const host = (ul?.parentElement ?? null) as HTMLDivElement | null
    setScrollHost(host)
    setScroller(folder, host)
  }, [folder, setScroller])

  const { items, totalCount, wasAtLeastOnceFetched, animate, requestItemForIdx } =
    useDialogListSource(folder, chats)

  const managers = useManagers()
  /**
   * Порт `AutonomousDialogList.ensureArchiveDialogHydrated`
   * (`autonomousDialogList/dialogs.ts:248-276`): список, который несёт строку
   * «Архив», сам и просит её страницу — в оригинале состояние строки тянет
   * `getDialogs({filterId: FOLDER_ID_ARCHIVE, limit: 10})`
   * (`archiveDialog.tsx:27,124-137`) и показывает ряд, если та непуста.
   *
   * Без этого запроса строки не бывает ВОВСЕ: её гейт — архивные диалоги в
   * зеркале (`pinnedArchive` ниже), первичный `refresh()` теперь страничный и
   * старый архив в первое окно не попадает, а страницы «Всех чатов» уходят с
   * `folder_id=0` и архив не принесут никогда (спека
   * `2026-08-13-dialogs-count-and-refresh-design.md`, «Дополнение: вход в архив»).
   *
   * Ответ здесь НЕ читается и никуда не пишется: владелец объявляет страницу
   * сам (`upsert` → `rt:dialog_op` → проектор → зеркало), витрина своего вывода
   * того же факта не держит (`web-client/CLAUDE.md`, «Владение фактами»).
   * `.catch` — как у прочих fire-and-forget колсайтов владельца (офлайн/401
   * оставляют список на кэше, unhandled rejection не плодим).
   *
   * Гейт `hasArchiveRow` — тот же, что у самой строки: `onOpenArchive` приезжает
   * от Sidebar только списку «Всех чатов». Зависимость БУЛЕВА, а не сам
   * колбэк: Sidebar пересоздаёт стрелку на каждом рендере, и запрос уходил бы
   * заново на каждый его рендер.
   *
   * Второе условие — `archiveEmpty` — это порт правила перезапроса
   * (`archiveDialog.tsx:163-171`: архив в состоянии строки СОКРАТИЛСЯ — просим
   * его страницу заново). У нас архив пропадает из зеркала штатно: `refresh()`
   * читает окно ГЛОБАЛЬНОЙ выборки и применяет его полной подменой
   * (`dialogsManager.ts::setAll`), а старые архивные диалоги в это окно не
   * входят. Без перезапроса строка «Архив» исчезала бы на первом же из
   * девятнадцати колсайтов `refresh()` и до конца сеанса. Пока архив в зеркале
   * непуст, зависимость не меняется — то есть запрос ровно один.
   */
  const hasArchiveRow = !!onOpenArchive
  const archiveEmpty = !archived?.length
  useEffect(() => {
    if (!hasArchiveRow || !archiveEmpty) return
    void managers.dialogs.getDialogs({ filterId: ARCHIVE_FOLDER_ID, limit: ARCHIVE_ROW_LIMIT }).catch(() => {})
  }, [hasArchiveRow, archiveEmpty, managers])

  // Порт `appDialogsManager.onTabChange` (`lib/appDialogsManager.ts:1101`) →
  // `AutonomousDialogList.onChatsScroll()` (`base.ts:144-146` — `requestItemForIdx(0)`):
  // показанная папка просит нулевой индекс. Это ЕДИНСТВЕННЫЙ старт её первой
  // загрузки — без него список не узнает ни `totalCount`, ни
  // `wasAtLeastOnceFetched`, останется в режиме `forceHostHeight` и никогда не
  // прокрутится дальше первого экрана. Папка у экземпляра своя и не меняется
  // (кадр ключуется ею), так что это ровно ПЕРВЫЙ показ папки: возврат на уже
  // показанную страницу не перезапрашивает.
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
  // sortedList.list.parentElement`, base.ts:156). Хост приезжает вторым
  // рендером (см. `setListEl`), поэтому эффект ждёт его — и всё равно успевает
  // до отрисовки: правку состояния из ref-колбэка React доигрывает синхронно.
  useLayoutEffect(() => {
    if (loaded || !scrollHost) return
    const placeholder = new DialogsPlaceholder()
    placeholderRef.current = placeholder
    placeholder.attach({ container: scrollHost, blockScrollable: scrollHost })
    return () => placeholder.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз, на появлении скроллера папки
  }, [scrollHost])

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
    <>
      {/* tweb: строки лежат в `ul.chatlist` — от неё наследуется половина правил
          ряда (`.user-title { display: flex }`, цвета статуса/бейджей,
          `.dialog-subtitle` и т.д., _chatlist.scss). `virtual-chatlist`
          (_chatlist.scss:471) переносит боковой отступ с `padding` на `margin`:
          containing block абсолютной строки — padding-box, поэтому боковой
          padding у `ul` визуально не работал бы. Список в DOM ВСЕГДА (пустой,
          пока строк нет) — скелетон лежит поверх канвасом, и между ними нет
          кадра пустого списка. */}
      <DeferredSortedVirtualList<ChatListRowValue>
        listRef={setListEl}
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
      {/* tweb `addFilter`: `scrollable.append(top, bottom)` — пустой
          `.chatlist-bottom` за списком (`lib/appDialogsManager.ts:1271-1277`);
          у нас он же держит клиренс под compose-FAB. Обёртки `.chatlist-top`
          вокруг `ul` нет: её правила живут только под
          `.chatlist-parts.with-contacts` (_chatlist.scss:399-414), а список
          контактов не портирован. */}
      <div className={classNames('chatlist-bottom', s.bottom)} />
    </>
  )
}

export default memo(ChatList)
