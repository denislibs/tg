// Колонка папок зеркалит градиент обоев в свой холст — порт tweb
// foldersSidebarContent/index.tsx:94-116 (`renderer.attachMirror(backgroundCanvas)`).
// Без зеркала колонка безусловно уходила в дорогую ветку
// `backdrop-filter: blur(40px)`: у нас она стояла в SCSS статикой, поэтому
// «нет зеркала» не отличалось от «есть».
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import FoldersSidebar, { type MainMenuHandlers } from './FoldersSidebar'
import contextMenuController from '../../helpers/contextMenuController'
import { CLICK_EVENT_NAME } from '../../helpers/dom/clickEvent'
import { applyFolderUpdate } from '../../stores/foldersStore'
import { useAppStateStore } from '../../stores/appState'
import { initialState } from '../../core/state/state'
import type { Folder, RawFolder } from '../../core/managers/foldersManager'
import { setActiveGradientRenderer } from '../../core/chat/activeGradient'
import type ChatBackgroundGradientRenderer from '../../core/chat/gradientRenderer'
import s from './FoldersSidebar.module.scss'

// Главное меню тянет менеджеры воркера (useManagers) — к зеркалу градиента
// отношения не имеет, подменяем заглушкой.
vi.mock('../MainMenu', () => ({ default: () => null }))

const menu: MainMenuHandlers = {
  onOpenSettings: () => {},
  onOpenContacts: () => {},
  onOpenSaved: () => {},
  onOpenPremium: () => {},
}

function makeAppSidebarLeft() {
  return {
    closeTabsBefore: vi.fn((clb: () => void) => clb()),
    openEditFolderTab: vi.fn(),
    openChatFoldersTab: vi.fn(),
  }
}

function makeManagers() {
  return { folders: { del: vi.fn(async (_id: number) => {}) } }
}

function renderSidebar(folders: Folder[] = []) {
  const host = document.createElement('div')
  host.id = 'main-columns'
  document.body.append(host)
  const appSidebarLeft = makeAppSidebarLeft()
  const managers = makeManagers()
  const r = render(
    <FoldersSidebar
      folders={folders}
      appSidebarLeft={appSidebarLeft}
      managers={managers}
      onOpenFolderSettings={() => {}}
      menu={menu}
    />,
  )
  return { host, appSidebarLeft, managers, ...r }
}

afterEach(() => {
  contextMenuController.close()
  act(() => setActiveGradientRenderer(undefined))
  cleanup()
  document.body.replaceChildren()
  useAppStateStore.setState(initialState(), true)
})

describe('FoldersSidebar — зеркало градиента обоев', () => {
  it('активные обои с градиентом → холст колонки цепляется зеркалом', () => {
    const detach = vi.fn()
    const attachMirror = vi.fn(() => detach)
    act(() => setActiveGradientRenderer(
      { attachMirror } as unknown as ChatBackgroundGradientRenderer,
      { isDarkMaskPattern: false },
    ))

    const { host } = renderSidebar()

    const canvas = host.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(attachMirror).toHaveBeenCalledWith(canvas)
    // Зеркало есть — ветка --no-gradient (backdrop-filter) выключена.
    expect(host.querySelector(`.${s.backgroundNoGradient}`)).toBeNull()
  })

  it('обои без градиента (картинка/цвет) — падаем обратно на backdrop-filter', () => {
    act(() => setActiveGradientRenderer(undefined))
    const { host } = renderSidebar()

    expect(host.querySelector(`.${s.backgroundNoGradient}`)).not.toBeNull()
  })

  it('смена обоев отцепляет прошлое зеркало и цепляет новое; тёмный узор дотемняет тинт', () => {
    const detach = vi.fn()
    const first = { attachMirror: vi.fn(() => detach) } as unknown as ChatBackgroundGradientRenderer
    act(() => setActiveGradientRenderer(first, { isDarkMaskPattern: false }))
    const { host } = renderSidebar()

    const second = { attachMirror: vi.fn(() => vi.fn()) } as unknown as ChatBackgroundGradientRenderer
    act(() => setActiveGradientRenderer(second, { isDarkMaskPattern: true }))

    expect(detach).toHaveBeenCalledTimes(1)
    expect(second.attachMirror).toHaveBeenCalledWith(host.querySelector('canvas'))
    expect(host.querySelector(`.${s.backgroundDarkPattern}`)).not.toBeNull()
  })
})

// Меню папки у колонки — ТА ЖЕ фабрика `createFolderContextMenu`, что у ряда
// владельца (tweb `foldersSidebarContent/index.tsx:84-92`: `className:
// 'folders-sidebar__folder-item'`, `listenTo` — контейнер строк). Пины ряда —
// `helpers/dom/createFolderContextMenu.test.ts`; здесь — что колонка на неё
// посажена: `data-filter-id` на строках, меню портированной разметки.
const raw = (id: number, pos: number, title: string): RawFolder => ({
  id, title, pos,
  contacts: false, non_contacts: false, groups: false, broadcasts: false, bots: false,
  exclude_muted: false, exclude_read: false, include_peers: [], exclude_peers: [],
})

const settle = async () => {
  for(let i = 0; i < 4; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function openOn(el: Element) {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await settle()
  return document.querySelector<HTMLElement>('.btn-menu.contextmenu.active')
}

const itemTexts = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll('.btn-menu-item .btn-menu-item-text') ?? []).map((el) => el.textContent)

function clickItem(menu: HTMLElement, text: string) {
  Array.from(menu.querySelectorAll<HTMLElement>('.btn-menu-item'))
    .find((el) => el.querySelector('.btn-menu-item-text')!.textContent === text)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('FoldersSidebar — меню папки (createFolderContextMenu)', () => {
  function renderWithFolders() {
    applyFolderUpdate({ folder: raw(3, 1, 'Работа') })
    applyFolderUpdate({ folder: raw(5, 2, 'Учёба') })
    const r = renderSidebar(useAppStateStore.getState().folders)
    const row = (filterId: number) =>
      r.host.querySelector(`.folders-sidebar__folder-item[data-filter-id="${filterId}"]`)!
    return { ...r, row }
  }

  it('строки несут data-filter-id; на папке — «Edit folder» и «Delete», на «Все чаты» — «Edit folders»', async () => {
    const { host, row } = renderWithFolders()
    expect(Array.from(host.querySelectorAll<HTMLElement>('.folders-sidebar__folder-item'))
      .map((el) => el.dataset.filterId)).toEqual(['0', '3', '5'])

    const menu = await openOn(row(3))
    expect(itemTexts(menu)).toEqual(['Edit folder', 'Delete'])
    expect(menu!.querySelectorAll('.btn-menu-item').length).toBe(2)
    contextMenuController.close()
    await settle()

    expect(itemTexts(await openOn(row(0)))).toEqual(['Edit folders'])
  })

  it('«Edit folder» открывает редактор папки строки; «Delete» после подтверждения удаляет её', async () => {
    const { row, appSidebarLeft, managers } = renderWithFolders()
    clickItem((await openOn(row(5)))!, 'Edit folder')
    await settle()
    expect(appSidebarLeft.openEditFolderTab.mock.calls[0][0]).toMatchObject({ id: 5 })

    clickItem((await openOn(row(3)))!, 'Delete')
    await settle()
    document.querySelector<HTMLElement>('.popup-confirmation .popup-button.danger')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()
    expect(managers.folders.del).toHaveBeenCalledWith(3)
  })

  it('размонтирование колонки снимает меню', async () => {
    const { row, unmount } = renderWithFolders()
    const el = row(3)
    unmount()
    expect(await openOn(el)).toBeNull()
  })
})
