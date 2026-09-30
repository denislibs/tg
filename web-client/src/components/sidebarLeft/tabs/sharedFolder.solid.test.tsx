/** @jsxImportSource solid-js */
/**
 * Тесты вкладки ссылки папки «Share Folder» (задача 25 плана 2D):
 * `sharedFolder.solid.tsx` + виджет `inviteLink.ts` — порты tweb
 * `sidebarLeft/tabs/{sharedFolder.tsx,inviteLink.ts}` (812502980).
 *
 * Вкладка НАСТОЯЩАЯ — `AppSharedFolderTab` из `solidJsTabs/tabs.ts`, открытая
 * через хост слайдера; селектор — настоящий `AppSelectPeers`. Стабы — только
 * границы: менеджеры воркера (ссылки, пиры), буфер обмена, всплывашка и
 * геометрия. Вход из редактора папки — в `chatFolders.solid.test.tsx`.
 *
 * Предмет: разметка оригинала (заставка, подпись, секция ссылки, список чатов с
 * заголовком «N chats selected» и подписью), порядок строк по рейтингу
 * (`:204-220`), подписи и `cant-select` нерасшариваемых (`:92-101`, `:184`),
 * меню ссылки (копировать/удалить → событие `delete` и закрытие), ветка «нечем
 * делиться» без ссылки, отказ выбора (О-23), уборка острова (DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import type { Folder, FolderInvite } from '@core/managers/foldersManager'
import type { Chat, User } from '@core/peers/peer'
import { useChatsStore } from '@stores/chatsStore'
import { useSettingsStore } from '@/settings'
import { resetPeerMirror } from '@core/peerCache'
import contextMenuController from '@helpers/contextMenuController'
import { AppSharedFolderTab } from '@components/solidJsTabs/tabs'
import { mountTestColumnSlider, type TestColumnSlider } from '@/test/columnSlider'

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
  [7, { _: 'user', id: 7, first_name: 'Bot', pFlags: { bot: true } }],
  [-10, { _: 'chat', id: 10, title: 'Private Group', participants_count: 3, date: 0 } as unknown as Chat],
  [-20, { _: 'channel', id: 20, title: 'Public Channel', username: 'pubch', participants_count: 9, date: 0, pFlags: { broadcast: true } } as unknown as Chat],
  [-30, { _: 'channel', id: 30, title: 'Public Group', username: 'pubgr', participants_count: 5, date: 0, pFlags: { megagroup: true } } as unknown as Chat],
  [-40, { _: 'channel', id: 40, title: 'Private Mega', participants_count: 4, date: 0, pFlags: { megagroup: true } } as unknown as Chat],
  [-50, { _: 'channel', id: 50, title: 'Private Channel', participants_count: 8, date: 0, pFlags: { broadcast: true } } as unknown as Chat],
])

const WORK: Folder = {
  id: 3, pos: 3, title: 'Работа',
  contacts: false, nonContacts: false, groups: false, broadcasts: false, bots: false,
  excludeMuted: false, excludeRead: false,
  includeChats: [2, 7, -10, -30, -40, -50], excludeChats: [],
}

const INVITE: FolderInvite = { slug: 'abc', url: '/addlist/abc', title: '', peerIds: [-20] }

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let host: TestColumnSlider
let revokeInvite: ReturnType<typeof vi.fn>
let animate: ReturnType<typeof vi.fn>

beforeEach(() => {
  rootScope.myId = ME
  resetPeerMirror()
  useChatsStore.setState({ dialogIndexById: {} })
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false, animations: false } })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  // `shake` — Web Animations; happy-dom её не проигрывает, считаем вызовы
  animate = vi.fn()
  HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate']
  toastNew.mockReset()
  copyTextToClipboard.mockClear()

  revokeInvite = vi.fn(async() => {})
  const managers = {
    folders: { revokeInvite },
    dialogs: { getDialogs: vi.fn(async() => ({ dialogs: [], count: 0, isEnd: true })) },
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
  host = mountTestColumnSlider(columnEl, managers)
})

afterEach(async() => {
  contextMenuController.close()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false, animations: false } })
})

const open = async(chatlistInvite?: FolderInvite) => {
  const tab = await host.openTab(AppSharedFolderTab, { filter: WORK, chatlistInvite })
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

const text = (el: Element) => (el.textContent ?? '').replace(/[-]/g, '').trim()
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const scroller = (tab: Tab) => tab.container.querySelector<HTMLElement>('.selector > .selector-scrollable')!
const rows = (tab: Tab) => [...tab.container.querySelectorAll<HTMLElement>('ul.chatlist > a.row')]
const row = (tab: Tab, peerId: PeerId) => tab.container.querySelector<HTMLElement>(`ul.chatlist > a.row[data-peer-id="${peerId}"]`)!
const checked = (tab: Tab, peerId: PeerId) => row(tab, peerId).querySelector<HTMLInputElement>('input')!.checked
const subtitle = (tab: Tab, peerId: PeerId) => text(row(tab, peerId).querySelector('.row-subtitle')!)

describe('вкладка «Share Folder» — разметка', () => {
  it('заголовок, классы контейнера; скроллер вкладки снят, в скроллере селектора: заставка, подпись, секция ссылки, список', async() => {
    const tab = await open(INVITE)

    expect(tab.title.textContent).toBe('Share Folder')
    expect(tab.container.classList.contains('edit-folder-container')).toBe(true)
    expect(tab.container.classList.contains('shared-folder-container')).toBe(true)
    expect(tab.content.isConnected).toBe(false)
    // галки «Save» нет — выбор чатов ссылки заблокирован (О-23)
    expect(tab.header.querySelector('.btn-confirm')).toBeNull()

    const children = [...scroller(tab).children]
    expect(children[0].className).toBe('sticker-container')
    expect(children[1].className).toBe('caption')
    expect(children[2].querySelector('.sidebar-left-section-name')!.textContent).toBe('Invite Link')
    expect(children[2].querySelector('.invite-link-container')).not.toBeNull()
    expect(children[3].classList.contains('selector-height-container')).toBe(true)
  })

  it('подпись — имя папки жирным и число чатов ссылки; секция чатов — «1 chat selected» с подписью оригинала', async() => {
    const tab = await open(INVITE)
    const caption = scroller(tab).querySelector(':scope > .caption')!
    expect(caption.textContent).toBe('Anyone with this link can add Работа folder and the 1 chat selected below')
    expect(caption.querySelector('b, strong')!.textContent).toBe('Работа')

    const section = scroller(tab).querySelector('.selector-height-container .sidebar-left-section-container')!
    expect(section.querySelector('.sidebar-left-section-name')!.textContent).toBe('1 chat selected')
    expect(section.querySelector('.sidebar-left-section-caption')!.textContent)
      .toBe('You can only share groups and channels in which you are allowed to create invite links.')
  })

  it('строки: сперва выбранные ссылкой, затем расшариваемые, затем нерасшариваемые (cant-select); галки — чаты ссылки', async() => {
    const tab = await open(INVITE)
    expect(rows(tab).map((el) => +el.dataset.peerId!)).toEqual([-20, -30, 2, 7, -10, -40, -50])
    expect(rows(tab).filter((el) => el.classList.contains('cant-select')).map((el) => +el.dataset.peerId!))
      .toEqual([2, 7, -10, -40, -50])
    expect(checked(tab, -20)).toBe(true)
    expect(checked(tab, -30)).toBe(false)
  })

  it('подписи нерасшариваемых — по типу пира; у расшариваемого — число участников', async() => {
    const tab = await open(INVITE)
    expect(subtitle(tab, 2)).toBe('you can\'t share chats with users')
    expect(subtitle(tab, 7)).toBe('you can\'t share chats with bots')
    expect(subtitle(tab, -10)).toBe('you can\'t invite others here')
    expect(subtitle(tab, -40)).toBe('you can\'t invite others here')
    expect(subtitle(tab, -30)).toMatch(/^5 /)
  })

  it('плашка ссылки: адрес без схемы, срезанный посередине элементом middle-ellipsis-element; справа ⋮', async() => {
    const tab = await open(INVITE)
    const link = tab.container.querySelector<HTMLElement>('.invite-link-container > .invite-link.rp-overflow')!
    expect(link.querySelector('.invite-link-text > middle-ellipsis-element')!.textContent).toBe(location.host + '/addlist/abc')
    expect(link.lastElementChild!.classList.contains('btn-menu-toggle')).toBe(true)
    expect(link.lastElementChild!.classList.contains('invite-link-menu')).toBe(true)
    // кнопки «Share Link» нет — попап `shareUrlToPeers` волны 2C
    expect(tab.container.querySelector('.invite-link-button')).toBeNull()
  })
})

describe('вкладка «Share Folder» — ссылка', () => {
  it('клик по плашке копирует полный адрес ровно один раз и показывает тост LinkCopied', async() => {
    const tab = await open(INVITE)
    click(tab.container.querySelector('.invite-link-text')!)
    expect(copyTextToClipboard).toHaveBeenCalledTimes(1)
    expect(copyTextToClipboard).toHaveBeenCalledWith(location.origin + '/addlist/abc')
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'LinkCopied' })
  })

  it('⋮ → «Copy Link» копирует; «Delete Link» — revokeInvite, событие delete и закрытие вкладки', async() => {
    const tab = await open(INVITE)
    const onDelete = vi.fn()
    tab.eventListener.addEventListener('delete', onDelete)

    click(tab.container.querySelector('.invite-link-menu')!)
    await settle()
    let items = [...document.querySelectorAll<HTMLElement>('.btn-menu-item')]
    expect(items.map(text)).toEqual(['Copy Link', 'Delete Link'])
    expect(items[1].classList.contains('danger')).toBe(true)
    click(items[0])
    expect(copyTextToClipboard).toHaveBeenLastCalledWith(location.origin + '/addlist/abc')

    await pause(350)
    click(tab.container.querySelector('.invite-link-menu')!)
    await settle()
    items = [...document.querySelectorAll<HTMLElement>('.btn-menu-item')]
    const close = vi.spyOn(tab, 'close')
    click(items.find((el) => text(el) === 'Delete Link')!)
    await settle()

    expect(revokeInvite).toHaveBeenCalledWith('abc')
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('вкладка «Share Folder» — выбор чатов', () => {
  it('нерасшариваемая строка: тост по типу пира и тряска, выбор не меняется', async() => {
    const tab = await open(INVITE)
    click(row(tab, 2))
    expect(toastNew).toHaveBeenLastCalledWith({ langPackKey: 'SharedFolder.Toast.NoPrivate' })
    click(row(tab, -10))
    expect(toastNew).toHaveBeenLastCalledWith({ langPackKey: 'SharedFolder.Toast.NoAdminGroup' })
    click(row(tab, -50))
    expect(toastNew).toHaveBeenLastCalledWith({ langPackKey: 'SharedFolder.Toast.NoAdminChannel' })
    expect(animate).toHaveBeenCalledTimes(3)
    expect(checked(tab, 2)).toBe(false)
  })

  it('(О-23) расшариваемую строку отметить или снять нельзя — только тряска, без тоста; заголовок прежний', async() => {
    const tab = await open(INVITE)
    click(row(tab, -30))
    click(row(tab, -20))
    expect(checked(tab, -30)).toBe(false)
    expect(checked(tab, -20)).toBe(true)
    expect(toastNew).not.toHaveBeenCalled()
    expect(animate).toHaveBeenCalledTimes(2)
    expect(scroller(tab).querySelector('.selector-height-container .sidebar-left-section-name')!.textContent).toBe('1 chat selected')
  })
})

describe('вкладка «Share Folder» без ссылки («нечем делиться»)', () => {
  it('подпись NoChats, заголовок списка NoChats.Title, секции ссылки нет, все строки — cant-select в порядке папки', async() => {
    const tab = await open()
    const children = [...scroller(tab).children]
    expect(children.map((el) => el.className.split(' ')[0])).toEqual(['sticker-container', 'caption', 'selector-height-container'])
    expect(children[1].textContent).toBe('There are no chats in this folder that you can share with others.')
    expect(scroller(tab).querySelector('.selector-height-container .sidebar-left-section-name')!.textContent)
      .toBe('These chats cannot be shared')
    expect(tab.container.querySelector('.invite-link-container')).toBeNull()
    expect(rows(tab).map((el) => +el.dataset.peerId!)).toEqual([2, 7, -10, -30, -40, -50])
    expect(rows(tab).every((el) => el.classList.contains('cant-select'))).toBe(true)
    expect(subtitle(tab, -30)).toBe('you can\'t invite others here')
  })
})

describe('вкладка «Share Folder» — жизненный цикл', () => {
  it('на закрытии Solid-остров и селектор сняты (DoD 5)', async() => {
    const tab = await open(INVITE)
    tab.close()
    await pause(400)
    expect(document.querySelector('.shared-folder-container .selector')).toBeNull()
  })
})
