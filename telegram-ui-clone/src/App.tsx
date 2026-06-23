import { useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Box, CssBaseline, ThemeProvider, useMediaQuery, useTheme } from '@mui/material'
import { buildTheme, resolvePreset, PRESET_MODE, type ThemeChoice } from './theme'
import { SettingsProvider, useSettings } from './settings'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import ConversationView from './components/ConversationView'
import ChatBackground from './components/ChatBackground'
import AuthFlow from './components/auth/AuthFlow'
import { I18nProvider, useT } from './i18n'
import { chats as initialChats, type Chat } from './data'

export type ToggleMode = (coords?: { x: number; y: number }) => void

const groupGradients = [
  'linear-gradient(135deg,#42e695,#3bb2b8)',
  'linear-gradient(135deg,#f7971e,#ffd200)',
  'linear-gradient(135deg,#6a11cb,#2575fc)',
  'linear-gradient(135deg,#ff5f6d,#ffc371)',
]

function Shell({ onToggleMode, onLogout }: { onToggleMode: ToggleMode; onLogout: () => void }) {
  const tg = useTheme().tg
  const t = useT()
  const [chatList, setChatList] = useState<Chat[]>(initialChats)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const createGroup = (name: string) => {
    const id = `group-${Date.now()}`
    const grad = groupGradients[Math.floor(Math.random() * groupGradients.length)]
    const newGroup: Chat = {
      id,
      name: name || 'New Group',
      avatar: grad,
      avatarText: (name || 'G')[0].toUpperCase(),
      date: 'now',
      preview: 'Group created',
      type: 'group',
      owned: true,
      status: '1 member',
      messages: [{ type: 'date', text: 'Today' }],
    }
    setChatList((prev) => [prev[0], newGroup, ...prev.slice(1)])
    setSelectedId(id)
  }

  const createChannel = (name: string, description: string) => {
    const id = `channel-${Date.now()}`
    const grad = groupGradients[Math.floor(Math.random() * groupGradients.length)]
    const newChannel: Chat = {
      id,
      name: name || 'New Channel',
      avatar: grad,
      avatarText: (name || 'C')[0].toUpperCase(),
      date: 'now',
      preview: 'Channel created',
      type: 'channel',
      owned: true,
      status: '1 subscriber',
      description: description || undefined,
      messages: [{ type: 'date', text: 'Today' }],
    }
    setChatList((prev) => [prev[0], newChannel, ...prev.slice(1)])
    setSelectedId(id)
  }

  const selected = chatList.find((c) => c.id === selectedId) ?? null

  // Responsive: below 900px the chat is full-width and the sidebar is hidden,
  // sliding out from the left (over the chat) when the back arrow is tapped.
  const narrow = useMediaQuery('(max-width:900px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const selectChat = (id: string) => {
    setSelectedId(id)
    setDrawerOpen(false)
  }
  const openDrawer = narrow ? () => setDrawerOpen(true) : undefined

  const renderSidebar = (fullWidth = false) => (
    <Sidebar
      chats={chatList}
      selectedId={selectedId ?? ''}
      onSelect={selectChat}
      onCreateGroup={(name) => {
        createGroup(name)
        setDrawerOpen(false)
      }}
      onCreateChannel={(name, description) => {
        createChannel(name, description)
        setDrawerOpen(false)
      }}
      onToggleMode={onToggleMode}
      onLogout={onLogout}
      fullWidth={fullWidth}
    />
  )

  const chatArea =
    selectedId === 'dollhouse-work' ? (
      <ChatView onBack={openDrawer} />
    ) : selected ? (
      <ConversationView key={selectedId} chat={selected} onBack={openDrawer} />
    ) : (
      <Box sx={{ flex: 1, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Box
          sx={{
            px: 2,
            py: 0.85,
            borderRadius: '16px',
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 500,
          }}
        >
          {t('Select a chat to start messaging')}
        </Box>
      </Box>
    )

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        minHeight: '100vh',
        background: tg.appBg,
      }}
    >
      {/* Animated 4-point gradient wallpaper + doodle pattern (tweb-style) */}
      <ChatBackground />

      {/* Wide: sidebar inline + chat (or empty state) */}
      {!narrow && (
        <>
          {renderSidebar()}
          {chatArea}
        </>
      )}

      {/* Narrow: no chat → the list fills the screen; a chat → chat + drawer */}
      {narrow && !selectedId && renderSidebar(true)}
      {narrow && selectedId && chatArea}

      {/* Narrow: sidebar as a slide-in drawer over the chat */}
      {narrow && selectedId && (
        <AnimatePresence>
          {drawerOpen && (
            <Box key="drawer">
              <Box
                component={motion.div}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDrawerOpen(false)}
                sx={{ position: 'fixed', inset: 0, zIndex: 1900, background: 'rgba(0,0,0,0.45)' }}
              />
              <Box
                component={motion.div}
                initial={{ x: '-106%' }}
                animate={{ x: '0%' }}
                exit={{ x: '-106%' }}
                transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
                sx={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 2000 }}
              >
                {renderSidebar()}
              </Box>
            </Box>
          )}
        </AnimatePresence>
      )}
    </Box>
  )
}

function ThemedApp() {
  const { themeChoice, update } = useSettings()
  const preset = resolvePreset(themeChoice)
  const theme = useMemo(() => buildTheme(preset), [preset])
  const [authed, setAuthed] = useState(() => localStorage.getItem('tg-authed') === '1')

  const login = () => {
    localStorage.setItem('tg-authed', '1')
    setAuthed(true)
  }
  const logout = () => {
    localStorage.removeItem('tg-authed')
    setAuthed(false)
  }

  // The header toggle flips between a light and a dark theme. It picks the
  // canonical Classic/Night presets unless the user is already on a light/dark
  // variant, in which case it jumps to the opposite mode's canonical preset.
  const apply = (next: ThemeChoice) => update({ themeChoice: next })

  // Circular reveal from the toggle click (View Transitions API), like tweb;
  // falls back to an instant swap when unsupported / reduced-motion / no coords.
  const toggleMode: ToggleMode = (coords) => {
    const next: ThemeChoice = PRESET_MODE[preset] === 'dark' ? 'classic' : 'night'
    const start = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } })
      .startViewTransition
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!start || !coords || reduce) {
      apply(next)
      return
    }
    const { x, y } = coords
    const transition = start.call(document, () => flushSync(() => apply(next)))
    transition.ready.then(() => {
      const endRadius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
        },
        {
          duration: 450,
          easing: 'cubic-bezier(.4, 0, .2, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {authed ? <Shell onToggleMode={toggleMode} onLogout={logout} /> : <AuthFlow onComplete={login} />}
    </ThemeProvider>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <SettingsProvider>
        <ThemedApp />
      </SettingsProvider>
    </I18nProvider>
  )
}
