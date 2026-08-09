import { useEffect, useLayoutEffect, useRef } from 'react'
import { useManagers } from './core/hooks/useManagers'
import { useConnectionStore, pingBackend } from './stores/connectionStore'
import { MotionConfig } from 'framer-motion'
import { useSettingsStore } from './settings'
import animationIntersector from './components/animationIntersector'
import liteMode, { type LiteModeKey } from './helpers/liteMode'
import { runNavigationTransition } from './core/dom/navigationTransition'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import PopupHost from './components/PopupHost'
import ChatBackground from './components/ChatBackground'
import SvgDefs from './components/SvgDefs'
import GlobalOverlays from './components/shell/GlobalOverlays'
import ShellLayout from './components/shell/ShellLayout'
import AuthFlow from './components/auth/AuthFlow'
import classNames from './shared/lib/classNames'
import { installColumnWidthsUpdater } from './core/dom/updateColumnWidths'
import { doubleRaf } from './core/accountTransition'
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
import { useLeftColumnShown } from './core/hooks/useLeftColumnShown'
import { useThemeToggle } from './core/hooks/useThemeToggle'
import { startVersionCheck } from './core/version/versionCheck'
import { useUpdateStore } from './stores/updateStore'
import s from './App.module.scss'
import useMediaQuery from './shared/lib/useMediaQuery'

export type ToggleMode = (coords?: { x: number; y: number }) => void

function Shell({ onToggleMode, onLogout }: { onToggleMode: ToggleMode; onLogout: () => void }) {
  // Инфраструктура Shell (эффекты без общего стейта).
  // Ширины колонок (порт tweb updateColumnWidths): JS пишет --chat-width /
  // --left-column-width / --page-chats-padding и класс body.right-column-floats,
  // из которых портированные партиалы раскладывают чат и ленту.
  useLayoutEffect(() => { installColumnWidthsUpdater() }, [])
  // has-auth-pages снимается кадром позже (doubleRaf, bootstrapIm.ts:60-61) —
  // иначе transition .main-column включится сразу и колонка «въедет» из
  // офскрина в первом кадре; на логин-старте AuthFlow уже снял класс сам.
  useLayoutEffect(() => {
    void doubleRaf().then(() => document.body.classList.remove('has-auth-pages'))
  }, [])
  useAppBootstrap()
  useShellEnterAnimation()
  useAutoLock()
  useAppHotkeys()
  const { toast, showToast } = useGlobalToast()

  // Навигация (navigationStore) + URL-хэш ↔ чат + deep-links + список чатов.
  const nav = useChatNavigation()
  const { selectedId, openThread, draftPeer } = nav
  // tweb appImManager.selectTab: класс держится, пока активна вкладка чатлиста,
  // то есть пока чат/тред/черновик НЕ выбран (см. useLeftColumnShown).
  useLeftColumnShown(selectedId !== null)
  useUrlSync()
  const deep = useDeepLinks(showToast)
  const chatList = useChatList()

  // Responsive: below 900px columns overlap fullscreen (tweb handheld). PiP-окно
  // узкое — форсируем мобильный layout (useMediaQuery слушает основное окно).
  const pipActive = usePipStore((st) => st.active)
  const narrow = useMediaQuery('(max-width:900px)') || pipActive
  const backToList = narrow ? () => nav.setSelectedId(null) : undefined

  // Переключение вкладок #main-columns (список ↔ чат) — как tweb chatsSelectTab
  // (appImManager.ts:2247-2254): на время перехода объявляется ТЯЖЁЛАЯ анимация,
  // и animationIntersector глушит стикеры/видео, чтобы слайд не дёргался;
  // контейнеру ставятся `.animating`/`.backwards`, под которые уже портирован
  // CSS (styles/tweb/_slider.scss:226-241).
  //
  // Параллакс (`slideNavigation`) здесь пока НЕ запускается: на узком экране
  // колонки двигает framer-motion в components/shell/ShellLayout (свои inline
  // transform'ы — подрались бы), на широком колонки видны обе и не переключаются
  // вовсе. Как только ShellLayout переедет на CSS (Task 7.5), сюда достаточно
  // передать `to`/`from` — оба узла `.tabs-tab` из #main-columns.
  const mainColumnsRef = useRef<HTMLDivElement>(null)
  const chatOpen = selectedId !== null
  const prevChatOpenRef = useRef<boolean | null>(null)
  useLayoutEffect(() => {
    const container = mainColumnsRef.current
    const prev = prevChatOpenRef.current
    prevChatOpenRef.current = chatOpen
    // первый рендер переходом не считается (tweb: prevId === -1 && !animateFirst)
    if (!container || prev === null || prev === chatOpen || !narrow) return
    if (!liteMode.isAvailable('animations')) return
    runNavigationTransition({ container, toRight: chatOpen })
  }, [chatOpen, narrow])

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
      <div className="chat tabs-tab active" />
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
      <div className="sidebar-left-overlay" />
      <div id="page-chats" className="whole page-chats">
        <div ref={mainColumnsRef} id="main-columns" className="tabs-container" data-animation="navigation">
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
  const { shellThemeVariant } = useShellTheme()

  // Тема управляется атрибутом data-theme на <html> (useThemeToggle) — MUI
  // ThemeProvider не нужен.
  //
  // Спрайт `#svg-defs` — общий для мессенджера и экрана входа (там из него
  // берётся `#logo`), поэтому монтируется до ветвления, как в tweb index.html.
  return (
    <>
      <SvgDefs />
      {/* Анимированный 4-точечный градиент + узор. Как в tweb, слой монтируется
          ДО ветвления по authState (index.ts:544 `appChatBackground.attach()`
          стоит раньше разбора authState на :549) — поэтому обои видны и за
          карточкой входа: её хост прозрачен, непрозрачна только сама карточка.
          Обои темы активного чата поднимаются сюда, чтобы весь shell был в теме
          (осознанное отклонение от tweb-скоупа для цветов — см. useShellTheme);
          цвета темы чата при этом остаются локально в колонке (Chat). */}
      <ChatBackground themeColors={shellThemeVariant?.gradient} />
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
  // Зацикливать анимированные стикеры (tweb appSettings.stickers.loop)
  const loopStickers = useSettingsStore((st) => st.loopStickers)
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
  // Гейт CSS-анимаций. 1:1 tweb appImManager.ts:2209-2211: классы на body, под
  // которые уже написаны 233 портированных правила `@include animation-level(2)`.
  // animation-level-2 стоит статикой в index.html:28 (чтобы не мигало до гидрации),
  // здесь он снимается/возвращается по настройке «Без анимаций».
  useLayoutEffect(() => {
    document.body.classList.toggle('animation-level-0', reduceMotion)
    document.body.classList.toggle('animation-level-1', false)
    document.body.classList.toggle('animation-level-2', !reduceMotion)
  }, [reduceMotion])

  // Настройки → уже живущие анимации (tweb appImManager.setSettings:2223-2228):
  // смена «зацикливать стикеры»/«без анимаций» переписывает loop/autoplay у
  // зарегистрированных плееров и перепроверяет, кому играть.
  useEffect(() => {
    const changedLoop = animationIntersector.setLoop(loopStickers)
    const keys: LiteModeKey[] = ['stickers_chat', 'stickers_panel']
    const changedAutoplay = keys.filter((key) => animationIntersector.setAutoplay(liteMode.isAvailable(key), key)).length > 0
    if (changedLoop || changedAutoplay) {
      animationIntersector.checkAnimations2(false)
    }
  }, [loopStickers, reduceMotion])

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
