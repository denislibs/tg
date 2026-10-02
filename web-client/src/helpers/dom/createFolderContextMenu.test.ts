// Пины контекстного меню папки (`helpers/dom/createFolderContextMenu.ts`, порт
// tweb `src/helpers/dom/createFolderContextMenu.ts`) на горизонтальном ряду
// владельца папок (`lib/appDialogsManager.ts`, у tweb — `:814-821`,
// `listenTo: folders.menu`, `className: 'menu-horizontal-div-item'`). Та же
// фабрика на вертикальной колонке — `components/folders/FoldersSidebar.test.tsx`.
//
// Главный пин — `verify` (`:41`, `:50`, `:65`): пункт, который его не прошёл,
// НЕ СОЗДАН (его нет в DOM меню), а не скрыт/задизейблен. Папка — из
// `target.dataset.filterId` (`:69-71`). Ряд, полоса и проекция папок —
// настоящие (обвязка `lib/appDialogsManager.testkit.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, installFrames, mountOwner, putFolders, raw, resetStores, settle, tabEls,
  uninstallFrames, type Mounted,
} from '@lib/appDialogsManager.testkit'
import { resetPeerMirror } from '@core/peerCache'
import { useAppStateStore } from '@stores/appState'
import contextMenuController from '@helpers/contextMenuController'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import type { AppSidebarLeft } from '@components/sidebarLeft'
import { AppChatFoldersTab, AppEditFolderTab } from '@components/solidJsTabs/tabs'

let mounted: Mounted | undefined

beforeEach(() => {
  resetStores()
  resetPeerMirror()
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной — её держит другой файл прогона').toBe(true)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  contextMenuController.close()
  mounted?.manager.destroy()
  mounted = undefined
  uninstallFrames()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  resetStores()
  resetPeerMirror()
})

const tabOf = (host: HTMLElement, filterId: number) =>
  tabEls(host).find((el) => el.dataset.filterId === '' + filterId)!

/** Правый клик по вкладке → открытое меню (закрытое живёт в DOM ещё 300 мс, поэтому — `.active`). */
async function openOn(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await settle()
  return document.querySelector<HTMLElement>('.btn-menu.contextmenu.active')
}

const itemTexts = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll('.btn-menu-item .btn-menu-item-text') ?? []).map((el) => el.textContent)

function clickItem(menu: HTMLElement, text: string) {
  const item = Array.from(menu.querySelectorAll<HTMLElement>('.btn-menu-item'))
    .find((el) => el.querySelector('.btn-menu-item-text')!.textContent === text)!
  item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

/**
 * Вкладки колонки — дублёр открытия: меню проверяют по тому, ЧТО оно открывает
 * (класс вкладки и её нагрузку), содержимое вкладок — их собственные пины.
 */
function spyColumn(sidebar: AppSidebarLeft) {
  const open = vi.fn(async (..._args: unknown[]) => {})
  const closeTabsBefore = vi.spyOn(sidebar, 'closeTabsBefore').mockImplementation(async (clb) => clb())
  const createTab = vi.spyOn(sidebar, 'createTab').mockImplementation((() => ({ open })) as never)
  return { open, closeTabsBefore, createTab }
}

async function mountWithFolders() {
  putFolders(raw(3, 1, 'Работа'), raw(5, 2, 'Учёба'))
  mounted = mountOwner()
  await settle()
  return mounted
}

describe('createFolderContextMenu на ряду владельца: пункты по verify', () => {
  it('папка — «Edit folder» и «Delete» (danger), без «Edit folders»; вкладка отмечена menu-open', async () => {
    const { host } = await mountWithFolders()
    const tab = tabOf(host, 3)
    const menu = await openOn(tab)

    expect(menu).not.toBeNull()
    expect(itemTexts(menu)).toEqual(['Edit folder', 'Delete'])
    // не прошедший verify пункт НЕ СОЗДАН — ни скрытого, ни отключённого
    expect(menu!.querySelectorAll('.btn-menu-item').length).toBe(2)
    expect(menu!.querySelectorAll('.btn-menu-item.danger').length).toBe(1)
    expect(tab.classList.contains('menu-open')).toBe(true)
  })

  it('«Все чаты» — только «Edit folders»', async () => {
    const { host } = await mountWithFolders()
    const menu = await openOn(tabOf(host, 0))

    expect(itemTexts(menu)).toEqual(['Edit folders'])
    expect(menu!.querySelectorAll('.btn-menu-item').length).toBe(1)
  })
})

describe('createFolderContextMenu на ряду владельца: действия', () => {
  it('«Edit folder» закрывает вкладки колонки и открывает редактор ЭТОЙ папки (data-filter-id)', async () => {
    const { host, sidebar } = await mountWithFolders()
    const { closeTabsBefore, open, createTab } = spyColumn(sidebar)
    clickItem((await openOn(tabOf(host, 5)))!, 'Edit folder')
    await settle()

    // tweb `createFolderContextMenu.ts:28-30`: `closeTabsBefore` → `createTab(AppEditFolderTab).open({initFilter})`
    expect(closeTabsBefore).toHaveBeenCalledTimes(1)
    expect(createTab).toHaveBeenCalledTimes(1)
    expect(createTab.mock.calls[0][0]).toBe(AppEditFolderTab)
    expect(open.mock.calls[0][0]).toMatchObject({ initFilter: { id: 5, title: 'Учёба' } })
  })

  it('«Edit folders» на «Все чаты» открывает список папок', async () => {
    const { host, sidebar } = await mountWithFolders()
    const { closeTabsBefore, createTab } = spyColumn(sidebar)
    clickItem((await openOn(tabOf(host, 0)))!, 'Edit folders')
    await settle()

    expect(closeTabsBefore).toHaveBeenCalledTimes(1)
    expect(createTab).toHaveBeenCalledTimes(1)
    expect(createTab.mock.calls[0][0]).toBe(AppChatFoldersTab)
  })

  it('«Delete» — подтверждение, затем удаление папки из data-filter-id; её вкладка уходит из ряда', async () => {
    const { host, hooks } = await mountWithFolders()
    clickItem((await openOn(tabOf(host, 3)))!, 'Delete')
    await settle()

    // tweb `editFolderShared.ts:25-32`: confirmationPopup «Remove Folder»
    const popup = document.querySelector<HTMLElement>('.popup-confirmation')!
    expect(popup).not.toBeNull()
    expect(popup.querySelector('.popup-title')?.textContent).toBe('Remove Folder')
    expect(hooks.managers.folders.del).not.toHaveBeenCalled()

    popup.querySelector<HTMLElement>('.popup-button.danger')!
      .dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()

    expect(hooks.managers.folders.del).toHaveBeenCalledWith(3)
    // `updateDialogFilter(…, true)` → `onUpdateDialogFilter` без фильтра — ПОСЛЕ ответа
    expect(useAppStateStore.getState().folders.map((f) => f.id)).toEqual([5])
    await settle()
    expect(tabEls(host).map((el) => el.dataset.filterId)).toEqual(['0', '5'])
  })

  it('отмена подтверждения — папка на месте, запроса нет', async () => {
    const { host, hooks } = await mountWithFolders()
    clickItem((await openOn(tabOf(host, 3)))!, 'Delete')
    await settle()

    const buttons = document.querySelectorAll<HTMLElement>('.popup-confirmation .popup-button')
    buttons[buttons.length - 1].dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()

    expect(hooks.managers.folders.del).not.toHaveBeenCalled()
    expect(useAppStateStore.getState().folders.map((f) => f.id)).toEqual([3, 5])
  })
})

describe('createFolderContextMenu на ряду владельца: владение', () => {
  it('destroy() владельца снимает меню с ряда (DoD 5)', async () => {
    const { host, manager } = await mountWithFolders()
    const tab = tabOf(host, 3)
    manager.destroy()
    mounted = undefined

    expect(await openOn(tab)).toBeNull()
  })
})
