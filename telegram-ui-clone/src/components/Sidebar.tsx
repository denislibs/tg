import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE } from '../motion'
import classNames from '../shared/lib/classNames'
import s from './Sidebar.module.scss'
import { useChatsStore, loadChats } from '../stores/chatsStore'
import { useFoldersStore, loadFolders, ALL_FOLDER_ID } from '../stores/foldersStore'
import { matchesFolder } from '../core/folderFilter'
import type { Folder } from '../core/managers/foldersManager'
import type { Chat, OpenPeer } from '../data'
import ChatList from './ChatList'
import FolderEditor from './folders/FolderEditor'
import FoldersSidebar from './folders/FoldersSidebar'
import { useSettings, useSettingsStore } from '../settings'
import useMediaQuery from '../shared/lib/useMediaQuery'
import Menu, { MenuItem } from '../shared/ui/Menu'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import { useLockStore } from '../stores/lockStore'
import SidebarMenuButton from './SidebarMenuButton'
import ComposeFab from './ComposeFab'
import PremiumModal from './PremiumModal'
import SettingsView from './SettingsView'
import ContactsView from './ContactsView'
import NewGroupFlow from './NewGroupFlow'
import NewChannelFlow from './NewChannelFlow'
import NewPrivateChat from './NewPrivateChat'
import SearchView from './SearchView'
import { useManagers } from '../core/hooks/useManagers'
import type { SearchResult } from '../core/managers/channelsManager'
import InputSearch from '../shared/ui/InputSearch'
import FolderTabs from './FolderTabs'
import { TabsBar } from '../shared/ui/Tabs'
import { useT } from '../i18n'

interface Props {
  chats: Chat[]
  selectedId: string
  onSelect: (id: string) => void
  onCreateGroup: (name: string, memberIds: number[], photo: import('./NewGroupFlow').GroupPhoto | null) => void
  onCreateChannel: (name: string, description: string) => void
  onToggleMode: (coords?: { x: number; y: number }) => void
  onLogout?: () => void
  onOpenPeer?: (peer: OpenPeer) => void
  fullWidth?: boolean
  /** префилл поиска (deep-open с публичной страницы /?domain=username) */
  initialQuery?: string
}

export default function Sidebar({
  chats,
  selectedId,
  onSelect,
  onCreateGroup,
  onCreateChannel,
  onToggleMode,
  onLogout,
  onOpenPeer,
  fullWidth = false,
  initialQuery,
}: Props) {
  const managers = useManagers()
  const t = useT()
  const loaded = useChatsStore((st) => st.loaded)
  const [query, setQuery] = useState(initialQuery ?? '')
  const [searching, setSearching] = useState(!!initialQuery)
  const [showSettings, setShowSettings] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
  const [premiumOpen, setPremiumOpen] = useState(false)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [newPrivateOpen, setNewPrivateOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)

  // Папки (tweb dialog filters): «Все» + пользовательские, из foldersStore.
  const folders = useFoldersStore((st) => st.folders)
  const folderId = useFoldersStore((st) => st.selectedId)
  const selectFolder = useFoldersStore((st) => st.select)
  const contactIds = useFoldersStore((st) => st.contactIds)
  // deep-open настроек на подэкран (контекстное меню «Настроить папки»)
  const [settingsSub, setSettingsSub] = useState<string | null>(null)
  // контекстное меню таба + удаление/редактирование папки
  const passcodeEnabled = useSettingsStore((st) => st.passcodeEnabled)
  const [tabMenu, setTabMenu] = useState<{ id: number; pos: CSSProperties } | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)

  const activeFolder = folders.find((f) => f.id === folderId)
  const tabOrder = useMemo(() => [ALL_FOLDER_ID, ...folders.map((f) => f.id)], [folders])

  // Memoized so <ChatList> / <FolderTabs> get stable props — a sidebar re-render
  // for overlay toggles won't produce new arrays and bust their memo.
  const filtered = useMemo(
    () => (activeFolder ? chats.filter((c) => matchesFolder(c, activeFolder, contactIds)) : chats),
    [chats, activeFolder, contactIds],
  )

  // Badge таба = число непрочитанных чатов папки (tweb folders-tabs Badge);
  // у «Все» — только незамьюченные (tweb unreadUnmutedCount).
  const folderUnread: Record<number, number> = useMemo(() => {
    const counts: Record<number, number> = {
      [ALL_FOLDER_ID]: chats.filter((c) => c.unread && !c.muted).length,
    }
    for (const f of folders) counts[f.id] = chats.filter((c) => c.unread && matchesFolder(c, f, contactIds)).length
    return counts
  }, [chats, folders, contactIds])

  const changeFolder = (id: number) => {
    if (id === folderId) return
    selectFolder(id)
    const el = listScrollRef.current
    if (el) el.scrollTop = 0
  }

  // Правый клик по табу — меню папки (tweb createFolderContextMenu)
  const onTabContextMenu = (id: number, e: React.MouseEvent) => {
    e.preventDefault()
    setTabMenu({ id, pos: { left: e.clientX, top: e.clientY } })
  }
  const menuFolder = tabMenu ? folders.find((f) => f.id === tabMenu.id) : undefined

  const doDeleteFolder = (f: Folder) => {
    setDeletingFolder(null)
    useFoldersStore.getState().remove(f.id) // оптимистично
    managers.folders.del(f.id).catch(() => loadFolders(managers))
  }

  // «Расположение папок → Слева от чатов» (tweb tabsInSidebar): вертикальная
  // колонка вместо горизонтальных табов; на узких экранах скрыта (tweb
  // until-floating-left-sidebar).
  const { tabsInSidebar } = useSettings()
  const narrowScreen = useMediaQuery('(max-width:900px)')
  const foldersSidebarShown = tabsInSidebar && folders.length > 0 && !narrowScreen && !fullWidth
  const openFolderSettings = () => {
    setSettingsSub('Chat Folders')
    setShowSettings(true)
  }

  const closeSearch = () => {
    setSearching(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const searchReal = (q: string): Promise<SearchResult> => managers.channels.search(q)
  const onJoin = async (username: string) => {
    await managers.channels.join(username)
    await loadChats(managers)
    closeSearch()
  }

  return (
    <div
      className={classNames(s.root, fullWidth ? s.fullWidth : '')}
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
          menu={{
            onOpenSettings: () => setShowSettings(true),
            onOpenContacts: () => setShowContacts(true),
            onOpenSaved: async () => {
              const id = await managers.chats.saved()
              await loadChats(managers)
              onSelect(String(id))
            },
            onOpenPremium: () => setPremiumOpen(true),
            onLogout,
          }}
        />
      )}
      {/* tweb .sidebar-header.main-search-sidebar-header. При включённой
          вертикальной колонке папок бургер живёт в ней (tweb is-first
          menu-button) — в шапке остаётся только стрелка «назад» при поиске. */}
      <div className={s.header}>
        {(!foldersSidebarShown || searching) && (
          <SidebarMenuButton
            searching={searching}
            onBack={closeSearch}
            onOpenSettings={() => setShowSettings(true)}
            onOpenContacts={() => setShowContacts(true)}
            onOpenSaved={async () => {
              const id = await managers.chats.saved()
              await loadChats(managers)
              onSelect(String(id))
            }}
            onOpenPremium={() => setPremiumOpen(true)}
            onLogout={onLogout}
          />
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
        {/* Замок над списком чатов при включённом код-пароле (tweb
            sidebar-lock-button): клик блокирует приложение. */}
        {passcodeEnabled && !searching && (
          <IconButton
            onClick={() => useLockStore.getState().lock()}
            color="var(--tg-textSecondary)"
            aria-label={t('Lock the app')}
            title={t('Lock the app')}
          >
            <TgIcon name="lock" size={24} />
          </IconButton>
        )}
      </div>

      {/* tweb #chatlist-container — список всегда смонтирован; поиск перекрывает его */}
      <div className={s.body}>
        <ChatList
          ref={listScrollRef}
          chats={filtered}
          selectedId={selectedId}
          onSelect={onSelect}
          loaded={loaded}
          folder={folderId}
          folderOrder={tabOrder}
          tabsShown={folders.length > 0 && !foldersSidebarShown}
        />

        {/* tweb .chatlist-overlay: градиент (за табами, гасит уплывающие строки в
            surface) + табы папок. Список прокручивается под ними. Табы видны
            только когда есть пользовательские папки (tweb onFiltersLengthChange)
            и папки не вынесены в вертикальную колонку. */}
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

        {/* tweb .sidebar-search — оверлей поиска (conditional: размонтируется мгновенно) */}
        {searching && (
          <div className={s.searchOverlay}>
            <motion.div
              className={s.searchInner}
              initial={{ opacity: 0, scale: 0.96, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              <SearchView query={query} chats={chats} onSelect={onSelect} searchReal={searchReal} onJoin={onJoin} onOpenPeer={onOpenPeer} />
            </motion.div>
          </div>
        )}
      </div>

      {/* Compose FAB (hidden while searching) — owns its own open state */}
      <ComposeFab
        searching={searching}
        onNewGroup={() => setNewGroupOpen(true)}
        onNewPrivate={() => setNewPrivateOpen(true)}
        onNewChannel={() => setNewChannelOpen(true)}
      />

      {/* Контекстное меню таба папки (tweb createFolderContextMenu) */}
      <Menu open={!!tabMenu} onClose={() => setTabMenu(null)} style={tabMenu?.pos}>
        {tabMenu?.id === ALL_FOLDER_ID ? (
          <MenuItem
            icon={<TgIcon name="edit" size={20} />}
            label={t('Edit folders')}
            onClick={() => {
              setTabMenu(null)
              setSettingsSub('Chat Folders')
              setShowSettings(true)
            }}
          />
        ) : (
          <>
            <MenuItem
              icon={<TgIcon name="edit" size={20} />}
              label={t('Edit folder')}
              onClick={() => {
                setTabMenu(null)
                if (menuFolder) setEditingFolder(menuFolder)
              }}
            />
            <MenuItem
              icon={<TgIcon name="delete" size={20} />}
              label={t('Delete')}
              danger
              onClick={() => {
                setTabMenu(null)
                if (menuFolder) setDeletingFolder(menuFolder)
              }}
            />
          </>
        )}
      </Menu>

      {/* Подтверждение удаления папки (tweb ChatList.Filter.Confirm.Remove) */}
      {deletingFolder && (
        <Popup
          open
          title={t('Remove Folder')}
          onClose={() => setDeletingFolder(null)}
          width={360}
          action={{ label: t('Delete'), onClick: () => doDeleteFolder(deletingFolder) }}
        >
          <div style={{ padding: '0 16px 8px' }}>
            <Text size={15}>
              {t('Are you sure you want to remove this folder? Your chats will not be deleted.')}
            </Text>
          </div>
        </Popup>
      )}

      {/* Редактор папки из контекстного меню таба */}
      <AnimatePresence>
        {editingFolder && (
          <FolderEditor folder={editingFolder} chats={chats} onClose={() => setEditingFolder(null)} />
        )}
      </AnimatePresence>

      {/* Overlays */}
      <PremiumModal open={premiumOpen} onClose={() => setPremiumOpen(false)} />
      <AnimatePresence>
        {showSettings && (
          <SettingsView
            onBack={() => {
              setShowSettings(false)
              setSettingsSub(null)
            }}
            onToggleMode={onToggleMode}
            chats={chats}
            initialSub={settingsSub ?? undefined}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showContacts && (
          <ContactsView
            chats={chats}
            onSelect={(id) => {
              setShowContacts(false)
              onSelect(id)
            }}
            onBack={() => setShowContacts(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {newGroupOpen && (
          <NewGroupFlow
            onClose={() => setNewGroupOpen(false)}
            onCreate={(name, memberIds, photo) => {
              onCreateGroup(name, memberIds, photo)
              setNewGroupOpen(false)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {newChannelOpen && (
          <NewChannelFlow
            onClose={() => setNewChannelOpen(false)}
            onCreate={(name, description) => {
              onCreateChannel(name, description)
              setNewChannelOpen(false)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {newPrivateOpen && (
          <NewPrivateChat
            chats={chats}
            onClose={() => setNewPrivateOpen(false)}
            onSelect={onSelect}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
