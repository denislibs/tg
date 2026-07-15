import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE } from '../motion'
import classNames from '../shared/lib/classNames'
import s from './Sidebar.module.scss'
import { useChatsStore, loadChats } from '../stores/chatsStore'
import type { Chat, OpenPeer } from '../data'
import ChatList from './ChatList'
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
import FolderTabs, { type FolderKey } from './FolderTabs'
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
}: Props) {
  const managers = useManagers()
  const t = useT()
  const loaded = useChatsStore((st) => st.loaded)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
  const [premiumOpen, setPremiumOpen] = useState(false)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [newPrivateOpen, setNewPrivateOpen] = useState(false)
  const [folder, setFolder] = useState<FolderKey>('all')
  const inputRef = useRef<HTMLInputElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)

  // Memoized so <ChatList> / <FolderTabs> get stable props — a sidebar re-render
  // for overlay toggles won't produce new arrays and bust their memo.
  const filtered = useMemo(
    () =>
      chats.filter((c) =>
        folder === 'all'
          ? true
          : folder === 'private'
            ? c.type === 'private'
            : folder === 'groups'
              ? c.type === 'group'
              : c.type === 'channel',
      ),
    [chats, folder],
  )

  // Unread-chat counts per folder for the tab badges (no badge on "All Chats").
  const folderUnread: Partial<Record<FolderKey, number>> = useMemo(
    () => ({
      private: chats.filter((c) => c.type === 'private' && c.unread).length,
      groups: chats.filter((c) => c.type === 'group' && c.unread).length,
      channels: chats.filter((c) => c.type === 'channel' && c.unread).length,
    }),
    [chats],
  )

  // direction for the folder-switch slide (right tab -> slide from right, etc.)
  const FOLDER_ORDER: FolderKey[] = ['all', 'private', 'groups', 'channels']
  const dirRef = useRef(0)
  const changeFolder = (k: FolderKey) => {
    if (k === folder) return
    dirRef.current = FOLDER_ORDER.indexOf(k) > FOLDER_ORDER.indexOf(folder) ? 1 : -1
    setFolder(k)
    const el = listScrollRef.current
    if (el) el.scrollTop = 0
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
    <div className={classNames(s.root, fullWidth ? s.fullWidth : '')}>
      {/* tweb .sidebar-header.main-search-sidebar-header */}
      <div className={s.header}>
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
      </div>

      {/* tweb #chatlist-container — список всегда смонтирован; поиск перекрывает его */}
      <div className={s.body}>
        <ChatList
          ref={listScrollRef}
          chats={filtered}
          selectedId={selectedId}
          onSelect={onSelect}
          loaded={loaded}
          folder={folder}
          dir={dirRef.current}
        />

        {/* tweb .chatlist-overlay: градиент (за табами, гасит уплывающие строки в
            surface) + табы папок. Список прокручивается под ними. */}
        {!searching && (
          <div className={s.overlay}>
            <div className={s.gradientContainer}>
              <div className={s.gradient} />
            </div>
            <FolderTabs value={folder} onChange={changeFolder} counts={folderUnread} />
          </div>
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

      {/* Overlays */}
      <PremiumModal open={premiumOpen} onClose={() => setPremiumOpen(false)} />
      <AnimatePresence>
        {showSettings && (
          <SettingsView onBack={() => setShowSettings(false)} onToggleMode={onToggleMode} />
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
