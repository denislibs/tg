import { useEffect, useLayoutEffect } from 'react'
import { useManagers } from './core/hooks/useManagers'
import { useConnectionStore, pingBackend } from './stores/connectionStore'
import { MotionConfig } from 'framer-motion'
import { useSettingsStore } from './settings'
import Sidebar from './components/Sidebar'
import type { GroupPhoto } from './components/NewGroupFlow'
import ConversationView from './components/ConversationView'
import ChatBackground from './components/ChatBackground'
import GlobalOverlays from './components/shell/GlobalOverlays'
import ShellLayout from './components/shell/ShellLayout'
import AuthFlow from './components/auth/AuthFlow'
import { useT } from './i18n'
import type { Chat } from './data'
import { loadChats } from './stores/chatsStore'
import { gradientFor } from './core/dialogToChat'
import { usePipStore } from './core/pip'
import { useAppBootstrap } from './core/hooks/useAppBootstrap'
import { useShellEnterAnimation } from './core/hooks/useShellEnterAnimation'
import { useAutoLock } from './core/hooks/useAutoLock'
import { useGlobalToast } from './core/hooks/useGlobalToast'
import { useDeepLinks } from './core/hooks/useDeepLinks'
import { useChatList } from './core/hooks/useChatList'
import { useChatNavigation } from './core/hooks/useChatNavigation'
import { useShellTheme } from './core/hooks/useShellTheme'
import { useAppHotkeys } from './core/hooks/useAppHotkeys'
import { useAuthGate } from './core/hooks/useAuthGate'
import { useThemeToggle } from './core/hooks/useThemeToggle'
import s from './App.module.scss'
import useMediaQuery from './shared/lib/useMediaQuery'

export type ToggleMode = (coords?: { x: number; y: number }) => void

function Shell({ onToggleMode, onLogout }: { onToggleMode: ToggleMode; onLogout: () => void }) {
  const managers = useManagers()
  const t = useT()

  // Инфраструктура Shell (эффекты без общего стейта).
  useAppBootstrap()
  useShellEnterAnimation()
  useAutoLock()
  useAppHotkeys()
  const { toast, showToast } = useGlobalToast()

  // Навигация (navigationStore) + deep-links + список чатов.
  const nav = useChatNavigation()
  const { selectedId, openThread, draftPeer } = nav
  const deep = useDeepLinks(showToast)
  const chatList = useChatList()

  const createGroup = async (name: string, memberIds: number[], photo: GroupPhoto | null) => {
    const chatId = await managers.groups.createGroup({ title: name || 'New Group', memberIds })
    // Фото — после создания, как tweb (createChat → editPhoto): upload → set.
    if (photo) {
      const bytes = await photo.blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: photo.blob.size, width: photo.width, height: photo.height })
      await managers.groups.setPhoto(chatId, mediaId)
    }
    await loadChats(managers)
    nav.setSelectedId(String(chatId))
  }

  const createChannel = async (name: string, description: string) => {
    const chatId = await managers.channels.createChannel({ title: name || 'New Channel', about: description })
    await loadChats(managers)
    nav.setSelectedId(String(chatId))
  }

  // Responsive: below 900px columns overlap fullscreen (tweb handheld). PiP-окно
  // узкое — форсируем мобильный layout (useMediaQuery слушает основное окно).
  const pipActive = usePipStore((st) => st.active)
  const narrow = useMediaQuery('(max-width:900px)') || pipActive
  const backToList = narrow ? () => nav.setSelectedId(null) : undefined

  // Черновик-чат (id "draft:<peerId>"), когда реального диалога ещё нет.
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

  const renderSidebar = (fullWidth = false) => (
    <Sidebar
      chats={chatList}
      initialQuery={deep.deepDomain}
      selectedId={selectedId ?? ''}
      onSelect={nav.selectChat}
      onOpenTopic={nav.openTopicThread}
      activeTopicId={openThread?.thread.kind === 'topic' ? openThread.thread.rootMsgId : null}
      onCreateGroup={(name, memberIds, photo) => { void createGroup(name, memberIds, photo) }}
      onCreateChannel={(name, description) => { void createChannel(name, description) }}
      onToggleMode={onToggleMode}
      onLogout={onLogout}
      onOpenPeer={nav.openPeer}
      onChatCreated={nav.onChatCreated}
      fullWidth={fullWidth}
    />
  )

  // Чат треда: диалог из списка, а для комментариев (discussion-группа, где мы
  // можем не состоять) — синтетический Chat.
  const threadChat: Chat | null = openThread
    ? chatList.find((c) => c.id === String(openThread.chatId)) ?? {
        id: String(openThread.chatId),
        name: openThread.thread.title,
        avatar: gradientFor(openThread.chatId),
        avatarText: '#',
        date: '',
        preview: '',
        type: 'group',
      }
    : null

  const { shellThemeVariant, shellThemeStyle } = useShellTheme({ selected, openThread, threadChat })

  const chatArea =
    openThread && threadChat ? (
      <ConversationView
        key={`thread-${openThread.chatId}-${openThread.thread.rootMsgId}`}
        chat={threadChat}
        thread={openThread.thread}
        onCloseThread={nav.closeThread}
        onBack={backToList}
        onOpenPeer={nav.openPeer}
        onChatCreated={nav.onChatCreated}
      />
    ) : selected ? (
      <ConversationView key={selectedId} chat={selected} onBack={backToList} onOpenPeer={nav.openPeer} onChatCreated={nav.onChatCreated} onOpenThread={nav.openCommentsThread} onOpenChannel={nav.openPublicChannel} />
    ) : (
      <div className={s.empty}>
        <div className={s.emptyPill}>{t('Select a chat to start messaging')}</div>
      </div>
    )

  return (
    <div id="app-shell" className={s.root} style={shellThemeStyle}>
      {/* Animated 4-point gradient wallpaper + doodle pattern (tweb-style). Обои темы
          активного чата поднимаются сюда, чтобы весь shell был в теме. */}
      <ChatBackground themeColors={shellThemeVariant?.gradient} />

      <ShellLayout narrow={narrow} selectedId={selectedId} renderSidebar={renderSidebar} chatArea={chatArea} />

      <GlobalOverlays
        chatList={chatList}
        toast={toast}
        qrConfirmToken={deep.qrConfirmToken}
        confirmQr={() => void deep.confirmQr()}
        cancelQr={deep.cancelQr}
        addlistSlug={deep.addlistSlug}
        closeAddlist={deep.closeAddlist}
        onAddlistJoined={deep.onAddlistJoined}
      />
    </div>
  )
}

function ThemedApp() {
  const { authed, login, logout } = useAuthGate()
  const toggleMode = useThemeToggle()

  // Тема управляется атрибутом data-theme на <html> (useThemeToggle) — MUI
  // ThemeProvider не нужен.
  return authed === null ? null : authed ? (
    <Shell onToggleMode={toggleMode} onLogout={logout} />
  ) : (
    <AuthFlow onComplete={login} onToggleMode={toggleMode} />
  )
}

export default function App() {
  const managers = useManagers()
  const backendOk = useConnectionStore((s) => s.backendOk)
  // «Без анимаций» (меню «Ещё»): framer-анимации выключаются глобально.
  const reduceMotion = useSettingsStore((st) => st.reduceMotion)
  useEffect(() => {
    void pingBackend(managers)
  }, [managers])
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', reduceMotion)
  }, [reduceMotion])

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>
      <ThemedApp />
      <div
        className={s.apiBadge}
        style={{ background: backendOk == null ? '#888' : backendOk ? '#1a7f37' : '#b3261e' }}
      >
        api: {backendOk == null ? '…' : backendOk ? 'ok' : 'down'}
      </div>
    </MotionConfig>
  )
}
