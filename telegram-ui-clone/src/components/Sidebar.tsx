import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, InputBase, useMediaQuery, useTheme } from '@mui/material'
import { useChatsStore } from '../stores/chatsStore'
import Preloader from './Preloader'
import TgIcon from './TgIcon'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE } from '../motion'
import type { Chat, OpenPeer } from '../data'
import ChatList from './ChatList'
import NotificationBanner from './NotificationBanner'
import SidebarMenuButton from './SidebarMenuButton'
import ComposeFab from './ComposeFab'
import PremiumModal from './PremiumModal'
import SettingsView from './SettingsView'
import ContactsView from './ContactsView'
import NewGroupFlow from './NewGroupFlow'
import NewChannelFlow from './NewChannelFlow'
import NewPrivateChat from './NewPrivateChat'
import SearchView from './SearchView'
import { startClient } from '../client/bootstrap'
import { loadChats } from '../stores/chatsStore'
import { loadStories } from '../stores/storiesStore'
import type { SearchResult } from '../core/managers/channelsManager'
import StoriesRow, { StoriesStack, FULL_H } from './StoriesRow'
import AddStorySheet from './AddStorySheet'
import StoryViewer from './StoryViewer'
import FolderTabs, { type FolderKey } from './FolderTabs'
import { useT } from '../i18n'

// Read an image file's intrinsic dimensions (best-effort, for media metadata).
function imageDims(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight }
      URL.revokeObjectURL(url)
      resolve(dims)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image load failed'))
    }
    img.src = url
  })
}

interface Props {
  chats: Chat[]
  selectedId: string
  onSelect: (id: string) => void
  onCreateGroup: (name: string) => void
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
  const theme = useTheme()
  const t = useT()
  const tg = theme.tg
  const mode = theme.palette.mode
  const loaded = useChatsStore((s) => s.loaded)
  const [showBanner, setShowBanner] = useState(true)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
  const [premiumOpen, setPremiumOpen] = useState(false)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [newPrivateOpen, setNewPrivateOpen] = useState(false)
  const [storyIndex, setStoryIndex] = useState<number | null>(null)
  // add-story flow: file picked + uploaded → caption/privacy sheet → post
  const [pendingMediaId, setPendingMediaId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [folder, setFolder] = useState<FolderKey>('all')
  const inputRef = useRef<HTMLInputElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const narrow = useMediaQuery('(max-width:900px)')
  // Stories fold (0 = expanded, 1 = folded into the search bar). The CONTINUOUS
  // value lives only as the `--stories-fold` CSS var on the root + a ref — never as
  // React state — so scrolling the chat list causes ZERO Sidebar re-renders. The
  // single discrete bit (is the folded cluster shown?) flips on threshold crossing.
  const foldPRef = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const [stackShown, setStackShown] = useState(false)
  const stackShownRef = useRef(false)
  const setFold = (next: number) => {
    foldPRef.current = next
    rootRef.current?.style.setProperty('--stories-fold', String(next))
    const sh = next > 0.45
    if (sh !== stackShownRef.current) { stackShownRef.current = sh; setStackShown(sh) }
  }
  // Desktop: stories are hidden and revealed by over-scrolling up at the top
  // of the list (tweb behaviour); they slide out with an animation.
  const [revealed, setRevealed] = useState(false)
  const revealedRef = useRef(false)
  const setReveal = (v: boolean) => {
    revealedRef.current = v
    setRevealed(v)
  }

  // Fold distance: stories are fully folded once the list is scrolled this far.
  const FOLD_DIST = 80

  // MOBILE: fold the stories row into the search bar as the list scrolls.
  useEffect(() => {
    if (!narrow) return
    const el = listScrollRef.current
    if (!el) return
    let raf = 0
    const apply = (next: number) => {
      if (next === foldPRef.current) return
      setFold(next) // CSS var only — no setState, no re-render on scroll
    }
    const recompute = () => {
      const storiesH = FULL_H * (1 - foldPRef.current)
      const room = el.scrollHeight - (el.clientHeight + storiesH)
      if (room < FOLD_DIST) {
        apply(0)
        return
      }
      apply(Math.min(1, Math.max(0, el.scrollTop / FOLD_DIST)))
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(recompute)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()
    return () => {
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [narrow])

  // DESKTOP: reveal the (otherwise hidden) stories by over-scrolling up at the
  // very top of the list; scrolling back down hides them again.
  useEffect(() => {
    if (narrow) return
    const el = listScrollRef.current
    if (!el) return
    let acc = 0
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && el.scrollTop <= 0) {
        acc += -e.deltaY
        if (acc > 24 && !revealedRef.current) setReveal(true)
      } else if (e.deltaY > 0) {
        if (revealedRef.current && el.scrollTop <= 0) {
          e.preventDefault()
          setReveal(false)
        }
        acc = 0
      } else {
        acc = 0
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [narrow])

  // Sync the fold to the layout mode: desktop reveal is binary (0 shown / 1 hidden,
  // with a CSS transition on the row); narrow re-asserts the current scroll fold.
  // (The narrow scroll handler keeps it updated per frame via the CSS var.)
  useLayoutEffect(() => {
    setFold(narrow ? foldPRef.current : revealed ? 0 : 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow, revealed])

  // Memoized so <ChatList> / <FolderTabs> get stable props — a sidebar re-render
  // for stories-fold/overlay toggles won't produce new arrays and bust their memo.
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
  const didChangeFolderRef = useRef(false)
  const changeFolder = (k: FolderKey) => {
    if (k === folder) return
    dirRef.current = FOLDER_ORDER.indexOf(k) > FOLDER_ORDER.indexOf(folder) ? 1 : -1
    didChangeFolderRef.current = true
    setFolder(k)
    const el = listScrollRef.current
    if (el) el.scrollTop = 0
    setFold(0)
  }

  const closeSearch = () => {
    setSearching(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const searchReal = (q: string): Promise<SearchResult> => startClient().managers.channels.search(q)
  const onJoin = async (username: string) => {
    const { managers } = startClient()
    await managers.channels.join(username)
    await loadChats(managers)
    closeSearch()
  }

  // Add-story: pick a file → upload → open the caption/privacy sheet.
  const onPickStoryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    const bytes = await file.arrayBuffer()
    let width: number | undefined
    let height: number | undefined
    if (file.type.startsWith('image/')) {
      try {
        const dims = await imageDims(file)
        width = dims.width
        height = dims.height
      } catch {
        // dimensions are best-effort; proceed without them
      }
    }
    const { managers } = startClient()
    const mediaId = await managers.media.upload({ bytes, mime: file.type, size: file.size, width, height })
    setPendingMediaId(mediaId)
  }

  const onPublishStory = async (args: {
    caption: string
    privacy: 'everyone' | 'contacts' | 'selected'
    allowIds: number[]
  }) => {
    if (pendingMediaId == null) return
    const { managers } = startClient()
    await managers.stories.post({ mediaId: pendingMediaId, ...args })
    await loadStories(managers)
    setPendingMediaId(null)
  }

  return (
    <Box
      ref={rootRef}
      sx={{
        position: 'sticky',
        top: '16px',
        zIndex: 20,
        width: fullWidth ? 'auto' : 360,
        flex: fullWidth ? '1 1 auto' : '0 0 auto',
        minWidth: 0,
        mt: 2,
        ml: '16px',
        mr: fullWidth ? '16px' : 0,
        height: 'calc(100vh - 32px)',
        background: tg.sidebarBg,
        borderRadius: '24px',
        overflow: 'hidden',
        boxShadow:
          mode === 'dark' ? '0 10px 40px rgba(0,0,0,0.45)' : '0 10px 40px rgba(80,60,160,0.18)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
        <SidebarMenuButton
          searching={searching}
          onBack={closeSearch}
          onOpenSettings={() => setShowSettings(true)}
          onOpenContacts={() => setShowContacts(true)}
          onOpenSaved={async () => {
            const { managers } = startClient()
            const id = await managers.chats.saved()
            await loadChats(managers)
            onSelect(String(id))
          }}
          onOpenPremium={() => setPremiumOpen(true)}
          onLogout={onLogout}
        />
        <Box
          onClick={() => inputRef.current?.focus()}
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            cursor: 'text',
            background: mode === 'dark' ? '#181818' : '#f0f0f2',
            borderRadius: '9999px',
            height: 44,
            px: 1.75,
            py: 0,
            border: `1.5px solid ${searching ? tg.accent : 'transparent'}`,
            transition: 'border-color .18s ease, background .18s ease',
            '&:hover': {
              borderColor: searching
                ? tg.accent
                : mode === 'dark'
                  ? 'rgba(255,255,255,0.18)'
                  : 'rgba(0,0,0,0.18)',
            },
          }}
        >
          {loaded ? (
            <TgIcon name="search" size={22} color={searching ? tg.accent : tg.textFaint} />
          ) : (
            <Preloader size={20} stroke={2.2} color={tg.textFaint} />
          )}
          <InputBase
            inputRef={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearching(true)}
            placeholder={loaded ? t('Search') : t('Updating…')}
            sx={{
              flex: 1,
              fontFamily:
                'Roboto, -apple-system, "apple color emoji", "system-ui", "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif',
              fontSize: '16px',
              fontWeight: 400,
              lineHeight: '21px',
              fontStyle: 'normal',
              color: tg.textPrimary,
              '& input': {
                padding: 0,
                height: '21px',
                fontSize: '16px',
                fontWeight: 400,
                lineHeight: '21px',
                color: tg.textPrimary,
              },
              '& input::placeholder': { color: tg.textFaint, opacity: 1 },
            }}
          />
          {!searching && <StoriesStack onOpen={(i) => setStoryIndex(i)} show={stackShown} />}
        </Box>
      </Box>

      {/* Stories + folder tabs (hidden while searching) */}
      {!searching && (
        <>
          <StoriesRow
            onOpen={(i) => setStoryIndex(i)}
            onAddStory={() => fileInputRef.current?.click()}
            animated={!narrow}
          />
        </>
      )}
      <AnimatePresence initial={false}>
        {showBanner && <NotificationBanner onClose={() => setShowBanner(false)} />}
      </AnimatePresence>
      {/* Body — chat list always mounted; search view overlays it */}
      <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {/* Chat list (always present) */}
        <ChatList
          ref={listScrollRef}
          chats={filtered}
          selectedId={selectedId}
          onSelect={onSelect}
          loaded={loaded}
          folder={folder}
          dir={dirRef.current}
        />

        {/* tweb .menu-horizontal-gradient: a surface→transparent gradient just
            under the folder tabs so rows melt into the (white) surface as they
            scroll up, instead of a hard edge / showing the wallpaper. */}
        {!searching && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 80,
              background: `linear-gradient(180deg, ${tg.sidebarBg} 0%, transparent 100%)`,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          />
        )}

        {/* Folder tabs — absolutely positioned over the list (tweb): the list
            scrolls under them and the gradient above fades the rows out. */}
        {!searching && (
          <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 }}>
            <FolderTabs value={folder} onChange={changeFolder} counts={folderUnread} />
          </Box>
        )}

        {/* Search view overlay — conditional (unmounts instantly, no stuck exit) */}
        {searching && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              background: tg.sidebarBg,
              zIndex: 10,
            }}
          >
            <Box
              component={motion.div}
              initial={{ opacity: 0, scale: 0.96, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
              sx={{ height: '100%', transformOrigin: 'top center' }}
            >
              <SearchView query={query} chats={chats} onSelect={onSelect} searchReal={searchReal} onJoin={onJoin} onOpenPeer={onOpenPeer} />
            </Box>
          </Box>
        )}
      </Box>

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
            onCreate={(name) => {
              onCreateGroup(name)
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
      <AnimatePresence>
        {storyIndex !== null && (
          <StoryViewer
            groupIndex={storyIndex}
            onClose={() => {
              setStoryIndex(null)
              void loadStories(startClient().managers)
            }}
          />
        )}
      </AnimatePresence>

      {/* Hidden file picker for the add-story flow */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={onPickStoryFile}
      />

      {/* Caption + privacy sheet (after a story file is uploaded) */}
      <AnimatePresence>
        {pendingMediaId !== null && (
          <AddStorySheet onBack={() => setPendingMediaId(null)} onPublish={onPublishStory} />
        )}
      </AnimatePresence>
    </Box>
  )
}
