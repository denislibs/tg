/** @jsxImportSource solid-js */
/**
 * Вкладки участников правой колонки — порт tweb `sidebarRight/tabs/
 * {chatAdministrators,chatMembers,removedUsers,chatRequests}.tsx` (812502980),
 * задача 0б-7 волны 7 (П-1).
 *
 * Вкладки НАСТОЯЩИЕ (`solidJsTabs/tabs.ts`), слайдер — настоящий `SidebarSlider`
 * (`navigationType: 'right'`). Стабы — только границы: менеджеры воркера.
 *
 * Предмет: классы контейнера и заголовок, угловая кнопка по праву, строки
 * селектора с подписями оригинала, что открывает щелчок по строке (вкладка
 * прав участника — в историю слайдера), сеть заявок (одобрить/отклонить),
 * закрытие снимает корень.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Channel } from '@core/peers/peer'
import type { ChannelParticipantWire, ChannelParticipantsFilter } from '@core/managers/groupsManager'
import lang from '@/lang'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import appNavigationController from '@core/navigation/appNavigationController'
import SidebarSlider from '@components/slider'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import {
  AppChatAdministratorsTab,
  AppChatMembersTab,
  AppChatRequestsTab,
  AppRemovedUsersTab,
  AppUserPermissionsTab,
} from '@components/solidJsTabs/tabs'

const ME = 1
const GROUP_ID = 30
const CHANNEL_ID = 20

const group = (over: Partial<Channel> = {}): Channel => ({
  _: 'channel', id: GROUP_ID, title: 'Group', photo: { _: 'chatPhotoEmpty' }, date: 0,
  pFlags: { megagroup: true, creator: true },
  ...over,
} as Channel)
const channel = (over: Partial<Channel> = {}): Channel => ({
  _: 'channel', id: CHANNEL_ID, title: 'Channel', photo: { _: 'chatPhotoEmpty' }, date: 0,
  pFlags: { broadcast: true, creator: true },
  ...over,
} as Channel)

const creator: ChannelParticipantWire = { _: 'channelParticipantCreator', user_id: ME, admin_rights: { _: 'chatAdminRights' } }
const admin: ChannelParticipantWire = { _: 'channelParticipantAdmin', user_id: 5, promoted_by: 1, date: 1, admin_rights: { _: 'chatAdminRights', pFlags: { pin_messages: true } } }
const member = (id: number): ChannelParticipantWire => ({ _: 'channelParticipant', user_id: id, date: 1 })
const kicked: ChannelParticipantWire = {
  _: 'channelParticipantBanned', pFlags: { left: true }, peer: { _: 'peerUser', user_id: 9 }, kicked_by: ME, date: 1,
  banned_rights: { until_date: 0 },
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 16; ++i) await pause(0)
}
async function waitFor<T>(get: () => T | null | undefined | false, timeout = 3000): Promise<T> {
  const started = Date.now()
  for(;;) {
    const value = get()
    if(value) return value
    if(Date.now() - started > timeout) throw new Error('waitFor: timeout')
    await pause(10)
  }
}

let slider: SidebarSlider
let groups: Record<string, ReturnType<typeof vi.fn>>
let participants: ChannelParticipantWire[]

beforeEach(() => {
  // заглушка пустого списка (`emptyPlaceholder`) грузит lottie — сеть
  vi.spyOn(lottieLoader, 'loadAnimationAsAsset').mockResolvedValue({} as LottiePlayer)
  vi.spyOn(lottieLoader, 'waitForFirstFrame').mockResolvedValue(undefined as never)
  resetPeerMirror()
  rootScope.myId = ME
  applyPeerOps([{ op: 'upsert', peers: [
    group(), channel(),
    ...[ME, 5, 6, 7, 9, 11, 12].map((id) => ({ _: 'user' as const, id, first_name: 'U' + id, pFlags: {} })),
  ] }])
  participants = [creator, admin, member(6), member(7)]
  groups = {
    getParticipants: vi.fn(async({ filter }: { filter: ChannelParticipantsFilter }) => {
      const list = filter._ === 'channelParticipantsAdmins' ?
        participants.filter((p) => p._ === 'channelParticipantCreator' || p._ === 'channelParticipantAdmin') :
        (filter._ === 'channelParticipantsKicked' ? [kicked] : participants)
      return { _: 'channels.channelParticipants', count: list.length, participants: list, chats: [], users: [] }
    }),
    getChatInviteImporters: vi.fn(async() => ({
      _: 'messages.chatInviteImporters', count: 2,
      importers: [11, 12].map((user_id) => ({ _: 'chatInviteImporter', user_id, date: 1700000000, pFlags: { requested: true } })),
    })),
    hideChatJoinRequest: vi.fn(async() => {}),
    kickFromChat: vi.fn(async() => {}),
    editBanned: vi.fn(async() => {}),
    addMember: vi.fn(async() => {}),
  }
  const managers = {
    groups,
    peers: {
      getPeers: vi.fn(async(ids: PeerId[]) => ids.map((id) => ({ _: 'user', id, first_name: 'U' + id, pFlags: {} }))),
      fillMirror: vi.fn(async() => {}),
    },
    dialogs: { getDialogs: vi.fn() },
    contacts: { getContactsPeerIds: vi.fn(async() => []), testSelfSearch: vi.fn(async() => false) },
    channels: { search: vi.fn() },
  } as unknown as Managers

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

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[-]/g, '').trim()
const rows = (tab: { content: HTMLElement }) => [...tab.content.querySelectorAll<HTMLElement>('ul.chatlist > a.row')]
const rowOf = (tab: { content: HTMLElement }, peerId: PeerId) => tab.content.querySelector<HTMLElement>(`ul.chatlist > a.row[data-peer-id="${peerId}"]`)!
const corner = (tab: { content: HTMLElement }) => tab.content.querySelector<HTMLElement>('.btn-corner')
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

describe('«Администраторы» (`chatAdministrators.tsx`)', () => {
  const open = async() => {
    const tab = slider.createTab(AppChatAdministratorsTab)
    await tab.open({ chatId: GROUP_ID })
    await settle()
    return tab
  }

  it('классы, заголовок, создатель и админы со строками; создатель — «Владелец»', async() => {
    const tab = await open()

    expect(tab.container.classList.contains('edit-peer-container')).toBe(true)
    expect(tab.container.classList.contains('chat-administrators-container')).toBe(true)
    expect(text(tab.title)).toBe(lang['PeerInfo.Administrators'])
    expect(groups.getParticipants.mock.calls[0][0]).toMatchObject({ id: GROUP_ID, filter: { _: 'channelParticipantsAdmins', q: '' } })
    expect(rows(tab).map((row) => +row.dataset.peerId!)).toEqual([ME, 5])
    expect(text(rowOf(tab, ME).querySelector('.row-subtitle'))).toBe(lang.ChannelCreator)
  })

  it('угловая кнопка — по праву `add_admins`', async() => {
    expect(corner(await open())).not.toBeNull()
    slider.closeAllTabs()
    await pause(400)

    applyPeerOps([{ op: 'upsert', peers: [group({ pFlags: { megagroup: true }, admin_rights: { _: 'chatAdminRights', pFlags: { pin_messages: true } } })] }])
    expect(corner(await open())).toBeNull()
  })

  it('щелчок по админу открывает его права (`editingAdmin`) в истории слайдера', async() => {
    const tab = await open()
    const createTab = vi.spyOn(slider, 'createTab')

    click(rowOf(tab, 5))
    await settle()

    expect(createTab).toHaveBeenCalledWith(AppUserPermissionsTab)
    const permissions = createTab.mock.results[0].value as InstanceType<typeof AppUserPermissionsTab>
    expect(permissions.payload).toEqual({ participant: admin, chatId: GROUP_ID, userId: 5, editingAdmin: true })
  })

  it('закрытие снимает селектор и классы', async() => {
    const tab = await open()
    tab.close()
    await pause(400)

    expect(tab.container.isConnected).toBe(false)
    expect(tab.container.classList.contains('chat-administrators-container')).toBe(false)
    expect(tab.content.querySelector('.selector')).toBeNull()
  })
})

describe('«Участники» (`chatMembers.tsx`)', () => {
  const open = async(chatId: ChatId) => {
    const tab = slider.createTab(AppChatMembersTab)
    await tab.open(chatId)
    await settle()
    return tab
  }

  it('группа: «Участники», все участники, кнопка добавления по `invite_users`', async() => {
    const tab = await open(GROUP_ID)

    expect(tab.container.classList.contains('chat-members-container')).toBe(true)
    expect(text(tab.title)).toBe(lang.GroupMembers)
    expect(groups.getParticipants.mock.calls[0][0]).toMatchObject({ filter: { _: 'channelParticipantsSearch', q: '' }, limit: 50, offset: 0 })
    expect(rows(tab)).toHaveLength(4)
    expect(corner(tab)).not.toBeNull()
  })

  it('канал: «Подписчики»', async() => {
    const tab = await open(CHANNEL_ID)
    expect(text(tab.title)).toBe(lang['PeerInfo.Subscribers'])
  })
})

describe('«Удалённые» (`removedUsers.tsx`)', () => {
  const open = async() => {
    const tab = slider.createTab(AppRemovedUsersTab)
    await tab.open({ chatId: GROUP_ID })
    await settle()
    return tab
  }

  it('подпись секции над списком, выгнанные с «Удалил(а) …», кнопка по праву банить', async() => {
    const tab = await open()

    expect(tab.container.classList.contains('removed-users-container')).toBe(true)
    expect(text(tab.title)).toBe(lang.ChannelBlacklist)
    expect(groups.getParticipants.mock.calls[0][0]).toMatchObject({ filter: { _: 'channelParticipantsKicked', q: '' } })
    expect(rows(tab).map((row) => +row.dataset.peerId!)).toEqual([9])
    expect(text(rowOf(tab, 9).querySelector('.row-subtitle'))).toBe(lang.UserRemovedBy.replace('%1$s', 'U1'))
    // :56-65 — подпись стоит перед контейнером высоты селектора
    const caption = tab.content.querySelector('.selector-scrollable > .sidebar-left-section-container .sidebar-left-section-caption')
    expect(text(caption)).toBe(lang.NoBlockedGroup2)
    expect(corner(tab)).not.toBeNull()
  })
})

describe('«Заявки» (`chatRequests.tsx`)', () => {
  const open = async() => {
    const tab = slider.createTab(AppChatRequestsTab)
    await tab.open(GROUP_ID)
    await settle()
    return tab
  }

  it('строки заявок с кнопками; «Добавить»/«Отклонить» — `hideChatJoinRequest`, строка уходит; `finish` на закрытии', async() => {
    const tab = await open()
    const finish = vi.fn()
    tab.eventListener.addEventListener('finish', finish)

    expect(text(tab.title)).toBe(lang.MemberRequests)
    expect(groups.getChatInviteImporters).toHaveBeenCalledWith({
      chatId: GROUP_ID, limit: 50, link: undefined, requested: true, offsetDate: undefined, offsetUserId: undefined, q: '',
    })
    expect(rows(tab).map((row) => +row.dataset.peerId!)).toEqual([11, 12])
    const buttons = rowOf(tab, 11).querySelector('.chatlist-chat-buttons')!
    expect([...buttons.children].map(text)).toEqual([lang.AddToGroup, lang.Dismiss])

    click(buttons.querySelector('.btn-color-primary')!)
    await waitFor(() => !rowOf(tab, 11))
    expect(groups.hideChatJoinRequest).toHaveBeenLastCalledWith(GROUP_ID, 11, true)

    click(rowOf(tab, 12).querySelector('.btn-transparent')!)
    await waitFor(() => !rowOf(tab, 12))
    expect(groups.hideChatJoinRequest).toHaveBeenLastCalledWith(GROUP_ID, 12, false)

    tab.close()
    await pause(400)
    expect(finish).toHaveBeenCalledWith(2)
  })
})
