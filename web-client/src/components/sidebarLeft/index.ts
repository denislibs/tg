/**
 * Порт tweb/src/components/sidebarLeft/index.ts (812502980) — `AppSidebarLeft`,
 * класс левой колонки: колоночный слайдер вкладок на `#column-left`
 * (`extends SidebarSlider`, `navigationType: 'left'`, :118, :147-152). Вкладка
 * №0 — `.item-main` колонки (список чатов), остальные экраны колонки — вкладки
 * этого слайдера.
 *
 * Как открыть вкладку колонки — ровно как у tweb:
 *
 *     appSidebarLeft.createTab(AppXxxTab).open(payload)
 *
 * изнутри вкладки — `tab.slider.createTab(…)`. Из React — тем же текстом в
 * обработчике события: `import appSidebarLeft from '@components/sidebarLeft'`
 * — живая привязка (п. 1 ниже).
 *
 * Перенесено (этой задачей, 2-1 волны 7): конструктор, `construct` без кнопок
 * шапки статуса и замка (поле поиска `:158-160`, бургер `:165-172`, `:244`,
 * морф `:431-442`, клик по `.sidebar-left-overlay` `:447-450`,
 * `initSidebarResize` `:451`, `can-menu-have-z-index` `:190-194`),
 * `initSearch` (:1137, тело — владелец `globalSearch.ts`), `initNavigation` (:474-489),
 * `isCollapsed`/`hasFoldersSidebar`/`onCollapsedChange` (:491-516),
 * `hasSomethingOpenInside`/`closeEverythingInside(Naturally)` (:518-545),
 * `onSomethingOpenInsideChange` (:547-634) — ЕДИНСТВЕННЫЙ писатель
 * `has-open-tabs` и `setOpenTabsLeftSidebar`, `initSidebarResize` (:651-671),
 * бургер `createToolsMenu` (:673-905), `createMoreSubmenu` (:916-1064),
 * `createNewChatsSubmenu` (:1130-1134), `closeSearch` (:1722), `createTab`/
 * `addTab` (:1730-1753), `closeTabsBefore`/`openArchiveTab` (:1755-1764),
 * `addAccount` (:1766), синглтон (:1798), `getVersionLink` (:1802).
 *
 * Не перенесено — у каждого пункта задача или номер «Отложено»:
 *  • тело `initSearch` (:1137-1691) — класс `GlobalSearch`
 *    (`sidebarLeft/globalSearch.ts`, порт по старой базе), его перенос в метод и
 *    дельта до HEAD, `showCtrlFTip` (:636-650, вызов в `onCollapsedChange`
 *    :511-513), `watchChannelsTabVisibility` (:1692) — задача 2-3. Ctrl+F
 *    (:458-461) — наш `core/hotkeys.ts` → событие `tg-focus-search` владельцу
 *    (его расхождение 9);
 *  • `#new-menu` (`createNewChatsMenuButton`/`createNewChatsMenuOptions`,
 *    :198-200, :1065-1128) — задача 2-4, место в `construct` помечено; подменю
 *    «Создать» бургера пока собирает свои три пункта (`createNewChatsSubmenu`);
 *  • архив-вкладка `AppArchivedTab` (`openArchiveTab` :1760-1764) — задача 1-5:
 *    до неё строка «Архив» списка закрывает открытое и больше ничего, пункт
 *    бургера скрыт; форум-таб (`appDialogsManager.forumTab`, :519, :524, :541,
 *    :555-560) — задача 1-6;
 *  • «Мои истории» (`AppMyStoriesTab`, :715-722) — О-82, пункт скрыт;
 *  • статус-эмодзи и замок (`toggleRightButtons`, :258-361) — задача 2-8;
 *  • вертикальная колонка папок (`renderFoldersSidebarContent`, :177-184) —
 *    задача 2-7; бейдж уведомлений других аккаунтов (:186-188) — О-81;
 *  • бейдж архива по `folder_unread` (:202-235) — расхождение 4 бургера ниже;
 *  • кнопка «Обновить» (`updateBtn`, :202-216, :367-384) — О-100;
 *  • кнопка поиска свёрнутой колонки `sidebar-header-search-trigger`
 *    (:392-421, сигнал `useHasOpenLeftTabs`) — О-101;
 *  • `getTopPeers('correspondents')` (:363) — прогрев выдачи поиска, задача 2-3;
 *  • Ctrl+0 (:463-470) — наш `core/hotkeys.ts`, задача 5-1;
 *  • `onSwipeTick: appImManager.adjustChatPatternBackground` (:670) — Э4-5;
 *  • `appDialogsManager.onChatListNarrowChange()`/`resizeStoriesList()` в
 *    `onCollapsedChange` (:507, :515) — задачи 1-8 и 2-6;
 *  • событие `resizing_left_sidebar` (:571-576) — его читатель, ряд историй, —
 *    задача 2-6 (у нас пересчёт ширин зовётся напрямую, шапка
 *    `core/dom/updateColumnWidths.ts`).
 *
 * Расхождения с оригиналом (временные — с номером задачи, которая снимает):
 *  1. ВРЕМЕННО до Э4-1 (поправка 13 плана волны 7). Синглтон tweb создаётся при
 *     импорте (:1798) и берёт узел из `index.html`. У нас `#column-left`
 *     рисует React (`components/Sidebar.tsx`), поэтому экземпляр создаёт
 *     `createAppSidebarLeft()` из layout-эффекта колонки ПОСЛЕ монтирования
 *     узла, а `destroy()` снимает всё, что навесил `construct` (колонка умирает
 *     на логауте, StrictMode гоняет эффект дважды на одном узле). Узлы колонки
 *     и `.sidebar-left-overlay` — статичная разметка шелла (`App.tsx`, tweb
 *     `index.html:88-107`); в тестах колонки оверлея может не быть — подписка
 *     на клик через `?.`.
 *  2. `construct(managers, dialogsManager)`: владелец списка чатов — экземпляр
 *     `AppDialogsManager` колонки, а не синглтон (расхождение 1 его шапки,
 *     `lib/appDialogsManager.ts`), и `construct` его получает от `start()`,
 *     который его зовёт (tweb :983).
 *  3. `switchTheme` — ВРЕМЕННО до Э4-5: ночной режим бургера
 *     (`themeController.switchTheme`, :919-928) — React-хук шелла
 *     `useThemeToggle`, его отдаёт `App.tsx`. «Избранное» —
 *     `appImManager.setPeer({peerId: myId})` (:707-713), ВРЕМЕННО до Э4-3 —
 *     открытие через `navigationStore`.
 *  4. `createTab` при свёрнутой колонке не открывает `AppSettingsTab`/
 *     `AppEditFolderTab`/`AppChatFoldersTab` попапом `showSettingsSliderPopup`
 *     (:1735-1739) — О-27 плана 2D: попапа-слайдера настроек нет. Вкладка
 *     открывается в колонке, а колонка всплывает (`has-open-tabs`).
 *  5. `is-collapsed` колонки пишет, как у tweb, не класс, а эффект
 *     `setSidebarLeftWidth` (`src/index.ts:205-235`) — у нас шелл `App.tsx`,
 *     ВРЕМЕННО до Э4-1; класс читает его (`isCollapsed`), а ручка ресайза пушит
 *     сырой драг в сигнал `useIsSidebarCollapsed` (:660-666).
 *  6. `globalSearch` — экземпляр владельца поиска (`sidebarLeft/globalSearch.ts`):
 *     у tweb это тело `initSearch` самого класса (:1137-1691), задача 2-3
 *     переносит его методом. Сеттер `isSearchActive` у tweb приватный (:137),
 *     у нас его зовёт владелец через `onSearchActive` (:1600-1601, :1614-1615).
 *
 * Расхождения бургера (`createToolsMenu`/`createMoreSubmenu`, задача 2-2):
 *  1. Отступление В7-4 — мультиаккаунт в нашей модели «одна сессия на
 *     браузер» (`core/auth/accounts.ts:1-5`, модель tweb — О-1 плана 2D):
 *     список аккаунтов — реестр воркера `managers.auth.listAccounts()`, а не
 *     `AccountController`; другой аккаунт приходит карточкой из реестра (имя
 *     и `photo_id`), а не из менеджеров его вкладки; переключение — команда
 *     воркеру + перезагрузка (`commandThenReload`), Ctrl/Cmd «в новой вкладке»
 *     нет (`changeAccount(n, newTab)`), `appImManager.goOffline()` не зовётся —
 *     соединение снимает сам переход. Лимит один — `MAX_ACCOUNTS`:
 *     премиум-ступени `MAX_ACCOUNTS_FREE` и попапа `showAccountsLimitPopup`
 *     нет (премиум-лимитов аккаунтов на бэкенде нет).
 *  2. Боты меню вложений (`getAttachMenuBots`, `show_in_side_menu`, :777-808)
 *     — нет на бэкенде: О-80 волны 7.
 *  3. Бейдж непрочитанного других аккаунтов (`notification_count_update`,
 *     `getNotificationsCountForAllAccounts`, :175-188, :862-870) — источника
 *     нет: воркер не считает непрочитанное неактивных аккаунтов. Бейдж в
 *     разметке есть и пуст (`is-badge-empty`) — О-81 волны 7.
 *  4. «Архив» (:680-688) и бейдж `archivedCount` (:202-235) — пункт скрыт до
 *     `AppArchivedTab` (задача 1-5, см. «Не перенесено»); verify оригинала у
 *     нас неполон и без того — О-83 волны 7.
 *  5. «Новая конференция» (`ConferenceCall.New`, :1093-1101) и verify
 *     `IS_CONFERENCE_CALL_SUPPORTED` у «Звонков» — О-1 волны 7.
 *  6. «Switch to A version» (`ChatList.Menu.SwitchTo.A`, :985-997) — verify
 *     `App.isMainDomain` у нас всегда ложь (своего домена версии A нет),
 *     пункта нет; поэтому `separator` у «Telegram Features» — всегда.
 *  7. «Telegram Features» — `appImManager.openUrl(url)` (:1002) → новая
 *     вкладка: обработчика внутренних ссылок нет, ВРЕМЕННО до Э5-4.
 *  8. PiP — наш вынос клиента `enterAppPip` (`core/pip.ts`) вместо
 *     `openClientPip`; «выйти» закрывает окно выноса.
 *  9. Клавиатурная навигация меню (фокус в подменю) — О-84 волны 7
 *     (`components/floatingButtonMenu.ts`).
 */
import { createEffect, createRoot } from 'solid-js'
import SidebarSlider, { SliderSuperTab } from '@components/slider'
import type { SliderSuperTabConstructable } from '@components/sliderTab'
import ButtonMenu, { type ButtonMenuItemOptions, type ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import createSubmenuTrigger, { type CreateSubmenuArgs } from '@components/createSubmenuTrigger'
import {
  AppCallsTab,
  AppContactsTab,
  AppNewChannelTab,
  AppPowerSavingTab,
  AppSettingsTab,
} from '@components/solidJsTabs/tabs'
import createNewGroupTab from '@components/sidebarLeft/tabs/createNewGroupTab'
import InputSearch from '@components/inputSearch'
import GlobalSearch from '@components/sidebarLeft/globalSearch'
import type { AppDialogsManager } from '@lib/appDialogsManager'
import { openSearchUrl } from '@core/hooks/openSearchUrl'
import { useNavigationStore } from '@stores/navigationStore'
import type { User, UserReal } from '@core/peers/peer'
import { MAX_ACCOUNTS, type PublicAccount } from '@core/auth/accounts'
import {
  ANIMATE_AUTH_KEY,
  PREV_ACCOUNT_KEY,
  commandThenReload,
  playChatlistExit,
  playMainScreenExit,
} from '@core/accountTransition'
import { getCurrentPreset } from '@core/theme/themeController'
import { usePwaStore } from '@core/pwa'
import { enterAppPip, usePipStore } from '@core/pip'
import mediaSizes from '@core/dom/mediaSizes'
import { setOpenTabsLeftSidebar } from '@core/dom/updateColumnWidths'
import installColumnResize from '@core/dom/installColumnResize'
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
import { useChatsStore } from '@stores/chatsStore'
import { useFoldersSidebarShown, useIsLeftSearchActive, useIsSidebarCollapsed } from '@stores/foldersSidebar.solid'
import { useAppSettings } from '@stores/appSettings.solid'
import { useSettingsStore } from '@/settings'
import { PRESET_MODE, resolvePreset } from '@/theme'
import IS_CALL_SUPPORTED from '@environment/callSupport'
import DOCUMENT_PICTURE_IN_PICTURE_SUPPORTED from '@environment/documentPictureInPictureSupport'
import contextMenuController from '@helpers/contextMenuController'
import { CLICK_EVENT_NAME, simulateClickEvent } from '@helpers/dom/clickEvent'
import filterAsync from '@helpers/array/filterAsync'
import createBadge from '@helpers/createBadge'
import liteMode from '@helpers/liteMode'
import type { MenuPositionPadding } from '@helpers/positionMenu'
import pause from '@helpers/schedulers/pause'
import limitSymbols from '@helpers/string/limitSymbols'
import type ListenerSetter from '@helpers/listenerSetter'
import I18n, { i18n } from '@lib/langPack'
import { setBlankToAnchor } from '@lib/richtext/url'
import rootScope from '@lib/rootScope'
import { MOUNT_CLASS_TO } from '@config/debug'
import { APP_TITLE, APP_VERSION_FULL } from '@/config/app'
import type { Managers } from '@/client/bootstrap'

/** Куда ведёт футер подменю «Ещё» — tweb ведёт на свой CHANGELOG.md (:1804). */
const CHANGELOG_URL = 'https://github.com/denislibs/messenger/blob/main/CHANGELOG.md'

export class AppSidebarLeft extends SidebarSlider {
  private chatListContainer!: HTMLElement
  private buttonsContainer!: HTMLElement
  private toolsBtn!: HTMLElement
  private backBtn!: HTMLElement
  public inputSearch!: InputSearch
  /** Расхождение 6 шапки. */
  private globalSearch?: GlobalSearch
  /** Расхождение 3 шапки — ВРЕМЕННО до Э4-5. */
  public switchTheme?: (coords: { x: number, y: number }) => void
  private dialogsManager?: AppDialogsManager

  public get isSearchActive() {
    return useIsLeftSearchActive()[0]()
  }

  /** У tweb приватный (:137); пишет владелец поиска — расхождение 6. */
  public set isSearchActive(value: boolean) {
    useIsLeftSearchActive()[1](value)
  }

  // ВРЕМЕННО до Э4-1 (расхождение 1): то, что снимает `destroy()`.
  private disposers: (() => void)[] = []

  constructor() {
    super({
      sidebarEl: document.getElementById('column-left') as HTMLDivElement,
      navigationType: 'left',
    })
  }

  construct(managers: Managers, dialogsManager: AppDialogsManager) {
    this.managers = managers
    this.dialogsManager = dialogsManager // расхождение 2

    this.chatListContainer = document.getElementById('chatlist-container')!
    this.inputSearch = new InputSearch({ oldStyle: true, placeholder: 'Search' })
    const sidebarHeader = this.sidebarEl.querySelector('.item-main .sidebar-header')!
    sidebarHeader.append(this.inputSearch.container)

    this.backBtn = this.sidebarEl.querySelector('.sidebar-back-button') as HTMLElement
    this.backBtn.setAttribute('aria-label', I18n.format('StarsRating.Back', true))

    this.toolsBtn = this.createToolsMenu()
    // .is-visible is owned by the Solid effect below (see "burger element
    // has two visual states") — don't seed it here.
    this.toolsBtn.classList.add('sidebar-tools-button')
    this.toolsBtn.setAttribute('role', 'button')
    this.toolsBtn.tabIndex = 0
    // :170-172 — бейдж непрочитанного других аккаунтов (расхождение 3 бургера, О-81)
    const totalNotificationsCount = createBadge('span', 20, 'primary')
    totalNotificationsCount.classList.add('sidebar-tools-button-notifications')
    this.toolsBtn.append(totalNotificationsCount)

    // If it has z-index to early, the browser makes it shift a few times before showing it properly in its position (on very large screens)
    // Doesn't solve the blinking, which doesn't seem to appear when the project is built
    const middleware = this.getMiddleware()
    void pause(1000).then(() => {
      if(!middleware()) return // расхождение 1
      this.sidebarEl.classList.add('can-menu-have-z-index')
    })

    this.backBtn.parentElement!.insertBefore(this.toolsBtn, this.backBtn)

    this.buttonsContainer = this.backBtn.parentElement!

    // `this.newBtnMenu = this.createNewChatsMenuButton()` +
    // `sidebarHeader.nextElementSibling.append(this.newBtnMenu)` (:198-200) — задача 2-4

    // `inputSearch.input focus → initSearch` (:226) вешает владелец поиска сам
    // (расхождение 6); он же слушает Ctrl+F (`tg-focus-search`).
    this.globalSearch = new GlobalSearch({
      searchContainer: this.sidebarEl.querySelector('#search-container') as HTMLElement,
      inputSearch: this.inputSearch,
      backBtn: this.backBtn,
      managers,
      onSearchActive: (active) => {
        this.isSearchActive = active
        this.onSomethingOpenInsideChange()
      },
      openUrl: (url) => openSearchUrl(url, managers),
    })

    this.initNavigation()

    // The burger element has two visual states: the three-line menu icon (a
    // click on it opens the burger menu) and the back arrow (a click on it
    // closes the open search). Three classes encode that state — toolsBtn /
    // backBtn `.is-visible` (which click target is active) and the animated
    // icon's `.state-back` (which shape it renders as). They all flow from
    // the same condition, so a single Solid effect owns the truth:
    //
    //   showBack = useFoldersSidebarShown OR useIsLeftSearchActive
    this.disposers.push(createRoot((dispose) => {
      const [foldersSidebarShown] = useFoldersSidebarShown()
      const [isLeftSearchActive] = useIsLeftSearchActive()
      const animatedMenuIcon = this.buttonsContainer.firstElementChild as HTMLElement
      createEffect(() => {
        const showBack = foldersSidebarShown() || isLeftSearchActive()
        this.toolsBtn.classList.toggle('is-visible', !showBack)
        this.backBtn.classList.toggle('is-visible', showBack)
        animatedMenuIcon.classList.toggle('state-back', showBack)
      })
      return dispose
    }))

    const sidebarOverlay = document.querySelector('.sidebar-left-overlay')
    const onOverlayClick = () => {
      this.closeEverythingInside()
    }
    sidebarOverlay?.addEventListener('click', onOverlayClick) // `?.` — расхождение 1
    this.disposers.push(() => sidebarOverlay?.removeEventListener('click', onOverlayClick))

    this.initSidebarResize()
  }

  /**
   * Focus search input by pressing Escape
   */
  public initNavigation() {
    const navigationItem: NavigationItem = {
      type: 'global-search-focus',
      onPop: () => {
        setTimeout(() => {
          if(this.isAnimatingCollapse) return
          this.initSearch().open()
        }, 0)

        return false
      },
      noHistory: true,
    }
    appNavigationController.removeByType('global-search-focus')
    appNavigationController.pushItem(navigationItem)
  }

  public isCollapsed() {
    // In the floating range the bar is always rendered expanded — the
    // is-collapsed class is preserved as the remembered preference for
    // wider viewports, but every consumer should see "not collapsed".
    if(mediaSizes.isLessThanFloatingLeftSidebar) return false
    return this.sidebarEl.classList.contains('is-collapsed')
  }

  public hasFoldersSidebar() {
    return document.body.classList.contains('has-folders-sidebar')
  }

  public onCollapsedChange(_canShowCtrlFTip = false) {
    this.chatListContainer.parentElement!.classList.toggle('fade', this.isCollapsed())
    this.chatListContainer.parentElement!.classList.toggle('zoom-fade', !this.isCollapsed())
    this.dialogsManager?.xd?.toggleAvatarUnreadBadges(this.isCollapsed())
    // `appDialogsManager.onChatListNarrowChange()` (:507) — задача 1-8;
    // `showCtrlFTip` (:509-513) — задача 2-3; `resizeStoriesList` (:515) — 2-6.
  }

  public hasSomethingOpenInside() {
    return this.hasTabsInNavigation() || this.isSearchActive // `|| !!appDialogsManager.forumTab` — задача 1-6
  }

  public closeEverythingInside() {
    this.closeSearch()
    // `appDialogsManager.toggleForumTab()` — задача 1-6

    return this.closeAllTabs()
  }

  // Like closeEverythingInside, but closes stacked tabs the "natural" way (via
  // the back arrow) so a tab can still confirm before closing. Returns false —
  // without touching the search or the forum — if the user declines a tab's
  // close confirmation, so the caller can cancel whatever triggered the close.
  public async closeEverythingInsideNaturally() {
    if(!await this.closeAllTabsNaturally()) {
      return false
    }

    if(this.isSearchActive) {
      this.closeSearch()
    }
    // `appDialogsManager.toggleForumTab()` — задача 1-6

    return true
  }

  private isAnimatingCollapse = false
  /** У tweb приватный (:547) — расхождение 6: зовёт и владелец поиска. */
  public onSomethingOpenInsideChange = (force = false) => {
    const wasFloating = this.sidebarEl.classList.contains('has-open-tabs')
    const isFloating = force || this.hasSomethingOpenInside()
    const isCollapsed = this.isCollapsed()
    const hasRealTabs = this.hasTabsInNavigation()

    this.sidebarEl.classList.toggle('has-open-tabs', isFloating)
    this.sidebarEl.classList.toggle('has-real-tabs', hasRealTabs)
    // `has-forum-open` и `forumTab.container.inert = hasRealTabs` (:555-560) — задача 1-6
    // `useHasOpenLeftTabs()[1](isFloating)` (:561) — сигнал без читателя, О-101

    // Keep the pop-out flag in sync with the actual tabs state regardless of
    // the early-return paths below. If we only set it inside the
    // isFloating/!isFloating branches, opening a tab from an expanded sidebar
    // and then closing it would leave the flag stuck at true — and a later
    // collapse via the resize handle would render at default width instead of
    // SIDEBAR_COLLAPSED_WIDTH.
    setOpenTabsLeftSidebar(isFloating)

    if(!isCollapsed && !this.hasSomethingOpenInside()) {
      // `resizing_left_sidebar` (:571-576) — задача 2-6, см. шапку
      return
    }

    if(wasFloating === isFloating) return

    // Width is animated by CSS (transition on #column-left.is-collapsed
    // width). The numbers below define how long we hold the auxiliary
    // class state — they must match the layer-transition duration the CSS
    // rule uses (currently 200ms).
    const ANIMATION_TIME = 200
    // Wait a touch longer than the width transition before removing the
    // force-* classes so child layouts don't shift while the bar is still
    // visually resizing.
    const DELAY_AFTER_ANIMATION = 150

    if(isFloating) {
      this.sidebarEl.classList.add(
        'force-hide-large-content',
        'force-hide-menu',
        'force-chatlist-thin',
      )
      if(!this.isSearchActive) this.sidebarEl.classList.add('force-hide-search')

      this.isAnimatingCollapse = true
      void pause(ANIMATION_TIME + DELAY_AFTER_ANIMATION).then(() => {
        this.isAnimatingCollapse = false
        this.sidebarEl.classList.remove(
          'force-hide-large-content',
          'force-hide-menu',
          'force-hide-search',
          'force-chatlist-thin',
        )
      })
      // `if(!appDialogsManager.forumTab)` — задача 1-6
      this.dialogsManager?.xd?.toggleAvatarUnreadBadges(false)
    } else {
      this.sidebarEl.classList.add(
        'force-fixed',
        'hide-add-folders',
        'force-chatlist-thin',
      )

      this.isAnimatingCollapse = true
      void pause(ANIMATION_TIME + DELAY_AFTER_ANIMATION).then(() => {
        this.sidebarEl.classList.remove(
          'force-fixed',
          'hide-add-folders',
          'force-chatlist-thin',
        )

        this.dialogsManager?.xd?.toggleAvatarUnreadBadges(true)

        void pause(200).then(() => {
          this.isAnimatingCollapse = false
        })
      })
    }
  }

  private initSidebarResize() {
    this.onTabsCountChange = () => {
      this.onSomethingOpenInsideChange()
    }

    this.disposers.push(installColumnResize({
      columnEl: this.sidebarEl,
      side: 'left',
      isCollapsed: () => this.isCollapsed(),
      setCollapsed: (collapsed) => {
        // Drag only fires off-handheld (the resize handle is display:none
        // at handheld), so the raw drag value is already the effective
        // one — push it into the signal and the mirror effect
        // (`App.tsx`, расхождение 5) toggles #column-left.is-collapsed.
        useIsSidebarCollapsed()[1](collapsed)
      },
      onCollapsedChange: () => this.onCollapsedChange(true),
      preventCollapse: () => this.hasSomethingOpenInside(),
      // onSwipeTick: appImManager.adjustChatPatternBackground — Э4-5, см. шапку
    }))
  }

  /** tweb `createToolsMenu` (:673-905). `listenerSetter` — расхождение 7. */
  public createToolsMenu(mountTo?: HTMLElement, positionPadding?: MenuPositionPadding, listenerSetter?: ListenerSetter) {
    const managers = this.managers!
    const closeTabsBefore = async(clb: () => void) => {
      if(this.closeEverythingInside()) await pause(200)

      clb()
    }

    // «Архив» с бейджем `archivedCount` (:202-235, :680-688) — расхождение 4 бургера

    const onContactsClick = () => {
      void closeTabsBefore(() => {
        void this.createTab(AppContactsTab).open()
      })
    }

    const moreSubmenu = createSubmenuTrigger({
      options: {
        text: 'MultiAccount.More',
        icon: 'more',
      },
      createSubmenu: (args) => this.createMoreSubmenu(args, closeTabsBefore),
    })

    const newSubmenu = createSubmenuTrigger({
      options: {
        text: 'CreateANew',
        icon: 'edit',
        verify: () => this.isCollapsed(),
        separator: true,
      },
      createSubmenu: () => this.createNewChatsSubmenu(),
    })

    const menuButtons: ButtonMenuItemOptionsVerifiable[] = [{
      icon: 'plus',
      text: 'MultiAccount.AddAccount',
      onClick: () => void this.addAccount(),
      verify: async() => {
        const totalAccounts = Math.max((await managers.auth.listAccounts()).length, 1)
        return totalAccounts < MAX_ACCOUNTS
      },
    }, newSubmenu, {
      icon: 'savedmessages',
      text: 'SavedMessages',
      onClick: () => {
        setTimeout(() => { // menu doesn't close if no timeout (lol)
          this.openSavedMessages()
        }, 0)
      },
      separator: true,
    }, {
      icon: 'user',
      text: 'Contacts',
      onClick: onContactsClick,
    }, {
      icon: 'phone',
      text: 'Calls',
      onClick: () => {
        void closeTabsBefore(() => {
          void this.createTab(AppCallsTab).open()
        })
      },
      verify: () => IS_CALL_SUPPORTED, // || IS_CONFERENCE_CALL_SUPPORTED — О-1 волны 7
    }, {
      id: 'settings',
      icon: 'settings',
      text: 'Settings',
      separator: true,
      onClick: () => {
        void closeTabsBefore(() => {
          void this.createTab(AppSettingsTab).open()
        })
      },
    }, moreSubmenu]

    const filteredButtons = menuButtons.filter(Boolean)
    const filteredButtonsSliced = filteredButtons.slice()
    const buttonMenuToggle = ButtonMenuToggle({
      direction: 'bottom-right',
      buttons: filteredButtons,
      container: mountTo,
      listenerSetter,
      buttonOptions: { ariaLabel: 'MultiAccount.More' },
      positionPadding,
      onOpenBefore: async() => {
        const buttons = filteredButtonsSliced.slice()
        // :777-816 — боты меню вложений перед «Настройками»: О-80 (расхождение 2 бургера)
        const targetIdx = buttons.findIndex((btn) => btn.id === 'settings')
        buttons[targetIdx].separator = true

        const accounts = await managers.auth.listAccounts()
        const me = useChatsStore.getState().me?.user
        // реестр мог не записаться (idb недоступен) — текущий аккаунт есть всегда,
        // как у tweb, где `totalAccounts >= 1`
        const list: (PublicAccount | undefined)[] = accounts.some((a) => a.id === me?.id) ? accounts : [undefined, ...accounts]
        const accountButtons: ButtonMenuItemOptions[] = []
        for(const account of list) {
          if(!account || account.id === me?.id) {
            accountButtons.push({
              avatarInfo: {
                peerId: rootScope.myId,
                active: true,
                managers,
              },
              regularText: wrapUserName(me, account?.name ?? ''),
              onClick: () => {
                void closeTabsBefore(() => {
                  void this.createTab(AppSettingsTab).open()
                })
              },
            })
          } else {
            const content = document.createElement('span')
            content.append(limitSymbols(account.name, 15, 18))
            // бейдж непрочитанного аккаунта (:850-854) — О-81 (расхождение 3 бургера)

            accountButtons.push({
              avatarInfo: {
                peerId: account.id,
                peer: accountToUser(account),
                managers,
              },
              className: 'btn-menu-account-item',
              regularText: content,
              onClick: async() => {
                // :866-876 — список чатов уезжает ДО команды смены аккаунта:
                // `rt:logging_out` воркер шлёт и этой вкладке, обратный порядок
                // срезал бы анимацию reload'ом
                await playChatlistExit(document.querySelector('.chatlist-container')?.firstElementChild as HTMLElement | null)
                await commandThenReload(managers.auth.switchAccount(account.id))
              },
            })
          }
        }

        buttons.splice(0, 0, ...accountButtons)

        filteredButtons.splice(0, filteredButtons.length, ...buttons)
      },
      onOpen: () => {
        moreSubmenu.onOpen?.()
        newSubmenu.onOpen?.()
      },
      onClose: () => {
        moreSubmenu.onClose?.()
        newSubmenu.onClose?.()
      },
      noIcon: true,
    })

    return buttonMenuToggle
  }

  /** tweb `createMoreSubmenu` (:916-1064). */
  private async createMoreSubmenu(
    { middleware }: CreateSubmenuArgs,
    closeTabsBefore: (clb: () => void) => void,
  ) {
    const toggleTheme = () => {
      const item = btns[0].element!
      const icon = item.querySelector('.tgico')!
      const rect = icon.getBoundingClientRect()
      this.switchTheme?.({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
    }

    const darkModeText = document.createElement('span')
    darkModeText.append(i18n(isNight() ? 'DisableDarkMode' : 'EnableDarkMode'))
    const animationsText = document.createElement('span')
    const isPipOpen = usePipStore.getState().active

    const btns: ButtonMenuItemOptionsVerifiable[] = [{
      icon: 'darkmode',
      regularText: darkModeText,
      onClick: () => {},
    }, {
      id: 'animations-toggle',
      icon: 'animations',
      regularText: animationsText,
      onClick: () => {
        void toggleAnimations()
      },
      verify: () => !liteMode.isEnabled(),
    }, {
      icon: 'animations',
      text: 'LiteMode.Title',
      onClick: () => {
        closeTabsBefore(() => {
          void this.createTab(AppPowerSavingTab).open()
        })
      },
      verify: () => liteMode.isEnabled(),
    }, {
      // «Switch to A version» — расхождение 6 бургера
      icon: 'help',
      text: 'TelegramFeatures',
      onClick: () => {
        const url = I18n.format('TelegramFeaturesUrl', true)
        // ВРЕМЕННО до Э5-4: `appImManager.openUrl(url)` (расхождение 7 бургера)
        window.open(url, '_blank', 'noopener')
      },
      separator: true,
    }, {
      icon: 'bug',
      text: 'ReportBug',
      onClick: () => {
        const a = document.createElement('a')
        setBlankToAnchor(a)
        a.href = 'https://bugs.telegram.org/?tag_ids=40&sort=time'
        document.body.append(a)
        a.click()
        setTimeout(() => {
          a.remove()
        }, 0)
      },
    }, {
      icon: 'plusround',
      text: 'PWA.Install',
      onClick: () => {
        void usePwaStore.getState().install()
      },
      verify: () => usePwaStore.getState().canInstall,
    }, {
      icon: 'pip',
      // The More submenu is rebuilt on every open, so reading the live pip state
      // here keeps the label in sync: while popped out the entry flips to "Exit".
      text: isPipOpen ? 'ClientPip.Exit' : 'PictureInPicture',
      onClick: () => {
        // расхождение 8 бургера
        if(usePipStore.getState().active) {
          usePipStore.getState().win?.close()
        } else {
          void enterAppPip({
            title: I18n.format('Pip.ActiveTitle', true),
            hint: I18n.format('Pip.ActiveHint', true),
            back: I18n.format('Pip.BackToTab', true),
          })
        }
      },
      // Document Picture-in-Picture is Chromium-only — gate the entry on actual support.
      verify: () => DOCUMENT_PICTURE_IN_PICTURE_SUPPORTED,
    }]

    const hasAnimations = () => {
      const [appSettings] = useAppSettings()
      return !appSettings.liteMode.animations
    }

    const initAnimationsToggleIcon = () => {
      updateAnimationsToggleButton(hasAnimations())
    }

    const toggleAnimations = async() => {
      updateAnimationsToggleButton(!hasAnimations())
      const [, setAppSettings] = useAppSettings()
      await setAppSettings('liteMode', 'animations', hasAnimations())
    }

    const updateAnimationsToggleButton = (enabled: boolean) => {
      const animationToggleButton = btns.find((button) => button.id === 'animations-toggle')?.element
      if(!animationToggleButton) return

      const icon = animationToggleButton.querySelector('.tgico')
      if(enabled) icon?.classList.add('animations-icon-off')
      else icon?.classList.remove('animations-icon-off')

      animationsText.replaceChildren(i18n(enabled ? 'DisableAnimations' : 'EnableAnimations'))
    }

    const filtered = await filterAsync(btns, (button) => button?.verify ? button.verify() ?? false : true)
    const menu = await ButtonMenu({
      buttons: filtered,
    })

    menu.append(getVersionLink())
    menu.classList.add('sidebar-tools-submenu')

    const darkModeBtn = btns[0].element!
    darkModeBtn.addEventListener(CLICK_EVENT_NAME, (e) => {
      e.stopPropagation()
      toggleTheme()
      void pause(20).then(() => contextMenuController.close())
    }, true)

    initAnimationsToggleIcon()

    if(!middleware()) return

    return menu
  }

  /**
   * tweb `createNewChatsSubmenu` (:1130-1134) — `createNewChatsMenuOptions(true,
   * true)` (:1065-1110): «Канал», «Группа», «Личный чат», каждый после
   * `closeEverythingInside`. «Новая конференция» — О-1 (расхождение 5 бургера).
   * Общий с `#new-menu` `createNewChatsMenuOptions` — задача 2-4.
   */
  private createNewChatsSubmenu() {
    const closeTabsBefore = async(clb: () => void) => {
      if(this.closeEverythingInside()) await pause(200)
      clb()
    }

    return ButtonMenu({
      buttons: [{
        icon: 'newchannel',
        text: 'Channel',
        onClick: () => {
          void closeTabsBefore(() => {
            void this.createTab(AppNewChannelTab).open()
          })
        },
      }, {
        icon: 'newgroup',
        text: 'Group',
        onClick: () => {
          void closeTabsBefore(() => {
            createNewGroupTab(this)
          })
        },
      }, {
        icon: 'newprivate',
        text: 'PrivateChat',
        onClick: () => {
          void closeTabsBefore(() => {
            void this.createTab(AppContactsTab).open()
          })
        },
      }],
    })
  }

  /** tweb `initSearch` (:1137) — расхождение 6. */
  public initSearch() {
    return this.globalSearch!.initSearch()
  }

  public closeSearch() {
    if(!this.isSearchActive) {
      return
    }

    simulateClickEvent(this.backBtn)
  }

  /**
   * `ctorsToOpenInPopup` при свёрнутой колонке (:1735-1739) — расхождение 4
   * (О-27 плана 2D), поэтому переопределение сводится к базовому методу.
   */
  public createTab<T extends SliderSuperTab>(
    ctor: SliderSuperTabConstructable<T>,
    destroyable = true,
    doNotAppend?: boolean,
  ) {
    return super.createTab(ctor, destroyable, doNotAppend)
  }

  // Every non-main tab in the left sidebar gets `.item-secondary`. The
  // chatlist (HTML-declared `.item-main`) keeps its identity; archive /
  // settings / contacts / etc. (all SliderSuperTab-created) flow through
  // `addTab` and pick up the marker here, so SCSS rules that target
  // "secondary" tabs don't have to enumerate every subclass.
  public addTab(tab: SliderSuperTab) {
    super.addTab(tab)
    if(!tab.container.classList.contains('item-main')) {
      tab.container.classList.add('item-secondary')
    }
  }

  public async closeTabsBefore(clb: () => void) {
    if(this.closeEverythingInside()) await pause(200)
    clb()
  }

  public openArchiveTab() {
    void this.closeTabsBefore(() => {
      // `this.createTab(AppArchivedTab).open()` — задача 1-5 (см. «Не перенесено»)
    })
  }

  /** `appImManager.setPeer({peerId: myId})` (:707-713) — ВРЕМЕННО до Э4-3 (расхождение 3). */
  private openSavedMessages() {
    const managers = this.managers!
    void (async() => {
      const id = await managers.chats.saved()
      await managers.dialogs.refresh()
      useNavigationStore.getState().selectChat(String(id))
    })()
  }

  /** tweb `addAccount` (:1766-1796) в нашей модели (расхождение 1 бургера). */
  public addAccount = async() => {
    const managers = this.managers!
    const accounts = await managers.auth.listAccounts()
    if(Math.max(accounts.length, 1) >= MAX_ACCOUNTS) return

    const me = useChatsStore.getState().me
    if(me) localStorage.setItem(PREV_ACCOUNT_KEY, String(me.user.id))
    localStorage.setItem(ANIMATE_AUTH_KEY, '1')

    // :1784-1789 — экран чатов уезжает до команды: `rt:logging_out` воркер шлёт
    // и этой вкладке, reload из обработчика срезал бы анимацию
    await playMainScreenExit(document.querySelector<HTMLElement>('.page-chats'))
    await commandThenReload(managers.auth.addAccount())
  }

  /**
   * ВРЕМЕННО до Э4-1 (расхождение 1) — у оригинала метода нет: синглтон вечен.
   * Закрывает вкладки (`super.destroy`), снимает запись навигации, кнопку
   * бургера, морф, клик по оверлею, ручку ресайза и свои следы на узле колонки.
   */
  public destroy() {
    super.destroy()
    this.disposers.forEach((dispose) => dispose())
    this.disposers = []
    this.onTabsCountChange = undefined
    this.toolsBtn?.remove()
    this.globalSearch?.destroy()
    this.globalSearch = undefined
    this.inputSearch?.container.remove()
    appNavigationController.removeByType('global-search-focus')
    this.sidebarEl.classList.remove(
      'has-open-tabs', 'has-real-tabs', 'has-forum-open', 'can-menu-have-z-index',
      'force-hide-large-content', 'force-hide-menu', 'force-hide-search', 'force-chatlist-thin',
      'force-fixed', 'hide-add-folders',
    )
    setOpenTabsLeftSidebar(false)
    this.dialogsManager = undefined
    this.switchTheme = undefined
  }
}

// ВРЕМЕННО до Э4-1 (расхождение 1): у tweb — `const appSidebarLeft = new AppSidebarLeft()` при импорте (:1798-1800).
let appSidebarLeft!: AppSidebarLeft

/** Слайдер ОДИН на колонку: он владеет историей вкладок, а история одна. */
export function createAppSidebarLeft() {
  appSidebarLeft?.destroy()
  appSidebarLeft = new AppSidebarLeft()
  MOUNT_CLASS_TO.appSidebarLeft = appSidebarLeft
  return appSidebarLeft
}

export { appSidebarLeft as default }

/** tweb `themeController.isNight()` — по применённой теме, а не по выбору рендера. */
function isNight() {
  const preset = getCurrentPreset() ?? resolvePreset(useSettingsStore.getState().themeChoice)
  return PRESET_MODE[preset] === 'dark'
}

/** tweb `wrapUserName` (:818-827): имя до 15 символов при длине больше 18. */
function wrapUserName(user: UserReal | undefined, fallback: string) {
  if(!user) {
    return fallback
  }

  let name = user.first_name ?? ''
  if(user.last_name) name += ' ' + user.last_name

  return limitSymbols(name, 15, 18)
}

/**
 * Карточка другого аккаунта из реестра — то, что tweb берёт
 * `otherManagers.appUsersManager.getSelf()` (:845), в объёме реестра
 * (расхождение 1 бургера): имя и фото.
 */
function accountToUser(account: PublicAccount): User {
  return {
    _: 'user',
    id: account.id,
    first_name: account.name,
    pFlags: {},
    photo: account.photoId ?
      { _: 'userProfilePhoto', photo_id: account.photoId, dc_id: 0, pFlags: {} } :
      { _: 'userProfilePhotoEmpty' },
  } as User
}

/** tweb `getVersionLink` (:1802-1817). */
function getVersionLink() {
  const btnMenuFooter = document.createElement('a')
  btnMenuFooter.href = CHANGELOG_URL
  setBlankToAnchor(btnMenuFooter)
  btnMenuFooter.classList.add('btn-menu-footer')
  btnMenuFooter.addEventListener(CLICK_EVENT_NAME, (e) => {
    e.stopPropagation()
    contextMenuController.close()
  })
  const t = document.createElement('span')
  t.classList.add('btn-menu-footer-text')
  t.textContent = `${APP_TITLE} ${APP_VERSION_FULL}`
  btnMenuFooter.append(t)

  return btnMenuFooter
}
