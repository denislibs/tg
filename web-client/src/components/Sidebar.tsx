import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isUserCollapsedLeft, setOpenTabsLeftSidebar } from '../core/dom/updateColumnWidths'
import installColumnResize from '../core/dom/installColumnResize'
import PendingSuggestion from './sidebarLeft/pendingSuggestion'
import classNames from '../shared/lib/classNames'
import s from './Sidebar.module.scss'
import { useChatsStore } from '../stores/chatsStore'
import { isDialogArchived } from '../core/models'
import FoldersSidebar from './folders/FoldersSidebar'
import type { FolderContextMenuSidebar } from '../helpers/dom/createFolderContextMenu'
import { createColumnSlider, destroyColumnSlider, openContactsTab } from './sidebarLeft/columnSlider'
import createNewGroupTab from './sidebarLeft/tabs/createNewGroupTab'
import type SidebarSlider from './slider'
import { AppChatFoldersTab, AppEditFolderTab, AppNewChannelTab } from './solidJsTabs/tabs'
import type { SliderSuperTabConstructable } from './sliderTab'
import type SliderSuperTab from './sliderTab'
import pause from '../helpers/schedulers/pause'
import { useSettings, useSettingsStore } from '../settings'
import useMediaQuery from '../shared/lib/useMediaQuery'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import createLockButton from './sidebarLeft/lockButton.solid'
import { mountSidebarToolsButton, type ToolsMenuSidebar } from './sidebarLeft/toolsMenu'
import SidebarEmojiStatusButton from './SidebarEmojiStatusButton'
import ComposeFab from './ComposeFab'
import StoriesRow from './StoriesRow'
import { useManagers } from '../core/hooks/useManagers'
import { useNavigationStore } from '../stores/navigationStore'
import { useChatStackStore, selectOpenThreadDesc } from '../stores/chatStackStore'
import { useNavigationActions } from '../core/hooks/useNavigationActions'
import InputSearch from '../shared/ui/InputSearch'
import { useT } from '../i18n'
import { useGlobalSearch } from '../core/hooks/useGlobalSearch'
import { useSidebarStories } from '../core/hooks/useSidebarStories'
import { useForumPanel } from '../core/hooks/useForumPanel'
import { useImperativeIsland } from '../core/hooks/useImperativeIsland'
import { useFolders } from '../stores/foldersStore'
import { AppDialogsManager } from '../lib/appDialogsManager'
import { useFoldersSidebarShown, useIsLeftSearchActive, useIsSidebarCollapsed } from '../stores/foldersSidebar.solid'
import ConnectionStatusComponent from './connectionStatus'
import type { InputSearchStatus } from '../shared/ui/InputSearch'
import type InputSearchHandle from '../shared/ui/InputSearch/inputSearchHandle'

interface Props {
  onToggleMode: (coords?: { x: number; y: number }) => void
  fullWidth?: boolean
  /** префилл поиска (deep-open с публичной страницы /?domain=username) */
  initialQuery?: string
}

// Sidebar — оркестратор левой колонки: композиция хуков (поиск/папки/истории/
// форум/создание чатов) + разметка шапки, списка и оверлеев. Кластеры логики
// вынесены в core/hooks/useSidebar*; экраны колонки — вкладки колоночного слайдера.
// Навигация и список чатов читаются из стора напрямую (инвариант: View читает из
// стора, а не через проброс из Shell) — тема/авторизация остаются пропсами (скоуп App).
export default function Sidebar({
  onToggleMode,
  fullWidth = false,
  initialQuery,
}: Props) {
  const managers = useManagers()
  const t = useT()
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

  // Навигация — из navigationStore/useNavigationActions напрямую. Список чатов
  // рисует владелец (`AppDialogsManager`, задача 1-4 волны 7) из зеркала сам;
  // колонке нужны лишь архивные диалоги — для бургера и оверлея архива.
  const dialogs = useChatsStore((st) => st.dialogs)
  // Возвращает примитив (не сам дескриптор) — селектор подписки безопасен и
  // без selectOpenThreadDesc, но переиспользуем её ради единого API «открыт ли
  // тред» (см. её докблок в chatStackStore.ts про безопасность подписки по ссылке).
  const activeTopicId = useChatStackStore((st) => {
    const open = selectOpenThreadDesc(st)
    return open?.thread.kind === 'topic' ? open.thread.rootMsgId : null
  })
  const onSelect = useNavigationStore((st) => st.selectChat)
  const { openTopicThread: onOpenTopic } = useNavigationActions()

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
  const { openForum, forumChat, closeForum, panel: forumPanel } = useForumPanel({ onSelect, activeTopicId, onOpenTopic })
  // Владелец поиска (порт `initSearch`, `components/sidebarLeft/globalSearch.ts`);
  // шов и расхождения — шапка `core/hooks/useGlobalSearch.ts`.
  // Отражение пишется и в сигнал `useIsLeftSearchActive` — его читает морф
  // бургера (tweb сеттер `AppSidebarLeft.isSearchActive`, `sidebarLeft/index.ts:134-139`;
  // ВРЕМЕННО до 2-1: сеттером станет класс колонки).
  const onSearchActive = useCallback((active: boolean) => {
    setSearching(active)
    useIsLeftSearchActive()[1](active)
  }, [])
  useLayoutEffect(() => () => { useIsLeftSearchActive()[1](false) }, [])
  const searchOwnerRef = useGlobalSearch({
    searchContainerRef,
    inputSearchRef,
    backBtnRef,
    onSearchActive,
    initialQuery,
  })

  const folders = useFolders()
  // Колоночный слайдер (tweb `AppSidebarLeft extends SidebarSlider`,
  // `sidebarLeft/index.ts:118`, `:147-152`): вкладка №0 — `.item-main` ниже,
  // остальные экраны колонки — его вкладки (корень настроек, папки, контакты,
  // новая группа и канал, звонки; архив — оверлеем до 1-5). Узлом `.sidebar-slider` владеет
  // React, вкладками — слайдер (шапка `sidebarLeft/columnSlider.ts`). Слой
  // раскладки: узел колонки должен быть в DOM, а слайдер — заведён до того,
  // как пользователь дотянется до пункта меню. ВРЕМЕННО до 2-1 (волна 7): там
  // слайдер становится классом колонки.
  const sliderRef = useRef<SidebarSlider | null>(null)
  // Отражение числа вкладок в навигации — роль `hasTabsInNavigation()` в tweb
  // `hasSomethingOpenInside` (`:518-520`). Пишет его ТОЛЬКО слайдер, хуком
  // `onTabsCountChange` (tweb `:652-654` → `onSomethingOpenInsideChange`):
  // закрыть вкладку можно и Esc, и стрелкой, и срезом истории изнутри вкладки,
  // и узнаёт об этом один слайдер.
  const [tabsOpen, setTabsOpen] = useState(false)
  useLayoutEffect(() => {
    const slider = createColumnSlider(columnRef.current!, managers, () => setTabsOpen(slider.hasTabsInNavigation()))
    sliderRef.current = slider
    return () => {
      sliderRef.current = null
      destroyColumnSlider(slider)
    }
  }, [managers])
  // `appSidebarLeft.createTab(ctor).open(…)` (tweb `createFolderContextMenu.ts:27-49`,
  // `foldersSidebarContent/index.tsx:207-215`, `sidebarLeft/index.ts:765`).
  const openColumnTab = <T extends SliderSuperTab>(ctor: SliderSuperTabConstructable<T>, ...args: Parameters<T['init']>) => {
    void sliderRef.current!.createTab(ctor).open(...args)
  }

  const archivedDialogs = useMemo(() => dialogs.filter(isDialogArchived), [dialogs])

  // «Расположение папок → Слева от чатов» (tweb tabsInSidebar): вертикальная колонка
  // вместо горизонтальных табов; на узких экранах скрыта (tweb until-floating-left-sidebar).
  const tabsInSidebar = useSettings((st) => st.tabsInSidebar)
  const narrowScreen = useMediaQuery('(max-width:900px)')
  const foldersSidebarShown = tabsInSidebar && folders.length > 0 && !narrowScreen && !fullWidth

  // --- Ресайз левой колонки (tweb sidebarLeft/index.ts:612-635 initSidebarResize) ---
  const columnRef = useRef<HTMLDivElement>(null)
  // tweb hasSomethingOpenInside(): открытые вкладки | активный поиск | форум-таб.
  const somethingOpenInside = searching || archiveOpen || tabsOpen || !!forumChat
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

  // `appSidebarLeft.closeAllTabs()` — вкладки колонки и оверлей архива (у tweb
  // архив — тоже вкладка слайдера, ВРЕМЕННО до 1-5). Отвечает, было ли что
  // закрывать.
  const closeAllTabsRef = useRef<() => boolean>(() => false)
  closeAllTabsRef.current = () => {
    const hadArchive = archiveOpen
    setArchiveOpen(false)
    // tweb `closeAllTabs` (`slider.ts:171-179`) — отвечает, были ли вкладки
    const hadTabs = !!sliderRef.current?.closeAllTabs()
    return hadArchive || hadTabs
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
  // То, что меню папки (`createFolderContextMenu`, оба ряда) и бургер
  // (`sidebarLeft/toolsMenu.ts`, оба места) берут у колонки — у tweb это
  // `appSidebarLeft` и классы вкладок. Объект один на жизнь колонки: его
  // получают владелец папок (хуки `start()`), бургер шапки и вертикальная
  // колонка. Состояние React читается через ref — объект создаётся один раз.
  // ВРЕМЕННО до 2-1: объектом станет класс `AppSidebarLeft`.
  const bridgeRef = useRef({ collapsed: false, archivedDialogs: [] as typeof dialogs, openMyStories: () => {}, onToggleMode })
  const [appSidebarLeft] = useState<FolderContextMenuSidebar & ToolsMenuSidebar>(() => ({
    managers,
    // tweb `sidebarLeft/index.ts:1755-1758`: пауза — на уход закрытой вкладки
    closeTabsBefore: async (clb) => {
      if (closeEverythingInsideRef.current()) await pause(200)
      clb()
    },
    openEditFolderTab: (filter) => openColumnTab(AppEditFolderTab, { ...AppEditFolderTab.getInitArgs(), initFilter: filter }),
    openChatFoldersTab: () => openColumnTab(AppChatFoldersTab, AppChatFoldersTab.getInitArgs()),
    isCollapsed: () => bridgeRef.current.collapsed,
    // ВРЕМЕННО до 1-5: оверлей архива вместо `AppArchivedTab` (tweb `:1760-1764`)
    openArchiveTab: () => appSidebarLeft.closeTabsBefore(() => setArchiveOpen(true)),
    hasArchivedDialogs: () => bridgeRef.current.archivedDialogs.length > 0,
    getArchivedUnreadCount: () => bridgeRef.current.archivedDialogs.reduce((sum, d) => sum + d.unread_count, 0),
    // ВРЕМЕННО до Э4-3: `appImManager.setPeer({peerId: myId})` (tweb `:707-713`)
    openSavedMessages: () => {
      void (async () => {
        const id = await managers.chats.saved()
        await managers.dialogs.refresh()
        useNavigationStore.getState().selectChat(String(id))
      })()
    },
    // О-82 волны 7: `AppMyStoriesTab` не портирован — наш архив историй
    openMyStories: () => bridgeRef.current.openMyStories(),
    // ВРЕМЕННО до Э4-5: тему переключает хук шелла `useThemeToggle`
    switchTheme: (coords) => bridgeRef.current.onToggleMode(coords),
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
  // ВРЕМЕННО до 1-6: панель тем — React (`useForumPanel`); клик по строке форума
  // владелец списка отдаёт сюда (хук `openForum`). Хуки владельцу отдаются один
  // раз — актуальное замыкание через ref.
  const openForumRef = useRef(openForum)
  openForumRef.current = openForum
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
      openForum: (peerId) => openForumRef.current(peerId),
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
  // ВРЕМЕННО до 1-6: половина tweb `toggleForumTab` — бейджи на аватарах узкой
  // колонки и `is-forum-visible` колонки (тексты строк гаснут, `_leftSidebar.scss`).
  // Первый проход (форум закрыт, класса нет) переходом ничего не делает.
  const forumShownRef = useRef(false)
  useLayoutEffect(() => {
    if (forumShownRef.current === !!forumChat) return
    forumShownRef.current = !!forumChat
    dialogsManager.onForumToggle(!!forumChat, columnRef.current!)
  }, [dialogsManager, forumChat])
  // ВРЕМЕННО до 2-1: tweb `onCollapsedChange` (`sidebarLeft/index.ts:503-507`) —
  // бейджи непрочитанного на аватарах свёрнутой колонки.
  const collapsedShownRef = useRef(false)
  useLayoutEffect(() => {
    if (collapsedShownRef.current === collapsed) return
    collapsedShownRef.current = collapsed
    dialogsManager.onCollapsedChange(collapsed)
  }, [dialogsManager, collapsed])

  bridgeRef.current = { collapsed, archivedDialogs, openMyStories: stories.openArchive, onToggleMode }

  // Кнопка бургера (tweb `construct` :165-172, :244, морф :431-442) — узлы
  // колонки `.animated-menu-icon` и `.sidebar-back-button` статичны, кнопку
  // меню между ними ставит и снимает порт.
  const burgerRef = useImperativeIsland((container) => mountSidebarToolsButton(appSidebarLeft, container), [])

  return (
    <div
      // #column-left — как в tweb (живой DOM §1); --folders-sidebar-offset и
      // остальные ширины колонок пишет core/dom/updateColumnWidths.
      id="column-left"
      ref={columnRef}
      className={classNames(s.root, 'tabs-tab', 'chatlist-container', 'sidebar', 'sidebar-left', 'main-column', 'sidebar-left-common', 'can-menu-have-z-index', collapsed ? 'is-collapsed' : '', somethingOpenInside ? 'has-open-tabs' : '', fullWidth ? s.fullWidth : '')}
    >
      {/* tweb #folders-sidebar — вертикальная колонка папок в поле страницы */}
      {foldersSidebarShown && (
        <FoldersSidebar
          folders={folders}
          appSidebarLeft={appSidebarLeft}
          managers={managers}
          onOpenFolderSettings={openFolderSettings}
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
        <div ref={burgerRef} className={classNames('sidebar-header__btn-container', 'left-sidebar-burger', foldersSidebarShown && !searching ? 'hide' : '')}>
          {/* tweb `index.html:93-96`: три полоски ≡ ↔ ← рисует CSS
              (`_animatedIcon.scss`), `state-back` и `is-visible` ставит морф
              порта — классы React здесь постоянные. Стрелку «назад» держит
              владелец поиска (`backBtnRef`), своего обработчика у неё нет. */}
          <div className="animated-menu-icon" />
          <div ref={backBtnRef} className="btn-icon sidebar-back-button" />
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
          Всё это — узлы владельца (`lib/appDialogsManager.ts`), и списки папок с
          их строками — тоже (`AutonomousDialogList`, задача 1-4); высоту оверлея
          он же кладёт в --chatlist-overlay-height, её читает padding-top у
          .folders-scrollable — так табы никогда не накрывают первый ряд списка.
          React рисует сюда только плашку-подсказку и оверлей архива. */}
      <div ref={bottomPartRef} className="connection-status-bottom">
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
              {/* Список архива — `AutonomousDialogList(FOLDER_ID_ARCHIVE)` владельца
                  (`mountArchivedList`, как вкладка tweb `archivedTab.tsx`);
                  заглушка пустого архива — ВМЕСТО его скроллера. */}
              {archivedDialogs.length === 0 ? (
                <div className={s.archiveList}>
                  <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                    <Text size={15} color="var(--secondary-text-color)">{t('Archive.Empty')}</Text>
                  </div>
                </div>
              ) : (
                <ArchiveList dialogsManager={dialogsManager} />
              )}
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
          // tweb `sidebarLeft/index.ts:1073-1077` — `createNewGroupTab(this)`
          onNewGroup={() => createNewGroupTab(sliderRef.current!)}
          // tweb `sidebarLeft/index.ts:1105-1109` (`closeBefore: false`) — «Новый личный
          // чат» и есть вкладка контактов; секретный — Отступление В7-1
          onNewPrivate={() => { void openContactsTab() }}
          // tweb `sidebarLeft/index.ts:1086-1092` — `createTab(AppNewChannelTab).open({})`
          onNewChannel={() => openColumnTab(AppNewChannelTab)}
          onNewSecret={() => { void openContactsTab({ secret: true }) }}
        />
      </div>

      {/* tweb .topics-slider — панель форум-тем поверх слайдера сайдбара */}
      <div className="topics-slider">{forumPanel}</div>
      </div>
      </div>

      {stories.overlays}
    </div>
  )
}

/**
 * ВРЕМЕННО до 1-5: список архивного оверлея — `AutonomousDialogList` с
 * `FOLDER_ID_ARCHIVE`, тот же, что строит вкладка tweb `archivedTab.tsx:80-110`
 * (`l({id: FOLDER_ID_ARCHIVE})` + `setFilterIdAndChangeTab`). Скроллер списка —
 * узел владельца, остров его кладёт и уносит (`mountArchivedList`).
 */
function ArchiveList({ dialogsManager }: { dialogsManager: AppDialogsManager }) {
  const hostRef = useImperativeIsland((container) => dialogsManager.mountArchivedList(container), [dialogsManager])
  return <div ref={hostRef} className={s.archiveList} />
}
