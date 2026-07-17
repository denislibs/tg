import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useManagers } from './core/hooks/useManagers'
import { useConnectionStore, pingBackend } from './stores/connectionStore'
import { AnimatePresence, motion } from 'framer-motion'
import Text from './shared/ui/Text'
import classNames from './shared/lib/classNames'
import { resolvePreset, PRESET_MODE, type ThemeChoice } from './theme'
import { useSettings, useSettingsStore } from './settings'
import Sidebar from './components/Sidebar'
import type { GroupPhoto } from './components/NewGroupFlow'
import ConversationView from './components/ConversationView'
import ChatBackground from './components/ChatBackground'
import CallOverlay from './components/call/CallOverlay'
import PasscodeLockScreen from './components/PasscodeLockScreen'
import { useLockStore } from './stores/lockStore'
import { lockOnStartIfEnabled } from './core/passcode'
import { syncCacheSettingsToSW } from './core/mediaCache'
import AuthFlow from './components/auth/AuthFlow'
import { useT } from './i18n'
import type { Chat, OpenPeer } from './data'
import { useChatsStore, loadChats, loadPresence } from './stores/chatsStore'
import { primeMediaToken } from './core/mediaUrl'
import { loadStories } from './stores/storiesStore'
import { dialogToChat, gradientFor } from './core/dialogToChat'
import { startRealtime } from './client/realtimeBridge'
import { setupPush } from './client/pushSetup'
import { loadNotifySettings, useNotifyStore, notifyTypeForChat } from './stores/notifyStore'
import { loadPrivacy } from './stores/privacyStore'
import { loadFolders } from './stores/foldersStore'
import s from './App.module.scss'
import useMediaQuery from './shared/lib/useMediaQuery'

export type ToggleMode = (coords?: { x: number; y: number }) => void


// Run the /join deep-link handler at most once per app session.
let joinDeepLinkHandled = false

function Shell({ onToggleMode, onLogout }: { onToggleMode: ToggleMode; onLogout: () => void }) {
  const managers = useManagers()
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
    void loadNotifySettings(managers)
    void loadFolders(managers)
    void loadPrivacy(managers)
    lockOnStartIfEnabled()
    void primeMediaToken() // cache the media token so media bubbles build URLs sync
    // SW чистит медиакэш по TTL/лимиту при получении настроек (tweb clearOldCache)
    const { cacheTTL, cacheSize } = useSettingsStore.getState()
    syncCacheSettingsToSW(cacheTTL, cacheSize)
    startRealtime()
    // offline-уведомления (web push) подписываем только если не выключены в настройках
    if (useSettingsStore.getState().notifyPush) void setupPush()
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
  const notifySettings = useNotifyStore((s) => s.settings)
  const locked = useLockStore((s) => s.locked)

  // Автоблокировка по бездействию (tweb settings.passcode.autoLockTimeoutMins):
  // активность пользователя перевзводит таймер.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = () => {
      if (timer) clearTimeout(timer)
      const { passcodeEnabled, passcodeAutoLockMins } = useSettingsStore.getState()
      if (!passcodeEnabled || !passcodeAutoLockMins) return
      timer = setTimeout(() => useLockStore.getState().lock(), passcodeAutoLockMins * 60_000)
    }
    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'pointerdown']
    events.forEach((e) => window.addEventListener(e, arm))
    arm()
    return () => {
      events.forEach((e) => window.removeEventListener(e, arm))
      if (timer) clearTimeout(timer)
    }
  }, [])
  // Per-dialog Chat cache: return the SAME Chat object reference when its mapped
  // value is unchanged (compared by JSON), so a dialogs update (e.g. markRead
  // clearing one unread) only produces a new object for the row that changed —
  // letting memo(ChatListItem) bail on every other row.
  const chatCacheRef = useRef<Map<number, { json: string; chat: Chat }>>(new Map())
  const chatList = useMemo<Chat[]>(() => {
    const cache = chatCacheRef.current
    const seen = new Set<number>()
    const next = dialogs.map((d) => {
      let chat = dialogToChat(d, meId)
      // Глобально выключенный тип чатов показывается как muted (tweb
      // isPeerLocalMuted с respectType): иконка + серый badge у всех таких чатов.
      if (!chat.muted && notifySettings[notifyTypeForChat(d.type)].muted) chat = { ...chat, muted: true }
      seen.add(d.chatId)
      const json = JSON.stringify(chat)
      const hit = cache.get(d.chatId)
      if (hit && hit.json === json) return hit.chat // value-identical → reuse ref
      cache.set(d.chatId, { json, chat })
      return chat
    })
    for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k)
    return next
  }, [dialogs, meId, notifySettings])

  const createGroup = async (name: string, memberIds: number[], photo: GroupPhoto | null) => {
    const chatId = await managers.groups.createGroup({ title: name || 'New Group', memberIds })
    // Фото — после создания, как tweb (createChat → editPhoto): upload → set.
    if (photo) {
      const bytes = await photo.blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: photo.blob.size, width: photo.width, height: photo.height })
      await managers.groups.setPhoto(chatId, mediaId)
    }
    await loadChats(managers)
    setSelectedId(String(chatId))
  }

  const createChannel = async (name: string, description: string) => {
    const chatId = await managers.channels.createChannel({ title: name || 'New Channel', about: description })
    await loadChats(managers)
    setSelectedId(String(chatId))
  }

  // Responsive: below 900px columns overlap fullscreen (tweb handheld) — the
  // list fills the screen, opening a chat replaces it, back returns to the list.
  const narrow = useMediaQuery('(max-width:900px)')
  const selectChat = useCallback((id: string) => {
    setSelectedId(id)
    setDraftPeer(null)
  }, [])

  // Клик по браузерному уведомлению: sw.js фокусирует вкладку и шлёт
  // {type:'open-chat', chatId} — открываем этот чат.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; chatId?: number } | null
      if (d && d.type === 'open-chat' && d.chatId != null) selectChat(String(d.chatId))
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [selectChat])
  const backToList = narrow ? () => setSelectedId(null) : undefined

  // Open a conversation with a user (member row, group sender, search result).
  // Reuses an existing private dialog if there is one; otherwise opens a draft
  // that only becomes a real sidebar chat once the first message is sent.
  const openPeer = (peer: OpenPeer) => {
    if (peer.chatId != null) {
      selectChat(String(peer.chatId))
      return
    }
    if (meId != null && peer.id === meId) return // skip self for now
    const existing = dialogs.find((d) => d.type === 'private' && d.peer?.id === peer.id)
    if (existing) {
      selectChat(String(existing.chatId))
      return
    }
    setDraftPeer(peer)
    setSelectedId(`draft:${peer.id}`)
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

  // /?domain=username с публичной страницы /@username: префилл поиска
  const [deepDomain] = useState(() => {
    const d = new URLSearchParams(location.search).get('domain')
    if (d) window.history.replaceState({}, '', '/')
    return d ?? undefined
  })

  const renderSidebar = (fullWidth = false) => (
    <Sidebar
      chats={chatList}
      initialQuery={deepDomain}
      selectedId={selectedId ?? ''}
      onSelect={selectChat}
      onCreateGroup={(name, memberIds, photo) => {
        void createGroup(name, memberIds, photo)
      }}
      onCreateChannel={(name, description) => {
        void createChannel(name, description)
      }}
      onToggleMode={onToggleMode}
      onLogout={onLogout}
      onOpenPeer={openPeer}
      fullWidth={fullWidth}
    />
  )

  const chatArea =
    selected ? (
      <ConversationView key={selectedId} chat={selected} onBack={backToList} onOpenPeer={openPeer} onChatCreated={onChatCreated} />
    ) : (
      <div className={s.empty}>
        <div className={s.emptyPill}>
          {t('Select a chat to start messaging')}
        </div>
      </div>
    )

  return (
    <div className={s.root}>
      {/* Animated 4-point gradient wallpaper + doodle pattern (tweb-style) */}
      <ChatBackground />

      {/* Transient /join deep-link banner */}
      <AnimatePresence>
        {joinToast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            className={s.joinToast}
          >
            {joinToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* /qr/:token confirm overlay — approve a desktop QR login */}
      {qrConfirmToken && (
        <>
          <div onClick={cancelQr} className={s.qrScrim} />
          <motion.div
            role="dialog"
            aria-label={t('Войти на новом устройстве?')}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className={s.qrCard}
          >
            <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ marginBottom: '8px' }}>
              {t('Войти на новом устройстве?')}
            </Text>
            <Text size={14.5} color="var(--tg-textSecondary)" style={{ lineHeight: 1.5 }}>
              {t('Подтвердите вход для нового устройства')}
            </Text>
            <div className={s.qrActions}>
              <div role="button" tabIndex={0} onClick={cancelQr} className={classNames(s.qrBtn, s.qrCancel)}>
                {t('Отмена')}
              </div>
              <div role="button" tabIndex={0} onClick={() => void confirmQr()} className={classNames(s.qrBtn, s.qrConfirm)}>
                {t('Подтвердить')}
              </div>
            </div>
          </motion.div>
        </>
      )}

      {/* Wide: sidebar inline + chat (or empty state) */}
      {!narrow && (
        <>
          {renderSidebar()}
          {chatArea}
        </>
      )}

      {/* Narrow: columns overlap fullscreen (tweb handheld) — классический
          синхронный слайд: список 0 → -100%, чат 100% → 0 (и обратно по «назад»).
          Кромки движутся вместе, обои чата остаются статичным фоном под ними. */}
      {narrow && (
        <>
          <AnimatePresence initial={false}>
            {selectedId && (
              <motion.div
                key="chat"
                className={s.mobileColumn}
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
              >
                {chatArea}
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {!selectedId && (
              <motion.div
                key="list"
                className={s.mobileColumn}
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
              >
                {renderSidebar(true)}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Глобальный экран звонка (входящие показываются из любого места) */}
      <CallOverlay />

      {/* Блокировка код-паролем поверх всего (tweb passcodeLockScreen) */}
      {locked && <PasscodeLockScreen />}
    </div>
  )
}

function ThemedApp() {
  const managers = useManagers()
  const { themeChoice, update } = useSettings()
  const preset = resolvePreset(themeChoice)
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

  // Тема управляется атрибутом data-theme на <html> (токены CSS-vars из
  // styles/_tokens.scss) — MUI ThemeProvider больше не нужен.
  return authed === null ? null : authed ? (
    <Shell onToggleMode={toggleMode} onLogout={logout} />
  ) : (
    <AuthFlow onComplete={login} />
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
      <div
        className={s.apiBadge}
        style={{ background: backendOk == null ? '#888' : backendOk ? '#1a7f37' : '#b3261e' }}
      >
        api: {backendOk == null ? '…' : backendOk ? 'ok' : 'down'}
      </div>
    </>
  )
}
