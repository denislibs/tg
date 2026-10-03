/** @jsxImportSource solid-js */
// Вертикальная колонка папок — порт tweb `sidebarLeft/foldersSidebarContent/index.tsx`
// (+ `folderItem.tsx`, `utils.ts`, `extractEmojiFromFilterTitle.ts`). Пины — на то,
// что видит пользователь: колонка по настройке, бургер — то же меню, что в шапке
// (`createToolsMenu(target, {top: 8, left: 48})`), строки папок с иконкой по типу
// или эмодзи названия и бейджем непрочитанного, клик — переключение владельцем,
// «добавить чаты» у пустой выбранной папки → `AppEditFolderTab`, «настройки
// папок» → `AppChatFoldersTab`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import appSidebarLeft from '@components/sidebarLeft'
import { AppChatFoldersTab, AppEditFolderTab } from '@components/solidJsTabs/tabs'
import useFolders from '@stores/folders.solid'
import { useAppStateStore } from '@stores/appState'
import { applyFolderUpdate, useFoldersStore } from '@stores/foldersStore'
import { useChatsStore } from '@stores/chatsStore'
import { useNotifyStore } from '@stores/notifyStore'
import { useSettingsStore } from '@/settings'
import { initialState } from '@core/state/state'
import { ALL_FOLDER_ID } from '@core/folderIds'
import { makeDialog } from '@core/dialogs/testDialog'
import { resetPeerMirror } from '@core/peerCache'
import { getIconContent } from '@components/icon'
import type { RawFolder } from '@core/managers/foldersManager'
import type { Dialog } from '@core/models'
import type { FolderContextMenuManagers } from '@helpers/dom/createFolderContextMenu'
import { applyLang } from '@/test/lang'
import { renderFoldersSidebarContent } from './index.solid'
import extractEmojiFromFilterTitle from './extractEmojiFromFilterTitle'

const SETTINGS = {
  private: { muted: false, preview: true },
  groups: { muted: false, preview: true },
  channels: { muted: false, preview: true },
}

const raw = (id: number, pos: number, over: Partial<RawFolder> = {}): RawFolder => ({
  id, title: `F${id}`, pos,
  contacts: false, non_contacts: true, groups: false, broadcasts: false, bots: false,
  exclude_muted: false, exclude_read: false, include_peers: [], exclude_peers: [],
  ...over,
})

const setDialogs = (dialogs: Dialog[]) => {
  useChatsStore.getState().applyDialogOps([{
    op: 'reset',
    items: dialogs.map((dialog, i) => ({ dialog, index: dialogs.length - i })),
  }])
}

const folders = useFolders()
let host: HTMLElement
let middlewareHelper: ReturnType<typeof getMiddleware>
let createToolsMenu: ReturnType<typeof vi.spyOn>

const column = () => host.querySelector<HTMLElement>('#folders-sidebar')!
const rows = () => [...column().querySelectorAll<HTMLElement>('.folders-sidebar__scrollable .folders-sidebar__folder-item')]
const row = (id: number) => column().querySelector<HTMLElement>(`.folders-sidebar__folder-item[data-filter-id="${id}"]`)!

function mount() {
  renderFoldersSidebarContent(host, () => 0, {} as FolderContextMenuManagers, middlewareHelper.get())
}

beforeEach(async() => {
  await applyLang('en')
  folders.dispose()
  useAppStateStore.setState(initialState(), true)
  useChatsStore.setState({ dialogs: [], dialogIndexById: {} })
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useNotifyStore.setState({ settings: SETTINGS })
  resetPeerMirror()
  host = document.createElement('div')
  host.id = 'main-columns-test'
  host.append(document.createElement('div'))
  document.body.append(host)
  middlewareHelper = getMiddleware()
  // `Animated` (cross-fade «добавить чаты») зовёт WAAPI — в happy-dom его нет
  Element.prototype.animate = vi.fn(() => ({ finished: Promise.resolve(), cancel() {}, onfinish: null }) as unknown as Animation)
  createToolsMenu = vi.spyOn(appSidebarLeft, 'createToolsMenu').mockImplementation((target?: HTMLElement) => target!)
})

afterEach(() => {
  middlewareHelper.destroy()
  folders.dispose()
  useSettingsStore.getState().update({ tabsInSidebar: false })
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('renderFoldersSidebarContent (:225-249)', () => {
  it('#folders-sidebar — первым ребёнком; содержимое только при «папки слева»; destroy снимает узел', () => {
    mount()
    expect(host.firstElementChild).toBe(column())
    expect(column().className).toBe('folders-sidebar sidebar-left-common')
    expect(column().childElementCount).toBe(0)

    useSettingsStore.getState().update({ tabsInSidebar: true })
    expect(column().querySelector('.folders-sidebar__background > canvas.folders-sidebar__background-gradient')).not.toBeNull()
    expect(column().querySelector('.folders-sidebar__menu-button.is-first')).not.toBeNull()
    expect(column().querySelector('.folders-sidebar__menu-button.is-last')).not.toBeNull()

    useSettingsStore.getState().update({ tabsInSidebar: false })
    expect(column().childElementCount).toBe(0)

    middlewareHelper.destroy()
    expect(host.querySelector('#folders-sidebar')).toBeNull()
  })
})

describe('FoldersSidebarContent', () => {
  beforeEach(() => {
    useSettingsStore.getState().update({ tabsInSidebar: true })
  })

  it('бургер колонки — то же меню шапки: createToolsMenu(пункт, {top: 8, left: 48}), sidebar-tools-button is-visible', () => {
    mount()
    const menuButton = column().querySelector<HTMLElement>('.folders-sidebar__menu-button.is-first')!
    expect(createToolsMenu).toHaveBeenCalledTimes(1)
    expect(createToolsMenu).toHaveBeenCalledWith(menuButton, { top: 8, left: 48 })
    expect(menuButton.classList.contains('sidebar-tools-button')).toBe(true)
    expect(menuButton.classList.contains('is-visible')).toBe(true)
    expect(menuButton.getAttribute('aria-label')).toBe('More')
    expect(menuButton.querySelector('.folders-sidebar__folder-item-icon')!.textContent).toBe(getIconContent('menu'))
  })

  it('строки: «Все чаты» и папки; иконка по типу, эмодзи из названия — иконкой; бейдж непрочитанного', () => {
    applyFolderUpdate({ folder: raw(3, 1) })
    applyFolderUpdate({ folder: raw(4, 2, { title: 'Работа 💼', non_contacts: false, groups: true }) })
    applyFolderUpdate({ folder: raw(5, 3, { contacts: true, groups: true }) })
    setDialogs([makeDialog({ peerId: 1, unread: 2 })])
    folders.hydrate()
    mount()

    expect(rows().map((el) => el.dataset.filterId)).toEqual([String(ALL_FOLDER_ID), '3', '4', '5'])
    const icon = (id: number) => row(id).querySelector('.folders-sidebar__folder-item-icon')?.textContent
    expect(icon(ALL_FOLDER_ID)).toBe(getIconContent('round_chats_filled'))
    expect(row(ALL_FOLDER_ID).querySelector('.folders-sidebar__folder-item-name')!.textContent).toBe('All Chats')
    expect(icon(3)).toBe(getIconContent('noncontacts'))
    expect(icon(5)).toBe(getIconContent('limit_folders'))
    // эмодзи в конце названия — в иконку, подпись — без него
    expect(row(4).querySelector('.folders-sidebar__folder-item-animated-icon .emoji')?.getAttribute('alt')).toBe('💼')
    expect(row(4).querySelector('.folders-sidebar__folder-item-name')!.textContent).toBe('Работа')

    const badge = (id: number) => row(id).querySelector<HTMLElement>('.folders-sidebar__folder-item-badge')
    expect(badge(3)!.className).toBe('badge badge-18 badge-primary folders-sidebar__folder-item-badge')
    // счёт — чатов с непрочитанным, а не сообщений (`stores/folders.ts:19-30`)
    expect(badge(3)!.textContent).toBe('1')
    expect(badge(4)).toBeNull()

    expect(row(ALL_FOLDER_ID).classList.contains('folders-sidebar__folder-item--selected')).toBe(true)
    useFoldersStore.setState({ selectedId: 3 })
    expect(row(3).classList.contains('folders-sidebar__folder-item--selected')).toBe(true)
    expect(row(3).getAttribute('aria-pressed')).toBe('true')
    expect(row(ALL_FOLDER_ID).classList.contains('folders-sidebar__folder-item--selected')).toBe(false)
  })

  it('клик по папке — переключение владельцем по индексу (onClick стора)', () => {
    applyFolderUpdate({ folder: raw(3, 1) })
    folders.hydrate()
    const selectTab = vi.fn()
    folders.setOnClick(() => selectTab)
    mount()

    row(3).click()
    expect(selectTab).toHaveBeenCalledWith(1)
  })

  it('«добавить чаты» — только у пустой выбранной папки в видимой части списка; клик → AppEditFolderTab', async() => {
    applyFolderUpdate({ folder: raw(3, 1) })
    applyFolderUpdate({ folder: raw(4, 2, { non_contacts: false, contacts: true }) })
    setDialogs([makeDialog({ peerId: 1, unread: 0 })])
    folders.hydrate()
    expect(folders.folderItems.find((it) => it.id === 3)!.chatsCount).toBe(1)
    expect(folders.folderItems.find((it) => it.id === 4)!.chatsCount).toBe(0)

    // строки по 56px, список 500px: середина выбранной строки — в видимой части
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      if(this.classList.contains('folders-sidebar__scrollable')) return new DOMRect(0, 0, 72, 500)
      const id = Number(this.dataset.filterId)
      return new DOMRect(0, 56 * (id - 1), 72, 56)
    })

    const closeTabsBefore = vi.spyOn(appSidebarLeft, 'closeTabsBefore').mockImplementation(async(clb) => clb())
    const open = vi.fn().mockResolvedValue(undefined)
    const createTab = vi.spyOn(appSidebarLeft, 'createTab').mockReturnValue({ open } as never)
    const addButton = () => column().querySelector<HTMLElement>('.folders-sidebar__add-folders-button')

    useFoldersStore.setState({ selectedId: 3 })
    mount()
    expect(addButton()).toBeNull() // в папке есть чаты

    useFoldersStore.setState({ selectedId: 4 })
    await vi.waitFor(() => expect(addButton()).not.toBeNull())
    expect(addButton()!.style.getPropertyValue('--offset')).toBe(String(56 * 3 + 28))
    expect(addButton()!.querySelector('.folders-sidebar__add-folders-button-name')!.textContent).toBe('Add Chats')
    expect(addButton()!.querySelector('.folders-sidebar__add-folders-button-icon')!.textContent).toBe(getIconContent('plus'))

    addButton()!.click()
    expect(closeTabsBefore).toHaveBeenCalledTimes(1)
    expect(createTab).toHaveBeenCalledWith(AppEditFolderTab)
    expect(open.mock.calls[0][0].initFilter.id).toBe(4)

    // «Все чаты» — не пользовательская папка
    useFoldersStore.setState({ selectedId: ALL_FOLDER_ID })
    await vi.waitFor(() => expect(addButton()).toBeNull())
  })

  it('«настройки папок» (equalizer) → AppChatFoldersTab, повторный клик во время открытия не дублирует', () => {
    mount()
    let finish!: () => void
    const open = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    vi.spyOn(appSidebarLeft, 'closeTabsBefore').mockImplementation(async(clb) => clb())
    const createTab = vi.spyOn(appSidebarLeft, 'createTab').mockReturnValue({ open } as never)

    const settings = column().querySelector<HTMLElement>('.folders-sidebar__menu-button.is-last')!
    expect(settings.getAttribute('aria-label')).toBe('Folders')
    settings.click()
    settings.click()
    expect(createTab).toHaveBeenCalledTimes(1)
    expect(createTab).toHaveBeenCalledWith(AppChatFoldersTab)
    finish()
  })
})

describe('extractEmojiFromFilterTitle', () => {
  it('один эмодзи в начале или в конце уходит в иконку; в середине или два — остаются', () => {
    expect(extractEmojiFromFilterTitle('🔥 Горячее')).toEqual({ text: 'Горячее', emoji: '🔥' })
    expect(extractEmojiFromFilterTitle('Работа 💼')).toEqual({ text: 'Работа', emoji: '💼' })
    expect(extractEmojiFromFilterTitle('Ра 💼 бота')).toEqual({ text: 'Ра 💼 бота' })
    expect(extractEmojiFromFilterTitle('🔥 Горячее 💼')).toEqual({ text: '🔥 Горячее 💼' })
    expect(extractEmojiFromFilterTitle('Без эмодзи')).toEqual({ text: 'Без эмодзи' })
  })
})
