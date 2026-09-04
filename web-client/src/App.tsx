import { useEffect, useLayoutEffect, useRef } from 'react'
import { useManagers } from './core/hooks/useManagers'
import { useConnectionStore, pingBackend } from './stores/connectionStore'
import { useSettingsStore } from './settings'
import animationIntersector from './components/animationIntersector'
import liteMode, { type LiteModeKey } from './helpers/liteMode'
import { dispatchHeavyAnimationEvent } from './core/dom/heavyAnimation'
import pause from './helpers/schedulers/pause'
import Sidebar from './components/Sidebar'
import Chat from './components/Chat'
import ChatsContainer from './components/chat/ChatsContainer'
import type { ChatInstanceDesc } from './stores/chatStackStore'
import PopupHost from './components/PopupHost'
import ChatBackground from './components/ChatBackground'
import SvgDefs from './components/SvgDefs'
import GlobalOverlays from './components/shell/GlobalOverlays'
import { mountAuthFlow } from './components/auth/mountAuthFlow.solid'
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
import { startChatHistory, backChatLevel } from './core/navigation/chatHistory'
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
  const { selectedId, draftPeer } = nav
  // tweb appImManager.selectTab: класс держится, пока активна вкладка чатлиста,
  // то есть пока чат/тред/черновик НЕ выбран (см. useLeftColumnShown).
  useLeftColumnShown(selectedId !== null)
  useUrlSync()
  // стор → хэш: подписка живёт рядом с useUrlSync (хэш → стор) — вместе они
  // и есть та самая двунаправленная синхронизация, разнесённая по направлениям
  // на разные модули (см. докблок `core/navigation/chatHistory.ts`).
  useEffect(() => startChatHistory(), [])
  const deep = useDeepLinks(showToast)
  const chatList = useChatList()

  // Responsive: below 900px columns overlap fullscreen (tweb handheld). PiP-окно
  // узкое — форсируем мобильный layout (useMediaQuery слушает основное окно).
  const pipActive = usePipStore((st) => st.active)
  const narrow = useMediaQuery('(max-width:900px)') || pipActive
  // Стрелка «назад» в шапке (узкий экран) закрывает уровень ЗАПИСЬЮ — как и
  // крестик в шапке треда, и Esc (`core/navigation/chatHistory.ts::
  // backChatLevel`). НАХОДКА РЕВЬЮ (Critical): раньше здесь стоял прямой
  // `nav.setSelectedId(null)` в обход контроллера — сохранение смонтированного
  // инстанса на хендхелдах (открыть тот же чат снова без ремаунта) казалось
  // причиной так делать, но у оригинала эта же ветка (`mediaSizes.
  // isFloatingLeftSidebar`, appImManager.ts:2771-2773) живёт ВНУТРИ `setPeer`,
  // то есть срабатывает уже ПОСЛЕ снятия записи контроллером — и портирована
  // именно туда, в `closeChatLevel`, а не сюда. Прямой вызов оставлял запись
  // `im` висеть на стеке контроллера при видимом списке чатов: хэш (тогда
  // читавшийся только из стека) не чистился, F5 открывал чат вместо списка,
  // Back/Esc били мимо.
  const backToList = narrow ? () => backChatLevel() : undefined

  // Переключение список ↔ чат на узком экране — 1:1 tweb `appImManager.selectTab`
  // (appImManager.ts:2588-2645). Само движение колонок там делает ОДИН класс на
  // body — `is-left-column-shown` (appImManager.ts:2593; у нас его ставит
  // useLeftColumnShown), под который уже написан портированный CSS: #column-center
  // уезжает на `translate3d(100vw, 0, 0) opacity:0` (styles/tweb/_chat.scss:452-456,
  // tweb _chat.scss:452-462), #column-left — на `translate3d(-25vw, 0, 0) opacity:0`
  // (styles/tweb/_leftSidebar.scss:245-248), а сам переход задан на `.main-column`
  // (`transform/opacity var(--tabs-transition)`, tweb pages/_chats.scss:52-54).
  //
  // JS-параллакса (`slideNavigation`) здесь НЕТ и в оригинале: `#main-columns`
  // хоть и размечен `tabs-container[data-animation="navigation"]`
  // (tweb index.html:88), TransitionSlider к нему не подключается — единственные
  // 'navigation'-слайдеры это сайдбарный slider.ts:43, horizontalMenu.ts:153,
  // popups/premium.ts:209 и `.chats-container` (appImManager.ts:308, переход
  // между чатами внутри колонки).
  //
  // От JS остаётся ровно то, что делает selectTab (appImManager.ts:2606-2614):
  // на время перехода объявить ТЯЖЁЛУЮ анимацию, чтобы animationIntersector
  // погасил стикеры/видео и слайд не дёргался.
  const chatOpen = selectedId !== null
  const prevChatOpenRef = useRef<boolean | null>(null)
  useLayoutEffect(() => {
    const prev = prevChatOpenRef.current
    prevChatOpenRef.current = chatOpen
    // первый рендер переходом не считается (tweb: prevTabId === undefined)
    if (prev === null || prev === chatOpen || !narrow) return
    if (!liteMode.isAvailable('animations')) return
    // tweb: `(mediaSizes.isMobile ? 250 : 200) + 100` — «cause transition time
    // could be > 250ms» (appImManager.ts:2606)
    const transitionTime = 250 + 100
    void dispatchHeavyAnimationEvent(pause(transitionTime), transitionTime)
  }, [chatOpen, narrow])

  // Черновик-чат (id "draft:<peerId>"), когда реального диалога ещё нет.
  const draftChat: ChatEntity | null =
    draftPeer && selectedId === `draft:${draftPeer.id}`
      ? {
          id: `draft:${draftPeer.id}`,
          name: draftPeer.title,
          avatar: gradientFor(draftPeer.id),
          avatarText: draftPeer.title.charAt(0).toUpperCase() || '?',
          // id медиа аватарки приходит готовым (`photo.photo_id`) — прежний
          // `avatarUrl` был строкой `/media/N/content`, собранной из этого же
          // числа.
          photoId: draftPeer.photoId,
          preview: '',
          type: 'private',
          username: draftPeer.username ?? undefined,
        }
      : null

  const renderSidebar = (fullWidth = false) => (
    <Sidebar
      initialQuery={deep.deepDomain}
      onToggleMode={onToggleMode}
      onLogout={onLogout}
      fullWidth={fullWidth}
    />
  )

  // Резолв дескриптора стека в сущность чата: реальный диалог из списка, иначе
  // черновик (тот же peerId, что открытого черновика), иначе синтетический Chat
  // для треда/комментариев (discussion-группа, где мы можем не состоять) —
  // та же логика, что раньше жила в `threadChat`/`selected`, теперь по `desc`.
  const resolveChat = (desc: ChatInstanceDesc): ChatEntity =>
    chatList.find((c) => c.id === String(desc.peerId)) ??
    // Ключ черновика — `draft:<peerId>`: сравниваем с ключом самого пира, а не
    // с отдельным полем рядом (его больше нет — это было одно число дважды).
    (draftChat && draftPeer && draftPeer.id === desc.peerId ? draftChat : null) ?? {
      id: String(desc.peerId),
      name: desc.thread?.title ?? '',
      avatar: gradientFor(desc.peerId),
      avatarText: '#',
      preview: '',
      type: 'group',
    }

  // #column-center — как в tweb (живой DOM §1): у него свой --page-chats-padding,
  // от него считаются инсеты .bubbles и маска фейдов ленты. Внутри —
  // ChatsContainer рисует .chats-container.tabs-container со стеком инстансов
  // колонки чата (tweb §1, порт appImManager.chats[]).
  const chatArea = (
    <div id="column-center" className={classNames('tabs-tab', 'main-column')}>
      <ChatsContainer
        renderInstance={(desc) => (
          <Chat chat={resolveChat(desc)} thread={desc.thread} onBack={backToList} />
        )}
      />
    </div>
  )

  // Каркас страницы — 1:1 из живого tweb (§1):
  //   div.sidebar-left-overlay
  //   div.whole.page-chats#page-chats
  //     div#main-columns.tabs-container[data-animation="navigation"]
  //       #folders-sidebar (портал из Sidebar) + #column-left + #column-center
  //       + #column-right (портал из UserInfoPanel)
  //
  // Обе колонки всегда в DOM и всегда `display: flex` — на узком экране это
  // делает `@include respond-to(handhelds) { .main-column { display: flex
  // !important } }` (tweb pages/_chats.scss:20-24), и именно поэтому они могут
  // разъезжаться переходом, а не появляться/исчезать. Кто из них видим, решает
  // body.is-left-column-shown (см. эффект выше) — своего JS-слайда тут нет.
  return (
    <>
      <div className="sidebar-left-overlay" />
      <div id="page-chats" className="whole page-chats">
        <div id="main-columns" className="tabs-container" data-animation="navigation">
          {renderSidebar(narrow)}
          {chatArea}
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
  const managers = useManagers()
  const toggleMode = useThemeToggle()
  const { shellThemeVariant } = useShellTheme()

  // Точка монтирования экрана входа — Solid, порт tweb `mountAuthFlow`
  // (устройство — components/auth/mountAuthFlow.solid.tsx). DOM auth-хоста
  // висит прямо на body, не в этом React-дереве (см. докблок моста), поэтому
  // здесь только вызов/снятие, а не JSX-ветка: React не должен решать, ЧТО
  // рисовать на экране входа, только КОГДА он существует.
  //
  // `login` (onComplete) — новая функция на каждый рендер `useAuthGate`
  // (не мемоизирована), но остров ловит её ОДНАЖДЫ, на монтирование: она не
  // из зависимостей эффекта намеренно, ровно как `props` у `SolidIsland` —
  // повторный маунт при каждом ре-рендере ThemedApp разрушил бы состояние
  // экрана входа. Это безопасно: `login()` лишь чистит localStorage и зовёт
  // `setAuthed(true)`, а сам `setAuthed` — стабильный сеттер `useState`,
  // поэтому любой снимок `login` ведёт себя одинаково независимо от рендера,
  // на котором он был захвачен.
  useLayoutEffect(() => {
    if (authed) return
    return mountAuthFlow({ managers, onComplete: login })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, managers])

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
      {authed && <Shell onToggleMode={toggleMode} onLogout={logout} />}
    </>
  )
}

export default function App() {
  const managers = useManagers()
  const backendOk = useConnectionStore((s) => s.backendOk)
  // «Без анимаций» (меню «Ещё») — ниже раздаётся классами на body, как в tweb.
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

  // Гасить анимации по настройке отдельным движком не нужно: это делает
  // body.animation-level-0 из эффекта выше (tweb appImManager.ts:2209-2211) —
  // под ним у портированных партиалов стоит `transition: none`.
  return (
    <>
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
    </>
  )
}
