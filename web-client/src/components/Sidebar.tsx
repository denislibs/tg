import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isUserCollapsedLeft, setOpenTabsLeftSidebar } from '../core/dom/updateColumnWidths'
import installColumnResize from '../core/dom/installColumnResize'
import PendingSuggestion from './sidebarLeft/pendingSuggestion'
import classNames from '../shared/lib/classNames'
import s from './Sidebar.module.scss'
import { useChatsStore } from '../stores/chatsStore'
import { ARCHIVE_FOLDER_ID } from '../core/folderIds'
import ChatList from './ChatList'
import ChatListItem from './ChatListItem'
import DeferredSortedVirtualList, {
  type DeferredSortedVirtualListRenderItemProps,
} from './virtual/DeferredSortedVirtualList'
import { useDialogListSource } from '../core/hooks/useDialogListSource'
import { useEvent } from '../core/hooks/useEvent'
import type { Chat } from '../data'
import FoldersSidebar, { type MainMenuHandlers } from './folders/FoldersSidebar'
import type { FolderContextMenuSidebar } from '../helpers/dom/createFolderContextMenu'
import { createSettingsSliderHost, type SettingsSliderHost } from './sidebarLeft/settingsSliderHost'
import { AppChatFoldersTab, AppEditFolderTab } from './solidJsTabs/tabs'
import type { SliderSuperTabConstructable } from './sliderTab'
import type SliderSuperTab from './sliderTab'
import { toastNew } from './toast'
import pause from '../helpers/schedulers/pause'
import { useSettings, useSettingsStore } from '../settings'
import useMediaQuery from '../shared/lib/useMediaQuery'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import createLockButton from './sidebarLeft/lockButton.solid'
import SidebarMenuButton from './SidebarMenuButton'
import SidebarEmojiStatusButton from './SidebarEmojiStatusButton'
import ComposeFab from './ComposeFab'
import PremiumModal from './PremiumModal'
import StoriesRow from './StoriesRow'
import SidebarScreens, { type SidebarScreen } from './SidebarScreens'
import { useManagers } from '../core/hooks/useManagers'
import { useChatList } from '../core/hooks/useChatList'
import { useNavigationStore } from '../stores/navigationStore'
import { useChatStackStore, selectOpenThreadDesc } from '../stores/chatStackStore'
import { useNavigationActions } from '../core/hooks/useNavigationActions'
import { openPopup } from '../stores/popupStore'
import InputSearch from '../shared/ui/InputSearch'
import { useT } from '../i18n'
import { useGlobalSearch } from '../core/hooks/useGlobalSearch'
import { useSidebarActions } from '../core/hooks/useSidebarActions'
import { useSidebarStories } from '../core/hooks/useSidebarStories'
import { useForumPanel } from '../core/hooks/useForumPanel'
import { useImperativeIsland } from '../core/hooks/useImperativeIsland'
import { useFolders } from '../stores/foldersStore'
import { AppDialogsManager } from '../lib/appDialogsManager'
import { useFoldersSidebarShown, useIsSidebarCollapsed } from '../stores/foldersSidebar.solid'
import ConnectionStatusComponent from './connectionStatus'
import type { InputSearchStatus } from '../shared/ui/InputSearch'
import type InputSearchHandle from '../shared/ui/InputSearch/inputSearchHandle'

interface Props {
  onToggleMode: (coords?: { x: number; y: number }) => void
  onLogout?: () => void
  fullWidth?: boolean
  /** префилл поиска (deep-open с публичной страницы /?domain=username) */
  initialQuery?: string
}

// Sidebar — оркестратор левой колонки: композиция хуков (поиск/папки/истории/
// форум/создание чатов) + разметка шапки, списка и оверлеев. Кластеры логики
// вынесены в core/hooks/useSidebar*; экраны колонки — в <SidebarScreens>.
// Навигация и список чатов читаются из стора напрямую (инвариант: View читает из
// стора, а не через проброс из Shell) — тема/авторизация остаются пропсами (скоуп App).
export default function Sidebar({
  onToggleMode,
  onLogout,
  fullWidth = false,
  initialQuery,
}: Props) {
  const managers = useManagers()
  const t = useT()
  const loaded = useChatsStore((st) => st.loaded)
  const passcodeEnabled = useSettingsStore((st) => st.passcodeEnabled)
  // Кнопка эмодзи-статуса в шапке — только у подписчика Premium (tweb
  // `onPremium` → `toggleRightButtons`, `sidebarLeft/index.ts`).
  const isPremium = useChatsStore((st) => !!st.me?.user.pFlags?.premium)
  const emojiStatus = useChatsStore((st) => st.me?.user.emoji_status_emoticon)
  // Плейсхолдер и спиннер поля поиска ведёт автомат состояния соединения (порт
  // tweb ConnectionStatusComponent), поэтому пропа `placeholder` у InputSearch
  // здесь нет: единственный писатель — автомат. Хэндл трёх его методов приезжает
  // отдельным `statusRef` (основной `ref` — сам input, его берёт ряд историй).
  const searchStatusRef = useRef<InputSearchStatus>(null)
  // Эффект слоя РАСКЛАДКИ, а не обычный: `construct()` ставит плейсхолдер
  // (tweb :45 делает это синхронно в конструкторе), и он должен быть на узле до
  // первой отрисовки — из пассивного эффекта поле поиска на первом кадре пустое.
  // Тем же слоем и по той же причине его ставил прежний layout-эффект самого
  // InputSearch. Порядок гарантирован React'ом: эффекты бегут снизу вверх,
  // поэтому `useImperativeHandle` ребёнка уже выставил хэндл (пин — в
  // `connectionStatus.test.ts`, «монтирование хостом»), а вся проводка целиком —
  // в `Sidebar.connectionStatus.test.tsx` (краснеет и на снятом `statusRef`, и
  // на снятом эффекте, и на снятом cleanup). Непокрыт ровно один оттенок: сама
  // подмена слоя на пассивный `useEffect` тестом не ловится — `act()` прогоняет
  // до возврата `render()` оба вида эффектов, а момент отрисовки в happy-dom не
  // наблюдаем. Держится этим комментарием.
  useLayoutEffect(() => {
    const status = searchStatusRef.current
    if (!status) return
    const connectionStatus = new ConnectionStatusComponent()
    connectionStatus.construct(managers, status)
    return () => connectionStatus.destroy()
  }, [managers])
  // Узлы, которые нужны сворачиванию ряда историй (tweb setScrolledOn / listenWheelOn)
  // и владельцу папок (`#chatlist-container`, хост `.connection-status-bottom`).
  const chatlistContainerRef = useRef<HTMLDivElement>(null)
  const bottomPartRef = useRef<HTMLDivElement>(null)
  // Владелец контейнеров папок и их переключения — порт папочного среза tweb
  // `appDialogsManager` (`lib/appDialogsManager.ts`). Экземпляр на колонку: она
  // монтируется и размонтируется (расхождение 1 его шапки).
  const [dialogsManager] = useState(() => new AppDialogsManager())

  // Навигация — из navigationStore/useNavigationActions напрямую; список чатов —
  // свой селектор (та же useChatList, что и в Shell; вторая подписка — норма).
  const chats = useChatList()
  const selectedId = useNavigationStore((st) => st.selectedId) ?? ''
  // Возвращает примитив (не сам дескриптор) — селектор подписки безопасен и
  // без selectOpenThreadDesc, но переиспользуем её ради единого API «открыт ли
  // тред» (см. её докблок в chatStackStore.ts про безопасность подписки по ссылке).
  const activeTopicId = useChatStackStore((st) => {
    const open = selectOpenThreadDesc(st)
    return open?.thread.kind === 'topic' ? open.thread.rootMsgId : null
  })
  const onSelect = useNavigationStore((st) => st.selectChat)
  const { openTopicThread: onOpenTopic, onChatCreated, openPeer: onOpenPeer } = useNavigationActions()

  // Экраны левой колонки взаимоисключающие — один стейт-энум (см. <SidebarScreens>).
  const [screen, setScreen] = useState<SidebarScreen>(null)
  const closeScreen = () => setScreen(null)
  const [archiveOpen, setArchiveOpen] = useState(false)

  // Поле поиска шапки: `inputRef` — сам `<input>` (сворачивание ряда историй),
  // `inputSearchRef` — объект-поле tweb (`InputSearchHandle`), которое читает
  // и пишет владелец глобального поиска.
  const inputRef = useRef<HTMLInputElement>(null)
  const inputSearchRef = useRef<InputSearchHandle>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const backBtnRef = useRef<HTMLDivElement>(null)
  // ОТРАЖЕНИЕ владельца поиска (`onSearchActive`, роль сигнала
  // `isSearchActive` tweb, :1484/:1498), а не его источник: морф бургера, FAB,
  // замок, `has-open-tabs`. Классы перехода React не ставит — см. разметку.
  const [searching, setSearching] = useState(false)
  const stories = useSidebarStories()
  const actions = useSidebarActions(onChatCreated)
  const { handleSelect, forumChat, closeForum, panel: forumPanel } = useForumPanel({ chats, onSelect, activeTopicId, onOpenTopic })
  // Владелец поиска (порт `initSearch`, `components/sidebarLeft/globalSearch.ts`);
  // шов и расхождения — шапка `core/hooks/useGlobalSearch.ts`.
  const searchOwnerRef = useGlobalSearch({
    searchContainerRef,
    inputSearchRef,
    backBtnRef,
    onSearchActive: setSearching,
    initialQuery,
  })

  const folders = useFolders()
  // Вкладки папок поверх списка чатов — «Папки» и редактор папки (tweb
  // `appSidebarLeft.createTab(AppChatFoldersTab | AppEditFolderTab).open(…)`,
  // `createFolderContextMenu.ts:27-49`, `foldersSidebarContent/index.tsx:207-215`).
  // Колоночного слайдера у нас ещё нет (шов, задача 28 плана 2D), поэтому
  // открытие заводит хост слайдера над колонкой (`settingsSliderHost.ts` — тот же
  // слой, что у вкладок настроек) и открывает вкладку в нём: закрытие последней
  // вкладки возвращает к списку чатов, как у оригинала. Хост один на колонку:
  // новое открытие снимает прежний (уже пустой) хост, экран настроек — тоже.
  const columnTabsHostRef = useRef<SettingsSliderHost | null>(null)
  // `has-open-tabs`, пока вкладка открыта (tweb `onTabsCountChange` →
  // `onSomethingOpenInsideChange`, `sidebarLeft/index.ts:547-569`)
  const [columnTabsOpen, setColumnTabsOpen] = useState(false)
  const openColumnTab = <T extends SliderSuperTab>(ctor: SliderSuperTabConstructable<T>, ...args: Parameters<T['init']>) => {
    const host = createSettingsSliderHost(columnRef.current!, managers)
    columnTabsHostRef.current = host
    setColumnTabsOpen(true)
    host.onTabsEmpty(() => setColumnTabsOpen(false))
    void host.openTab(ctor, ...args).catch(() => toastNew({ langPackKey: 'Error.AnError' }))
  }
  useEffect(() => () => columnTabsHostRef.current?.destroy(), [])

  // Мемоизировано, чтобы <ChatList> получал стабильный проп — ре-рендер
  // сайдбара под тогл оверлея не пересоздаёт массив и не бьёт его memo.
  const archivedChats = useMemo(() => chats.filter((c) => !!c.archived), [chats])

  // Вьюпортная модалка Premium — через глобальный popupStore (не экран колонки).
  const openPremium = () => openPopup((p) => (
    <PremiumModal open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} />
  ))

  // «Расположение папок → Слева от чатов» (tweb tabsInSidebar): вертикальная колонка
  // вместо горизонтальных табов; на узких экранах скрыта (tweb until-floating-left-sidebar).
  const tabsInSidebar = useSettings((st) => st.tabsInSidebar)
  const narrowScreen = useMediaQuery('(max-width:900px)')
  const foldersSidebarShown = tabsInSidebar && folders.length > 0 && !narrowScreen && !fullWidth

  // --- Ресайз левой колонки (tweb sidebarLeft/index.ts:612-635 initSidebarResize) ---
  const columnRef = useRef<HTMLDivElement>(null)
  // tweb hasSomethingOpenInside(): открытые вкладки | активный поиск | форум-таб.
  const somethingOpenInside = searching || screen !== null || archiveOpen || columnTabsOpen || !!forumChat
  // tweb isCollapsed(): в floating-диапазоне (<=925) колонка всегда развёрнута,
  // предпочтение просто помнится для широких вьюпортов.
  const floatingLeft = useMediaQuery('(max-width:925px)')
  const [collapsedPref, setCollapsedPref] = useState(isUserCollapsedLeft)
  const collapsed = collapsedPref && !floatingLeft && !fullWidth
  // Режим папок (tweb `stores/foldersSidebar.ts:90-112`): стор решает,
  // горизонтальный ряд или вертикальная колонка, и ставит `body.has-*-folders`
  // (он же резервирует место колонке — `setFoldersSidebarShown`). «Показана» и
  // «свёрнута» сообщает колонка — она их рисует (расхождения 1 и 3 шапки
  // стора). Слой раскладки: класс должен смениться до кадра, где колонка уже
  // нарисована, иначе на один кадр видны и ряд, и колонка. Размонтирование
  // сбрасывает оба факта — колонки на экране больше нет.
  useLayoutEffect(() => {
    const [, setShown] = useFoldersSidebarShown()
    setShown(foldersSidebarShown)
    return () => { setShown(false) }
  }, [foldersSidebarShown])
  useLayoutEffect(() => {
    const [, setIsSidebarCollapsed] = useIsSidebarCollapsed()
    setIsSidebarCollapsed(collapsed)
    return () => { setIsSidebarCollapsed(false) }
  }, [collapsed])
  // Ручка вешается один раз на живой узел — актуальные значения читаются из рефов.
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed
  const openInsideRef = useRef(somethingOpenInside)
  openInsideRef.current = somethingOpenInside
  useEffect(() => {
    const columnEl = columnRef.current
    if (!columnEl) return
    // Не портированы побочные эффекты tweb-колбэка onCollapsedChange
    // (fade/zoom-fade у чатлиста, бейджи непрочитанного на аватарах, подсказка
    // Ctrl+F) и onSwipeTick → adjustChatPatternBackground: у нас нет этих подсистем.
    return installColumnResize({
      columnEl,
      side: 'left',
      isCollapsed: () => collapsedRef.current,
      setCollapsed: setCollapsedPref,
      preventCollapse: () => openInsideRef.current,
    })
  }, [])
  // tweb onSomethingOpenInsideChange: свёрнутая колонка всплывает до полной
  // ширины, пока внутри что-то открыто (sidebarLeft/index.ts:535).
  useEffect(() => { setOpenTabsLeftSidebar(somethingOpenInside) }, [somethingOpenInside])

  // `appSidebarLeft.closeAllTabs()` — экраны колонки (у tweb это вкладки
  // слайдера: экран-вкладка, архив, редактор папки). Отвечает, было ли что
  // закрывать.
  const closeAllTabsRef = useRef<() => boolean>(() => false)
  closeAllTabsRef.current = () => {
    const hadTabs = screen !== null || archiveOpen || columnTabsOpen
    setScreen(null)
    setArchiveOpen(false)
    columnTabsHostRef.current?.destroy()
    columnTabsHostRef.current = null
    setColumnTabsOpen(false)
    return hadTabs
  }
  // `appSidebarLeft.closeEverythingInside()` (tweb `sidebarLeft/index.ts:494-499`):
  // поиск, форум, вкладки. Им же отвечает колбэк владельцу папок
  // `closeEverythingInsideNaturally` (`:505-516`) — переключение папки
  // закрывает то, что открыто в колонке. Хуки владельцу отдаются один раз,
  // поэтому состояние читается через ref. Отказа (вкладка просит
  // подтверждения, `closeAllTabsNaturally`) у наших экранов нет — владельцу
  // ответ всегда `true`.
  const closeEverythingInsideRef = useRef<() => boolean>(() => false)
  closeEverythingInsideRef.current = () => {
    // tweb `closeSearch()` (:1583-1585) — клик по стрелке «назад» владельца
    if (searching) searchOwnerRef.current?.closeSearch()
    closeForum()
    return closeAllTabsRef.current()
  }
  // То, что меню папки (`createFolderContextMenu`, оба ряда) берёт у колонки —
  // у tweb `appSidebarLeft` и классы вкладок. Объект один на жизнь колонки:
  // его получают владелец папок (хуки `start()`) и вертикальная колонка.
  const [appSidebarLeft] = useState<FolderContextMenuSidebar>(() => ({
    // tweb `sidebarLeft/index.ts:1613-1616`: пауза — на уход закрытой вкладки
    closeTabsBefore: async (clb) => {
      if (closeEverythingInsideRef.current()) await pause(200)
      clb()
    },
    openEditFolderTab: (filter) => openColumnTab(AppEditFolderTab, { ...AppEditFolderTab.getInitArgs(), initFilter: filter }),
    openChatFoldersTab: () => openColumnTab(AppChatFoldersTab, AppChatFoldersTab.getInitArgs()),
  }))
  // Кнопка настроек вертикальной колонки папок (tweb
  // `foldersSidebarContent/index.tsx:203-216`: `closeTabsBefore` → `AppChatFoldersTab`).
  // Флаг `openingChatFolders` оригинала не нужен: `closeTabsBefore` и так
  // закрывает открытую вкладку папок до новой.
  const openFolderSettings = () => {
    appSidebarLeft.closeTabsBefore(() => appSidebarLeft.openChatFoldersTab())
  }
  const forumOpenRef = useRef(false)
  forumOpenRef.current = !!forumChat
  // Плашка-подсказка рисуется порталом в узел владельца (tweb `:1079-1082`);
  // узел появляется со `start()`, поэтому это состояние.
  const [suggestionContainer, setSuggestionContainer] = useState<HTMLElement>()

  // Владелец въезжает в `.connection-status-bottom` (tweb `start()`,
  // `:587-604`): кладёт туда `.chatlist-overlay` и `#folders-container`, ставит
  // `--chatlist-overlay-height` на хост и `has-filters` на `#chatlist-container`.
  // Хост приходит чужим ref'ом — к layout-фазе Sidebar оба узла уже в DOM (у
  // ref-колбэка хоста `#chatlist-container` ещё не был бы привязан: React
  // цепляет ref'ы детей раньше родителя).
  useImperativeIsland((host) => {
    // Первый `onClick(0, false)` владелец делает ВНУТРИ `start()` (tweb
    // `:1064-1065`), и у tweb в этот момент в колонке ничего не открыто. У нас
    // открытым может быть поиск — префилл deep-open (`initialQuery`), — но
    // колонка на этом кадре его ещё не видит: `searching` — отражение владельца
    // поиска и приходит следующим рендером, а `closeEverythingInsideRef` —
    // замыкание первого. Стартовый показ «Всех чатов» поиск не закрывает (пин —
    // `Sidebar.chatlist.test.tsx`, «deep-open с префиллом поиска»).
    dialogsManager.start(host, chatlistContainerRef.current!, {
      closeEverythingInsideNaturally: () => {
        closeEverythingInsideRef.current()
        return true
      },
      isForumOpen: () => forumOpenRef.current,
      appSidebarLeft,
      managers,
    })
    setSuggestionContainer(dialogsManager.suggestionContainer)
    return () => dialogsManager.destroy()
  }, [], { host: bottomPartRef })

  // Кнопка замка (tweb `toggleRightButtons`, `sidebarLeft/index.ts:345-352`) —
  // ванильный узел порта `sidebarLeft/lockButton.solid.tsx`: при включённом коде
  // шапка дописывает его последним, после кнопки статуса, и снимает при
  // выключении. Смена Premium пересобирает замок, чтобы он остался последним.
  const lockButtonHostRef = useImperativeIsland((header) => {
    if (!passcodeEnabled) return
    const lockButton = createLockButton()
    header.append(lockButton.element)
    return () => {
      lockButton.element.remove()
      lockButton.dispose()
    }
  }, [passcodeEnabled, isPremium])

  // Свёрнутая колонка аватаров при открытом форуме — клиренс под FAB у
  // скроллеров папок снимает владелец (его узлы, расхождение 19).
  useLayoutEffect(() => {
    dialogsManager.setCollapsed(!!forumChat)
  }, [dialogsManager, forumChat])

  // Меню бургера и вертикальной колонки папок — один набор обработчиков на оба места.
  const menuActions: MainMenuHandlers = {
    onOpenSettings: () => setScreen('settings'),
    onOpenContacts: () => setScreen('contacts'),
    onOpenSaved: async () => {
      const id = await managers.chats.saved()
      await managers.dialogs.refresh()
      onSelect(String(id))
    },
    onOpenPremium: openPremium,
    onOpenMyStories: stories.openArchive,
    onOpenCloseFriends: stories.openCloseFriends,
    onOpenWallet: () => setScreen('wallet'),
    onOpenCalls: () => setScreen('calls'),
    onLogout,
    onToggleMode,
  }

  return (
    <div
      // #column-left — как в tweb (живой DOM §1); --folders-sidebar-offset и
      // остальные ширины колонок пишет core/dom/updateColumnWidths.
      id="column-left"
      ref={columnRef}
      className={classNames(s.root, 'tabs-tab', 'chatlist-container', 'sidebar', 'sidebar-left', 'main-column', 'sidebar-left-common', 'can-menu-have-z-index', collapsed ? 'is-collapsed' : '', somethingOpenInside ? 'has-open-tabs' : '', fullWidth ? s.fullWidth : '', forumChat ? s.hasForum : '')}
    >
      {/* tweb #folders-sidebar — вертикальная колонка папок в поле страницы */}
      {foldersSidebarShown && (
        <FoldersSidebar
          folders={folders}
          appSidebarLeft={appSidebarLeft}
          managers={managers}
          onOpenFolderSettings={openFolderSettings}
          menu={menuActions}
        />
      )}
      {/* Дальше — дерево tweb 1:1 (живой DOM §2):
          .sidebar-slider.tabs-container > .tabs-tab.sidebar-slider-item.item-main.active
            > .sidebar-header.main-search-sidebar-header
            + .stories-list
            + .sidebar-content > #chatlist-container.transition-item > .connection-status-bottom
                                 + #search-container.transition-item.sidebar-search
                                 + кнопка «новый чат» */}
      <div className={classNames('sidebar-slider', 'tabs-container', s.slider)}>
      {/* `is-search-active` на .item-main ставит владелец поиска
          (`onTransitionStart`, tweb sidebarLeft/index.ts:1431) — через него
          гаснет ряд историй (_storiesList.scss); `className` постоянный. */}
      <div className={classNames('tabs-tab', 'sidebar-slider-item', 'item-main', 'active', s.sliderItem)}>
      {/* `is-input-the-last-child` — tweb `toggleRightButtons`: поле поиска
          последнее, когда справа нет ни кнопки статуса, ни замка. */}
      <div ref={lockButtonHostRef} className={classNames('sidebar-header', 'main-search-sidebar-header', 'can-have-forum', !isPremium && !passcodeEnabled ? 'is-input-the-last-child' : '', s.header)}>
        {/* Бургер в DOM всегда (tweb `index.html:93-96`): в нём стрелка
            «назад» — узел владельца поиска, ссылку на него владелец держит с
            монтирования колонки. При показанной колонке папок бургер прячется
            (`hide`), пока поиск закрыт — у колонки свой триггер меню (у tweb то
            же делает `body.has-folders-sidebar .left-sidebar-burger:not(.is-visible)`,
            расхождение 2 шапки `stores/foldersSidebar.solid.ts`). */}
        <div className={classNames('sidebar-header__btn-container', 'left-sidebar-burger', foldersSidebarShown && !searching ? 'hide' : '')}>
          <SidebarMenuButton searching={searching} backBtnRef={backBtnRef} {...menuActions} />
        </div>
        <InputSearch
          ref={inputRef}
          searchRef={inputSearchRef}
          statusRef={searchStatusRef}
          className={classNames('old-style', s.search)}
          focused={searching}
        />
        {isPremium && <SidebarEmojiStatusButton emoji={emojiStatus} />}
      </div>
      {/* tweb: ряд историй ВСЕГДА в дереве (высотой 0), гаснет через
          .is-search-active на .item-main; свёрнут/развёрнут — useCollapsable */}
      {!forumChat && (
        <div className="stories-list">
          <StoriesRow
            onOpen={stories.openViewer}
            onAddStory={stories.pickStoryFile}
            foldInto={() => inputRef.current}
            setScrolledOn={() => chatlistContainerRef.current}
            // скроллер АКТИВНОЙ папки — `xd` владельца (`appDialogsManager.ts:723`)
            getScrollable={() => dialogsManager.xd?.scrollable.container ?? null}
            listenWheelOn={() => bottomPartRef.current}
            onExpand={() => dialogsManager.xd?.scrollable.container.scrollTo({ top: 0, behavior: 'smooth' })}
          />
        </div>
      )}

      {/* tweb .sidebar-content — общий слой чатлиста, выдачи поиска и FAB */}
      <div className={classNames('sidebar-content', 'transition', 'zoom-fade', 'can-have-forum', s.content)}>
      {/* #chatlist-container несёт --stories-scrolled, .connection-status-bottom
          на него сдвигается (translateY(92px - var(--stories-scrolled))) */}
      {/* `.transition > .transition-item:not(.active)` — display:none !important
          (_transition.scss:12). `active` носит ровно один из двух узлов, и
          переводит его `TransitionSlider` 'zoom-fade' владельца поиска
          (tweb sidebarLeft/index.ts:1425-1449) вместе с `from/to/animating`.
          `className` ПОСТОЯННЫЙ: React пишет его один раз (стартовый `active` —
          статический каркас tweb `index.html:99`) и больше не трогает, иначе
          ре-рендер стёр бы классы перехода и `has-filters` владельца папок. */}
      <div ref={chatlistContainerRef} id="chatlist-container" className={classNames('transition-item', 'active', s.body)}>
      {/* tweb appDialogsManager.start(): bottomPart = .connection-status-bottom,
          в него prepend'ится .chatlist-overlay (плашка-подсказка, градиент, ряд
          вкладок папок) и append'ится #folders-container с контейнерами папок.
          Всё это — узлы владельца (`lib/appDialogsManager.ts`); высоту оверлея
          он же кладёт в --chatlist-overlay-height, её читает padding-top у
          .folders-scrollable — так табы никогда не накрывают первый ряд списка.
          React рисует сюда только оверлей архива; списки папок — порталами в
          `.chatlist-top` их контейнеров (<ChatList>). */}
      <div ref={bottomPartRef} className="connection-status-bottom">
        <ChatList
          manager={dialogsManager}
          // Витрина зеркала ЦЕЛИКОМ: по папке список фильтрует себя сам
          // (`useDialogListSource`) — там это правило одно и на строки, и на
          // размер набора для пагинации.
          chats={chats}
          selectedId={selectedId}
          onSelect={handleSelect}
          loaded={loaded}
          archived={archivedChats}
          onOpenArchive={() => setArchiveOpen(true)}
          collapsed={!!forumChat}
        />
        {suggestionContainer && createPortal(<PendingSuggestion collapsed={collapsed} />, suggestionContainer)}

        {/* Архив — в tweb отдельная вкладка слайдера (AppArchivedTab,
            SliderSuperTab), поэтому появление у неё то же, что у прочих вкладок:
            въезд справа за --transition-standard-in. Кейфрейм на вставке узла
            вместо движка анимаций. Лежит в `.connection-status-bottom`, а не в
            `#folders-container`: там дети — только кадры папок, слайдер берёт
            кадр индексом (`content.children[id]`, `horizontalMenu.ts:56`). */}
        {archiveOpen && (
            <div className={s.archiveOverlay}>
              <div className={s.archiveHeader}>
                <IconButton onClick={() => setArchiveOpen(false)} color="var(--secondary-text-color)" aria-label={t('Common.Back')}>
                  <TgIcon name="back" size={24} />
                </IconButton>
                <Text size={18} weight={600} color="var(--primary-text-color)">
                  {t('ArchivedChats')}
                </Text>
              </div>
              {/* Контейнер прокрутки оверлея — он же `scrollableHost` списка;
                  заглушка пустого архива рендерится ВМЕСТО `ul`, а не внутри
                  него (у виртуального `ul` своя геометрия под весь набор). */}
              <div className={s.archiveList}>
                {archivedChats.length === 0 ? (
                  <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                    <Text size={15} color="var(--secondary-text-color)">{t('Archive.Empty')}</Text>
                  </div>
                ) : (
                  <ArchiveList chats={chats} selectedId={selectedId} onSelect={handleSelect} />
                )}
              </div>
            </div>
        )}
      </div>
      </div>

        {/* tweb `index.html:102` — узел ПОСТОЯННЫЙ и пустой: детей (скроллер,
            класс `AppSearchSuper`, группы) строит владелец поиска на фокусе
            поля и сносит по концу обратного перехода (`cleanup`, :1401-1423). */}
        <div ref={searchContainerRef} id="search-container" className="transition-item sidebar-search" />

        {/* tweb: кнопка «новый чат» (#new-menu.btn-corner) живёт ВНУТРИ
            .sidebar-content, рядом с чатлистом и выдачей поиска. */}
        <ComposeFab
          searching={searching || !!forumChat}
          onNewGroup={() => setScreen('newGroup')}
          onNewPrivate={() => setScreen('newPrivate')}
          onNewChannel={() => setScreen('newChannel')}
          onNewSecret={() => setScreen('newSecret')}
        />
      </div>

      {/* tweb .topics-slider — панель форум-тем поверх слайдера сайдбара */}
      <div className="topics-slider">{forumPanel}</div>
      </div>
      </div>

      <SidebarScreens
        screen={screen}
        close={closeScreen}
        onSettingsBack={closeScreen}
        onSelect={onSelect}
        onOpenPeer={onOpenPeer}
        onChatCreated={onChatCreated}
        onCreateGroup={actions.createGroup}
        onCreateChannel={actions.createChannel}
        onStartSecret={actions.startSecret}
      />

      {stories.overlays}
    </div>
  )
}

/**
 * Строка архива — той же высоты, что и строка списка чатов: в tweb вкладка
 * архива это ТОТ ЖЕ `AutonomousDialogList`, только с `FOLDER_ID_ARCHIVE`
 * (`sidebarLeft/tabs/archivedTab.tsx:80-96`), а высоту строки он берёт из
 * `autonomousDialogList/dialogs.ts:221` — `itemSize: 72`.
 */
const ARCHIVE_ITEM_HEIGHT = 72

/**
 * Архивные чаты — тот же виртуальный список, что и у папки (`ChatList`): строки
 * лежат абсолютом в `ul` фиксированной высоты, в DOM живут только те, что попали
 * в окно видимости. Оригинал — `tweb/src/components/sidebarLeft/tabs/archivedTab.tsx`:
 * там архив это обычный `AutonomousDialogList` с `FOLDER_ID_ARCHIVE`
 * (`archivedTab.tsx:19,80-96`), то есть то же ядро
 * `createDeferredSortedVirtualList` и ТОТ ЖЕ курсор догрузки, что у остальных
 * списков диалогов, — поэтому источник здесь общий, `useDialogListSource`:
 * фильтр выборки, размер набора, признак конца и запрос страницы у владельца
 * считаются ровно там же, где у папки, вторых правил не заводится.
 *
 * Своей пагинации у архива не было (список жил тем, что случайно оказалось в
 * зеркале) — и это делало его недостижимым, как только первичная загрузка стала
 * страничной: страницы «Всех чатов» уходят с `folder_id=0` и архивных диалогов
 * не приносят вовсе (спека `2026-08-13-dialogs-count-and-refresh-design.md`,
 * «Дополнение: вход в архив»). Теперь оверлей просит свои страницы сам —
 * `getDialogs({filterId: ARCHIVE_FOLDER_ID})` уходит с `folder_id=1` и приносит
 * настоящий размер архивной выборки.
 *
 * Отличие от списка папки одно и оно от нашей модели данных, а не от tweb:
 * **закреплённых строк нет** — закреплён сам архив, и не здесь, а в списке
 * уровнем выше (`ChatList`, `pinnedItems`).
 *
 * Следствие своей пагинации: `wasAtLeastOnceFetched` и `animate` — ЖИВЫЕ
 * значения источника, а не константы (константами они стояли ровно потому, что
 * первой загрузки у архива не существовало). Наблюдаемы они только ПОКА первая
 * страница архива летит: до ответа `ul` ростом с хост, а переезд строки не
 * анимируется (глушилка `blockedAnimationCount`, порт `dialogs.ts:248-256`).
 * Оба пина — `Sidebar.archive.test.tsx`, describe «первая страница архива ещё
 * летит»: он краснеет и на возврате любого из двух пропов в константу.
 *
 * `chats` — витрина зеркала ЦЕЛИКОМ (как у `ChatList`), а не отфильтрованная:
 * архивность строки решает тот же `useDialogListSource`, что и её набор.
 */
function ArchiveList({ chats, selectedId, onSelect }: {
  chats: Chat[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  // Хост нужен ядру ЗНАЧЕНИЕМ (оно вешает на него слушатель скролла и
  // ResizeObserver), поэтому это состояние: первый рендер идёт с null, второй —
  // с живым узлом. Ref-колбэк обязан быть СТАБИЛЬНЫМ: смена идентичности
  // заставила бы React переприсваивать его на каждом рендере, то есть на каждом
  // рендере пересобирать окно видимости. Всё — как в `ChatList.ChatListFolder`.
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null)
  const setListEl = useCallback((ul: HTMLUListElement | null) => {
    setScrollHost(ul?.parentElement ?? null)
  }, [])

  // Обёртки строк, размер набора, признак «хоть раз загружались», глушилка
  // анимации первой загрузки и запрос страницы — всё из общего источника списка
  // диалогов (там же живут и кэш обёрток, без которого `useShouldAnimate`
  // сравнивал бы по ссылке всегда разные элементы, и правило принадлежности
  // строки выборке).
  const { items, totalCount, wasAtLeastOnceFetched, animate, requestItemForIdx } =
    useDialogListSource(ARCHIVE_FOLDER_ID, chats)

  // Порт `AutonomousDialogList.onChatsScroll()` (`base.ts:144-146` —
  // `requestItemForIdx(0)`): показанный список просит нулевой индекс. Это
  // ЕДИНСТВЕННЫЙ старт его первой загрузки — тот же эффект, что у
  // `ChatList.ChatListFolder` на первом показе папки.
  useEffect(() => {
    requestItemForIdx(0)
  }, [requestItemForIdx])

  // `handleSelect` Sidebar пересоздаётся на каждом его рендере, а `renderItem`
  // обязан быть стабильным: он входит в пропсы `memo`-строки, и его смена
  // перерисовывает ВСЁ окно.
  const selectChat = useEvent(onSelect)

  const renderItem = useCallback(
    ({ value, itemRef }: DeferredSortedVirtualListRenderItemProps<Chat>) => (
      <ChatListItem ref={itemRef} chat={value} selected={value.id === selectedId} onSelect={selectChat} />
    ),
    [selectedId, selectChat],
  )

  return (
    <DeferredSortedVirtualList<Chat>
      listRef={setListEl}
      className={s.archiveVirtualList}
      scrollableHost={scrollHost}
      items={items}
      totalCount={totalCount}
      wasAtLeastOnceFetched={wasAtLeastOnceFetched}
      itemSize={ARCHIVE_ITEM_HEIGHT}
      animate={animate}
      requestItemForIdx={requestItemForIdx}
      renderItem={renderItem}
    />
  )
}
