import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { isUserCollapsedLeft, setFoldersSidebarShown, setOpenTabsLeftSidebar } from '../core/dom/updateColumnWidths'
import installColumnResize from '../core/dom/installColumnResize'
import PendingSuggestion from './sidebarLeft/pendingSuggestion'
import classNames from '../shared/lib/classNames'
import s from './Sidebar.module.scss'
import { useChatsStore } from '../stores/chatsStore'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '../core/folderIds'
import ChatList from './ChatList'
import ChatListItem from './ChatListItem'
import DeferredSortedVirtualList, {
  type DeferredSortedVirtualListRenderItemProps,
} from './virtual/DeferredSortedVirtualList'
import { useDialogListSource } from '../core/hooks/useDialogListSource'
import { useEvent } from '../core/hooks/useEvent'
import type { Chat } from '../data'
import FoldersSidebar, { type MainMenuHandlers } from './folders/FoldersSidebar'
import { useSettings, useSettingsStore } from '../settings'
import useMediaQuery from '../shared/lib/useMediaQuery'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import { useLockStore } from '../stores/lockStore'
import SidebarMenuButton from './SidebarMenuButton'
import ComposeFab from './ComposeFab'
import PremiumModal from './PremiumModal'
import SearchView from './SearchView'
import StoriesRow from './StoriesRow'
import SidebarScreens, { type SidebarScreen } from './SidebarScreens'
import { useManagers } from '../core/hooks/useManagers'
import { useChatList } from '../core/hooks/useChatList'
import { useNavigationStore } from '../stores/navigationStore'
import { useChatStackStore, selectOpenThreadDesc } from '../stores/chatStackStore'
import { useNavigationActions } from '../core/hooks/useNavigationActions'
import { openPopup } from '../stores/popupStore'
import InputSearch from '../shared/ui/InputSearch'
import FolderTabs from './FolderTabs'
import { useT } from '../i18n'
import { useSidebarSearch } from '../core/hooks/useSidebarSearch'
import { useSidebarActions } from '../core/hooks/useSidebarActions'
import { useSidebarStories } from '../core/hooks/useSidebarStories'
import { useForumPanel } from '../core/hooks/useForumPanel'
import { useSidebarFolders } from '../core/hooks/useSidebarFolders'
import useMeasuredHeight from '../shared/lib/useMeasuredHeight'
import ConnectionStatusComponent from './connectionStatus'
import type { InputSearchStatus } from '../shared/ui/InputSearch'

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
  // Плейсхолдер и спиннер поля поиска ведёт автомат состояния соединения (порт
  // tweb ConnectionStatusComponent), поэтому пропа `placeholder` у InputSearch
  // здесь нет: единственный писатель — автомат. Хэндл трёх его методов приезжает
  // отдельным `statusRef` (основной `ref` — сам input, его берёт useSidebarSearch).
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
  // Контейнер прокрутки АКТИВНОЙ папки: скроллер теперь свой у каждой (кадр
  // слайда, `components/ChatList.tsx`), а ряду историй нужен ровно тот, что
  // сейчас перед глазами, — его ChatList сюда и публикует.
  const listScrollRef = useRef<HTMLDivElement>(null)
  // Узлы, которые нужны сворачиванию ряда историй (tweb setScrolledOn / listenWheelOn).
  const chatlistContainerRef = useRef<HTMLDivElement>(null)
  const bottomPartRef = useRef<HTMLDivElement>(null)

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
  const { openTopicThread: onOpenTopic, openPeer: onOpenPeer, onChatCreated } = useNavigationActions()

  // Экраны левой колонки взаимоисключающие — один стейт-энум (см. <SidebarScreens>).
  const [screen, setScreen] = useState<SidebarScreen>(null)
  const closeScreen = () => setScreen(null)
  // deep-open настроек на подэкран (контекстное меню «Настроить папки»)
  const [settingsSub, setSettingsSub] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const { query, setQuery, searching, setSearching, inputRef, closeSearch, searchReal, onJoin } = useSidebarSearch(initialQuery)
  const stories = useSidebarStories()
  const actions = useSidebarActions(chats, onChatCreated)
  const { handleSelect, forumChat, panel: forumPanel } = useForumPanel({ chats, onSelect, activeTopicId, onOpenTopic })

  const openFolderSettings = () => {
    setSettingsSub('Chat Folders')
    setScreen('settings')
  }
  const {
    folders, folderId, tabOrder, archivedChats, folderUnread,
    changeFolder, onTabContextMenu, overlays: folderOverlays,
  } = useSidebarFolders({ chats, onOpenFolderSettings: openFolderSettings })

  // --chatlist-overlay-height: живая высота .chatlist-overlay (нотисы + табы папок).
  // tweb ставит её ResizeObserver'ом на .connection-status-bottom, а .folders-scrollable
  // читает как padding-top (appDialogsManager.start(), _leftSidebar.scss:418).
  const [overlayHeight, setOverlayHeight] = useState(0)
  const overlayRef = useMeasuredHeight(setOverlayHeight)
  const overlayHeightVar = { '--chatlist-overlay-height': `${overlayHeight}px` } as CSSProperties

  // Вьюпортная модалка Premium — через глобальный popupStore (не экран колонки).
  const openPremium = () => openPopup((p) => (
    <PremiumModal open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} />
  ))

  // «Расположение папок → Слева от чатов» (tweb tabsInSidebar): вертикальная колонка
  // вместо горизонтальных табов; на узких экранах скрыта (tweb until-floating-left-sidebar).
  const tabsInSidebar = useSettings((st) => st.tabsInSidebar)
  const narrowScreen = useMediaQuery('(max-width:900px)')
  const foldersSidebarShown = tabsInSidebar && folders.length > 0 && !narrowScreen && !fullWidth
  // tweb stores/foldersSidebar.ts → setFoldersSidebarShown: панель папок резервирует
  // место, значит правая колонка начинает всплывать раньше, а чат — уже.
  useEffect(() => { setFoldersSidebarShown(foldersSidebarShown) }, [foldersSidebarShown])

  // --- Ресайз левой колонки (tweb sidebarLeft/index.ts:612-635 initSidebarResize) ---
  const columnRef = useRef<HTMLDivElement>(null)
  // tweb hasSomethingOpenInside(): открытые вкладки | активный поиск | форум-таб.
  const somethingOpenInside = searching || screen !== null || archiveOpen || !!forumChat
  // tweb isCollapsed(): в floating-диапазоне (<=925) колонка всегда развёрнута,
  // предпочтение просто помнится для широких вьюпортов.
  const floatingLeft = useMediaQuery('(max-width:925px)')
  const [collapsedPref, setCollapsedPref] = useState(isUserCollapsedLeft)
  const collapsed = collapsedPref && !floatingLeft && !fullWidth
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
          selectedId={folderId}
          counts={folderUnread}
          onSelect={changeFolder}
          onContextMenu={onTabContextMenu}
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
      {/* tweb вешает is-search-active на .item-main (sidebarLeft/index.ts:1431) —
          через него гаснет ряд историй (_storiesList.scss) */}
      <div className={classNames('tabs-tab', 'sidebar-slider-item', 'item-main', 'active', searching ? 'is-search-active' : '', s.sliderItem)}>
      <div className={classNames('sidebar-header', 'main-search-sidebar-header', 'can-have-forum', 'is-input-the-last-child', s.header)}>
        {(!foldersSidebarShown || searching) && (
          <div className={classNames('sidebar-header__btn-container', 'left-sidebar-burger')}>
            <SidebarMenuButton searching={searching} onBack={closeSearch} {...menuActions} />
          </div>
        )}
        <InputSearch
          ref={inputRef}
          statusRef={searchStatusRef}
          className={classNames('old-style', s.search)}
          value={query}
          onChange={setQuery}
          onFocus={() => setSearching(true)}
          onClear={() => setQuery('')}
          focused={searching}
        />
        {/* Замок над списком чатов при включённом код-пароле (tweb sidebar-lock-button). */}
        {passcodeEnabled && !searching && (
          <IconButton
            onClick={() => useLockStore.getState().lock()}
            color="var(--secondary-text-color)"
            aria-label={t('PasscodeLock.LockNow')}
            title={t('PasscodeLock.LockNow')}
          >
            <TgIcon name="lock" size={24} />
          </IconButton>
        )}
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
            getScrollable={() => listScrollRef.current}
            listenWheelOn={() => bottomPartRef.current}
            onExpand={() => listScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          />
        </div>
      )}

      {/* tweb .sidebar-content — общий слой чатлиста, выдачи поиска и FAB */}
      <div className={classNames('sidebar-content', 'transition', 'zoom-fade', 'can-have-forum', s.content)}>
      {/* #chatlist-container несёт --stories-scrolled, .connection-status-bottom
          на него сдвигается (translateY(92px - var(--stories-scrolled))) */}
      {/* `.transition > .transition-item:not(.active)` — display:none !important
          (_transition.scss:12). Значит `active` носит РОВНО ОДИН из двух узлов:
          при открытом поиске он уходит на #search-container, иначе на чатлист. */}
      <div ref={chatlistContainerRef} id="chatlist-container" className={classNames('transition-item', searching ? '' : 'active', folders.length > 0 ? 'has-filters' : '', s.body)}>
      {/* tweb appDialogsManager.start(): bottomPart = .connection-status-bottom,
          в него prepend'ится .chatlist-overlay и append'ится #folders-container.
          Высота оверлея уезжает в --chatlist-overlay-height (ResizeObserver там же),
          её читает padding-top у .folders-scrollable — так табы никогда не
          накрывают первый ряд списка. */}
      <div ref={bottomPartRef} className="connection-status-bottom" style={overlayHeightVar}>
        {/* tweb .chatlist-overlay — один абсолютный оверлей над списком, дети в нём
            текут обычным потоком: плашка-подсказка (appDialogsManager.ts:1079-1082
            prepend'ит её сюда) СВЕРХУ, градиент-фейд и карточка табов под ней.
            Позиционирование даёт портированный `#column-left .chatlist-overlay`
            (_leftSidebar.scss:295). */}
        <div ref={overlayRef} className="chatlist-overlay">
          <PendingSuggestion collapsed={collapsed} />
          {/* tweb (живой DOM :8099): градиент-фейд — ПРЯМОЙ ребёнок .chatlist-overlay,
              а не часть плашки табов; `.folders-tabs-gradient-container { inset: 0 }`
              растягивает его на ВЕСЬ оверлей (плашка-подсказка + табы), и строки
              списка, уезжающие под их поля, гаснут в --surface-color. Без него
              чат-лист просвечивает в 8px-полях вокруг плашки. */}
          <div className={classNames('menu-horizontal-gradient-container', 'folders-tabs-gradient-container')}>
            <div className={classNames('menu-horizontal-gradient', 'menu-horizontal-gradient-color-surface', 'menu-horizontal-gradient-smaller', 'folders-tabs-gradient')} />
          </div>
          {/* tweb (живой DOM :8099): карточка табов — ПРЯМОЙ ребёнок .chatlist-overlay
              рядом с градиентом, без обёртки; слои даёт сам партиал
              (`#column-left .item-main .menu-horizontal-scrollable`: position:relative,
              z-index:2 — _leftSidebar.scss:274). */}
          {!searching && folders.length > 0 && !foldersSidebarShown && (
            <FolderTabs
              value={folderId}
              onChange={changeFolder}
              folders={folders}
              counts={folderUnread}
              onTabContextMenu={onTabContextMenu}
            />
          )}
        </div>
        <div id="folders-container" className="tabs-container">
        <ChatList
          ref={listScrollRef}
          // Витрина зеркала ЦЕЛИКОМ: по папке список фильтрует себя сам
          // (`useDialogListSource`) — там это правило одно и на строки, и на
          // размер набора для пагинации.
          chats={chats}
          selectedId={selectedId}
          onSelect={handleSelect}
          loaded={loaded}
          folder={folderId}
          folderOrder={tabOrder}
          archived={folderId === ALL_FOLDER_ID ? archivedChats : undefined}
          onOpenArchive={() => setArchiveOpen(true)}
          collapsed={!!forumChat}
        />

        {/* Архив — в tweb отдельная вкладка слайдера (AppArchivedTab,
            SliderSuperTab), поэтому появление у неё то же, что у прочих вкладок:
            въезд справа за --transition-standard-in. Кейфрейм на вставке узла
            вместо движка анимаций. */}
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
      </div>

        {searching && (
          <div id="search-container" className={classNames('transition-item', 'active', 'sidebar-search', s.searchOverlay)}>
            {/* tweb: выдача поиска — `.transition-item` внутри
                `.sidebar-content.transition.zoom-fade`, приходящий узел играет
                `fade-in-opacity .15s ease, zoom-fade-in-move .15s ease`
                (_transition.scss:25-40) — scale 1.1 → 1 с фейдом. */}
            <div className={s.searchInner}>
              <SearchView query={query} chats={chats} onSelect={handleSelect} searchReal={searchReal} onJoin={onJoin} onOpenPeer={onOpenPeer} />
            </div>
          </div>
        )}

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

      {folderOverlays}

      <SidebarScreens
        screen={screen}
        close={closeScreen}
        chats={chats}
        settingsSub={settingsSub}
        onSettingsBack={() => { closeScreen(); setSettingsSub(null) }}
        onToggleMode={onToggleMode}
        onSelect={onSelect}
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
