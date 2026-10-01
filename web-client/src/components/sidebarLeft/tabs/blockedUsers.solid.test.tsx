/** @jsxImportSource solid-js */
/**
 * Вкладка «Заблокированные» (`blockedUsers.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/blockedUsers.tsx`, 812502980) — задача 22 плана волны 2D.
 *
 * Вкладка НАСТОЯЩАЯ — `AppBlockedUsersTab` из `solidJsTabs/tabs.ts`, открытая
 * колоночным слайдером с полезной нагрузкой `{peerIds}`, как её открывает хаб
 * «Конфиденциальность» (tweb `privacyAndSecurity.tsx:217`). Стабы — только
 * границы: менеджеры воркера (`privacy.getBlocked/toggleBlock`, пиры,
 * контакты) и геометрия. Событие `peer_block` в продукте шлёт воркер после
 * ответа сервера (`privacyManager.toggleBlock`); здесь стаб `toggleBlock`
 * шлёт его в `rootScope` сам — тем же путём, каким кадр воркера доезжает до
 * вкладки (`dispatchEventSingle`, `client/realtimeBridge.ts`).
 *
 * Предмет — DOM и поведение оригинала: подпись `BlockedUsersInfo` НАД
 * карточкой (`:61`, дамп `14-left-16b`), чатлист `chatlist-chat-abitbigger`,
 * подзаголовок телефон/@username/статус (`:49-56`), FAB `btn-corner`, меню
 * «Unblock» (`lockoff`), `peer_block` (`:118-132`), подгрузка по 50
 * (`:134-155`), догрузка после въезда (`tabs.ts:252`, `onOpenAfterTimeout`),
 * уборка меню и острова на закрытии (`:158-160`, DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import type { User } from '@core/peers/peer'
import { resetPeerMirror } from '@core/peerCache'
import { useChatsStore } from '@stores/chatsStore'
import { useSettingsStore } from '@/settings'
import { formatUserPhone } from '@core/format/phone'
import contextMenuController from '@helpers/contextMenuController'
import { getOverlayRoot } from '@helpers/appWindow'
import { AppBlockedUsersTab } from '@components/solidJsTabs/tabs'
import { mountTestColumnSlider, type TestColumnSlider } from '@/test/columnSlider'

const ME = 1
const PEERS = new Map<PeerId, User>([
  [ME, { _: 'user', id: ME, first_name: 'Me', pFlags: { self: true } }],
  [2, { _: 'user', id: 2, first_name: 'Phone', phone: '79990000002', username: 'phoneuser', pFlags: {} }],
  [3, { _: 'user', id: 3, first_name: 'Nick', username: 'nick', pFlags: {} }],
  [4, { _: 'user', id: 4, first_name: 'Quiet', status: { _: 'userStatusRecently' }, pFlags: {} }],
  [5, { _: 'user', id: 5, first_name: 'Robot', username: 'robot_bot', phone: '79990000005', pFlags: { bot: true } }],
  [6, { _: 'user', id: 6, first_name: 'Six', username: 'six', pFlags: { contact: true } }],
])

// 60 заблокированных за первой страницей: ключи 100…159
for(let i = 100; i < 160; ++i) {
  PEERS.set(i, { _: 'user', id: i, first_name: 'U' + i, username: 'u' + i, pFlags: {} })
}
const REST = [...PEERS.keys()].filter((id) => id >= 100)

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let host: TestColumnSlider
let getBlocked: ReturnType<typeof vi.fn<(offset: number, limit: number) => Promise<{ count: number, peerIds: PeerId[] }>>>
let toggleBlock: ReturnType<typeof vi.fn<(peerId: PeerId, block: boolean) => Promise<void>>>

/** Страница серверного списка: сначала первая (`FIRST`), за ней — `REST`. */
const FIRST: PeerId[] = [2, 3, 4, 5]
const serverList = () => [...FIRST, ...REST]

beforeEach(() => {
  rootScope.myId = ME
  resetPeerMirror()
  useChatsStore.setState({ dialogIndexById: {} })
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false, animations: false } })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)

  getBlocked = vi.fn(async(offset: number, limit: number) => {
    const all = serverList()
    return { count: all.length, peerIds: all.slice(offset, offset + limit) }
  })
  toggleBlock = vi.fn(async(peerId: PeerId, block: boolean) => {
    rootScope.dispatchEventSingle('peer_block', { peerId, blocked: block || undefined })
  })

  const managers = {
    privacy: { getBlocked, toggleBlock },
    dialogs: { getDialogs: vi.fn(async() => ({ dialogs: [], count: 0, isEnd: true })) },
    contacts: { getContactsPeerIds: vi.fn(async() => [6]), testSelfSearch: vi.fn(async() => false) },
    channels: { search: vi.fn() },
    peers: {
      getPeers: vi.fn(async(ids: PeerId[]) => ids.map((id) => PEERS.get(id)).filter(Boolean)),
      getUsers: vi.fn(async(ids: PeerId[]) => ids.map((id) => PEERS.get(id)).filter(Boolean)),
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
})

const open = async(peerIds: PeerId[] = FIRST) => {
  const tab = await host.openTab(AppBlockedUsersTab, { peerIds })
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

// глиф иконки (`tgico`) — символ из области частного использования
const text = (el: Element) => (el.textContent ?? '').replace(/[\uE000-\uF8FF]/g, '').trim()
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const rows = (tab: Tab) => [...tab.container.querySelectorAll<HTMLElement>('ul.chatlist > a.row')]
const ids = (tab: Tab) => rows(tab).map((el) => +el.dataset.peerId!)
const row = (tab: Tab, peerId: PeerId) => tab.container.querySelector<HTMLElement>(`ul.chatlist > a.row[data-peer-id="${peerId}"]`)!
const subtitle = (tab: Tab, peerId: PeerId) => text(row(tab, peerId).querySelector('.dialog-subtitle .row-subtitle')!)

describe('«Заблокированные» — разметка', () => {
  it('заголовок, классы контейнера и скроллера (дамп 14-left-16b)', async() => {
    const tab = await open()
    expect(text(tab.title)).toBe('Blocked Users')
    expect(tab.container.classList.contains('blocked-users-container')).toBe(true)
    expect(tab.scrollable.container.classList.contains('chatlist-container')).toBe(true)
  })

  it('подпись BlockedUsersInfo — НАД карточкой, внутри контейнера секции; в карточке — ul.chatlist', async() => {
    const tab = await open()
    const container = tab.scrollable.container.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const [first, second] = [...container.children]
    expect(first.classList.contains('sidebar-left-section-caption')).toBe(true)
    expect(text(first)).toBe('Blocked users can\'t send you messages or add you to groups. They will not see your profile photos, stories, online and last seen status.')
    expect(second.classList.contains('sidebar-left-section')).toBe(true)
    expect(second.querySelector(':scope > .sidebar-left-section-content > ul.chatlist')).not.toBeNull()
  })

  it('строки — чатлист оригинала в порядке полезной нагрузки', async() => {
    const tab = await open()
    expect(ids(tab).slice(0, 4)).toEqual(FIRST)
    const el = row(tab, 2)
    for(const cls of ['row', 'no-wrap', 'row-with-padding', 'row-clickable', 'hover-effect', 'chatlist-chat', 'chatlist-chat-abitbigger']) {
      expect(el.classList.contains(cls)).toBe(true)
    }
    expect(el.querySelector('.avatar.dialog-avatar.row-media-abitbigger')).not.toBeNull()
    expect(el.hasAttribute('href')).toBe(false)
  })

  it('подзаголовок: телефон, иначе @username, иначе статус; у бота — всегда @username (:49-56)', async() => {
    const tab = await open()
    expect(subtitle(tab, 2)).toBe(formatUserPhone('79990000002'))
    expect(subtitle(tab, 3)).toBe('@nick')
    expect(subtitle(tab, 4)).toBe('last seen recently')
    expect(subtitle(tab, 5)).toBe('@robot_bot')
  })

  it('FAB — btn-circle btn-corner is-visible в .sidebar-content вкладки', async() => {
    const tab = await open()
    const btn = tab.content.querySelector<HTMLElement>(':scope > button.btn-corner')!
    expect(btn).not.toBeNull()
    expect(btn.className).toContain('btn-circle btn-corner z-depth-1 is-visible')
    expect(btn.querySelector('.button-icon')).not.toBeNull()
  })
})

describe('«Заблокированные» — меню и события', () => {
  const rightClick = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))

  it('меню #blocked-users-contextmenu в оверлее: один пункт Unblock (lockoff) → toggleBlock(peer, false), строка снята', async() => {
    const tab = await open()
    const menu = getOverlayRoot().querySelector<HTMLElement>('#blocked-users-contextmenu')!
    expect(menu.classList.contains('btn-menu')).toBe(true)
    expect(menu.classList.contains('contextmenu')).toBe(true)

    rightClick(row(tab, 3))
    await settle()
    expect(menu.classList.contains('active')).toBe(true)
    const items = [...menu.querySelectorAll<HTMLElement>('.btn-menu-item')]
    expect(items.map(text)).toEqual(['Unblock'])
    expect(items[0].querySelector('.tgico')).not.toBeNull()

    click(items[0])
    await settle()
    expect(toggleBlock).toHaveBeenCalledWith(3, false)
    expect(ids(tab)).not.toContain(3)
  })

  it('peer_block {blocked} ставит строку ПЕРВОЙ, повтор — без дубля', async() => {
    const tab = await open()
    rootScope.dispatchEventSingle('peer_block', { peerId: 6, blocked: true })
    rootScope.dispatchEventSingle('peer_block', { peerId: 6, blocked: true })
    await settle()
    expect(ids(tab)[0]).toBe(6)
    expect(ids(tab).filter((id) => id === 6)).toHaveLength(1)
  })

  it('peer_block без blocked снимает строку; неизвестный пир — без ошибок', async() => {
    const tab = await open()
    rootScope.dispatchEventSingle('peer_block', { peerId: 4 })
    rootScope.dispatchEventSingle('peer_block', { peerId: 999 })
    await settle()
    expect(ids(tab)).not.toContain(4)
  })

  it('FAB открывает выбор контакта «Blocked Users» (мост до 2C-16); выбор → toggleBlock(peer, true) и строка в списке', async() => {
    const tab = await open()
    click(tab.content.querySelector(':scope > button.btn-corner')!)
    const picker = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>('.tabs-tab.add-members-container')
      if(!el || !el.querySelector('ul.chatlist > a.row[data-peer-id="6"]')) throw new Error('выбор не открыт')
      return el
    }, { timeout: 5000 })
    expect(text(picker.querySelector('.sidebar-header__title')!)).toBe('Blocked Users')

    click(picker.querySelector<HTMLElement>('ul.chatlist > a.row[data-peer-id="6"]')!)
    click(picker.querySelector<HTMLElement>('.sidebar-content > button.btn-corner')!)
    await settle()
    expect(toggleBlock).toHaveBeenCalledWith(6, true)
    expect(ids(tab)[0]).toBe(6)
  })
})

describe('«Заблокированные» — подгрузка', () => {
  // Геометрия скроллера: happy-dom не раскладывает, а `checkForTriggers` у
  // пустого по размеру блока триггеров не зовёт (`scrollable.ts`). Список
  // «влезает целиком» — прокручено до низа, как короткая первая страница.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
  })

  it('после въезда догружает страницу с offset = числу строк, по 50; конец списка снимает подгрузку', async() => {
    const tab = await open()
    await vi.waitFor(() => expect(getBlocked).toHaveBeenCalledWith(4, 50))
    await settle()
    expect(ids(tab)).toEqual([...FIRST, ...REST.slice(0, 50)])

    tab.scrollable.onScrolledBottom!()
    await settle()
    expect(getBlocked).toHaveBeenLastCalledWith(54, 50)
    expect(ids(tab)).toEqual(serverList())
    // страница короче 50 — дальше грузить нечего
    expect(tab.scrollable.onScrolledBottom).toBeFalsy()
  })

  it('повторный вызов во время загрузки не шлёт второй запрос', async() => {
    const tab = await open([])
    await settle()
    const calls = getBlocked.mock.calls.length
    tab.scrollable.onScrolledBottom?.()
    tab.scrollable.onScrolledBottom?.()
    expect(getBlocked.mock.calls.length - calls).toBeLessThanOrEqual(1)
  })
})

describe('«Заблокированные» — жизненный цикл', () => {
  it('на закрытии меню снято из оверлея, строки и остров — со вкладкой (DoD 5)', async() => {
    const tab = await open()
    expect(getOverlayRoot().querySelector('#blocked-users-contextmenu')).not.toBeNull()
    tab.close()
    await pause(400)
    expect(getOverlayRoot().querySelector('#blocked-users-contextmenu')).toBeNull()
    expect(document.querySelector('.blocked-users-container')).toBeNull()
  })
})
