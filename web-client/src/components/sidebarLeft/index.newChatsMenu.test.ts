// Кнопка «новый чат» `#new-menu` — порт tweb `sidebarLeft/index.ts:198-200`,
// `:1065-1135` (`createNewChatsMenuOptions`/`createNewChatsMenuButton`/
// `createNewChatsSubmenu`), методы класса `AppSidebarLeft`. Пины — на то, что
// видит пользователь: место и разметка кнопки, меню вверх-влево, состав пунктов
// по флагам, что открывает клик, скрытие при поиске и при открытой вкладке.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import contextMenuController from '@helpers/contextMenuController'
import { AppContactsTab, AppNewChannelTab } from '@components/solidJsTabs/tabs'
import { useIsLeftSearchActive } from '@stores/foldersSidebar.solid'
import type { Managers } from '@/client/bootstrap'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'
import { applyLang } from '@/test/lang'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import type { AppDialogsManager } from '@lib/appDialogsManager'

const flags = vi.hoisted(() => ({ secret: false }))
vi.mock('@/config/app', async(importOriginal) => {
  const original = await importOriginal<typeof import('@/config/app')>()
  return { ...original, get SECRET_CHATS_ENABLED() { return flags.secret } }
})

// Содержимое вкладки контактов — заглушка: её пины — в тестах самой вкладки.
vi.mock('./tabs/contacts.solid', () => ({
  default: () => {
    const el = document.createElement('div')
    el.className = 'contacts-stub'
    return el
  },
}))

const managers = new Proxy({}, {
  get: () => new Proxy({}, { get: () => async() => undefined }),
}) as unknown as Managers

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const rootMenu = () => document.body.querySelector<HTMLElement>(':scope > .btn-menu')
const itemTexts = (menu: HTMLElement) =>
  [...menu.querySelectorAll<HTMLElement>(':scope > .btn-menu-item .btn-menu-item-text')].map((el) => el.textContent)
const item = (menu: HTMLElement, text: string) =>
  [...menu.querySelectorAll<HTMLElement>(':scope > .btn-menu-item')]
    .find((el) => el.querySelector('.btn-menu-item-text')!.textContent === text)!

let installed: InstalledSidebarLeft
let closeEverythingInside: ReturnType<typeof vi.spyOn>

const topTab = () => {
  const history = installed.sidebar.getHistory()
  return history[history.length - 1]
}

beforeEach(async() => {
  await applyLang('en')
  flags.secret = false
  installed = installSidebarLeft(managers, undefined, { full: true })
  closeEverythingInside = vi.spyOn(installed.sidebar, 'closeEverythingInside')
})

afterEach(async() => {
  contextMenuController.close()
  await pause(320) // уборка ButtonMenuToggle (300 мс)
  installed.destroy()
  useIsLeftSearchActive()[1](false)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

// синглтон вечен (К-2): `construct` — один раз на прогон, как в приложении
let constructed = false
function construct() {
  if(!constructed) installed.sidebar.construct(managers, { xd: undefined } as unknown as AppDialogsManager)
  constructed = true
  return installed.column.querySelector<HTMLElement>('#new-menu')!
}

async function openMenu() {
  const btn = construct()
  btn.click()
  await vi.waitFor(() => expect(rootMenu()?.classList.contains('active')).toBe(true))
  return { btn, menu: rootMenu()! }
}

/** Подменю «Создать» бургера: тот же набор, `createNewChatsMenuOptions(true, true)`. */
async function openSubmenu() {
  const menu = await (installed.sidebar as unknown as { createNewChatsSubmenu(): Promise<HTMLElement> }).createNewChatsSubmenu()
  // открытое подменю — `.active` (его ставит `attachFloatingButtonMenu`); пункт неактивного меню клик игнорирует
  menu.classList.add('active')
  document.body.append(menu)
  return menu
}

describe('construct — кнопка #new-menu (:198-200, :1113-1129)', () => {
  it('последний ребёнок .sidebar-content вкладки №0; разметка, роль, иконки морфа ✎ ↔ ✕, подпись', () => {
    const btn = construct()

    expect(btn.parentElement).toBe(installed.header.nextElementSibling)
    expect(btn.parentElement!.lastElementChild).toBe(btn)
    expect(btn.className).toBe('btn-new-menu btn-circle rp btn-corner z-depth-1 btn-menu-toggle animated-button-icon')
    expect(btn.getAttribute('role')).toBe('button')
    expect(btn.tabIndex).toBe(0)
    expect(btn.getAttribute('aria-label')).toBe('New Chats')
    expect([...btn.querySelectorAll(':scope > .tgico')].map((el) => el.className)).toEqual([
      'tgico animated-button-icon-icon animated-button-icon-icon-first',
      'tgico animated-button-icon-icon animated-button-icon-icon-last',
    ])
  })

  it('меню открывается вверх-влево (`top-left`), триггер получает menu-open', async() => {
    const { btn, menu } = await openMenu()

    expect(menu.classList.contains('top-left')).toBe(true)
    expect(btn.classList.contains('menu-open')).toBe(true)
  })

  it('пунктов 3 — канал, группа, личный чат; ни секретного, ни конференции (О-1)', async() => {
    const { menu } = await openMenu()

    expect(itemTexts(menu)).toEqual(['New Channel', 'New Group', 'New Private Chat'])
  })

  it('+1 «New Secret Chat» под SECRET_CHATS_ENABLED (Отступление В7-1)', async() => {
    flags.secret = true
    const { menu } = await openMenu()

    expect(itemTexts(menu)).toEqual(['New Channel', 'New Group', 'New Private Chat', 'New Secret Chat'])
  })

  it('«New Channel» — AppNewChannelTab без closeEverythingInside (closeBefore=false)', async() => {
    const { menu } = await openMenu()
    item(menu, 'New Channel').click()

    await vi.waitFor(() => expect(topTab()).toBeInstanceOf(AppNewChannelTab), { timeout: 3000 })
    expect(closeEverythingInside).not.toHaveBeenCalled()
  })

  it('«New Group» — выбор участников createNewGroupTab', async() => {
    // пустая книга контактов рисует стикер-заглушку — воркера lottie в happy-dom нет
    vi.spyOn(lottieLoader, 'loadAnimationAsAsset').mockResolvedValue({} as LottiePlayer)
    vi.spyOn(lottieLoader, 'waitForFirstFrame').mockResolvedValue(undefined as never)
    const { menu } = await openMenu()
    item(menu, 'New Group').click()

    await vi.waitFor(() => expect(installed.column.querySelector('.add-members-container')).not.toBeNull(), { timeout: 5000 })
    expect(closeEverythingInside).not.toHaveBeenCalled()
  })

  it('«New Private Chat» — вкладка контактов без {secret}', async() => {
    const { menu } = await openMenu()
    item(menu, 'New Private Chat').click()

    await vi.waitFor(() => expect(topTab()).toBeInstanceOf(AppContactsTab), { timeout: 3000 })
    expect(!!((topTab() as InstanceType<typeof AppContactsTab>).payload as { secret?: boolean } | undefined)?.secret).toBe(false)
  })

  it('при открытой вкладке кнопка уезжает вместе с .item-main (своего класса у tweb нет)', async() => {
    const btn = construct()

    await installed.openTab(AppNewChannelTab)
    await pause(400)

    expect(btn.closest('.sidebar-slider-item')).toBe(installed.mainEl)
    expect(installed.mainEl.classList.contains('active')).toBe(false)
    expect(btn.classList.contains('is-hidden')).toBe(false)
  })

  it('фокус поиска — is-hidden (:1571): кнопку получает владелец поиска', async() => {
    const btn = construct()
    installed.sidebar.inputSearch.input.dispatchEvent(new FocusEvent('focus'))

    expect(btn.classList.contains('is-hidden')).toBe(true)
  })
})

describe('подменю «Создать» бургера (:1131-1135)', () => {
  it('те же пункты в единственном числе; клик — после closeEverythingInside', async() => {
    const menu = await openSubmenu()

    expect(itemTexts(menu)).toEqual(['Channel', 'Group', 'Private Chat'])
    item(menu, 'Channel').click()
    expect(closeEverythingInside).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(topTab()).toBeInstanceOf(AppNewChannelTab), { timeout: 3000 })
  })

  it('секретный чат и в подменю — только под флагом (ButtonMenu verify не фильтрует)', async() => {
    flags.secret = true
    const menu = await openSubmenu()

    expect(itemTexts(menu)).toEqual(['Channel', 'Group', 'Private Chat', 'New Secret Chat'])
  })
})
