import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE } from '../motion'
import { setFoldersSidebarShown } from '../core/dom/updateColumnWidths'
import classNames from '../shared/lib/classNames'
import s from './Sidebar.module.scss'
import { useChatsStore, loadChats } from '../stores/chatsStore'
import { ALL_FOLDER_ID } from '../stores/foldersStore'
import ChatList from './ChatList'
import ChatListItem from './ChatListItem'
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
import { useNavigationActions } from '../core/hooks/useNavigationActions'
import { openPopup } from '../stores/popupStore'
import InputSearch from '../shared/ui/InputSearch'
import FolderTabs from './FolderTabs'
import { TabsBar } from '../shared/ui/Tabs'
import { useT } from '../i18n'
import { useSidebarSearch } from '../core/hooks/useSidebarSearch'
import { useSidebarActions } from '../core/hooks/useSidebarActions'
import { useSidebarStories } from '../core/hooks/useSidebarStories'
import { useForumPanel } from '../core/hooks/useForumPanel'
import { useSidebarFolders } from '../core/hooks/useSidebarFolders'
import useMeasuredHeight from '../shared/lib/useMeasuredHeight'

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
  const listScrollRef = useRef<HTMLDivElement>(null)
  // Узлы, которые нужны сворачиванию ряда историй (tweb setScrolledOn / listenWheelOn).
  const chatlistContainerRef = useRef<HTMLDivElement>(null)
  const bottomPartRef = useRef<HTMLDivElement>(null)

  // Навигация — из navigationStore/useNavigationActions напрямую; список чатов —
  // свой селектор (та же useChatList, что и в Shell; вторая подписка — норма).
  const chats = useChatList()
  const selectedId = useNavigationStore((st) => st.selectedId) ?? ''
  const activeTopicId = useNavigationStore((st) => (st.openThread?.thread.kind === 'topic' ? st.openThread.thread.rootMsgId : null))
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
    folders, folderId, tabOrder, filtered, archivedChats, folderUnread,
    changeFolder, onTabContextMenu, overlays: folderOverlays,
  } = useSidebarFolders({ chats, listScrollRef, onOpenFolderSettings: openFolderSettings })

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

  // Меню бургера и вертикальной колонки папок — один набор обработчиков на оба места.
  const menuActions: MainMenuHandlers = {
    onOpenSettings: () => setScreen('settings'),
    onOpenContacts: () => setScreen('contacts'),
    onOpenSaved: async () => {
      const id = await managers.chats.saved()
      await loadChats(managers)
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
      className={classNames(s.root, 'tabs-tab', 'chatlist-container', 'sidebar', 'sidebar-left', 'main-column', 'sidebar-left-common', 'can-menu-have-z-index', fullWidth ? s.fullWidth : '', forumChat ? s.hasForum : '')}
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
          className={classNames('old-style', s.search)}
          value={query}
          onChange={setQuery}
          onFocus={() => setSearching(true)}
          onClear={() => setQuery('')}
          placeholder={loaded ? t('Search') : t('Updating…')}
          focused={searching}
        />
        {/* Замок над списком чатов при включённом код-пароле (tweb sidebar-lock-button). */}
        {passcodeEnabled && !searching && (
          <IconButton
            onClick={() => useLockStore.getState().lock()}
            color="var(--secondary-text-color)"
            aria-label={t('Lock the app')}
            title={t('Lock the app')}
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
        {!searching && folders.length > 0 && !foldersSidebarShown && (
          <TabsBar mode="overlay" className="chatlist-overlay" barRef={overlayRef}>
            <FolderTabs
              value={folderId}
              onChange={changeFolder}
              folders={folders}
              counts={folderUnread}
              onTabContextMenu={onTabContextMenu}
            />
          </TabsBar>
        )}
        <div id="folders-container" className="tabs-container">
        <ChatList
          ref={listScrollRef}
          chats={filtered}
          selectedId={selectedId}
          onSelect={handleSelect}
          loaded={loaded}
          folder={folderId}
          folderOrder={tabOrder}
          archived={folderId === ALL_FOLDER_ID ? archivedChats : undefined}
          onOpenArchive={() => setArchiveOpen(true)}
          collapsed={!!forumChat}
        />

        <AnimatePresence>
          {archiveOpen && (
            <motion.div
              className={s.archiveOverlay}
              initial={{ x: 80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 80, opacity: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              <div className={s.archiveHeader}>
                <IconButton onClick={() => setArchiveOpen(false)} color="var(--secondary-text-color)" aria-label={t('Back')}>
                  <TgIcon name="back" size={24} />
                </IconButton>
                <Text size={18} weight={600} color="var(--primary-text-color)">
                  {t('Archived Chats')}
                </Text>
              </div>
              <div className={s.archiveList}>
                {archivedChats.map((chat) => (
                  <ChatListItem key={chat.id} chat={chat} selected={chat.id === selectedId} onSelect={handleSelect} />
                ))}
                {archivedChats.length === 0 && (
                  <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                    <Text size={15} color="var(--secondary-text-color)">{t('No archived chats')}</Text>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>
      </div>

        {searching && (
          <div id="search-container" className={classNames('transition-item', 'active', 'sidebar-search', s.searchOverlay)}>
            <motion.div
              className={s.searchInner}
              initial={{ opacity: 0, scale: 0.96, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              <SearchView query={query} chats={chats} onSelect={handleSelect} searchReal={searchReal} onJoin={onJoin} onOpenPeer={onOpenPeer} />
            </motion.div>
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
