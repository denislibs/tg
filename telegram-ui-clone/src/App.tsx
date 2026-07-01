import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useManagers } from './core/hooks/useManagers'
import { useConnectionStore, pingBackend } from './stores/connectionStore'
import { AnimatePresence, motion } from 'framer-motion'
import { Box, CssBaseline, ThemeProvider, useMediaQuery, useTheme } from '@mui/material'
import Text from './shared/ui/Text'
import { buildTheme, resolvePreset, PRESET_MODE, type ThemeChoice } from './theme'
import { useSettings } from './settings'
import Sidebar from './components/Sidebar'
import ConversationView from './components/ConversationView'
import ChatBackground from './components/ChatBackground'
import AuthFlow from './components/auth/AuthFlow'
import { useT } from './i18n'
import type { Chat, OpenPeer } from './data'
import { useChatsStore, loadChats, loadPresence } from './stores/chatsStore'
import { primeMediaToken } from './core/mediaUrl'
import { loadStories } from './stores/storiesStore'
import { dialogToChat, gradientFor } from './core/dialogToChat'
import { startRealtime } from './client/realtimeBridge'
import { setupPush } from './client/pushSetup'

export type ToggleMode = (coords?: { x: number; y: number }) => void

// Run the /join deep-link handler at most once per app session.
let joinDeepLinkHandled = false

function Shell({ onToggleMode, onLogout }: { onToggleMode: ToggleMode; onLogout: () => void }) {
  const managers = useManagers()
  const tg = useTheme().tg
  const t = useT()
  const dialogs = useChatsStore((s) => s.dialogs)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A peer we've opened a conversation with but who has no dialog yet: shown as a
  // draft chat. No sidebar entry is created until the first message is sent.
  const [draftPeer, setDraftPeer] = useState<OpenPeer | null>(null)
  const [joinToast, setJoinToast] = useState<string | null>(null)
  const joinToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [qrConfirmToken, setQrConfirmToken] = useState<string | null>(null)

  const showJoinToast = (text: string) => {
    setJoinToast(text)
    if (joinToastTimer.current) clearTimeout(joinToastTimer.current)
    joinToastTimer.current = setTimeout(() => setJoinToast(null), 4000)
  }

  useEffect(() => {
    void loadChats(managers).then(() => loadPresence(managers))
    void loadStories(managers)
    void primeMediaToken() // cache the media token so media bubbles build URLs sync
    startRealtime()
    void setupPush()
  }, [managers])

  // /join/:token deep link — authed only, runs once. Joins or sends a request,
  // shows a transient banner, then clears the path.
  useEffect(() => {
    if (joinDeepLinkHandled) return
    const m = location.pathname.match(/^\/join\/([\w-]+)$/)
    if (!m) return
    joinDeepLinkHandled = true
    const token = m[1]
    void managers.groups
      .joinByToken(token)
      .then(async (res) => {
        if (res.status === 'joined') {
          await loadChats(managers)
          showJoinToast('Вы вступили')
        } else {
          showJoinToast('Заявка отправлена, ждите одобрения')
        }
      })
      .catch(() => showJoinToast('Не удалось перейти по ссылке'))
      .finally(() => {
        window.history.replaceState({}, '', '/')
      })
    return () => {
      if (joinToastTimer.current) clearTimeout(joinToastTimer.current)
    }
  }, [managers])

  // /qr/:token confirm deep link — authed only. Shows a confirm overlay; on
  // confirm, approves the desktop's QR login, then clears the path.
  useEffect(() => {
    const m = location.pathname.match(/^\/qr\/([\w-]+)$/)
    if (!m) return
    setQrConfirmToken(m[1])
  }, [])

  const confirmQr = async () => {
    if (!qrConfirmToken) return
    try {
      await managers.auth.qrConfirm(qrConfirmToken)
      showJoinToast('Вход подтверждён')
    } catch {
      showJoinToast('Не удалось подтвердить')
    }
    setQrConfirmToken(null)
    window.history.replaceState({}, '', '/')
  }

  const cancelQr = () => {
    setQrConfirmToken(null)
    window.history.replaceState({}, '', '/')
  }

  const meId = useChatsStore((s) => s.meId)
  // Per-dialog Chat cache: return the SAME Chat object reference when its mapped
  // value is unchanged (compared by JSON), so a dialogs update (e.g. markRead
  // clearing one unread) only produces a new object for the row that changed —
  // letting memo(ChatListItem) bail on every other row.
  const chatCacheRef = useRef<Map<number, { json: string; chat: Chat }>>(new Map())
  const chatList = useMemo<Chat[]>(() => {
    const cache = chatCacheRef.current
    const seen = new Set<number>()
    const next = dialogs.map((d) => {
      const chat = dialogToChat(d, meId)
      seen.add(d.chatId)
      const json = JSON.stringify(chat)
      const hit = cache.get(d.chatId)
      if (hit && hit.json === json) return hit.chat // value-identical → reuse ref
      cache.set(d.chatId, { json, chat })
      return chat
    })
    for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k)
    return next
  }, [dialogs, meId])

  const createGroup = async (name: string) => {
    const chatId = await managers.groups.createGroup({ title: name || 'New Group' })
    await loadChats(managers)
    setSelectedId(String(chatId))
  }

  const createChannel = async (name: string, description: string) => {
    const chatId = await managers.channels.createChannel({ title: name || 'New Channel', about: description })
    await loadChats(managers)
    setSelectedId(String(chatId))
  }

  // Responsive: below 900px the chat is full-width and the sidebar is hidden,
  // sliding out from the left (over the chat) when the back arrow is tapped.
  const narrow = useMediaQuery('(max-width:900px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const selectChat = useCallback((id: string) => {
    setSelectedId(id)
    setDraftPeer(null)
    setDrawerOpen(false)
  }, [])
  const openDrawer = narrow ? () => setDrawerOpen(true) : undefined

  // Open a conversation with a user (member row, group sender, search result).
  // Reuses an existing private dialog if there is one; otherwise opens a draft
  // that only becomes a real sidebar chat once the first message is sent.
  const openPeer = (peer: OpenPeer) => {
    if (meId != null && peer.id === meId) return // skip self for now
    const existing = dialogs.find((d) => d.type === 'private' && d.peer?.id === peer.id)
    if (existing) {
      selectChat(String(existing.chatId))
      return
    }
    setDraftPeer(peer)
    setSelectedId(`draft:${peer.id}`)
    setDrawerOpen(false)
    void loadPresence(managers, [peer.id])
  }

  // The draft chat (id "draft:<peerId>"), rendered when no real dialog is selected.
  const draftChat: Chat | null =
    draftPeer && selectedId === `draft:${draftPeer.id}`
      ? {
          id: `draft:${draftPeer.id}`,
          name: draftPeer.displayName,
          avatar: gradientFor(draftPeer.id),
          avatarText: draftPeer.displayName.charAt(0).toUpperCase() || '?',
          avatarUrl: draftPeer.avatarUrl,
          peerId: draftPeer.id,
          date: '',
          preview: '',
          type: 'private',
          username: draftPeer.username ?? undefined,
        }
      : null

  const selected = chatList.find((c) => c.id === selectedId) ?? draftChat

  // First message in a draft created the real chat: refresh dialogs and switch to it.
  const onChatCreated = (chatId: number) => {
    setDraftPeer(null)
    setSelectedId(String(chatId))
    void loadChats(managers)
  }

  const renderSidebar = (fullWidth = false) => (
    <Sidebar
      chats={chatList}
      selectedId={selectedId ?? ''}
      onSelect={selectChat}
      onCreateGroup={(name) => {
        void createGroup(name)
        setDrawerOpen(false)
      }}
      onCreateChannel={(name, description) => {
        void createChannel(name, description)
        setDrawerOpen(false)
      }}
      onToggleMode={onToggleMode}
      onLogout={onLogout}
      onOpenPeer={openPeer}
      fullWidth={fullWidth}
    />
  )

  const chatArea =
    selected ? (
      <ConversationView key={selectedId} chat={selected} onBack={openDrawer} onOpenPeer={openPeer} onChatCreated={onChatCreated} />
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

      {/* Transient /join deep-link banner */}
      <AnimatePresence>
        {joinToast && (
          <Box
            component={motion.div}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            sx={{
              position: 'fixed',
              top: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 3000,
              px: 2.5,
              py: 1.25,
              borderRadius: '14px',
              background: 'rgba(0,0,0,0.78)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 500,
              boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
            }}
          >
            {joinToast}
          </Box>
        )}
      </AnimatePresence>

      {/* /qr/:token confirm overlay — approve a desktop QR login */}
      {qrConfirmToken && (
        <>
          <Box
            onClick={cancelQr}
            sx={{ position: 'fixed', inset: 0, zIndex: 4100, background: 'rgba(0,0,0,0.45)' }}
          />
          <Box
            role="dialog"
            aria-label={t('Войти на новом устройстве?')}
            component={motion.div}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            sx={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 4101,
              width: 'min(360px, calc(100vw - 32px))',
              p: 2.5,
              background: tg.menuBg,
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              borderRadius: '14px',
              boxShadow: tg.menuShadow,
            }}
          >
            <Text size={17} weight={600} color={tg.textPrimary} style={{ marginBottom: '8px' }}>
              {t('Войти на новом устройстве?')}
            </Text>
            <Text size={14.5} color={tg.textSecondary} style={{ lineHeight: 1.5 }}>
              {t('Подтвердите вход для нового устройства')}
            </Text>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2.5 }}>
              <Box
                role="button"
                tabIndex={0}
                onClick={cancelQr}
                sx={{
                  px: 2,
                  py: 1,
                  borderRadius: '10px',
                  fontSize: 14.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  color: tg.textSecondary,
                  cursor: 'pointer',
                  '&:hover': { background: tg.hover },
                }}
              >
                {t('Отмена')}
              </Box>
              <Box
                role="button"
                tabIndex={0}
                onClick={() => void confirmQr()}
                sx={{
                  px: 2,
                  py: 1,
                  borderRadius: '10px',
                  fontSize: 14.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  color: tg.accent,
                  cursor: 'pointer',
                  '&:hover': { background: tg.hover },
                }}
              >
                {t('Подтвердить')}
              </Box>
            </Box>
          </Box>
        </>
      )}

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
  const managers = useManagers()
  const { themeChoice, update } = useSettings()
  const preset = resolvePreset(themeChoice)
  const theme = useMemo(() => buildTheme(preset), [preset])
  const [authed, setAuthed] = useState<boolean | null>(null) // null = checking

  // Drive the active theme via a `data-theme` attribute on <html> — token CSS-vars
  // (styles/_tokens.scss) resolve from it, so a theme switch is just the attribute
  // (no per-element JS value swap). useLayoutEffect sets it before paint (no FOUC).
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = preset
  }, [preset])

  useEffect(() => {
    managers.auth.me().then((u) => setAuthed(!!u)).catch(() => setAuthed(false))
  }, [managers])

  const login = () => setAuthed(true)
  const logout = () => {
    void managers.auth.logout()
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
      {authed === null ? null : authed ? (
        <Shell onToggleMode={toggleMode} onLogout={logout} />
      ) : (
        <AuthFlow onComplete={login} />
      )}
    </ThemeProvider>
  )
}

export default function App() {
  const managers = useManagers()
  const backendOk = useConnectionStore((s) => s.backendOk)
  useEffect(() => {
    void pingBackend(managers)
  }, [managers])

  return (
    <>
      <ThemedApp />
      <div style={{ position: 'fixed', bottom: 6, right: 8, zIndex: 9999, fontSize: 11, padding: '2px 6px', borderRadius: 6,
        background: backendOk == null ? '#888' : backendOk ? '#1a7f37' : '#b3261e', color: '#fff' }}>
        api: {backendOk == null ? '…' : backendOk ? 'ok' : 'down'}
      </div>
    </>
  )
}
