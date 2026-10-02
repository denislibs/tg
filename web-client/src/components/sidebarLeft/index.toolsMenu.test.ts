// Бургер-меню левой колонки — порт tweb `sidebarLeft/index.ts:673-905`
// (`createToolsMenu`) и `:916-1064` (`createMoreSubmenu`), методы класса
// `AppSidebarLeft` (`index.ts`, расхождения бургера — в его шапке).
// Пины — на то, что видит пользователь: состав и порядок пунктов ровно по
// `verify` оригинала (ничего сверх: ни «Близких друзей», ни «Кошелька», ни
// «Telegram Premium», ни «Выйти»), что открывает клик, подменю «Ещё» и морф
// кнопки бургера ≡ ↔ ←.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import contextMenuController from '@helpers/contextMenuController'
import { useChatsStore } from '@stores/chatsStore'
import { makeDialog } from '@core/dialogs/testDialog'
import appImManager from '@lib/appImManager'
import { useFoldersSidebarShown, useIsLeftSearchActive } from '@stores/foldersSidebar.solid'
import { useSettingsStore } from '@/settings'
import { usePwaStore } from '@core/pwa'
import type { Managers } from '@/client/bootstrap'
import type { PublicAccount } from '@core/auth/accounts'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'
import { applyLang } from '@/test/lang'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import type { AppDialogsManager } from '@lib/appDialogsManager'
import type { AppSidebarLeft } from './index'

const env = vi.hoisted(() => ({ call: true, pip: false }))
const switchTheme = vi.hoisted(() => vi.fn())
vi.mock('@core/theme/themeTransition', async(importOriginal) => ({
  ...await importOriginal<typeof import('@core/theme/themeTransition')>(),
  switchTheme,
}))
vi.mock('@environment/callSupport', () => ({ get default() { return env.call } }))
vi.mock('@environment/documentPictureInPictureSupport', () => ({ get default() { return env.pip } }))

// Содержимое корня настроек — заглушка: пины вкладки — `tabs/settings.solid.test.tsx`.
vi.mock('./tabs/settings.solid', () => ({
  default: () => {
    const el = document.createElement('div')
    el.className = 'settings-root-stub'
    return el
  },
}))
// Вкладка архива — тоже заглушка, но с `id` контейнера: пины вкладки — `tabs/archivedTab.solid.test.tsx`.
vi.mock('./tabs/archivedTab.solid', async() => {
  const { useSuperTab } = await import('@components/solidJsTabs/superTabProvider.solid')
  return {
    default: () => {
      const [tab] = useSuperTab()
      tab.container.id = 'chats-archived-container'
      const el = document.createElement('div')
      el.className = 'archived-tab-stub'
      return el
    },
  }
})
// Журнал звонков — тоже заглушка: пины вкладки — `tabs/calls.solid.test.tsx`.
vi.mock('./tabs/calls.solid', () => ({
  default: () => {
    const el = document.createElement('div')
    el.className = 'calls-tab-stub'
    return el
  },
}))

const ME = { _: 'user', id: 1, first_name: 'Denis', last_name: 'Me', pFlags: {} }

let accounts: PublicAccount[] = []
const managers = new Proxy({}, {
  get: (_, ns) => new Proxy({}, {
    get: (_2, method) => {
      if(ns === 'auth' && method === 'listAccounts') return async() => accounts
      if(ns === 'peers' && method === 'fillMirror') return async() => {}
      return async() => undefined
    },
  }),
}) as unknown as Managers

let closeEverythingInside: ReturnType<typeof vi.spyOn>

type SidebarOver = { isCollapsed?: () => boolean }

/** Класс колонки со шпионом «закрыть всё». */
function makeSidebar(over: SidebarOver = {}): AppSidebarLeft {
  const { sidebar } = testSlider
  if(over.isCollapsed) vi.spyOn(sidebar, 'isCollapsed').mockImplementation(over.isCollapsed)
  closeEverythingInside = vi.spyOn(sidebar, 'closeEverythingInside')
  return sidebar
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const rootMenu = () => document.body.querySelector<HTMLElement>(':scope > .btn-menu:not(.btn-menu-submenu)')
const submenu = () => document.body.querySelector<HTMLElement>(':scope > .btn-menu.btn-menu-submenu')
// подпись пункта; у триггера подменю — без глифа шеврона (`.submenu-label-text`)
const label = (el: HTMLElement) =>
  (el.querySelector('.submenu-label-text') ?? el.querySelector('.btn-menu-item-text')!).textContent
const itemTexts = (menu: HTMLElement) =>
  [...menu.querySelectorAll<HTMLElement>(':scope > .btn-menu-item')].map(label)
const item = (menu: HTMLElement, text: string) =>
  [...menu.querySelectorAll<HTMLElement>(':scope > .btn-menu-item')].find((el) => label(el) === text)!

let column: HTMLElement
let testSlider: InstalledSidebarLeft

beforeEach(async() => {
  await applyLang('en')
  env.call = true
  env.pip = false
  accounts = [{ id: 1, name: 'Denis Me', photoId: 0, phone: '' }]
  useChatsStore.setState({ me: { user: ME } } as never)
  testSlider = installSidebarLeft(managers, undefined, { full: true })
  column = testSlider.column
})

afterEach(async() => {
  contextMenuController.close()
  await pause(320) // уборка ButtonMenuToggle (300 мс)
  testSlider.destroy()
  useChatsStore.setState({ me: null, dialogs: [], dialogIndexById: {} })
  switchTheme.mockClear()
  usePwaStore.setState({ canInstall: false })
  useFoldersSidebarShown()[1](false)
  useIsLeftSearchActive()[1](false)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

async function openMenu(sidebar = makeSidebar()) {
  const trigger = document.createElement('div')
  document.body.append(trigger)
  sidebar.createToolsMenu(trigger)
  trigger.click()
  await vi.waitFor(() => expect(rootMenu()?.classList.contains('active')).toBe(true))
  return { menu: rootMenu()!, sidebar, trigger }
}

async function openMore(menu: HTMLElement) {
  item(menu, 'More').dispatchEvent(new MouseEvent('mouseenter'))
  await vi.waitFor(() => expect(submenu()?.classList.contains('active')).toBe(true))
  return submenu()!
}

describe('createToolsMenu — состав по verify tweb', () => {
  it('один аккаунт, колонка развёрнута: ровно пункты tweb в его порядке, лишних нет', async() => {
    const { menu } = await openMenu()

    expect(itemTexts(menu)).toEqual([
      'Denis Me', 'Add Account', 'Saved Messages', 'Contacts', 'Calls', 'Settings', 'More',
    ])
    // разделители — перед «Избранным» и «Настройками» (tweb :705, :739)
    const hrBefore = (text: string) => item(menu, text).previousElementSibling?.tagName
    expect(hrBefore('Saved Messages')).toBe('HR')
    expect(hrBefore('Settings')).toBe('HR')
    // направление и пустая иконка триггера (`noIcon`) — tweb :772-778
    expect(menu.classList.contains('bottom-right')).toBe(true)
  })

  it('«Мои истории» скрыты (О-82); «Архив» — только когда в зеркале есть архивные диалоги (расхождение 4 бургера)', async() => {
    const { menu } = await openMenu()

    expect(itemTexts(menu)).not.toContain('My Stories')
    expect(itemTexts(menu)).not.toContain('Archived Chats')
  })

  it('«Архив» — после «Избранного» (tweb :736), с бейджем `archived-count`; клик открывает AppArchivedTab после closeEverythingInside', async() => {
    useChatsStore.getState().applyDialogOps([{ op: 'reset', items: [{ dialog: makeDialog({ peerId: 2, archived: true }), index: 1 }] }])
    const { menu } = await openMenu()

    expect(itemTexts(menu)).toEqual([
      'Denis Me', 'Add Account', 'Saved Messages', 'Archived Chats', 'Contacts', 'Calls', 'Settings', 'More',
    ])
    const archive = item(menu, 'Archived Chats')
    expect(archive.querySelector('.badge.badge-24.badge-gray.archived-count')).not.toBeNull()

    archive.click()
    await vi.waitFor(() => expect(column.querySelector('#chats-archived-container .archived-tab-stub')).not.toBeNull())
    expect(closeEverythingInside).toHaveBeenCalledTimes(1)
    expect(testSlider.slider.hasTabsInNavigation()).toBe(true)
  })

  it('«Создать» — только у свёрнутой колонки (дублирует скрытый FAB, tweb :700)', async() => {
    const { menu } = await openMenu(makeSidebar({ isCollapsed: () => true }))

    expect(itemTexts(menu).slice(0, 4)).toEqual(['Denis Me', 'Add Account', 'Create a New', 'Saved Messages'])
  })

  it('«Создать → Группа» — флоу «Новой группы» в колоночном слайдере после closeEverythingInside (tweb :1074-1078)', async() => {
    // пустая книга контактов рисует стикер-заглушку выбора — воркера lottie в happy-dom нет
    vi.spyOn(lottieLoader, 'loadAnimationAsAsset').mockResolvedValue({} as LottiePlayer)
    vi.spyOn(lottieLoader, 'waitForFirstFrame').mockResolvedValue(undefined as never)
    const { menu } = await openMenu(makeSidebar({ isCollapsed: () => true }))
    item(menu, 'Create a New').dispatchEvent(new MouseEvent('mouseenter'))
    await vi.waitFor(() => expect(submenu()?.classList.contains('active')).toBe(true))

    item(submenu()!, 'Group').click()
    await vi.waitFor(() => expect(column.querySelector('.add-members-container')).not.toBeNull(), { timeout: 5000 }) // чанк вкладки и селектор — долгий путь под нагрузкой хоста

    expect(closeEverythingInside).toHaveBeenCalledTimes(1)
    expect(testSlider.slider.hasTabsInNavigation()).toBe(true)
  })

  it('«Звонки» — только при поддержке звонков (IS_CALL_SUPPORTED, Отступление В7-6)', async() => {
    env.call = false
    const { menu } = await openMenu()

    expect(itemTexts(menu)).not.toContain('Calls')
  })

  it('«Добавить аккаунт» скрыт на лимите MAX_ACCOUNTS; другой аккаунт — строкой с аватаркой', async() => {
    accounts = [
      { id: 1, name: 'Denis Me', photoId: 0, phone: '' },
      { id: 2, name: 'Second', photoId: 0, phone: '' },
      { id: 3, name: 'Third', photoId: 0, phone: '' },
      { id: 4, name: 'A very long account name here', photoId: 0, phone: '' },
    ]
    const { menu } = await openMenu()

    expect(itemTexts(menu).slice(0, 5)).toEqual(['Denis Me', 'Second', 'Third', 'A very long acc...', 'Saved Messages'])
    const active = item(menu, 'Denis Me').querySelector('.btn-menu-item-avatar')!
    expect(active.classList.contains('active')).toBe(true)
    const other = item(menu, 'Second')
    expect(other.classList.contains('btn-menu-account-item')).toBe(true)
    expect(other.querySelector('.avatar.avatar-24.btn-menu-item-icon.is-external.btn-menu-item-avatar')).not.toBeNull()
    expect(other.querySelector('.btn-menu-item-avatar')!.classList.contains('active')).toBe(false)
    // карточка другого аккаунта — из реестра (`peer`), не из зеркала этой вкладки
    expect(other.querySelector('.btn-menu-item-avatar')!.textContent).toBe('S')
  })
})

describe('createToolsMenu — клики', () => {
  it('«Настройки» открывают AppSettingsTab в колоночном слайдере после closeEverythingInside', async() => {
    const { menu } = await openMenu()

    item(menu, 'Settings').click()
    await vi.waitFor(() => expect(column.querySelector('.settings-root-stub')).not.toBeNull())

    expect(closeEverythingInside).toHaveBeenCalledTimes(1)
    expect(testSlider.slider.hasTabsInNavigation()).toBe(true)
    expect(menu.classList.contains('active')).toBe(false)
  })

  it('строка своего аккаунта — тоже настройки (tweb :838-842)', async() => {
    const { menu } = await openMenu()

    item(menu, 'Denis Me').click()
    await vi.waitFor(() => expect(column.querySelector('.settings-root-stub')).not.toBeNull())
  })

  it('«Звонки» открывают AppCallsTab в колоночном слайдере после closeEverythingInside (tweb :751-756)', async() => {
    const { menu } = await openMenu()

    item(menu, 'Calls').click()
    await vi.waitFor(() => expect(column.querySelector('.calls-tab-stub')).not.toBeNull())

    expect(closeEverythingInside).toHaveBeenCalledTimes(1)
    expect(testSlider.slider.hasTabsInNavigation()).toBe(true)
  })

  it('«Избранное» открывает свой чат (`appImManager.setPeer({peerId: myId})`)', async() => {
    const setPeer = vi.spyOn(appImManager, 'setPeer').mockResolvedValue(undefined)
    const saved = vi.fn(async() => 77)
    const own = { auth: managers.auth, peers: managers.peers, chats: { saved }, dialogs: { refresh: async() => null } } as unknown as Managers
    ;(testSlider.sidebar as unknown as { managers: Managers }).managers = own
    const { menu } = await openMenu()
    item(menu, 'Saved Messages').click()

    await vi.waitFor(() => expect(setPeer).toHaveBeenCalledWith({ peerId: 77 }))
    expect(saved).toHaveBeenCalledTimes(1)
  })
})

describe('createMoreSubmenu — «Ещё»', () => {
  it('по наведению: ночной режим, анимации, Telegram Features, сообщить об ошибке + футер-версия', async() => {
    const { menu } = await openMenu()
    const more = await openMore(menu)

    expect(more.classList.contains('sidebar-tools-submenu')).toBe(true)
    expect(itemTexts(more)).toEqual(['Enable Dark Mode', 'Disable Animations', 'Telegram Features', 'Report Bug'])
    expect(item(more, 'Disable Animations').querySelector('.tgico')!.classList.contains('animations-icon-off')).toBe(true)
    expect(item(more, 'Telegram Features').previousElementSibling?.tagName).toBe('HR')
    expect(more.lastElementChild!.matches('a.btn-menu-footer')).toBe(true)
    expect(more.querySelector('.btn-menu-footer-text')!.textContent).toMatch(/^Telegram Web /)
  })

  it('энергосбережение включено: вместо тумблера анимаций — «Power Saving» (liteMode.isEnabled)', async() => {
    const prev = useSettingsStore.getState().liteMode
    useSettingsStore.setState({ liteMode: { ...prev, all: true } })
    try {
      const { menu } = await openMenu()
      const more = await openMore(menu)
      expect(itemTexts(more)).toEqual(['Enable Dark Mode', 'Power Saving', 'Telegram Features', 'Report Bug'])
    } finally {
      useSettingsStore.setState({ liteMode: prev })
    }
  })

  it('PWA — по своему verify; PiP скрыт без `#root` (Б-12)', async() => {
    usePwaStore.setState({ canInstall: true })
    env.pip = true
    const { menu } = await openMenu()
    const more = await openMore(menu)

    expect(itemTexts(more).slice(-1)).toEqual(['Install App'])
    expect(itemTexts(more)).not.toContain('Picture-in-Picture')
  })

  it('тумблер анимаций пишет liteMode.animations', async() => {
    const prev = useSettingsStore.getState().liteMode
    try {
      const { menu } = await openMenu()
      const more = await openMore(menu)
      item(more, 'Disable Animations').click()
      expect(useSettingsStore.getState().liteMode.animations).toBe(true)
    } finally {
      useSettingsStore.setState({ liteMode: prev })
    }
  })

  it('ночной режим: тема переключается из центра иконки, меню закрывается', async() => {
    const { menu } = await openMenu(makeSidebar())
    const more = await openMore(menu)

    item(more, 'Enable Dark Mode').click()
    expect(switchTheme).toHaveBeenCalledTimes(1)
    expect(switchTheme).toHaveBeenCalledWith({ x: expect.any(Number), y: expect.any(Number) })
    await vi.waitFor(() => expect(contextMenuController.isOpened()).toBe(false))
  })
})

describe('construct — кнопка бургера в шапке (tweb :165-172, :244, :431-442)', () => {
  // синглтон вечен (К-2): `construct` — один раз на прогон, как в приложении
  let constructed = false
  function mountHeader() {
    const sidebar = makeSidebar()
    if(!constructed) sidebar.construct(managers, { xd: undefined } as unknown as AppDialogsManager)
    constructed = true
    const container = column.querySelector<HTMLElement>('.left-sidebar-burger')!
    const icon = container.querySelector<HTMLElement>('.animated-menu-icon')!
    const back = container.querySelector<HTMLElement>('.sidebar-back-button')!
    return { container, icon, back }
  }

  it('кнопка меню встаёт перед «назад», с бейджем уведомлений других аккаунтов', () => {
    const { container, back } = mountHeader()
    const tools = container.querySelector<HTMLElement>('.sidebar-tools-button')!

    expect(tools.nextElementSibling).toBe(back)
    expect(tools.classList.contains('btn-menu-toggle')).toBe(true)
    expect(tools.getAttribute('aria-label')).toBe('More')
    expect(back.getAttribute('aria-label')).toBe('Back')
    expect(tools.querySelector('.badge.badge-20.badge-primary.sidebar-tools-button-notifications.is-badge-empty')).not.toBeNull()
  })

  it('морф ≡ ↔ ←: поиск или показанная колонка папок — стрелка, иначе меню', () => {
    const { container, icon, back } = mountHeader()
    const tools = container.querySelector<HTMLElement>('.sidebar-tools-button')!
    expect(tools.classList.contains('is-visible')).toBe(true)
    expect(back.classList.contains('is-visible')).toBe(false)
    expect(icon.classList.contains('state-back')).toBe(false)

    useIsLeftSearchActive()[1](true)
    expect(tools.classList.contains('is-visible')).toBe(false)
    expect(back.classList.contains('is-visible')).toBe(true)
    expect(icon.classList.contains('state-back')).toBe(true)

    useIsLeftSearchActive()[1](false)
    useFoldersSidebarShown()[1](true)
    expect(icon.classList.contains('state-back')).toBe(true)
    expect(back.classList.contains('is-visible')).toBe(true)
  })
})
