/** @jsxImportSource solid-js */
/**
 * Вкладки ссылок-приглашений правой колонки — порт tweb
 * `sidebarRight/tabs/{chatInviteLinks,chatInviteLink}.tsx` (812502980), задача
 * 0б-3 волны 7. Редактор ссылки — `editChatInviteLink.solid.test.tsx`.
 *
 * Вкладки НАСТОЯЩИЕ (`solidJsTabs/tabs.ts`), открытые синглтоном
 * `AppSidebarRight` на статичном `#column-right` (`@/test/sidebarRight`).
 * Стабы — только границы: менеджеры воркера, буфер обмена, всплывашка, мост
 * выбора получателей.
 *
 * Предмет: разметка оригинала (заставка, подпись, основная ссылка виджетом,
 * дополнительные и отозванные строками `usernames-username` с подписями и
 * кольцом), сеть — в момент оригинала (отзыв — по кнопке подтверждения,
 * удаление всех отозванных — тоже), дочерние вкладки кладутся в историю
 * слайдера (Esc возвращает к списку), закрытие снимает таймер остатка (DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import appImManager from '@lib/appImManager'
import type { Managers } from '@/client/bootstrap'
import type { Channel, User } from '@core/peers/peer'
import type { ChatInviteExported } from '@core/managers/groupsManager'
import lang from '@/lang'
import rootScope from '@lib/rootScope'
import { DEFAULT_TME_ORIGIN } from '@config/app'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import contextMenuController from '@helpers/contextMenuController'
import { installSidebarRight } from '@/test/sidebarRight'
import { AppChatInviteLinksTab } from '@components/solidJsTabs/tabs'

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

const shareUrlToPeers = vi.hoisted(() => vi.fn())
vi.mock('@components/popups/shareUrl.bridge', () => ({ default: shareUrlToPeers }))

const openPeer = vi.fn()

const ME = 1
const CHANNEL_ID = 20
const PUBLIC_ID = 40
const CHANNEL: Channel = { _: 'channel', id: CHANNEL_ID, title: 'Channel', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true, creator: true } } as Channel
const PUBLIC: Channel = { _: 'channel', id: PUBLIC_ID, title: 'Public', username: 'pubch', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true, creator: true } } as Channel
const USERS = [
  { _: 'user', id: ME, first_name: 'Me', pFlags: { self: true } },
  { _: 'user', id: 2, first_name: 'Bob', pFlags: {} },
] as unknown as User[]

const TME = DEFAULT_TME_ORIGIN
const HOST = new URL(TME).host
const now = () => Math.floor(Date.now() / 1000)
const invite = (hash: string, over: Partial<ChatInviteExported> = {}): ChatInviteExported =>
  ({ _: 'chatInviteExported', link: `${TME}/+${hash}`, admin_id: ME, date: now() - 3600, ...over })

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let column: ReturnType<typeof installSidebarRight>
let groups: Record<string, ReturnType<typeof vi.fn>>
let active: ChatInviteExported[]
let revoked: ChatInviteExported[]

beforeEach(() => {
  rootScope.myId = ME
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [CHANNEL, PUBLIC, ...USERS] }])
  toastNew.mockReset()
  copyTextToClipboard.mockClear()
  shareUrlToPeers.mockReset()
  openPeer.mockReset()
  vi.spyOn(appImManager, 'setInnerPeer').mockImplementation(async(options) => { openPeer(options) })

  // выдача сервера — от новых к старым; «постоянная» (без параметров) — самая старая
  active = [
    invite('extra', { title: 'Team', usage: 3, usage_limit: 10 }),
    invite('timed', { expire_date: now() + 3600 }),
    invite('primary', { date: now() - 86400 }),
  ]
  revoked = [invite('old', { pFlags: { revoked: true } })]
  groups = {
    getExportedChatInvites: vi.fn(async({ revoked: r }: { revoked?: boolean }) => ({
      _: 'messages.exportedChatInvites',
      count: (r ? revoked : active).length,
      invites: r ? revoked : active,
    })),
    exportChatInvite: vi.fn(async() => invite('fresh')),
    editExportedChatInvite: vi.fn(async({ link }: { link: string }) => ({
      _: 'messages.exportedChatInvite',
      invite: { ...active.concat(revoked).find((i) => i.link === link)!, pFlags: { revoked: true } },
    })),
    deleteExportedChatInvite: vi.fn(async() => {}),
    deleteRevokedExportedChatInvites: vi.fn(async() => {}),
    getChatInviteImporters: vi.fn(async() => ({
      _: 'messages.chatInviteImporters', count: 1,
      importers: [{ _: 'chatInviteImporter', user_id: 2, date: now() - 60 }],
    })),
  }
  const managers = {
    groups,
    dialogs: { getDialogs: vi.fn(async() => ({ dialogs: [], count: 0, isEnd: true })) },
    contacts: { getContactsPeerIds: vi.fn(async() => []), testSelfSearch: vi.fn(async() => false) },
    channels: { search: vi.fn() },
    peers: { getPeers: vi.fn(async() => []), fillMirror: vi.fn(async() => {}) },
  } as unknown as Managers
  column = installSidebarRight(managers)
})

afterEach(async() => {
  contextMenuController.close()
  column.dispose()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const open = async(chatId = CHANNEL_ID) => {
  const tab = column.sidebar.createTab(AppChatInviteLinksTab)
  await tab.open({ chatId })
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

// глиф иконки (`.tgico`) — символ из частной области Юникода, в подпись не входит
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[\uE000-\uF8FF]/g, '').trim()
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
const blocks = (tab: Tab) => [...tab.scrollable.container.children].slice(1) as HTMLElement[]
const rowsOf = (section: HTMLElement) => [...section.querySelectorAll<HTMLElement>('.usernames-username')]
const popupButton = (key: keyof typeof lang) =>
  [...document.querySelectorAll<HTMLElement>('.popup.popup-confirmation .popup-button')].find((b) => text(b) === lang[key])!
const activeTab = () => column.slider.querySelector<HTMLElement>(':scope > .sidebar-slider-item.active')

describe('«Пригласительные ссылки» — разметка оригинала', () => {
  it('заголовок, классы, порядок блоков; основная ссылка — виджет, остальные — строки ссылок', async() => {
    const tab = await open()

    expect(text(tab.title)).toBe(lang.InviteLinks)
    expect(tab.container.classList.contains('chat-folders-container')).toBe(true)
    expect(tab.container.classList.contains('chat-discussion-container')).toBe(true)

    // :328-335 — заставка, подпись, основная, дополнительные, отозванные (админов нет — О-121)
    const [sticker, caption, main, additional, revokedSection, ...rest] = blocks(tab)
    expect(rest).toHaveLength(0)
    expect(sticker.className).toBe('sticker-container')
    expect(caption.className).toBe('caption')
    expect(text(caption)).toBe(lang.ChannelLinkInfo)

    // :189-197 — «постоянная» (самая старая без параметров, О-120) в виджете
    expect(text(main.querySelector('.sidebar-left-section-name'))).toBe(lang.InviteLink)
    expect(text(main.querySelector('.invite-link-container .invite-link-text'))).toBe(`${HOST}/+primary`)
    expect(text(main.querySelector('.invite-link-container > .invite-link-button'))).toBe(lang.ShareLink)
    expect(main.querySelector('.invite-link-subtitle')!.classList.contains('hide')).toBe(true)

    // :200-228 — «Создать ссылку», затем строки без основной, в порядке сервера
    expect(text(additional.querySelector('.sidebar-left-section-name'))).toBe(lang['InviteLinks.Additional'])
    const create = additional.querySelector<HTMLElement>('.sidebar-left-section-content > button')!
    expect(create.className).toContain('btn-primary btn-transparent primary')
    expect(text(create)).toBe(lang.CreateNewLink)
    expect(text(additional.querySelector('.sidebar-left-section-caption'))).toBe(lang['InviteLinks.Description'])
    const [team, timed, ...more] = rowsOf(additional)
    expect(more).toHaveLength(0)
    expect(team.classList.contains('is-link')).toBe(true)
    expect(text(team.querySelector('.row-title'))).toBe('Team')
    expect(team.querySelector('.row-title')!.classList.contains('text-bold')).toBe(true)
    // :478-485 — «3 joined • 7 remaining», кольцо лимита
    expect(text(team.querySelector('.usernames-username-status'))).toBe('3 joined • 7 remaining')
    expect(team.querySelector('.usernames-username-icon.avatar-gradient > svg.usernames-username-icon-svg > circle')).not.toBeNull()
    // без имени — адрес без схемы (:64); срок — «expires in ч:мм:сс» (:500)
    expect(text(timed.querySelector('.row-title'))).toBe(`${HOST}/+timed`)
    expect(text(timed.querySelector('.usernames-username-status'))).toMatch(/^no one joined yet • expires in (\d+:)?\d\d:\d\d$/)

    // :292-326 — отозванные: «удалить все» и строка серым
    expect(revokedSection.classList.contains('hide')).toBe(false)
    const deleteAll = revokedSection.querySelector<HTMLElement>('.sidebar-left-section-content > button')!
    expect(deleteAll.className).toContain('btn-primary btn-transparent danger')
    const [old] = rowsOf(revokedSection)
    expect(text(old.querySelector('.usernames-username-status'))).toBe('no one joined • revoked')
    expect(old.querySelector<HTMLElement>('.usernames-username-icon')!.dataset.color).toBe('archive')
  })

  it('без отозванных секция спрятана; у публичного чата основная — его адрес, ссылка не выпускается (:575-579)', async() => {
    revoked = []
    active = [invite('extra', { title: 'Team' })]
    const tab = await open(PUBLIC_ID)
    const [, , main, , revokedSection] = blocks(tab)

    expect(revokedSection.classList.contains('hide')).toBe(true)
    expect(text(main.querySelector('.invite-link-text'))).toBe(`${HOST}/pubch`)
    expect(groups.exportChatInvite).not.toHaveBeenCalled()
  })

  it('нет «постоянной» — выпускается одна (порт getChatInviteLink, О-120)', async() => {
    active = [invite('extra', { title: 'Team' })]
    const tab = await open()

    expect(groups.exportChatInvite).toHaveBeenCalledTimes(1)
    expect(groups.exportChatInvite).toHaveBeenCalledWith({ chatId: CHANNEL_ID })
    expect(text(blocks(tab)[2].querySelector('.invite-link-text'))).toBe(`${HOST}/+fresh`)
  })
})

describe('«Пригласительные ссылки» — действия', () => {
  it('отзыв основной из ⋮: сеть только по кнопке подтверждения, затем новая основная и строка в отозванных', async() => {
    const tab = await open()
    const [, , main, , revokedSection] = blocks(tab)

    click(main.querySelector('.invite-link-menu')!)
    await settle()
    const item = [...document.querySelectorAll<HTMLElement>('.btn-menu .btn-menu-item')].find((el) => text(el) === lang.RevokeLink)!
    click(item)
    await settle()

    expect(document.querySelector('.popup.popup-confirmation')).not.toBeNull()
    expect(groups.editExportedChatInvite).not.toHaveBeenCalled()

    click(popupButton('RevokeButton'))
    await settle()

    expect(groups.editExportedChatInvite).toHaveBeenCalledWith({ chatId: CHANNEL_ID, link: `${TME}/+primary`, revoked: true })
    expect(groups.exportChatInvite).toHaveBeenCalledWith({ chatId: CHANNEL_ID })
    expect(text(main.querySelector('.invite-link-text'))).toBe(`${HOST}/+fresh`)
    expect(rowsOf(revokedSection).map((row) => text(row.querySelector('.row-title')))).toEqual([`${HOST}/+primary`, `${HOST}/+old`])
  })

  it('«Удалить все отозванные» — по подтверждению, строки уходят, секция прячется', async() => {
    const tab = await open()
    const revokedSection = blocks(tab)[4]

    click(revokedSection.querySelector('.sidebar-left-section-content > button')!)
    await settle()
    expect(groups.deleteRevokedExportedChatInvites).not.toHaveBeenCalled()

    click(popupButton('Delete'))
    await settle()

    expect(groups.deleteRevokedExportedChatInvites).toHaveBeenCalledWith(CHANNEL_ID)
    expect(rowsOf(revokedSection)).toHaveLength(0)
    expect(revokedSection.classList.contains('hide')).toBe(true)
  })

  it('«Создать ссылку» открывает редактор поверх списка; его галка — новая строка первой в дополнительных', async() => {
    const tab = await open()
    const additional = blocks(tab)[3]
    click(additional.querySelector('.sidebar-left-section-content > button')!)
    await vi.waitFor(() => {
      if(activeTab() === tab.container) throw new Error('редактор ещё не открыт')
    }, { timeout: 5000 })
    await settle()

    const editor = activeTab()!
    expect(text(editor.querySelector('.sidebar-header__title'))).toBe(lang.NewLink)
    expect(groups.exportChatInvite).not.toHaveBeenCalled()

    click(editor.querySelector('.sidebar-content > .btn-corner')!)
    await pause(400)
    await settle()

    expect(groups.exportChatInvite).toHaveBeenCalledTimes(1)
    expect(editor.isConnected).toBe(false)
    expect(activeTab()).toBe(tab.container)
    expect(rowsOf(additional).map((row) => text(row.querySelector('.row-title')))).toEqual([`${HOST}/+fresh`, 'Team', `${HOST}/+timed`])
  })

  it('клик по строке открывает ссылку вкладкой поверх списка; Esc возвращает к списку', async() => {
    const tab = await open()
    click(rowsOf(blocks(tab)[3])[0])
    await vi.waitFor(() => {
      if(activeTab() === tab.container) throw new Error('вкладка ссылки ещё не открыта')
    }, { timeout: 5000 })
    await settle()

    const detail = activeTab()!
    expect(text(detail.querySelector('.sidebar-header__title'))).toBe('Team')
    expect(tab.container.isConnected).toBe(true)

    escape()
    await pause(400)

    expect(detail.isConnected).toBe(false)
    expect(activeTab()).toBe(tab.container)
  })

  it('Esc закрывает список: через 250 мс узла нет, таймер остатка снят (DoD 5)', async() => {
    const clearInterval = vi.spyOn(globalThis, 'clearInterval')
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    const tab = await open()
    const timer = setInterval.mock.results[setInterval.mock.calls.findIndex((call) => call[1] === 1000)].value

    escape()
    await pause(400)

    expect(tab.container.isConnected).toBe(false)
    expect(column.slider.querySelector('.chat-folders-container')).toBeNull()
    expect(clearInterval).toHaveBeenCalledWith(timer)
  })
})

describe('«Ссылка» — вкладка одной ссылки', () => {
  const openDetail = async() => {
    const list = await open()
    click(rowsOf(blocks(list)[3])[0])
    await vi.waitFor(() => {
      if(activeTab() === list.container) throw new Error('вкладка ссылки ещё не открыта')
    }, { timeout: 5000 })
    await settle()
    return activeTab()!
  }

  it('секция ссылки, «Ссылку создал», вступившие — селектором, страницей сервера (:35-243)', async() => {
    const detail = await openDetail()

    // вступившие есть — скроллер вкладки снят, всё в скроллере селектора (:231-233)
    const scroller = detail.querySelector<HTMLElement>('.selector > .selector-scrollable')!
    const sections = [...scroller.querySelectorAll<HTMLElement>(':scope > .sidebar-left-section-container')]
    const [linkSection, creator] = sections
    expect(text(linkSection.querySelector('.sidebar-left-section-name'))).toBe(lang.InviteLink)
    expect(text(linkSection.querySelector('.invite-link-text'))).toBe(`${HOST}/+extra`)
    // ссылка активна — кнопка «Поделиться» и меню ⋮ общие со списком
    expect(text(linkSection.querySelector('.invite-link-button'))).toBe(lang.ShareLink)

    expect(text(creator.querySelector('.sidebar-left-section-name'))).toBe(lang.LinkCreatedeBy)
    const creatorRow = creator.querySelector<HTMLElement>('.chatlist-container > ul.chatlist.chatlist-new > a.row')!
    expect(creatorRow.dataset.peerId).toBe(String(ME))

    expect(groups.getChatInviteImporters).toHaveBeenCalledTimes(1)
    expect(groups.getChatInviteImporters).toHaveBeenCalledWith(expect.objectContaining({ chatId: CHANNEL_ID, link: `${TME}/+extra` }))
    const joined = detail.querySelector<HTMLElement>('.selector-height-container')!
    expect(text(joined.querySelector('.sidebar-left-section-name'))).toMatch(/^3 people joined/)
    expect(text(joined.querySelector('.sidebar-left-section-name-right'))).toBe('7 remaining')
    const bob = joined.querySelector<HTMLElement>('a.row[data-peer-id="2"]')!
    expect(bob).not.toBeNull()

    click(bob)
    expect(openPeer).toHaveBeenCalledWith({ peerId: 2 })
  })
})
