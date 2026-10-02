// Бургер-меню левой колонки — порт tweb `sidebarLeft/index.ts:673-905`
// (`createToolsMenu`) и `:916-1064` (`createMoreSubmenu`), шапка `toolsMenu.ts`.
// Пины — на то, что видит пользователь: состав и порядок пунктов ровно по
// `verify` оригинала (ничего сверх: ни «Близких друзей», ни «Кошелька», ни
// «Telegram Premium», ни «Выйти»), что открывает клик, подменю «Ещё» и морф
// кнопки бургера ≡ ↔ ←.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import contextMenuController from '@helpers/contextMenuController'
import { useChatsStore } from '@stores/chatsStore'
import { useFoldersSidebarShown, useIsLeftSearchActive } from '@stores/foldersSidebar.solid'
import { useSettingsStore } from '@/settings'
import { usePwaStore } from '@core/pwa'
import type { Managers } from '@/client/bootstrap'
import type { PublicAccount } from '@core/auth/accounts'
import { mountTestColumnSlider, type TestColumnSlider } from '@/test/columnSlider'
import { applyLang } from '@/test/lang'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import { createToolsMenu, mountSidebarToolsButton, type ToolsMenuSidebar } from './toolsMenu'

const env = vi.hoisted(() => ({ call: true, pip: false }))
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

function makeSidebar(over: Partial<ToolsMenuSidebar> = {}): ToolsMenuSidebar {
  return {
    managers,
    closeTabsBefore: vi.fn((clb: () => void) => clb()),
    isCollapsed: () => false,
    openArchiveTab: vi.fn(),
    hasArchivedDialogs: () => false,
    getArchivedUnreadCount: () => 0,
    openSavedMessages: vi.fn(),
    openMyStories: vi.fn(),
    openCalls: vi.fn(),
    switchTheme: vi.fn(),
    ...over,
  }
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
let testSlider: TestColumnSlider

beforeEach(async() => {
  await applyLang('en')
  env.call = true
  env.pip = false
  accounts = [{ id: 1, name: 'Denis Me', photoId: 0, phone: '' }]
  useChatsStore.setState({ me: { user: ME } } as never)
  column = document.createElement('div')
  column.id = 'column-left'
  document.body.append(column)
  testSlider = mountTestColumnSlider(column, managers)
})

afterEach(async() => {
  contextMenuController.close()
  await pause(320) // уборка ButtonMenuToggle (300 мс)
  testSlider.destroy()
  useChatsStore.setState({ me: null })
  usePwaStore.setState({ canInstall: false })
  useFoldersSidebarShown()[1](false)
  useIsLeftSearchActive()[1](false)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

async function openMenu(sidebar = makeSidebar()) {
  const trigger = document.createElement('div')
  document.body.append(trigger)
  createToolsMenu(sidebar, trigger)
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
      'Denis Me', 'Add Account', 'Saved Messages', 'My Stories', 'Contacts', 'Calls', 'Settings', 'More',
    ])
    // разделители — перед «Избранным» и «Настройками» (tweb :705, :739)
    const hrBefore = (text: string) => item(menu, text).previousElementSibling?.tagName
    expect(hrBefore('Saved Messages')).toBe('HR')
    expect(hrBefore('Settings')).toBe('HR')
    // направление и пустая иконка триггера (`noIcon`) — tweb :772-778
    expect(menu.classList.contains('bottom-right')).toBe(true)
  })

  it('«Архив» — только при архивных диалогах, с бейджем непрочитанного', async() => {
    const { menu } = await openMenu(makeSidebar({ hasArchivedDialogs: () => true, getArchivedUnreadCount: () => 1234 }))

    expect(itemTexts(menu)).toEqual([
      'Denis Me', 'Add Account', 'Saved Messages', 'Archived Chats', 'My Stories', 'Contacts', 'Calls', 'Settings', 'More',
    ])
    const badge = item(menu, 'Archived Chats').querySelector('.archived-count')!
    expect(badge.className).toBe('badge badge-24 badge-gray archived-count')
    expect(badge.textContent).toBe('1.2K')
  })

  it('«Создать» — только у свёрнутой колонки (дублирует скрытый FAB, tweb :700)', async() => {
    const { menu } = await openMenu(makeSidebar({ isCollapsed: () => true }))

    expect(itemTexts(menu).slice(0, 4)).toEqual(['Denis Me', 'Add Account', 'Create a New', 'Saved Messages'])
  })

  it('«Создать → Группа» — флоу «Новой группы» в колоночном слайдере после closeTabsBefore (tweb :1074-1078)', async() => {
    // пустая книга контактов рисует стикер-заглушку выбора — воркера lottie в happy-dom нет
    vi.spyOn(lottieLoader, 'loadAnimationAsAsset').mockResolvedValue({} as LottiePlayer)
    vi.spyOn(lottieLoader, 'waitForFirstFrame').mockResolvedValue(undefined as never)
    const { menu, sidebar } = await openMenu(makeSidebar({ isCollapsed: () => true }))
    item(menu, 'Create a New').dispatchEvent(new MouseEvent('mouseenter'))
    await vi.waitFor(() => expect(submenu()?.classList.contains('active')).toBe(true))

    item(submenu()!, 'Group').click()
    await vi.waitFor(() => expect(column.querySelector('.add-members-container')).not.toBeNull())

    expect(sidebar.closeTabsBefore).toHaveBeenCalledTimes(1)
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
  it('«Настройки» открывают AppSettingsTab в колоночном слайдере после closeTabsBefore', async() => {
    const { menu, sidebar } = await openMenu()

    item(menu, 'Settings').click()
    await vi.waitFor(() => expect(column.querySelector('.settings-root-stub')).not.toBeNull())

    expect(sidebar.closeTabsBefore).toHaveBeenCalledTimes(1)
    expect(testSlider.slider.hasTabsInNavigation()).toBe(true)
    expect(menu.classList.contains('active')).toBe(false)
  })

  it('строка своего аккаунта — тоже настройки (tweb :838-842)', async() => {
    const { menu } = await openMenu()

    item(menu, 'Denis Me').click()
    await vi.waitFor(() => expect(column.querySelector('.settings-root-stub')).not.toBeNull())
  })

  it('«Избранное», «Мои истории», «Звонки», «Архив» зовут мосты колонки', async() => {
    const sidebar = makeSidebar({ hasArchivedDialogs: () => true })
    for(const [text, fn] of [
      ['Saved Messages', sidebar.openSavedMessages],
      ['My Stories', sidebar.openMyStories],
      ['Calls', sidebar.openCalls],
      ['Archived Chats', sidebar.openArchiveTab],
    ] as const) {
      const { menu } = await openMenu(sidebar)
      item(menu, text).click()
      await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1))
      contextMenuController.close()
      await pause(320)
      document.body.querySelectorAll(':scope > div:not(#column-left)').forEach((el) => el.remove())
    }
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

  it('PWA и PiP — по своим verify', async() => {
    usePwaStore.setState({ canInstall: true })
    env.pip = true
    const { menu } = await openMenu()
    const more = await openMore(menu)

    expect(itemTexts(more).slice(-2)).toEqual(['Install App', 'Picture-in-Picture'])
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
    const { menu, sidebar } = await openMenu()
    const more = await openMore(menu)

    item(more, 'Enable Dark Mode').click()
    expect(sidebar.switchTheme).toHaveBeenCalledTimes(1)
    expect(sidebar.switchTheme).toHaveBeenCalledWith({ x: expect.any(Number), y: expect.any(Number) })
    await vi.waitFor(() => expect(contextMenuController.isOpened()).toBe(false))
  })
})

describe('mountSidebarToolsButton — кнопка бургера в шапке', () => {
  function mountHeader() {
    const container = document.createElement('div')
    container.className = 'sidebar-header__btn-container left-sidebar-burger'
    const icon = document.createElement('div')
    icon.className = 'animated-menu-icon'
    const back = document.createElement('div')
    back.className = 'btn-icon sidebar-back-button'
    container.append(icon, back)
    document.body.append(container)
    const destroy = mountSidebarToolsButton(makeSidebar(), container)
    return { container, icon, back, destroy }
  }

  it('кнопка меню встаёт перед «назад», с бейджем уведомлений других аккаунтов', () => {
    const { container, back } = mountHeader()
    const tools = container.querySelector<HTMLElement>('.sidebar-tools-button')!

    expect(tools.nextElementSibling).toBe(back)
    expect(tools.classList.contains('btn-menu-toggle')).toBe(true)
    expect(tools.getAttribute('aria-label')).toBe('More')
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

  it('уборка снимает кнопку и гасит морф', () => {
    const { container, icon, destroy } = mountHeader()
    destroy()

    expect(container.querySelector('.sidebar-tools-button')).toBeNull()
    useIsLeftSearchActive()[1](true)
    expect(icon.classList.contains('state-back')).toBe(false)
  })
})
