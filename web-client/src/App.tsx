import { useEffect, useLayoutEffect } from 'react'
import { useManagers } from './core/hooks/useManagers'
import { useConnectionStore, pingBackend } from './stores/connectionStore'
import { MotionConfig } from 'framer-motion'
import { useSettingsStore } from './settings'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import PopupHost from './components/PopupHost'
import ChatBackground from './components/ChatBackgroundLazy'
import SvgDefs from './components/SvgDefs'
import GlobalOverlays from './components/shell/GlobalOverlays'
import ShellLayout from './components/shell/ShellLayout'
import AuthFlow from './components/auth/AuthFlow'
import { useT } from './i18n'
import classNames from './shared/lib/classNames'
import { installColumnWidthsUpdater } from './core/dom/updateColumnWidths'
// Сущность чата из модели данных; компонент ниже называется так же (как в tweb),
// поэтому тип импортируется под алиасом.
import type { Chat as ChatEntity } from './data'
import { gradientFor } from './core/dialogToChat'
import { usePipStore } from './core/pip'
import { useAppBootstrap } from './core/hooks/useAppBootstrap'
import { useUrlSync } from './core/hooks/useUrlSync'
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
import { startVersionCheck } from './core/version/versionCheck'
import { useUpdateStore } from './stores/updateStore'
import s from './App.module.scss'
import useMediaQuery from './shared/lib/useMediaQuery'

export type ToggleMode = (coords?: { x: number; y: number }) => void

function Shell({ onToggleMode, onLogout }: { onToggleMode: ToggleMode; onLogout: () => void }) {
  const t = useT()

  // Инфраструктура Shell (эффекты без общего стейта).
  // Ширины колонок (порт tweb updateColumnWidths): JS пишет --chat-width /
  // --left-column-width / --page-chats-padding и класс body.right-column-floats,
  // из которых портированные партиалы раскладывают чат и ленту.
  useLayoutEffect(() => { installColumnWidthsUpdater() }, [])
  useAppBootstrap()
  useShellEnterAnimation()
  useAutoLock()
  useAppHotkeys()
  const { toast, showToast } = useGlobalToast()

  // Навигация (navigationStore) + URL-хэш ↔ чат + deep-links + список чатов.
  const nav = useChatNavigation()
  const { selectedId, openThread, draftPeer } = nav
  useUrlSync()
  const deep = useDeepLinks(showToast)
  const chatList = useChatList()

  // Responsive: below 900px columns overlap fullscreen (tweb handheld). PiP-окно
  // узкое — форсируем мобильный layout (useMediaQuery слушает основное окно).
  const pipActive = usePipStore((st) => st.active)
  const narrow = useMediaQuery('(max-width:900px)') || pipActive
  const backToList = narrow ? () => nav.setSelectedId(null) : undefined

  // Черновик-чат (id "draft:<peerId>"), когда реального диалога ещё нет.
  const draftChat: ChatEntity | null =
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
      initialQuery={deep.deepDomain}
      onToggleMode={onToggleMode}
      onLogout={onLogout}
      fullWidth={fullWidth}
    />
  )

  // Чат треда: диалог из списка, а для комментариев (discussion-группа, где мы
  // можем не состоять) — синтетический Chat.
  const threadChat: ChatEntity | null = openThread
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

  const { shellThemeVariant } = useShellTheme({ selected, openThread, threadChat })

  // Ключ вкладки чата: его смена ремаунтит колонку — как в tweb, где на переход
  // между чатами из списка предыдущий `.chat` УДАЛЯЕТСЯ из DOM (см. ниже).
  const tabKey = openThread && threadChat
    ? `thread-${openThread.chatId}-${openThread.thread.rootMsgId}`
    : selected
      ? `chat-${selected.id}`
      : 'empty'

  const chatBody =
    openThread && threadChat ? (
      <Chat
        key={tabKey}
        chat={threadChat}
        thread={openThread.thread}
        onBack={backToList}
      />
    ) : selected ? (
      <Chat key={tabKey} chat={selected} onBack={backToList} />
    ) : (
      <div className={s.empty}>
        <div className={s.emptyPill}>{t('Select a chat to start messaging')}</div>
      </div>
    )

  // #column-center — как в tweb (живой DOM §1): у него свой --page-chats-padding,
  // от него считаются инсеты .bubbles и маска фейдов ленты. Внутри —
  // .chats-container.tabs-container с колонкой чата (tweb §1).
  const chatArea = (
    <div id="column-center" className={classNames('tabs-tab', 'main-column')}>
      <div className="chats-container tabs-container">{chatBody}</div>
    </div>
  )

  // Каркас страницы — 1:1 из живого tweb (§1):
  //   div.sidebar-left-overlay
  //   div.whole.page-chats#page-chats
  //     div#main-columns.tabs-container[data-animation="navigation"]
  //       #folders-sidebar (портал из Sidebar) + #column-left + #column-center
  //       + #column-right (портал из UserInfoPanel)
  return (
    <>
      {/* Animated 4-point gradient wallpaper + doodle pattern (tweb-style). Обои темы
          активного чата поднимаются сюда, чтобы весь shell был в теме (осознанное
          отклонение от tweb-скоупа для цветов — см. useShellTheme). Цвета темы чата
          при этом остаются локально в колонке (Chat). */}
      <ChatBackground themeColors={shellThemeVariant?.gradient} />

      <div className="sidebar-left-overlay" />
      <div id="page-chats" className="whole page-chats">
        <div id="main-columns" className="tabs-container" data-animation="navigation">
          <ShellLayout narrow={narrow} selectedId={selectedId} renderSidebar={renderSidebar} chatArea={chatArea} />
        </div>
      </div>

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
    </>
  )
}

function ThemedApp() {
  const { authed, login, logout } = useAuthGate()
  const toggleMode = useThemeToggle()

  // Тема управляется атрибутом data-theme на <html> (useThemeToggle) — MUI
  // ThemeProvider не нужен.
  //
  // Спрайт `#svg-defs` — общий для мессенджера и экрана входа (там из него
  // берётся `#logo`), поэтому монтируется до ветвления, как в tweb index.html.
  return (
    <>
      <SvgDefs />
      {authed ? (
        <Shell onToggleMode={toggleMode} onLogout={logout} />
      ) : (
        <AuthFlow onComplete={login} onToggleMode={toggleMode} />
      )}
    </>
  )
}

export default function App() {
  const managers = useManagers()
  const backendOk = useConnectionStore((s) => s.backendOk)
  // «Без анимаций» (меню «Ещё»): framer-анимации выключаются глобально.
  const reduceMotion = useSettingsStore((st) => st.reduceMotion)
  // Доступно ли обновление приложения (новая сборка задеплоена — см. versionCheck).
  const updateAvailable = useUpdateStore((st) => st.available)
  useEffect(() => {
    void pingBackend(managers)
  }, [managers])
  // Опрос версии раз в 30 мин: при расхождении public/version с вкомпиленной строкой
  // показываем кнопку «Обновить приложение» вместо залипания на устаревшем бандле.
  useEffect(() => {
    startVersionCheck()
  }, [])
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', reduceMotion)
  }, [reduceMotion])

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>
      <ThemedApp />
      {/* Стек попапов (popupStore) — единая точка рендера всех императивно
          открываемых попапов чата (порт tweb PopupManager). */}
      <PopupHost />
      {/* Ненавязчивая пилюля «доступна новая сборка» (инлайн-стиль, как apiBadge —
          App.module.scss тут не трогаем). Клик — перезагрузка на свежий бандл. */}
      {updateAvailable && (
        <button
          type="button"
          onClick={() => location.reload()}
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5000,
            padding: '9px 18px',
            borderRadius: 20,
            background: 'var(--primary-color)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          }}
        >
          Обновить приложение
        </button>
      )}
      <div
        className={s.apiBadge}
        style={{ background: backendOk == null ? '#888' : backendOk ? '#1a7f37' : '#b3261e' }}
      >
        api: {backendOk == null ? '…' : backendOk ? 'ok' : 'down'}
      </div>
    </MotionConfig>
  )
}
