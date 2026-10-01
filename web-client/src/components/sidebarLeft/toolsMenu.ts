/**
 * Бургер-меню левой колонки — порт tweb `src/components/sidebarLeft/index.ts`
 * (812502980):
 *  • `createToolsMenu(mountTo?, positionPadding?)` (:673-905) — `ButtonMenuToggle`
 *    `bottom-right`: аккаунты, «Добавить аккаунт», подменю «Создать» (только у
 *    свёрнутой колонки), «Избранное», «Архив», «Мои истории», «Контакты»,
 *    «Звонки», «Настройки», подменю «Ещё»;
 *  • `createMoreSubmenu` (:916-1064) — «Ещё»: ночной режим, анимации /
 *    энергосбережение, Telegram Features, сообщить об ошибке, PWA, PiP и
 *    футер-версия `getVersionLink` (:1802-1817);
 *  • `createNewChatsSubmenu` (:1130-1134) поверх `createNewChatsMenuOptions`
 *    (:1065-1110) — подменю «Создать»;
 *  • `addAccount` (:1766-1796);
 *  • кнопка бургера в шапке из `construct`: `toolsBtn` + бейдж уведомлений
 *    (:165-172), вставка перед `backBtn` (:244), морф ≡ ↔ ← одним эффектом
 *    (:431-442) — `mountSidebarToolsButton`.
 * Тот же `createToolsMenu` монтирует вертикальная колонка папок на свой пункт
 * (`foldersSidebarContent/index.tsx:77-83`, у нас `folders/FoldersSidebar.tsx`).
 *
 * ── ВРЕМЕННО до 2-1: функции вместо методов `AppSidebarLeft` ─────────────
 * Класса колонки ещё нет, колонку рисует React (`Sidebar.tsx`). Поэтому всё
 * выше — функции модуля, а `this` оригинала — срез колонки `ToolsMenuSidebar`,
 * который собирает `Sidebar.tsx` (тот же объект, что получает меню папки).
 * Вкладки открываются колоночным слайдером `getColumnSlider()` — роль
 * `this.createTab`. Задача 2-1 переносит модуль методами класса.
 *
 * ── Пункты, ведущие ещё не в вкладки (мосты с номером) ────────────────────
 *  • «Избранное» — `appImManager.setPeer({peerId: myId})` (:707-713) →
 *    `sidebar.openSavedMessages()`, ВРЕМЕННО до Э4-3;
 *  • «Архив» — `openArchiveTab()` (:1760) → наш оверлей архива, его verify и
 *    бейдж — из зеркала диалогов колонки, ВРЕМЕННО до 1-5;
 *  • «Мои истории» — `AppMyStoriesTab` (:715-722) не портирован → наш
 *    `StoriesArchiveSheet`, О-82 волны 7;
 *  • «Звонки» — `AppCallsTab` (:727-734) → React-экран, ВРЕМЕННО до 0а-4;
 *  • «Создать → Группа» — `createNewGroupTab(this)` → React-экран,
 *    ВРЕМЕННО до 0а-2;
 *  • ночной режим — `themeController.switchTheme` (:919-928) → React-хук
 *    шелла `useThemeToggle`, ВРЕМЕННО до Э4-5.
 *
 * ── Расхождения с оригиналом ─────────────────────────────────────────────
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
 *  4. verify «Архива» (:681-685) — только «есть архивные диалоги»: признака
 *     «архив ещё не догружен» (`isDialogsLoaded(FOLDER_ID_ARCHIVE)`) и архива
 *     историй (`appStoriesManager.hasArchive()`) у нас нет — О-83 волны 7.
 *     Бейдж архива (`archivedCount`, :202-235) считается на открытии меню, а
 *     не событием `folder_unread` (меню перестраивается на каждое открытие).
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
import ButtonMenu, { type ButtonMenuItemOptions, type ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import createSubmenuTrigger, { type CreateSubmenuArgs } from '@components/createSubmenuTrigger'
import { AppNewChannelTab, AppPowerSavingTab, AppSettingsTab } from '@components/solidJsTabs/tabs'
import { getColumnSlider, openContactsTab } from '@components/sidebarLeft/columnSlider'
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
import { useChatsStore } from '@stores/chatsStore'
import { useFoldersSidebarShown, useIsLeftSearchActive } from '@stores/foldersSidebar.solid'
import { useAppSettings } from '@stores/appSettings.solid'
import { useSettingsStore } from '@/settings'
import { PRESET_MODE, resolvePreset } from '@/theme'
import IS_CALL_SUPPORTED from '@environment/callSupport'
import DOCUMENT_PICTURE_IN_PICTURE_SUPPORTED from '@environment/documentPictureInPictureSupport'
import contextMenuController from '@helpers/contextMenuController'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
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
import { APP_TITLE, APP_VERSION_FULL } from '@/config/app'
import type { Managers } from '@/client/bootstrap'
import { createEffect, createRoot } from 'solid-js'

/** Куда ведёт футер подменю «Ещё» — tweb ведёт на свой CHANGELOG.md (:1804). */
const CHANGELOG_URL = 'https://github.com/denislibs/messenger/blob/main/CHANGELOG.md'

/**
 * Срез `AppSidebarLeft`, которым пользуются функции бургера (ВРЕМЕННО до 2-1,
 * см. шапку). Каждый мост — с номером задачи, которая его снимает.
 */
export interface ToolsMenuSidebar {
  managers: Managers
  /** tweb `closeTabsBefore` (:1755-1758): закрыть всё внутри колонки, дать вкладке уехать, затем `clb` */
  closeTabsBefore: (clb: () => void) => void
  /** tweb `isCollapsed` (:491-497) */
  isCollapsed: () => boolean
  /** tweb `openArchiveTab` (:1760-1764) — ВРЕМЕННО до 1-5: оверлей архива колонки */
  openArchiveTab: () => void
  /** verify «Архива» (:681-685, расхождение 4) — ВРЕМЕННО до 1-5 */
  hasArchivedDialogs: () => boolean
  /** число для бейджа `archivedCount` (:202-235) — ВРЕМЕННО до 1-5 */
  getArchivedUnreadCount: () => number
  /** `appImManager.setPeer({peerId: myId})` (:707-713) — ВРЕМЕННО до Э4-3 */
  openSavedMessages: () => void
  /** `AppMyStoriesTab` (:715-722) — О-82 волны 7 */
  openMyStories: () => void
  /** `AppCallsTab` (:727-734) — ВРЕМЕННО до 0а-4 */
  openCalls: () => void
  /** `createNewGroupTab(this)` (:1074-1078) — ВРЕМЕННО до 0а-2 */
  openNewGroup: () => void
  /** `themeController.switchTheme(undefined, coords)` (:919-928) — ВРЕМЕННО до Э4-5 */
  switchTheme: (coords: { x: number, y: number }) => void
}

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
 * (расхождение 1): имя и фото.
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

/** tweb `addAccount` (:1766-1796) в нашей модели (расхождение 1). */
export async function addAccount(managers: Managers) {
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
 * tweb `createToolsMenu` (:673-905).
 *
 * `listenerSetter` — сверх оригинала, ВРЕМЕННО до 2-7: `mountTo` колонки папок
 * — React-узел (`folders/FoldersSidebar.tsx`), его остров перезапускается
 * (StrictMode, размонтирование), и слушатель клика обязан сниматься вместе с
 * ним. У tweb узел живёт столько же, сколько страница.
 */
export function createToolsMenu(
  sidebar: ToolsMenuSidebar,
  mountTo?: HTMLElement,
  positionPadding?: MenuPositionPadding,
  listenerSetter?: ListenerSetter,
) {
  const { managers } = sidebar
  const closeTabsBefore = (clb: () => void) => sidebar.closeTabsBefore(clb)

  const archivedCount = createBadge('span', 24, 'gray')
  archivedCount.classList.add('archived-count')

  const btnArchive: ButtonMenuItemOptionsVerifiable = {
    icon: 'archive',
    text: 'ArchivedChats',
    onClick: () => {
      sidebar.openArchiveTab()
    },
    verify: () => sidebar.hasArchivedDialogs(),
  }

  const onContactsClick = () => {
    closeTabsBefore(() => {
      void openContactsTab()
    })
  }

  const moreSubmenu = createSubmenuTrigger({
    options: {
      text: 'MultiAccount.More',
      icon: 'more',
    },
    createSubmenu: (args) => createMoreSubmenu(args, closeTabsBefore, sidebar),
  })

  const newSubmenu = createSubmenuTrigger({
    options: {
      text: 'CreateANew',
      icon: 'edit',
      verify: () => sidebar.isCollapsed(),
      separator: true,
    },
    createSubmenu: () => createNewChatsSubmenu(sidebar),
  })

  const menuButtons: ButtonMenuItemOptionsVerifiable[] = [{
    icon: 'plus',
    text: 'MultiAccount.AddAccount',
    onClick: () => void addAccount(managers),
    verify: async() => {
      const totalAccounts = Math.max((await managers.auth.listAccounts()).length, 1)
      return totalAccounts < MAX_ACCOUNTS
    },
  }, newSubmenu, {
    icon: 'savedmessages',
    text: 'SavedMessages',
    onClick: () => {
      setTimeout(() => { // menu doesn't close if no timeout (lol)
        sidebar.openSavedMessages()
      }, 0)
    },
    separator: true,
  }, btnArchive, {
    icon: 'stories',
    text: 'MyStories.Title',
    onClick: () => {
      closeTabsBefore(() => {
        sidebar.openMyStories()
      })
    },
    // verify: () => !TEST_NO_STORIES — у нас тестового сервера без историй нет
  }, {
    icon: 'user',
    text: 'Contacts',
    onClick: onContactsClick,
  }, {
    icon: 'phone',
    text: 'Calls',
    onClick: () => {
      closeTabsBefore(() => {
        sidebar.openCalls()
      })
    },
    verify: () => IS_CALL_SUPPORTED, // || IS_CONFERENCE_CALL_SUPPORTED — О-1 волны 7
  }, {
    id: 'settings',
    icon: 'settings',
    text: 'Settings',
    separator: true,
    onClick: () => {
      closeTabsBefore(() => {
        void getColumnSlider().createTab(AppSettingsTab).open()
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
      // :777-816 — боты меню вложений перед «Настройками»: О-80 (расхождение 2)
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
              closeTabsBefore(() => {
                void getColumnSlider().createTab(AppSettingsTab).open()
              })
            },
          })
        } else {
          const content = document.createElement('span')
          content.append(limitSymbols(account.name, 15, 18))
          // бейдж непрочитанного аккаунта (:850-854) — О-81 (расхождение 3)

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
      const unread = sidebar.getArchivedUnreadCount()
      setBadgeContent(archivedCount, unread ? '' + formatNumber(unread, 1) : '')
      btnArchive.element?.append(archivedCount)
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
async function createMoreSubmenu(
  { middleware }: CreateSubmenuArgs,
  closeTabsBefore: (clb: () => void) => void,
  sidebar: ToolsMenuSidebar,
) {
  const toggleTheme = () => {
    const item = btns[0].element!
    const icon = item.querySelector('.tgico')!
    const rect = icon.getBoundingClientRect()
    sidebar.switchTheme({
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
        void getColumnSlider().createTab(AppPowerSavingTab).open()
      })
    },
    verify: () => liteMode.isEnabled(),
  }, {
    // «Switch to A version» — расхождение 6
    icon: 'help',
    text: 'TelegramFeatures',
    onClick: () => {
      const url = I18n.format('TelegramFeaturesUrl', true)
      // ВРЕМЕННО до Э5-4: `appImManager.openUrl(url)` (расхождение 7)
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
      // расхождение 8
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
 * `closeEverythingInside`. «Новая конференция» — О-1 (расхождение 5).
 */
function createNewChatsSubmenu(sidebar: ToolsMenuSidebar) {
  const closeTabsBefore = (clb: () => void) => sidebar.closeTabsBefore(clb)

  return ButtonMenu({
    buttons: [{
      icon: 'newchannel',
      text: 'Channel',
      onClick: () => {
        closeTabsBefore(() => {
          void getColumnSlider().createTab(AppNewChannelTab).open()
        })
      },
    }, {
      icon: 'newgroup',
      text: 'Group',
      onClick: () => {
        closeTabsBefore(() => {
          sidebar.openNewGroup()
        })
      },
    }, {
      icon: 'newprivate',
      text: 'PrivateChat',
      onClick: () => {
        closeTabsBefore(() => {
          void openContactsTab()
        })
      },
    }],
  })
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

/**
 * Кнопка бургера в шапке колонки — кусок `AppSidebarLeft.construct`
 * (ВРЕМЕННО до 2-1): `toolsBtn = createToolsMenu()` с классами и бейджем
 * (:165-172), вставка перед `.sidebar-back-button` (:244) и морф ≡ ↔ ←
 * (:431-442). Контейнер `.sidebar-header__btn-container` с
 * `.animated-menu-icon` и `.sidebar-back-button` — статичная разметка колонки
 * (tweb `index.html:93-96`), у нас — `Sidebar.tsx` с постоянными классами.
 *
 * Возвращает уборку: колонка у нас размонтируется вместе с React-шеллом.
 */
export function mountSidebarToolsButton(sidebar: ToolsMenuSidebar, buttonsContainer: HTMLElement) {
  const backBtn = buttonsContainer.querySelector<HTMLElement>('.sidebar-back-button')!

  const toolsBtn = createToolsMenu(sidebar)
  // .is-visible is owned by the Solid effect below — don't seed it here.
  toolsBtn.classList.add('sidebar-tools-button')
  toolsBtn.setAttribute('role', 'button')
  toolsBtn.tabIndex = 0
  // :170-172 — бейдж непрочитанного других аккаунтов (расхождение 3, О-81)
  const totalNotificationsCount = createBadge('span', 20, 'primary')
  totalNotificationsCount.classList.add('sidebar-tools-button-notifications')
  toolsBtn.append(totalNotificationsCount)

  buttonsContainer.insertBefore(toolsBtn, backBtn)

  // The burger element has two visual states: the three-line menu icon (a
  // click on it opens the burger menu) and the back arrow (a click on it
  // closes the open search). Three classes encode that state — toolsBtn /
  // backBtn `.is-visible` and the animated icon's `.state-back`. They all flow
  // from the same condition, so a single Solid effect owns the truth:
  //
  //   showBack = useFoldersSidebarShown OR useIsLeftSearchActive
  const dispose = createRoot((dispose) => {
    const [foldersSidebarShown] = useFoldersSidebarShown()
    const [isLeftSearchActive] = useIsLeftSearchActive()
    const animatedMenuIcon = buttonsContainer.firstElementChild as HTMLElement
    createEffect(() => {
      const showBack = foldersSidebarShown() || isLeftSearchActive()
      toolsBtn.classList.toggle('is-visible', !showBack)
      backBtn.classList.toggle('is-visible', showBack)
      animatedMenuIcon.classList.toggle('state-back', showBack)
    })
    return dispose
  })

  return () => {
    dispose()
    toolsBtn.remove()
  }
}
