/** @jsxImportSource solid-js */
/**
 * Вкладка «Группа обсуждения» — порт tweb `sidebarRight/tabs/chatDiscussion.tsx`
 * (812502980), задача 0б-5 пачки П-1 (Б-40).
 *
 * Вкладка НАСТОЯЩАЯ — `AppChatDiscussionTab` из `solidJsTabs/tabs.ts`, открытая
 * настоящим `SidebarSlider`; попап подтверждения — настоящий `confirmationPopup`.
 * Стабы — менеджеры воркера и открытие чата (`appImManager.setInnerPeer`).
 *
 * Предмет:
 *  - видимость по состоянию канала (`update`, `:250-263`): без обсуждения —
 *    кандидаты, «Создать новую группу», без «Отвязать»; с обсуждением — только
 *    привязанная группа и «Отвязать группу»; подпись по состоянию (`:117-122`);
 *  - сеть в момент оригинала: привязка — только после подтверждения
 *    (`:181-191`), отвязка — только после подтверждения (`:71-81`);
 *  - новое состояние — по кадру `chat_update` канала (`:272-280`);
 *  - тема-форум не привязывается: тост, без попапа (`:145-149`);
 *  - «Создать новую группу» — `AppNewGroupTab` с нагрузкой оригинала (`:52-67`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Channel, ChannelFull } from '@core/peers/peer'
import lang from '@/lang'
import rootScope from '@lib/rootScope'
import appImManager from '@lib/appImManager'
import { RT } from '@core/realtime/events'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import appNavigationController from '@core/navigation/appNavigationController'
import SidebarSlider from '@components/slider'
import { AppChatDiscussionTab, AppNewGroupTab } from '@components/solidJsTabs/tabs'

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@components/toast')>()),
  toastNew,
}))

const CHANNEL_ID = 20
const PUBLIC_GROUP = 40
const PRIVATE_GROUP = 41
const FORUM_GROUP = 42

const chatOf = (id: number, title: string, extra: Partial<Channel> = {}): Channel => ({
  _: 'channel', id, title, photo: { _: 'chatPhotoEmpty' }, date: 0,
  ...extra,
  pFlags: { megagroup: true, creator: true, ...extra.pFlags },
} as Channel)
const CHANNEL: Channel = { ...chatOf(CHANNEL_ID, 'News'), pFlags: { broadcast: true, creator: true } }
const GROUPS = [
  chatOf(PUBLIC_GROUP, 'Public Chat', { username: 'pubchat' }),
  chatOf(PRIVATE_GROUP, 'Private Chat'),
  chatOf(FORUM_GROUP, 'Forum Chat', { pFlags: { megagroup: true, creator: true, forum: true } }),
]
const fullOf = (id: number, extra: Partial<ChannelFull> = {}): ChannelFull => ({
  _: 'channelFull', id, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null, ...extra,
})

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

beforeAll(async() => {
  await import('./chatDiscussion.solid')
})

let slider: SidebarSlider
let channels: Record<string, ReturnType<typeof vi.fn>>
let groups: Record<string, ReturnType<typeof vi.fn>>
const openPeer = vi.fn()

beforeEach(() => {
  resetPeerMirror()
  toastNew.mockReset()
  // `shake` (`helpers/dom/shake.ts`) — Web Animations, в happy-dom её нет
  HTMLElement.prototype.animate = vi.fn() as never
  openPeer.mockClear()
  vi.spyOn(appImManager, 'setInnerPeer').mockImplementation(async(options) => { openPeer(options) })
  channels = {
    discussionCandidates: vi.fn(async() => GROUPS.map((chat) => ({
      peerId: -chat.id, title: chat.title, username: chat.username ?? '', memberCount: 1,
    }))),
    linkDiscussion: vi.fn(async(_channel: number, group: number) => group),
    unlinkDiscussion: vi.fn(async() => {}),
  }
  groups = {
    card: vi.fn(async(peerId: number) => ({
      peerId,
      chat: GROUPS.find((chat) => chat.id === -peerId),
      fullChat: fullOf(-peerId, { pFlags: { hidden_prehistory: true } }),
    })),
  }
  const managers = {
    channels,
    groups,
    media: {},
    peers: { fillMirror: vi.fn(async() => {}) },
  } as unknown as Managers

  applyPeerOps([{ op: 'upsert', peers: [CHANNEL, ...GROUPS] }])

  const sidebarEl = document.createElement('div')
  sidebarEl.id = 'column-right'
  const sliderEl = document.createElement('div')
  sliderEl.classList.add('sidebar-content', 'sidebar-slider', 'tabs-container')
  sidebarEl.append(sliderEl)
  document.body.append(sidebarEl)
  slider = new SidebarSlider({ sidebarEl, navigationType: 'right', managers, canHideFirst: true })
})

afterEach(async() => {
  slider.closeAllTabs()
  await pause(400)
  appNavigationController.spliceItems(0, Infinity)
  document.body.replaceChildren()
  resetPeerMirror()
  vi.restoreAllMocks()
})

const open = async(linkedChatId?: number) => {
  const tab = slider.createTab(AppChatDiscussionTab)
  await tab.open({ chatId: CHANNEL_ID, linkedChatId })
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[-]/g, '').trim()
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const rows = (tab: Tab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('ul.chatlist > .chatlist-chat')]
const visibleRows = (tab: Tab) => rows(tab).filter((row) => !row.classList.contains('hide'))
const rowOf = (tab: Tab, chatId: number) => rows(tab).find((row) => row.dataset.peerId === String(-chatId))!
const subtitle = (row: HTMLElement) => text(row.querySelector('.row-subtitle, .dialog-subtitle'))
const button = (tab: Tab, key: keyof typeof lang) =>
  [...tab.scrollable.container.querySelectorAll<HTMLElement>('button')].find((b) => text(b) === lang[key])
const unlinkSection = (tab: Tab) => button(tab, 'DiscussionUnlinkGroup')!.closest('.sidebar-left-section-container')!
const caption = (tab: Tab) => text(tab.scrollable.container.querySelector('.caption'))
const popup = () => document.querySelector<HTMLElement>('.popup.popup-confirmation')
const popupButton = (key: keyof typeof lang) =>
  [...document.querySelectorAll<HTMLElement>('.popup.popup-confirmation .popup-button')].find((b) => text(b) === lang[key])!
const chatUpdate = (linked?: number) => rootScope.dispatchEventSingle(RT.chatUpdate, {
  peer: { _: 'peerChannel', channel_id: CHANNEL_ID },
  chat_full: { _: 'messages.chatFull', full_chat: fullOf(CHANNEL_ID, linked ? { linked_chat_id: linked } : {}), chats: [CHANNEL], users: [] },
} as never)

describe('вкладка «Группа обсуждения» — видимость по состоянию', () => {
  it('канал без обсуждения: кандидаты с @именем / «частная группа», «Создать новую группу», без «Отвязать»', async() => {
    const tab = await open()

    expect(text(tab.title)).toBe(lang['DiscussionController.Channel.Title'])
    expect(tab.container.classList.contains('chat-discussion-container')).toBe(true)
    expect(tab.container.classList.contains('chat-folders-container')).toBe(true)
    expect(caption(tab)).toBe(lang.DiscussionChannelHelp3)
    expect(tab.scrollable.container.textContent).toContain(lang.DiscussionChannelHelp2)
    expect(channels.discussionCandidates).toHaveBeenCalledWith(-CHANNEL_ID)

    expect(visibleRows(tab).map((row) => row.dataset.peerId)).toEqual([String(-PUBLIC_GROUP), String(-PRIVATE_GROUP), String(-FORUM_GROUP)])
    expect(subtitle(rowOf(tab, PUBLIC_GROUP))).toBe('@pubchat')
    expect(subtitle(rowOf(tab, PRIVATE_GROUP))).toBe(lang['DiscussionController.PrivateGroup'])
    expect(button(tab, 'DiscussionCreateGroup')).not.toBeUndefined()
    expect(unlinkSection(tab).classList.contains('hide')).toBe(true)
  })

  it('канал с обсуждением: видна только привязанная группа, подпись с её именем, «Отвязать группу»', async() => {
    const tab = await open(PRIVATE_GROUP)

    expect(visibleRows(tab).map((row) => row.dataset.peerId)).toEqual([String(-PRIVATE_GROUP)])
    expect(caption(tab)).toContain('Private Chat')
    expect(button(tab, 'DiscussionCreateGroup')).toBeUndefined()
    expect(unlinkSection(tab).classList.contains('hide')).toBe(false)
  })

  it('кадр chat_update канала переключает вкладку без перезапроса', async() => {
    const tab = await open()

    chatUpdate(PUBLIC_GROUP)
    await settle()
    expect(visibleRows(tab).map((row) => row.dataset.peerId)).toEqual([String(-PUBLIC_GROUP)])
    expect(unlinkSection(tab).classList.contains('hide')).toBe(false)

    chatUpdate()
    await settle()
    expect(visibleRows(tab)).toHaveLength(3)
    expect(button(tab, 'DiscussionCreateGroup')).not.toBeUndefined()
    expect(channels.discussionCandidates).toHaveBeenCalledTimes(1)
  })

  it('клик по привязанной группе открывает её чат, а не привязку', async() => {
    const tab = await open(PRIVATE_GROUP)

    click(rowOf(tab, PRIVATE_GROUP))
    await settle()

    expect(openPeer).toHaveBeenCalledWith({ peerId: -PRIVATE_GROUP })
    expect(popup()).toBeNull()
  })
})

describe('вкладка «Группа обсуждения» — сеть в момент оригинала', () => {
  it('привязка — только после подтверждения; описание собрано по приватности и истории', async() => {
    const tab = await open()

    click(rowOf(tab, PRIVATE_GROUP))
    await settle()
    expect(popup()).not.toBeNull()
    expect(channels.linkDiscussion).not.toHaveBeenCalled()
    const description = text(popup()!.querySelector('.popup-description'))
    expect(description).toContain(lang['Discussion.Set.PrivateChannel'])
    expect(description).toContain(lang['Discussion.Set.PrivateGroup'])
    expect(description).toContain(lang.DiscussionLinkGroupAlertHistory)

    click(popupButton('DiscussionLinkGroup'))
    await settle()
    expect(channels.linkDiscussion).toHaveBeenCalledTimes(1)
    expect(channels.linkDiscussion).toHaveBeenCalledWith(-CHANNEL_ID, -PRIVATE_GROUP)
  })

  it('отмена подтверждения — сети нет', async() => {
    const tab = await open()

    click(rowOf(tab, PUBLIC_GROUP))
    await settle()
    click(popupButton('Cancel'))
    await pause(400)

    expect(channels.linkDiscussion).not.toHaveBeenCalled()
  })

  it('форум не привязывается: тост, без попапа', async() => {
    const tab = await open()

    click(rowOf(tab, FORUM_GROUP))
    await settle()

    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'ChannelTopicsDiscussionForbidden' })
    expect(popup()).toBeNull()
    expect(channels.linkDiscussion).not.toHaveBeenCalled()
  })

  it('отвязка — только после подтверждения, ручкой канала', async() => {
    const tab = await open(PRIVATE_GROUP)

    click(button(tab, 'DiscussionUnlinkGroup')!)
    await settle()
    expect(popup()).not.toBeNull()
    expect(channels.unlinkDiscussion).not.toHaveBeenCalled()

    click(popupButton('DiscussionUnlink'))
    await settle()
    expect(channels.unlinkDiscussion).toHaveBeenCalledTimes(1)
    expect(channels.unlinkDiscussion).toHaveBeenCalledWith(-CHANNEL_ID)
  })

  it('сторона группы (Б-119): привязанный канал строкой, «Отвязать канал» — ручкой канала', async() => {
    const tab = slider.createTab(AppChatDiscussionTab)
    await tab.open({ chatId: PRIVATE_GROUP, linkedChatId: CHANNEL_ID })
    await settle()

    expect(text(tab.title)).toBe(lang['DiscussionController.Group.Title'])
    expect(rows(tab).map((row) => row.dataset.peerId)).toEqual([String(-CHANNEL_ID)])

    click(button(tab, 'DiscussionUnlinkChannel')!)
    await settle()
    click(popupButton('DiscussionUnlink'))
    await settle()
    expect(channels.unlinkDiscussion).toHaveBeenCalledWith(-CHANNEL_ID)
  })

  it('«Создать новую группу» открывает «Новую группу» с нагрузкой оригинала; `onCreate` привязывает её', async() => {
    const tab = await open()
    const opened: { ctor: unknown, payload: Record<string, unknown> }[] = []
    vi.spyOn(slider, 'createTab').mockImplementation(((ctor: unknown) => ({
      open: (payload: Record<string, unknown>) => {
        opened.push({ ctor, payload })
        return Promise.resolve()
      },
    })) as never)
    const removeFromHistory = vi.spyOn(slider, 'removeTabFromHistory')

    click(button(tab, 'DiscussionCreateGroup')!)
    await settle()

    expect(opened).toHaveLength(1)
    expect(opened[0].ctor).toBe(AppNewGroupTab)
    expect(opened[0].payload).toMatchObject({ peerIds: [], openAfter: false, title: 'News Chat', asChannel: true })
    expect(channels.linkDiscussion).not.toHaveBeenCalled()

    await (opened[0].payload.onCreate as (chatId: number) => Promise<void>)(77)
    expect(removeFromHistory).toHaveBeenCalledWith(tab)
    expect(channels.linkDiscussion).toHaveBeenCalledWith(-CHANNEL_ID, -77)
  })
})
