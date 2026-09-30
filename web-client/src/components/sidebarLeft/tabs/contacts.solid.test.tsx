/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Контакты» (`contacts.solid.tsx`, порт tweb `sidebarLeft/tabs/contacts.tsx`,
 * 812502980) и её списка (`contactsList.solid.tsx`).
 *
 * Вкладка НАСТОЯЩАЯ — `AppContactsTab` из `solidJsTabs/tabs.ts`, открытая через существующий
 * слайдер (`settingsSliderHost.ts` → `components/slider.ts`); колоночный слайдер 2D-28 здесь не
 * нужен — вкладке всё равно, чей `SidebarSlider` её держит. Стабы — только границы: менеджеры
 * воркера, зеркала пиров и присутствия и геометрия (happy-dom её не считает).
 *
 * Предмет — форма оригинала: `#contacts-container`, поле поиска на месте заголовка и кнопка
 * сортировки в шапке, виртуальный `ul.chatlist`, поиск запросом к книге, порядок по «был(а) в
 * сети» и по имени с секциями, клик по строке открывает чат и вкладку НЕ закрывает (tweb:
 * `setListClickListener` → `setPeer`), `{secret: true}` (Отступление В7-1), `noSame`,
 * перечитывание книги по `contacts_update` и уборка острова после закрытия.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { useChatsStore } from '@stores/chatsStore'
import { useNavigationStore } from '@stores/navigationStore'
import { useSecretChatStore } from '@stores/secretChatStore'
import { useSettingsStore } from '@/settings'
import type { UserReal } from '@core/peers/peer'
import type SidebarSlider from '@components/slider'
import { AppContactsTab } from '@components/solidJsTabs/tabs'
import { openPeer } from '@core/navigation/openPeer'
import { glyph } from '@core/tgico-icons'
import { createSettingsSliderHost, type SettingsSliderHost } from '../settingsSliderHost'

vi.mock('@core/navigation/openPeer', async(importOriginal) => ({
  ...await importOriginal<typeof import('@core/navigation/openPeer')>(),
  openPeer: vi.fn(),
}))

const NOW = Math.floor(Date.now() / 1000)
const USERS: UserReal[] = [
  { _: 'user', id: 11, first_name: 'Boris', username: 'bob', pFlags: { contact: true } },
  { _: 'user', id: 12, first_name: 'Anna', pFlags: { contact: true } },
  { _: 'user', id: 13, first_name: 'Carl', pFlags: { contact: true } },
]

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let host: SettingsSliderHost
let book: PeerId[]
let getContactsPeerIds: ReturnType<typeof vi.fn>
let secretStart: ReturnType<typeof vi.fn>

beforeEach(() => {
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true }, contactsSortMode: 'online' })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420, height: 600 } as DOMRect)
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: USERS }])
  useChatsStore.setState({
    presence: {
      11: { _: 'userStatusOffline', was_online: NOW - 3600 },
      12: { _: 'userStatusRecently' },
      13: { _: 'userStatusOnline', expires: NOW + 600 },
    },
  })

  book = [11, 12, 13]
  // книга отвечает поиском по имени и @username, как индекс `contactsManager`
  getContactsPeerIds = vi.fn(async(query?: string) => book.filter((id) => {
    const user = USERS.find((u) => u.id === id)!
    return !query || user.first_name!.toLowerCase().startsWith(query) || user.username?.startsWith(query)
  }))
  secretStart = vi.fn(async(userId: PeerId) => ({ peerId: 5000 + userId }))
  const managers = {
    contacts: { getContactsPeerIds },
    presence: { get: vi.fn(async() => []) },
    peers: { fillMirror: vi.fn(async() => {}) },
    media: { downloadMediaURL: vi.fn(async() => '') },
    secret: { start: secretStart },
    dialogs: { refresh: vi.fn(async() => {}) },
  } as unknown as Managers

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = createSettingsSliderHost(columnEl, managers)
})

afterEach(async() => {
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.mocked(openPeer).mockClear()
  resetPeerMirror()
  useChatsStore.setState({ presence: {} })
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
  useSecretChatStore.setState({ byChat: {} })
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false }, contactsSortMode: 'online' })
})

type ContactsTab = InstanceType<typeof AppContactsTab>

const open = async(payload?: Parameters<ContactsTab['init']>[0]) => {
  const tab = await host.openTab(AppContactsTab, payload)
  await settle()
  return tab
}

const list = (tab: ContactsTab) => tab.scrollable.container.querySelector<HTMLUListElement>('ul.chatlist.virtual-chatlist')!
const rowIds = (tab: ContactsTab) => [...list(tab).querySelectorAll<HTMLElement>(':scope > a.row')]
  .sort((a, b) => parseFloat(a.style.transform.slice(11)) - parseFloat(b.style.transform.slice(11)))
  .map((row) => +row.dataset.peerId!)
const row = (tab: ContactsTab, peerId: PeerId) => list(tab).querySelector<HTMLElement>(`:scope > a.row[data-peer-id="${peerId}"]`)!
const sortButton = (tab: ContactsTab) => tab.header.querySelector<HTMLButtonElement>(':scope > button.sidebar-header-right')!
const searchInput = (tab: ContactsTab) => tab.header.querySelector<HTMLInputElement>('.input-search input')!
const mousedown = (element: HTMLElement) => element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))

describe('вкладка контактов — разметка', () => {
  it('open(): #contacts-container, поле поиска вместо заголовка, кнопка сортировки, угловая «добавить», список', async() => {
    const tab = await open()

    expect(tab.container.id).toBe('contacts-container')
    expect(tab.header.querySelector('.sidebar-header__title')).toBeNull()
    expect(searchInput(tab)).not.toBeNull()
    expect(sortButton(tab).querySelector('.tgico')).not.toBeNull()
    expect(tab.content.querySelector(':scope > button.btn-corner.is-visible')).not.toBeNull()
    expect(getContactsPeerIds).toHaveBeenCalledWith('', false, 'none')
    // по умолчанию — по «был(а) в сети»: онлайн, час назад, недавно
    expect(rowIds(tab)).toEqual([13, 11, 12])
    expect(row(tab, 13).classList.contains('chatlist-chat-abitbigger')).toBe(true)
  })

  it('поле поиска получает фокус, когда вкладка доехала (`tab.shown`)', async() => {
    const tab = await open()
    expect(document.activeElement).not.toBe(searchInput(tab))

    await pause(300)
    expect(document.activeElement).toBe(searchInput(tab))
  })
})

describe('вкладка контактов — поиск и порядок', () => {
  it('ввод в поиск спрашивает книгу запросом и показывает найденное', async() => {
    const tab = await open()
    const input = searchInput(tab)
    input.value = 'bo'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(350)
    await settle()

    expect(getContactsPeerIds).toHaveBeenLastCalledWith('bo', false, 'none')
    expect(rowIds(tab)).toEqual([11])
  })

  it('кнопка сортировки: по имени с секциями по букве, глиф — порядок, в который переключит', async() => {
    const tab = await open()
    const icon = () => sortButton(tab).querySelector('.tgico')!.textContent
    expect(icon()).toBe(glyph('sort_name'))
    expect(list(tab).querySelector('.sidebar-left-h2')).toBeNull()

    sortButton(tab).click()
    await settle()

    expect(useSettingsStore.getState().contactsSortMode).toBe('name')
    expect(icon()).toBe(glyph('sort_online'))
    expect(rowIds(tab)).toEqual([12, 11, 13])
    expect([...list(tab).querySelectorAll('.sidebar-left-h2')].map((el) => el.textContent)).toEqual(['A', 'B', 'C'])
    // полоса букв — в `.sidebar-content`, поверх скроллера (tweb `indexContainer={tab.content}`)
    expect([...tab.content.querySelectorAll(':scope > div > [aria-hidden="true"] > span')].map((el) => el.textContent)).toEqual(['A', 'B', 'C'])
  })

  it('contacts_update перечитывает книгу: добавленный контакт встаёт в список', async() => {
    const tab = await open()
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: 14, first_name: 'Dora', pFlags: { contact: true } }] }])
    USERS.push({ _: 'user', id: 14, first_name: 'Dora', pFlags: { contact: true } })
    book = [...book, 14]

    rootScope.dispatchEventSingle('contacts_update', 14)
    await pause(10)
    await settle()

    expect(getContactsPeerIds).toHaveBeenCalledTimes(2)
    expect(rowIds(tab)).toContain(14)
    USERS.pop()
  })
})

describe('вкладка контактов — клик по строке', () => {
  it('открывает чат пира; вкладка остаётся открытой, как у оригинала', async() => {
    const tab = await open()
    const close = vi.spyOn(tab, 'close')

    mousedown(row(tab, 11))

    expect(openPeer).toHaveBeenCalledTimes(1)
    expect(vi.mocked(openPeer).mock.calls[0][1]).toMatchObject({ id: 11, title: 'Boris', username: 'bob' })
    expect(close).not.toHaveBeenCalled()
    expect(tab.container.isConnected).toBe(true)
  })

  it('{secret: true} — Отступление В7-1: секретный чат с контактом вместо личного', async() => {
    const tab = await open({ secret: true })

    mousedown(row(tab, 12))
    await settle()

    expect(secretStart).toHaveBeenCalledWith(12)
    expect(openPeer).not.toHaveBeenCalled()
    expect(useSecretChatStore.getState().byChat[5012]?.status).toBe('awaiting')
    expect(useNavigationStore.getState().selectedId).toBe('5012')
  })
})

describe('вкладка контактов — жизненный цикл', () => {
  it('noSame: повторный createTab при открытой вкладке отдаёт её же', async() => {
    const tab = await open()
    const slider = tab.slider as unknown as SidebarSlider

    expect(slider.createTab(AppContactsTab)).toBe(tab)
  })

  it('после закрытия и перехода остров снят: узла нет, книга по contacts_update не перечитывается', async() => {
    const tab = await open()
    const container = tab.container

    tab.close()
    await pause(400)

    expect(container.isConnected).toBe(false)
    expect(document.getElementById('contacts-container')).toBeNull()
    getContactsPeerIds.mockClear()
    rootScope.dispatchEventSingle('contacts_update', 11)
    await pause(10)
    expect(getContactsPeerIds).not.toHaveBeenCalled()
  })
})
