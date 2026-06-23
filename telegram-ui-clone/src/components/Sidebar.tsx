import { useEffect, useRef, useState } from 'react'
import { Box, IconButton, InputBase, useMediaQuery, useTheme } from '@mui/material'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR } from '../motion'
import type { Chat } from '../data'
import ChatListItem from './ChatListItem'
import NotificationBanner from './NotificationBanner'
import MainMenu from './MainMenu'
import ComposeMenu from './ComposeMenu'
import PremiumModal from './PremiumModal'
import SettingsView from './SettingsView'
import ContactsView from './ContactsView'
import NewGroupFlow from './NewGroupFlow'
import NewChannelFlow from './NewChannelFlow'
import NewPrivateChat from './NewPrivateChat'
import SearchView from './SearchView'
import StoriesRow, { StoriesStack, FULL_H } from './StoriesRow'
import StoryViewer from './StoryViewer'
import FolderTabs, { type FolderKey } from './FolderTabs'
import { useT } from '../i18n'

const MotionFab = motion(IconButton)

// tweb's bubbles-scrollable fade easing, bottom-only: fully opaque until 84px from
// the bottom, then an iOS-style eased ramp down to the 0.24 alpha floor.
const LIST_FADE = 84
const LIST_FADE_MASK = `linear-gradient(to bottom, #000 0, #000 calc(100% - ${LIST_FADE}px), color-mix(in srgb, #000 91.4%, rgba(255,255,255,0.24)) calc(100% - ${LIST_FADE * 0.8}px), color-mix(in srgb, #000 66.6%, rgba(255,255,255,0.24)) calc(100% - ${LIST_FADE * 0.6}px), color-mix(in srgb, #000 33.4%, rgba(255,255,255,0.24)) calc(100% - ${LIST_FADE * 0.4}px), color-mix(in srgb, #000 8.6%, rgba(255,255,255,0.24)) calc(100% - ${LIST_FADE * 0.2}px), rgba(255,255,255,0.24) 100%)`

interface Props {
  chats: Chat[]
  selectedId: string
  onSelect: (id: string) => void
  onCreateGroup: (name: string) => void
  onCreateChannel: (name: string, description: string) => void
  onToggleMode: (coords?: { x: number; y: number }) => void
  onLogout?: () => void
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
  fullWidth = false,
}: Props) {
  const theme = useTheme()
  const t = useT()
  const tg = theme.tg
  const mode = theme.palette.mode
  const [showBanner, setShowBanner] = useState(true)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
  const [premiumOpen, setPremiumOpen] = useState(false)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [newPrivateOpen, setNewPrivateOpen] = useState(false)
  const [storyIndex, setStoryIndex] = useState<number | null>(null)
  const [folder, setFolder] = useState<FolderKey>('all')
  const inputRef = useRef<HTMLInputElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const narrow = useMediaQuery('(max-width:900px)')
  const [foldP, setFoldP] = useState(0) // 0 = stories expanded, 1 = folded into the search bar
  const foldPRef = useRef(0)
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
      foldPRef.current = next
      setFoldP(next)
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

  // stories collapse progress: 0 = fully shown, 1 = hidden/folded
  const storiesProgress = narrow ? foldP : revealed ? 0 : 1

  const filtered = chats.filter((c) =>
    folder === 'all'
      ? true
      : folder === 'private'
        ? c.type === 'private'
        : folder === 'groups'
          ? c.type === 'group'
          : c.type === 'channel',
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
    // tweb parity: switching a folder scrolls the list to top and unfolds the
    // stories. Without this the scroll container keeps its old scrollTop while
    // foldP stays stale (the browser doesn't always fire `scroll` on content
    // swap), leaving a dead gap between the search bar and the folder tabs.
    const el = listScrollRef.current
    if (el) el.scrollTop = 0
    foldPRef.current = 0
    setFoldP(0)
  }

  const closeSearch = () => {
    setSearching(false)
    setQuery('')
    inputRef.current?.blur()
  }

  return (
    <Box
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
        <IconButton
          onClick={() => (searching ? closeSearch() : setMenuOpen((o) => !o))}
          sx={{ color: tg.textSecondary }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={searching ? 'back' : 'menu'}
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.18 }}
              style={{ display: 'inline-flex' }}
            >
              {searching ? <ArrowBackRoundedIcon /> : <MenuRoundedIcon />}
            </motion.span>
          </AnimatePresence>
        </IconButton>
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
          <SearchRoundedIcon sx={{ color: searching ? tg.accent : tg.textFaint, fontSize: 22 }} />
          <InputBase
            inputRef={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearching(true)}
            placeholder={t('Search')}
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
          {!searching && <StoriesStack onOpen={(i) => setStoryIndex(i)} progress={storiesProgress} />}
        </Box>
      </Box>

      {/* Stories + folder tabs (hidden while searching) */}
      {!searching && (
        <>
          <StoriesRow onOpen={(i) => setStoryIndex(i)} progress={storiesProgress} animated={!narrow} />
          <FolderTabs value={folder} onChange={changeFolder} />
        </>
      )}

      {/* Body — chat list always mounted; search view overlays it */}
      <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {/* Chat list (always present) */}
        <Box
          ref={listScrollRef}
          sx={{
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            // reserve a thin gutter so the list width stays constant whether or
            // not it scrolls — switching folders no longer shifts the content
            // (tweb keeps the scrollbar as a thin overlay for the same reason)
            scrollbarGutter: 'stable',
            scrollbarWidth: 'thin',
            scrollbarColor: `${tg.textFaint} transparent`,
            '&::-webkit-scrollbar': { width: '6px' },
            '&::-webkit-scrollbar-thumb': {
              background: 'transparent',
              borderRadius: '3px',
              transition: 'background .2s',
            },
            '&:hover::-webkit-scrollbar-thumb': { background: tg.textFaint },
            // smooth eased bottom fade (tweb bubbles-scrollable curve) so the last
            // chats melt away behind the floating compose button instead of a hard cut
            maskImage: LIST_FADE_MASK,
            WebkitMaskImage: LIST_FADE_MASK,
          }}
        >
          <AnimatePresence initial={false}>
            {showBanner && <NotificationBanner onClose={() => setShowBanner(false)} />}
          </AnimatePresence>
          <AnimatePresence mode="popLayout" custom={dirRef.current} initial={false}>
            <Box
              component={motion.div}
              key={folder}
              custom={dirRef.current}
              variants={{
                enter: (d: number) => ({ x: d > 0 ? '100%' : '-100%' }),
                center: { x: '0%' },
                exit: (d: number) => ({ x: d > 0 ? '-100%' : '100%' }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: DUR.in, ease: EASE }}
              sx={{ pt: 0.5, pb: '84px', width: '100%' }}
            >
              {filtered.map((chat, i) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  index={i}
                  selected={chat.id === selectedId}
                  onClick={() => onSelect(chat.id)}
                />
              ))}
            </Box>
          </AnimatePresence>
        </Box>

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
              <SearchView query={query} chats={chats} onSelect={onSelect} />
            </Box>
          </Box>
        )}
      </Box>

      {/* Compose FAB (hidden while searching) */}
      <AnimatePresence>
        {!searching && (
          <MotionFab
            onClick={() => setComposeOpen((o) => !o)}
            initial={{ y: 96, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 96, opacity: 0 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            sx={{
              position: 'absolute',
              right: 20,
              bottom: 20,
              zIndex: 32,
              width: 56,
              height: 56,
              background: tg.accentGradient,
              color: '#fff',
              '&:hover': { background: tg.accentGradient },
            }}
          >
            <motion.span
              animate={{ rotate: composeOpen ? 90 : 0 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'inline-flex' }}
            >
              {composeOpen ? <CloseRoundedIcon /> : <EditRoundedIcon />}
            </motion.span>
          </MotionFab>
        )}
      </AnimatePresence>

      {/* Overlays */}
      <MainMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenSettings={() => {
          setMenuOpen(false)
          setShowSettings(true)
        }}
        onOpenContacts={() => {
          setMenuOpen(false)
          setShowContacts(true)
        }}
        onOpenSaved={() => {
          setMenuOpen(false)
          onSelect('saved')
        }}
        onOpenPremium={() => {
          setMenuOpen(false)
          setPremiumOpen(true)
        }}
        onLogout={
          onLogout
            ? () => {
                setMenuOpen(false)
                onLogout()
              }
            : undefined
        }
      />
      <ComposeMenu
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onNewGroup={() => setNewGroupOpen(true)}
        onNewPrivate={() => setNewPrivateOpen(true)}
        onNewChannel={() => setNewChannelOpen(true)}
      />
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
          <StoryViewer index={storyIndex} onClose={() => setStoryIndex(null)} />
        )}
      </AnimatePresence>
    </Box>
  )
}
