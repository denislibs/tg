/** @jsxImportSource solid-js */
/**
 * Тесты вкладок «Папки» (задача 24 плана 2D): список `chatFolders.solid.tsx`,
 * редактор `editFolder.solid.tsx`, выбор чатов `includedChats.solid.tsx` —
 * порты tweb `sidebarLeft/tabs/{chatFolders,editFolder,includedChats}.tsx`
 * (812502980).
 *
 * Вкладки НАСТОЯЩИЕ (`solidJsTabs/tabs.ts`), открытые через хост слайдера
 * (`settingsSliderHost.ts`) тем же путём, что их открывает строка корня
 * настроек и меню папки; дочерние вкладки — изнутри, `tab.slider.createTab`.
 * Стабы — только границы: менеджеры воркера (папки, ссылки, пиры, диалоги),
 * попап подтверждения, всплывашка, загрузка лотти (без WASM SIMD она и так
 * отклоняется — вкладка ставит статичный кадр) и геометрия.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import { HttpError } from '@core/net/restClient'
import type { Folder, FolderInvite } from '@core/managers/foldersManager'
import type { Chat, User } from '@core/peers/peer'
import type { Dialog } from '@core/models'
import { useAppStateStore } from '@stores/appState'
import { useChatsStore } from '@stores/chatsStore'
import { useFoldersStore } from '@stores/foldersStore'
import { useSettingsStore } from '@/settings'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { initialState } from '@core/state/state'
import contextMenuController from '@helpers/contextMenuController'
import type SliderSuperTab from '@components/sliderTab'
import { AppChatFoldersTab, AppEditFolderTab } from '@components/solidJsTabs/tabs'
import { createSettingsSliderHost, type SettingsSliderHost } from '../settingsSliderHost'

const confirmationPopup = vi.hoisted(() => vi.fn(async(_options: unknown) => {}))
vi.mock('@components/popups/popupPeer', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@components/popups/popupPeer')>()),
  confirmationPopup,
}))

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@components/toast')>()),
  toastNew,
}))

const copyTextToClipboard = vi.hoisted(() => vi.fn(async() => {}))
vi.mock('@helpers/clipboard', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@helpers/clipboard')>()),
  copyTextToClipboard,
}))

const ME = 1
const PEERS = new Map<PeerId, User | Chat>([
  [ME, { _: 'user', id: ME, first_name: 'Me', pFlags: { self: true } }],
  [2, { _: 'user', id: 2, first_name: 'Two', pFlags: {} }],
  [3, { _: 'user', id: 3, first_name: 'Three', pFlags: {} }],
  [4, { _: 'user', id: 4, first_name: 'Four', pFlags: {} }],
  [5, { _: 'user', id: 5, first_name: 'Five', pFlags: {} }],
  [6, { _: 'user', id: 6, first_name: 'Six', pFlags: {} }],
  [-10, { _: 'chat', id: 10, title: 'Group', participants_count: 3, date: 0 } as unknown as Chat],
])

const folder = (over: Partial<Folder> & Pick<Folder, 'id' | 'title'>): Folder => ({
  pos: over.id,
  contacts: false, nonContacts: false, groups: false, broadcasts: false, bots: false,
  excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
  ...over,
})

const WORK = folder({ id: 3, title: 'Работа', includeChats: [2, -10] })
const BOTS = folder({ id: 5, title: 'Боты', bots: true })

const dialog = (peerId: PeerId): Dialog => ({
  peerId, unread_count: 0, unread_mentions_count: 0, folder_id: 0, notify_settings: {},
} as unknown as Dialog)

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let host: SettingsSliderHost
let folders: {
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
  listInvites: ReturnType<typeof vi.fn>
  createInvite: ReturnType<typeof vi.fn>
  revokeInvite: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  rootScope.myId = ME
  resetPeerMirror()
  useAppStateStore.setState({ ...initialState(), folders: [WORK, BOTS] })
  useChatsStore.setState({ dialogs: [dialog(2), dialog(-10)], dialogIndexById: { 2: 900, [-10]: 800 } })
  useFoldersStore.setState({ contactIds: new Set() })
  useSettingsStore.setState({ tabsInSidebar: false, liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  confirmationPopup.mockReset().mockResolvedValue(undefined)
  toastNew.mockReset()
  copyTextToClipboard.mockClear()

  folders = {
    create: vi.fn(async(input: Omit<Folder, 'id' | 'pos'>) => ({ ...input, id: 9, pos: 9 })),
    update: vi.fn(async(id: number, input: Omit<Folder, 'id' | 'pos'>) => ({ ...input, id, pos: id })),
    del: vi.fn(async() => {}),
    listInvites: vi.fn(async(): Promise<FolderInvite[]> => []),
    createInvite: vi.fn(async(): Promise<FolderInvite> => ({ slug: 'new', url: '/addlist/new', title: '', peerIds: [-10] })),
    revokeInvite: vi.fn(async() => {}),
  }
  const managers = {
    folders,
    dialogs: {
      getDialogs: vi.fn(async() => ({ dialogs: [2, -10].map((peerId) => ({ peerId })), count: 2, isEnd: true })),
    },
    contacts: { getContactsPeerIds: vi.fn(async() => []), testSelfSearch: vi.fn(async() => false) },
    channels: { search: vi.fn() },
    peers: {
      getPeers: vi.fn(async(ids: PeerId[]) => ids.map((id) => PEERS.get(id)).filter(Boolean)),
      fillMirror: vi.fn(async() => {}),
    },
  } as unknown as Managers

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = createSettingsSliderHost(columnEl, managers)
})

afterEach(async() => {
  contextMenuController.close()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  useSettingsStore.setState({ tabsInSidebar: false, liteMode: { ...useSettingsStore.getState().liteMode, all: false } })
})

const openList = () => host.openTab(AppChatFoldersTab, AppChatFoldersTab.getInitArgs())
const openEditor = (initFilter?: Folder) => host.openTab(AppEditFolderTab, { ...AppEditFolderTab.getInitArgs(), initFilter })

/** Вкладка, которую открыл клик внутри другой: ждём её модуль и коллектор. */
const waitTab = (className: string) => vi.waitFor(() => {
  const tab = document.querySelector<HTMLElement>(`.sidebar-slider > .tabs-tab.${className}`)
  if(!tab) throw new Error('нет вкладки ' + className)
  return tab
}, { timeout: 5000 })

/** Текст кнопки/пункта без глифа иконки (приватная область Unicode). */
const text = (el: Element) => (el.textContent ?? '').replace(/[\ue000-\uf8ff]/g, '').trim()

const sectionNames = (root: HTMLElement) =>
  [...root.querySelectorAll('.sidebar-left-section-name')].map((el) => el.textContent)

const rowTitles = (root: Element) =>
  [...root.querySelectorAll('.row-title:not(.row-title-right)')].map((el) => el.textContent)

const buttonsText = (root: Element) =>
  [...root.querySelectorAll<HTMLElement>(':scope > button.folder-category-button')].map(text)

const visibleButtonsText = (root: Element) =>
  [...root.querySelectorAll<HTMLElement>(':scope > button.folder-category-button')]
    .filter((el) => el.style.display !== 'none')
    .map(text)

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

function typeName(tab: SliderSuperTab, value: string) {
  const input = tab.container.querySelector<HTMLElement>('.input-field-input')!
  input.textContent = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('вкладка «Папки» — разметка HEAD', () => {
  it('заставка, подпись и кнопка «New Folder» — вне секций; секции Filters и FiltersView, без рекомендованных (О-20)', async() => {
    const tab = await openList()
    expect(tab.container.classList.contains('chat-folders-container')).toBe(true)
    expect(tab.scrollable.container.classList.contains('chat-folders')).toBe(true)
    expect(tab.title.textContent).toBe('Chat Folders')

    const root = tab.scrollable.container
    const sticker = root.querySelector(':scope > div > .sticker-container')!
    expect(sticker).not.toBeNull()
    expect(sticker.nextElementSibling!.className).toBe('caption')
    const button = sticker.nextElementSibling!.nextElementSibling as HTMLElement
    expect(button.tagName).toBe('BUTTON')
    expect([...button.classList]).toEqual(expect.arrayContaining(['btn-primary', 'btn-color-primary', 'btn-control']))
    expect(button.querySelector('.tgico')).not.toBeNull()
    expect(button.textContent).toContain('Create Folder')

    expect(sectionNames(root)).toEqual(['Folders', 'Folders view'])
  })

  it('строки папок — по порядку pos, без ручки перетаскивания (О-19); подписи: один флаг — «All Bots», иначе счёт чатов', async() => {
    const tab = await openList()
    const section = tab.scrollable.container.querySelectorAll('.sidebar-left-section-container')[0]
    expect(section.classList.contains('hide')).toBe(false)

    const rows = [...section.querySelectorAll<HTMLElement>('.row')]
    expect(rows.map((row) => row.querySelector('.row-title')!.textContent)).toEqual(['Работа', 'Боты'])
    expect(rows.every((row) => !row.classList.contains('row-sortable'))).toBe(true)
    expect(section.querySelector('.row-sortable-icon')).toBeNull()
    expect(rows.map((row) => row.querySelector('.row-subtitle')?.textContent)).toEqual(['1 chat and 1 group', 'All Bots'])
  })

  // Счёт чатов — тем же правилом, что список папки: бот попадает по флагу
  // bots (`pFlags.bot` карточки из зеркала пиров) и считается чатом
  // (tweb chatFolders.tsx:92-96), человек в такую папку не попадает.
  it('подпись папки «Боты + группы» считает личку с ботом и не считает людей', async() => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: 7, first_name: 'Bot', pFlags: { bot: true } }, PEERS.get(2)!] }])
    useChatsStore.setState({ dialogs: [dialog(2), dialog(7), dialog(-10)], dialogIndexById: { 2: 900, 7: 850, [-10]: 800 } })
    useAppStateStore.setState({ folders: [folder({ id: 5, title: 'Боты', bots: true, groups: true })] })
    const tab = await openList()
    const row = tab.scrollable.container.querySelector<HTMLElement>('.sidebar-left-section-container .row')!
    expect(row.querySelector('.row-subtitle')?.textContent).toBe('1 chat and 1 group')
  })

  it('без папок секция Filters спрятана', async() => {
    useAppStateStore.setState({ folders: [] })
    const tab = await openList()
    const section = tab.scrollable.container.querySelectorAll('.sidebar-left-section-container')[0]
    expect(section.classList.contains('hide')).toBe(true)
  })

  it('папка переименована пушем — строка перерисована', async() => {
    const tab = await openList()
    useAppStateStore.setState({ folders: [{ ...WORK, title: 'Офис' }, BOTS] })
    expect(rowTitles(tab.scrollable.container.querySelectorAll('.sidebar-left-section-container')[0])).toEqual(['Офис', 'Боты'])
  })

  it('«Расположение папок»: радио отражает tabsInSidebar и пишет его', async() => {
    const tab = await openList()
    const radios = [...tab.scrollable.container.querySelectorAll<HTMLInputElement>('form input[type="radio"]')]
    expect(radios.map((input) => input.value)).toEqual(['true', 'false'])
    expect(radios.map((input) => input.checked)).toEqual([false, true])

    radios[0].checked = true
    radios[0].dispatchEvent(new Event('change', { bubbles: true }))
    expect(useSettingsStore.getState().tabsInSidebar).toBe(true)
  })

  it('на закрытии Solid-остров снят (DoD 5)', async() => {
    const tab = await openList()
    tab.close()
    await pause(400)
    expect(document.querySelector('.chat-folders .sticker-container')).toBeNull()
  })
})

describe('вкладка «Папки» — вход в редактор', () => {
  it('«Create Folder» открывает редактор новой папки: заголовок FilterNew, галка видна, меню нет', async() => {
    const list = await openList()
    click(list.scrollable.container.querySelector('button.btn-control')!)
    await settle()

    const editor = await waitTab('edit-folder-container')
    expect(editor.classList.contains('edit-folder-container')).toBe(true)
    expect(editor.querySelector('.sidebar-header__title')!.textContent).toBe('New Folder')
    expect(editor.querySelector('.btn-confirm')!.classList.contains('hide')).toBe(false)
    expect(editor.querySelector('.btn-menu-toggle')!.classList.contains('hide')).toBe(true)
  })

  it('строка папки открывает её редактор: заголовок FilterHeaderEdit и имя в поле', async() => {
    const list = await openList()
    click(list.scrollable.container.querySelector('.row')!)
    await settle()

    const editor = await waitTab('edit-folder-container')
    expect(editor.querySelector('.sidebar-header__title')!.textContent).toBe('Edit Folder')
    expect(editor.querySelector('.input-field-input')!.textContent).toBe('Работа')
  })
})

describe('редактор папки — разметка HEAD', () => {
  it('секции included/excluded/links; категории — folder-category-button, у первой primary; Archived нет (О-21)', async() => {
    const tab = await openEditor(BOTS)
    await settle()
    const root = tab.scrollable.container

    expect(root.querySelector(':scope > .sticker-container')).not.toBeNull()
    expect(root.querySelector(':scope > .caption')!.textContent).toContain('Choose chats')

    const included = root.querySelector('.folder-list.folder-list-included .folder-categories')!
    expect(buttonsText(included)).toEqual(['Add Chats', 'Contacts', 'Non-Contacts', 'Groups', 'Channels', 'Bots'])
    expect(included.firstElementChild!.classList.contains('primary')).toBe(true)
    expect(included.children[1].classList.contains('disable-hover')).toBe(true)

    const excluded = root.querySelector('.folder-list.folder-list-excluded .folder-categories')!
    expect(buttonsText(excluded)).toEqual(['Remove Chats', 'Muted', 'Read'])

    const links = root.querySelector('.folder-list.folder-list-links .folder-categories')!
    expect(buttonsText(links)).toEqual(['Create a New Link'])
    expect(sectionNames(root)).toEqual(['Included Chats', 'Excluded Chats', 'Invite Links'])
  })

  it('видны только включённые категории папки — «Bots» у папки ботов', async() => {
    const tab = await openEditor(BOTS)
    await settle()
    const included = tab.scrollable.container.querySelector('.folder-list-included .folder-categories')!
    expect(visibleButtonsText(included)).toEqual(['Add Chats', 'Bots'])
  })

  it('поле имени — лимит 12; подсказка про эмодзи — только при папках слева', async() => {
    let tab = await openEditor(WORK)
    await settle()
    const nameSection = tab.scrollable.container.querySelector('.input-field')!.closest('.sidebar-left-section-container')!
    expect(nameSection.querySelector('.sidebar-left-section-caption')).toBeNull()
    tab.close()
    await pause(400)

    useSettingsStore.setState({ tabsInSidebar: true })
    tab = await openEditor(WORK)
    await settle()
    const caption = tab.scrollable.container.querySelector('.input-field')!
      .closest('.sidebar-left-section-container')!.querySelector('.sidebar-left-section-caption')!
    expect(caption.textContent).toContain('folders sidebar')

    typeName(tab, 'Тринадцать букв')
    expect(tab.container.querySelector('.input-field-input')!.classList.contains('error')).toBe(true)
  })

  it('включённые чаты: до 4 строк и «Show N More Chats»; клик раскрывает остальные', async() => {
    const many = folder({ id: 7, title: 'Много', includeChats: [2, 3, 4, 5, 6] })
    const tab = await openEditor(many)
    await settle()
    const section = tab.scrollable.container.querySelector('.folder-list-included')!
    expect(section.querySelectorAll('ul.chatlist > .row')).toHaveLength(4)
    const more = section.querySelector<HTMLElement>('button.load-more')!
    expect(more.textContent).toContain('Show 1 More Chat')

    click(more)
    await settle()
    expect(section.querySelectorAll('ul.chatlist > .row')).toHaveLength(5)
  })
})

describe('редактор папки — изменения и сохранение', () => {
  it('без изменений — меню ⋮, с изменением — галка (и обратно)', async() => {
    const tab = await openEditor(WORK)
    await settle()
    const confirm = tab.header.querySelector('.btn-confirm')!
    const menu = tab.header.querySelector('.btn-menu-toggle')!
    expect([confirm.classList.contains('hide'), menu.classList.contains('hide')]).toEqual([true, false])

    typeName(tab, 'Офис')
    expect([confirm.classList.contains('hide'), menu.classList.contains('hide')]).toEqual([false, true])

    typeName(tab, 'Работа')
    expect([confirm.classList.contains('hide'), menu.classList.contains('hide')]).toEqual([true, false])
  })

  it('галка: update с флагами и списками папки, стор получает ответ, вкладка закрывается', async() => {
    const tab = await openEditor(BOTS)
    await settle()
    typeName(tab, 'Роботы')
    click(tab.header.querySelector('.btn-confirm')!)
    await settle()

    expect(folders.update).toHaveBeenCalledTimes(1)
    expect(folders.update).toHaveBeenCalledWith(5, expect.objectContaining({ title: 'Роботы', bots: true, includeChats: [], excludeChats: [] }))
    expect(useAppStateStore.getState().folders.find((f) => f.id === 5)!.title).toBe('Роботы')
    await pause(400)
    expect(document.querySelector('.edit-folder-container')).toBeNull()
  })

  it('новая папка без чатов и типов — тост ChooseChat, запроса нет; без имени — ошибка поля', async() => {
    const tab = await openEditor()
    await settle()
    click(tab.header.querySelector('.btn-confirm')!)
    expect(tab.container.querySelector('.input-field-input')!.classList.contains('error')).toBe(true)

    typeName(tab, 'Пусто')
    click(tab.header.querySelector('.btn-confirm')!)
    await settle()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'EditFolder.Toast.ChooseChat' })
    expect(folders.create).not.toHaveBeenCalled()
  })

  it('отказ «папок слишком много» — тост LimitReached (О-22), вкладка остаётся', async() => {
    folders.update.mockRejectedValueOnce(new HttpError(400, 'folders limit reached', 'folders limit reached'))
    const tab = await openEditor(WORK)
    await settle()
    typeName(tab, 'Офис')
    click(tab.header.querySelector('.btn-confirm')!)
    await settle()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'LimitReached' })
    expect(tab.container.isConnected).toBe(true)
  })

  it('⋮ → «Delete Folder»: подтверждение, del и уход папки из стора, вкладка закрыта', async() => {
    const tab = await openEditor(WORK)
    await settle()
    click(tab.header.querySelector('.btn-menu-toggle')!)
    await settle()
    const item = [...document.querySelectorAll<HTMLElement>('.btn-menu-item')].find((el) => text(el) === 'Delete Folder')!
    expect(item.classList.contains('danger')).toBe(true)
    click(item)
    await settle()

    expect(confirmationPopup).toHaveBeenCalledTimes(1)
    expect(folders.del).toHaveBeenCalledWith(3)
    expect(useAppStateStore.getState().folders.map((f) => f.id)).toEqual([5])
  })
})

describe('редактор папки — ссылки-приглашения', () => {
  const INVITE: FolderInvite = { slug: 'abc', url: '/addlist/abc', title: '', peerIds: [-10, -20] }

  it('строка ссылки: usernames-username active, адрес без схемы, «Includes 2 chats», иконка link', async() => {
    folders.listInvites.mockResolvedValue([INVITE])
    const tab = await openEditor(WORK)
    await settle()
    const row = tab.scrollable.container.querySelector<HTMLElement>('.folder-list-links .usernames-username')!
    expect(row.classList.contains('active')).toBe(true)
    expect(row.querySelector('.row-title')!.textContent).toBe(location.host + '/addlist/abc')
    expect(row.querySelector('.row-subtitle')!.textContent).toBe('Includes 2 chats')
    expect(row.querySelector('.usernames-username-icon .tgico')).not.toBeNull()
  })

  it('меню строки: копировать полный адрес; удалить — revokeInvite и строка снята', async() => {
    folders.listInvites.mockResolvedValue([INVITE])
    const tab = await openEditor(WORK)
    await settle()
    const row = tab.scrollable.container.querySelector<HTMLElement>('.folder-list-links .usernames-username')!

    const openMenu = async() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      await settle()
      return [...document.querySelectorAll<HTMLElement>('.btn-menu.contextmenu.active .btn-menu-item')]
    }

    let items = await openMenu()
    expect(items.map(text)).toEqual(['Copy Link', 'Delete'])
    click(items[0])
    expect(copyTextToClipboard).toHaveBeenCalledWith(location.origin + '/addlist/abc')
    contextMenuController.close()
    await pause(350)

    items = await openMenu()
    click(items[1])
    await settle()
    expect(folders.revokeInvite).toHaveBeenCalledWith('abc')
    expect(row.isConnected).toBe(false)
  })

  it('«Create a New Link» у папки с типами — тост NoTypes; у папки только с чатами — сохранение и новая строка', async() => {
    let tab = await openEditor(BOTS)
    await settle()
    click(tab.scrollable.container.querySelector('.folder-list-links .folder-categories > .btn')!)
    await settle()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'SharedFolder.Toast.NoTypes' })
    expect(folders.createInvite).not.toHaveBeenCalled()
    tab.close()
    await pause(400)

    tab = await openEditor(WORK)
    await settle()
    click(tab.scrollable.container.querySelector('.folder-list-links .folder-categories > .btn')!)
    await settle()
    expect(folders.update).toHaveBeenCalledTimes(1)
    expect(folders.createInvite).toHaveBeenCalledWith(3)
    expect(tab.scrollable.container.querySelectorAll('.folder-list-links .usernames-username')).toHaveLength(1)
  })
})

describe('выбор чатов папки (includedChats)', () => {
  it('«Add Chats» → вкладка Include Chats: категории с data-peer-id и чекбоксом, флаги папки отмечены', async() => {
    const editor = await openEditor(BOTS)
    await settle()
    click(editor.scrollable.container.querySelector('.folder-list-included .folder-categories > .btn')!)
    await settle()

    const picker = await waitTab('included-chatlist-container')
    expect(picker.classList.contains('included-chatlist-container')).toBe(true)
    expect(picker.querySelector('.sidebar-header__title')!.textContent).toBe('Include Chats')
    const categories = [...picker.querySelectorAll<HTMLElement>('.folder-categories button.folder-category-button')]
    expect(categories.map((el) => el.dataset.peerId)).toEqual(['contacts', 'non_contacts', 'groups', 'broadcasts', 'bots'])
    expect(categories.map((el) => el.querySelector<HTMLInputElement>('input')!.checked)).toEqual([false, false, false, false, true])
  })

  it('подпись строки — папки чата тем же правилом, что список: бот числится в папке «Боты»', async() => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: 2, first_name: 'Two', pFlags: { bot: true } }] }])
    const editor = await openEditor(WORK)
    await settle()
    click(editor.scrollable.container.querySelector('.folder-list-included .folder-categories > .btn')!)
    await settle()

    const picker = await waitTab('included-chatlist-container')
    const subtitle = () => picker.querySelector('ul.chatlist > .row[data-peer-id="2"] .row-subtitle')?.textContent
    await vi.waitFor(() => expect(subtitle()).toContain('Работа'))
    expect(subtitle()).toContain('Боты')
  })

  it('«Remove Chats» → Exclude Chats: Muted и Read, без Archived (О-21)', async() => {
    const editor = await openEditor(BOTS)
    await settle()
    click(editor.scrollable.container.querySelector('.folder-list-excluded .folder-categories > .btn')!)
    await settle()

    const picker = await waitTab('included-chatlist-container')
    expect(picker.querySelector('.sidebar-header__title')!.textContent).toBe('Exclude Chats')
    expect([...picker.querySelectorAll<HTMLElement>('.folder-categories button.folder-category-button')].map((el) => el.dataset.peerId))
      .toEqual(['exclude_muted', 'exclude_read'])
  })

  it('галка: выбранные пиры и категории уходят в папку редактора, исключённое снимается из другого списка', async() => {
    const both = folder({ id: 8, title: 'Смесь', bots: true, excludeChats: [2] })
    const editor = await openEditor(both)
    await settle()
    click(editor.scrollable.container.querySelector('.folder-list-included .folder-categories > .btn')!)
    await settle()

    const picker = await waitTab('included-chatlist-container')
    click(picker.querySelector('.folder-categories button[data-peer-id="groups"]')!)
    click(picker.querySelector('ul.chatlist > .row[data-peer-id="2"]')!)
    await settle()
    click(picker.querySelector('.btn-confirm')!)
    await settle()
    await pause(400)

    const included = editor.scrollable.container.querySelector('.folder-list-included .folder-categories')!
    expect(visibleButtonsText(included)).toEqual(['Add Chats', 'Groups', 'Bots'])
    expect([...editor.scrollable.container.querySelectorAll<HTMLElement>('.folder-list-included ul.chatlist > .row')]
      .map((row) => +row.dataset.peerId!)).toEqual([2])
    expect(editor.scrollable.container.querySelectorAll('.folder-list-excluded ul.chatlist > .row')).toHaveLength(0)
    // изменение видно по галке
    expect(editor.header.querySelector('.btn-confirm')!.classList.contains('hide')).toBe(false)
  })
})
