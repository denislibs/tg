import { useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE } from '../motion'
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

  // Вьюпортная модалка Premium — через глобальный popupStore (не экран колонки).
  const openPremium = () => openPopup((p) => (
    <PremiumModal open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} />
  ))

  // «Расположение папок → Слева от чатов» (tweb tabsInSidebar): вертикальная колонка
  // вместо горизонтальных табов; на узких экранах скрыта (tweb until-floating-left-sidebar).
  const tabsInSidebar = useSettings((st) => st.tabsInSidebar)
  const narrowScreen = useMediaQuery('(max-width:900px)')
  const foldersSidebarShown = tabsInSidebar && folders.length > 0 && !narrowScreen && !fullWidth

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
      id="chatlist-column"
      className={classNames(s.root, fullWidth ? s.fullWidth : '', forumChat ? s.hasForum : '')}
      style={foldersSidebarShown ? ({ '--folders-sidebar-offset': '80px' } as CSSProperties) : undefined}
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
      {/* tweb .sidebar-header.main-search-sidebar-header. При включённой вертикальной
          колонке папок бургер живёт в ней — в шапке остаётся только стрелка «назад». */}
      <div className={s.header}>
        {(!foldersSidebarShown || searching) && (
          <SidebarMenuButton searching={searching} onBack={closeSearch} {...menuActions} />
        )}
        <div className={s.search}>
          <InputSearch
            ref={inputRef}
            value={query}
            onChange={setQuery}
            onFocus={() => setSearching(true)}
            onClear={() => setQuery('')}
            placeholder={loaded ? t('Search') : t('Updating…')}
            focused={searching}
          />
        </div>
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
      {!searching && !forumChat && (
        <StoriesRow onOpen={stories.openViewer} onAddStory={stories.pickStoryFile} />
      )}

      {/* tweb #chatlist-container — список всегда смонтирован; поиск перекрывает его */}
      <div className={s.body}>
        <ChatList
          ref={listScrollRef}
          chats={filtered}
          selectedId={selectedId}
          onSelect={handleSelect}
          loaded={loaded}
          folder={folderId}
          folderOrder={tabOrder}
          tabsShown={folders.length > 0 && !foldersSidebarShown}
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
        {!searching && folders.length > 0 && !foldersSidebarShown && (
          <TabsBar mode="overlay">
            <FolderTabs
              value={folderId}
              onChange={changeFolder}
              folders={folders}
              counts={folderUnread}
              onTabContextMenu={onTabContextMenu}
            />
          </TabsBar>
        )}
        {searching && (
          <div className={s.searchOverlay}>
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
      </div>

      {forumPanel}

      <ComposeFab
        searching={searching || !!forumChat}
        onNewGroup={() => setScreen('newGroup')}
        onNewPrivate={() => setScreen('newPrivate')}
        onNewChannel={() => setScreen('newChannel')}
        onNewSecret={() => setScreen('newSecret')}
      />

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
