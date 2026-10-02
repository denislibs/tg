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
 * форум-таб (`appDialogsManager.forumTab`, :453-455, :519, :524, :541, :555-560,
 * :610, задача 1-6 — через экземпляр владельца, расхождение 2),
 * `onSomethingOpenInsideChange` (:547-634) — ЕДИНСТВЕННЫЙ писатель
 * `has-open-tabs` и `setOpenTabsLeftSidebar`, `initSidebarResize` (:651-671),
 * бургер `createToolsMenu` (:673-905), `createMoreSubmenu` (:916-1064),
 * `#new-menu` — `createNewChatsMenuOptions`/`createNewChatsMenuButton`/
 * `createNewChatsSubmenu` (:198-200, :1065-1135, задача 2-4), `closeSearch` (:1722), `createTab`/
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
 *  • «Мои истории» (`AppMyStoriesTab`, :715-722) — О-82, пункт скрыт;
 *  • статус-эмодзи и замок (`toggleRightButtons`, :258-361) — задача 2-8;
 *  • вертикальная колонка папок (`renderFoldersSidebarContent`, :177-184) —
 *    задача 2-7; бейдж уведомлений других аккаунтов (:186-188) — О-81;
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
 *  1. (снято на К-2) Синглтон создаётся при импорте, как у tweb (:1798), над
 *     статичной разметкой `index.html` (`#column-left`, `.sidebar-left-overlay`).
 *  2. `construct(managers, dialogsManager)`: владелец списка чатов — экземпляр
 *     `AppDialogsManager` колонки, а не синглтон (расхождение 1 его шапки,
 *     `lib/appDialogsManager.ts`), и `construct` его получает от `start()`,
 *     который его зовёт (tweb :983).
 *  3. Ночной режим бургера (`themeController.switchTheme`, :919-928) — наш
 *     `switchTheme` из `core/theme/themeTransition.ts` (там исполнитель перехода).
 *  4. `createTab` при свёрнутой колонке не открывает `AppSettingsTab`/
 *     `AppEditFolderTab`/`AppChatFoldersTab` попапом `showSettingsSliderPopup`
 *     (:1735-1739) — О-27 плана 2D: попапа-слайдера настроек нет. Вкладка
 *     открывается в колонке, а колонка всплывает (`has-open-tabs`).
 *  5. `is-collapsed` колонки пишет, как у tweb, не класс, а эффект
 *     `setSidebarLeftWidth` (`src/index.ts`, tweb `:205-235`); класс читает его
 *     (`isCollapsed`), а ручка ресайза пушит сырой драг в сигнал
 *     `useIsSidebarCollapsed` (:660-666).
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
 *  4. «Архив» (:680-688, задача 1-5): verify — архивные диалоги в зеркале
 *     (`useChatsStore`), а не `getFolderDialogs`/`isDialogsLoaded` хранилища
 *     воркера (его нет на главном потоке); первую страницу архива зеркало
 *     получает от строки «Архив» списка («Все чаты» тянут её на первой загрузке).
 *     Истории архива (`appStoriesManager.hasArchive`) — Б-51. Бейдж
 *     `archivedCount` (:230-258) — подписка на зеркало вместо `folder_unread`,
 *     счёт — `archiveUnreadCount` (расхождение 3 шапки `archiveDialog.solid.tsx`).
 *  5. «Новая конференция» (`ConferenceCall.New`, :1093-1101, пункт
 *     `createNewChatsMenuOptions`) и verify `IS_CONFERENCE_CALL_SUPPORTED` у
 *     «Звонков» — О-1 волны 7: конференц-звонков нет на бэкенде, флага
 *     `environment/conferenceCallSupport` и `appImManager.createConference`
 *     у нас нет, пункта нет.
 * 10. Отступление В7-1 — «Новый секретный чат» в `createNewChatsMenuOptions`
 *     (у tweb секретных чатов нет): пункт под `SECRET_CHATS_ENABLED`
 *     (`config/app.ts`, решение пользователя 2026-10-01 — фича на паузе, флаг
 *     `false`), так что меню = tweb. Флаг решает состав массива, а не
 *     `verify`: подменю «Создать» строит `ButtonMenu` напрямую (:1131-1135), а
 *     он `verify` не фильтрует — фильтрует только `ButtonMenuToggle`.
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
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import createSubmenuTrigger, { type CreateSubmenuArgs } from '@components/createSubmenuTrigger'
import {
  AppArchivedTab,
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
import appImManager from '@lib/appImManager'
import { switchTheme } from '@core/theme/themeTransition'
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
import { isDialogArchived } from '@core/models'
import { archiveUnreadCount } from '@core/folders/folderUnreadCounts'
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
import setBadgeContent from '@helpers/setBadgeContent'
import formatNumber from '@helpers/number/formatNumber'
import liteMode from '@helpers/liteMode'
import type { MenuPositionPadding } from '@helpers/positionMenu'
import pause from '@helpers/schedulers/pause'
import limitSymbols from '@helpers/string/limitSymbols'
import type ListenerSetter from '@helpers/listenerSetter'
import I18n, { i18n } from '@lib/langPack'
import { setBlankToAnchor } from '@lib/richtext/url'
import rootScope from '@lib/rootScope'
import { MOUNT_CLASS_TO } from '@config/debug'
import { APP_TITLE, APP_VERSION_FULL, SECRET_CHATS_ENABLED } from '@/config/app'
import type { Managers } from '@/client/bootstrap'

/** :230-231 */
function createArchivedCount() {
  const archivedCount = createBadge('span', 24, 'gray')
  archivedCount.classList.add('archived-count')
  return archivedCount
}

/** Куда ведёт футер подменю «Ещё» — tweb ведёт на свой CHANGELOG.md (:1804). */
const CHANGELOG_URL = 'https://github.com/denislibs/messenger/blob/main/CHANGELOG.md'

export class AppSidebarLeft extends SidebarSlider {
  private chatListContainer!: HTMLElement
  private buttonsContainer!: HTMLElement
  private toolsBtn!: HTMLElement
  private backBtn!: HTMLElement
  private newBtnMenu!: HTMLElement
  /** :230-231 — бейдж пункта «Архив» бургера (расхождение 4 бургера) */
  private archivedCount = createArchivedCount()
  public inputSearch!: InputSearch
  /** Расхождение 6 шапки. */
  private globalSearch?: GlobalSearch
  private dialogsManager?: AppDialogsManager

  public get isSearchActive() {
    return useIsLeftSearchActive()[0]()
  }

  /** У tweb приватный (:137); пишет владелец поиска — расхождение 6. */
  public set isSearchActive(value: boolean) {
    useIsLeftSearchActive()[1](value)
  }

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
    void pause(1000).then(() => {
      this.sidebarEl.classList.add('can-menu-have-z-index')
    })

    this.backBtn.parentElement!.insertBefore(this.toolsBtn, this.backBtn)

    this.buttonsContainer = this.backBtn.parentElement!

    this.newBtnMenu = this.createNewChatsMenuButton()
    sidebarHeader.nextElementSibling!.append(this.newBtnMenu)

    // `inputSearch.input focus → initSearch` (:226) вешает владелец поиска сам
    // (расхождение 6); он же слушает Ctrl+F (`tg-focus-search`).
    this.globalSearch = new GlobalSearch({
      searchContainer: this.sidebarEl.querySelector('#search-container') as HTMLElement,
      inputSearch: this.inputSearch,
      backBtn: this.backBtn,
      newBtnMenu: this.newBtnMenu,
      managers,
      onSearchActive: (active) => {
        this.isSearchActive = active
        this.onSomethingOpenInsideChange()
      },
      openUrl: (url) => openSearchUrl(url),
    })

    // :233-258 — `folder_unread` архива; у нас — движение зеркала диалогов (расхождение 4 бургера)
    const updateArchivedCount = () => {
      const unreadCount = archiveUnreadCount(useChatsStore.getState().dialogs)
      setBadgeContent(this.archivedCount, unreadCount ? '' + formatNumber(unreadCount, 1) : '')
    }
    updateArchivedCount()
    useChatsStore.subscribe((state, prev) => {
      if(state.dialogs !== prev.dialogs) updateArchivedCount()
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
    createRoot(() => {
      const [foldersSidebarShown] = useFoldersSidebarShown()
      const [isLeftSearchActive] = useIsLeftSearchActive()
      const animatedMenuIcon = this.buttonsContainer.firstElementChild as HTMLElement
      createEffect(() => {
        const showBack = foldersSidebarShown() || isLeftSearchActive()
        this.toolsBtn.classList.toggle('is-visible', !showBack)
        this.backBtn.classList.toggle('is-visible', showBack)
        animatedMenuIcon.classList.toggle('state-back', showBack)
      })
    })

    const sidebarOverlay = document.querySelector('.sidebar-left-overlay')!
    sidebarOverlay.addEventListener('click', () => {
      this.closeEverythingInside()
    })

    this.initSidebarResize()
    // `:453-455`
    dialogsManager.onSomeDrawerToggle = () => {
      this.onSomethingOpenInsideChange()
    }
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
    return this.hasTabsInNavigation() || this.isSearchActive || !!this.dialogsManager?.forumTab
  }

  public closeEverythingInside() {
    this.closeSearch()
    void this.dialogsManager?.toggleForumTab()

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
    void this.dialogsManager?.toggleForumTab()

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
    this.sidebarEl.classList.toggle('has-forum-open', !!this.dialogsManager?.forumTab)
    // A floating forum stays mounted under its own management tabs — take it out
    // of hit-testing so the selected tab gets pointer and keyboard interaction.
    if(this.dialogsManager?.forumTab) {
      this.dialogsManager.forumTab.container.inert = hasRealTabs
    }
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
      if(!this.dialogsManager?.forumTab) {
        this.dialogsManager?.xd?.toggleAvatarUnreadBadges(false)
      }
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

    installColumnResize({
      columnEl: this.sidebarEl,
      side: 'left',
      isCollapsed: () => this.isCollapsed(),
      setCollapsed: (collapsed) => {
        // Drag only fires off-handheld (the resize handle is display:none
        // at handheld), so the raw drag value is already the effective
        // one — push it into the signal and the mirror effect
        // (`src/index.ts::setSidebarLeftWidth`, расхождение 5) toggles
        // #column-left.is-collapsed.
        useIsSidebarCollapsed()[1](collapsed)
      },
      onCollapsedChange: () => this.onCollapsedChange(true),
      preventCollapse: () => this.hasSomethingOpenInside(),
      // onSwipeTick: appImManager.adjustChatPatternBackground — Э4-5, см. шапку
    })
  }

  /** tweb `createToolsMenu` (:673-905). `listenerSetter` — расхождение 7. */
  public createToolsMenu(mountTo?: HTMLElement, positionPadding?: MenuPositionPadding, listenerSetter?: ListenerSetter) {
    const managers = this.managers!
    const closeTabsBefore = async(clb: () => void) => {
      if(this.closeEverythingInside()) await pause(200)

      clb()
    }

    const btnArchive: ButtonMenuItemOptionsVerifiable = {
      icon: 'archive',
      text: 'ArchivedChats',
      onClick: () => {
        this.openArchiveTab()
      },
      // расхождение 4 бургера
      verify: () => useChatsStore.getState().dialogs.some(isDialogArchived),
    }

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
    }, btnArchive, {
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
        btnArchive.element?.append(this.archivedCount)
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
      switchTheme({
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
      // Б-12 (К-2): вынос переносил `#root`, которого с точкой входа tweb нет, —
      // пункт скрыт до порта `components/clientPip.tsx`.
      verify: () => DOCUMENT_PICTURE_IN_PICTURE_SUPPORTED && !!document.getElementById('root'),
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

  /** tweb `createNewChatsMenuOptions` (:1065-1111); конференция и секретный чат — расхождения 5, 10 бургера. */
  private createNewChatsMenuOptions(closeBefore?: boolean, singular?: boolean): ButtonMenuItemOptionsVerifiable[] {
    const closeTabsBefore = async(clb: () => void) => {
      if(closeBefore && this.closeEverythingInside()) {
        await pause(200)
      }
      clb()
    }

    const onNewGroupClick = () => {
      void closeTabsBefore(() => {
        createNewGroupTab(this)
      })
    }

    const onContactsClick = () => {
      void closeTabsBefore(() => {
        void this.createTab(AppContactsTab).open()
      })
    }

    const buttons: ButtonMenuItemOptionsVerifiable[] = [{
      icon: 'newchannel',
      text: singular ? 'Channel' : 'NewChannel',
      onClick: () => {
        void closeTabsBefore(() => {
          void this.createTab(AppNewChannelTab).open()
        })
      },
    }, {
      icon: 'newgroup',
      text: singular ? 'Group' : 'NewGroup',
      onClick: onNewGroupClick,
    }, {
      icon: 'newprivate',
      text: singular ? 'PrivateChat' : 'NewPrivateChat',
      onClick: onContactsClick,
    }]

    // Отступление В7-1 (расхождение 10 бургера)
    if(SECRET_CHATS_ENABLED) {
      buttons.push({
        icon: 'lock',
        text: 'SecretChat.New',
        onClick: () => {
          void closeTabsBefore(() => {
            void this.createTab(AppContactsTab).open({ secret: true })
          })
        },
      })
    }

    return buttons
  }

  /** tweb `createNewChatsMenuButton` (:1113-1129). */
  private createNewChatsMenuButton() {
    const btnMenu = ButtonMenuToggle({
      direction: 'top-left',
      buttons: this.createNewChatsMenuOptions(false),
      noIcon: true,
      buttonOptions: { ariaLabel: 'ChatAutomation.NewChats' },
      positionPadding: { bottom: 10 },
    })
    btnMenu.className = 'btn-new-menu btn-circle rp btn-corner z-depth-1 btn-menu-toggle animated-button-icon'
    btnMenu.tabIndex = 0
    btnMenu.setAttribute('role', 'button')
    const icons: IconName[] = ['newchat_filled', 'close']
    btnMenu.prepend(...icons.map((icon, idx) => Icon(icon, 'animated-button-icon-icon', 'animated-button-icon-icon-' + (idx === 0 ? 'first' : 'last'))))
    btnMenu.id = 'new-menu'

    return btnMenu
  }

  /** tweb `createNewChatsSubmenu` (:1131-1135). */
  private createNewChatsSubmenu() {
    return ButtonMenu({
      buttons: this.createNewChatsMenuOptions(true, true),
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
      void this.createTab(AppArchivedTab).open()
    })
  }

  /** `appImManager.setPeer({peerId: myId})` (:707-713). */
  private openSavedMessages() {
    const managers = this.managers!
    void (async() => {
      const id = await managers.chats.saved()
      await managers.dialogs.refresh()
      void appImManager.setPeer({ peerId: id })
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
}

const appSidebarLeft = new AppSidebarLeft()
MOUNT_CLASS_TO.appSidebarLeft = appSidebarLeft
export default appSidebarLeft

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
