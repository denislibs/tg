/** @jsxImportSource solid-js */
// Добавление участников из профиля — задача 0б-8 (П-1): угловая кнопка
// вкладки профиля `btnAddMembers` (tweb `sharedMedia.tsx:903-911`) зовёт
// `addChatUsers({peerId, slider})` (tweb `components/addChatUsers.ts`, у нас —
// `components/addChatUsers.ts` над `AppAddMembersTab`), а видна она классом
// вкладки `can-add-members` — участники видны И есть право `invite_users`
// (`cleanupHTML`, tweb `:76-87`; стили — `_rightSidebar.scss`).
//
// Вкладка и `AppSearchSuper` настоящие, заглушены профиль, карусель аватарок
// и сам `addChatUsers` (его предмет — вкладка выбора и попап подтверждения).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PeerProfileProps } from '@components/peerProfile.solid'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { resetSharedMediaHistories } from '@components/sharedMediaHistories'
import type { Channel } from '@core/peers/peer'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import addChatUsers from '@components/addChatUsers'
import AppSharedMediaTab from './sharedMediaTab'

vi.mock('@components/addChatUsers', () => ({ default: vi.fn() }))

vi.mock('@components/peerProfile.solid', () => ({
  default: (props: PeerProfileProps) => () => {
    const div = document.createElement('div')
    div.className = 'profile-content'
    div.append(props.avatarsContainer!, props.searchSuperContainer!)
    return div
  },
}))

vi.mock('@components/peerProfileAvatars', () => ({
  default: class {
    container = document.createElement('div')
    info = document.createElement('div')
    hasPhoto = false
    setPeer = vi.fn(async() => {})
    setCollapsed = vi.fn()
    updateHeaderFilled = () => {}
    cleanup = vi.fn()
  },
}))

const INVITER: PeerId = -100
const MEMBER: PeerId = -101

const channel = (id: number, pFlags: Channel['pFlags'], extra: Partial<Channel> = {}): Channel => ({
  _: 'channel', id, title: 'C' + id, photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags,
  default_banned_rights: { _: 'chatBannedRights', pFlags: {}, until_date: 0 }, ...extra,
} as Channel)

const managers = {
  messages: {
    searchCounters: async(_peerId: number, filters: string[]) => filters.map((filter) => ({ filter, count: 0 })),
    searchHistory: async() => ({ messages: [], count: 0 }),
  },
  peers: { fillMirror: async() => {} },
  groups: {
    channelParticipants: async() => ({ _: 'channels.channelParticipants', count: 0, participants: [], chats: [], users: [] }),
    addMember: vi.fn(), removeMember: vi.fn(), unban: vi.fn(),
  },
  stories: { pinnedStories: async() => [] },
  chats: { savedDialogs: async() => ({}) },
  stars: { profileGifts: async() => [] },
  presence: { get: async() => undefined },
  contacts: { getContactsPeerIds: async() => [], isContact: async() => false },
  channels: { search: async() => ({}) },
  dialogs: { getDialogs: async() => ({ dialogs: [] }) },
} as unknown as Managers

const settle = async() => {
  for(let i = 0; i < 10; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const slider = { createTab: vi.fn(), onCloseBtnClick: vi.fn(), deleteTab: vi.fn() }
const tabs: AppSharedMediaTab[] = []

async function openTab(peerId: PeerId) {
  const tab = new AppSharedMediaTab(undefined, false)
  tabs.push(tab)
  tab.managers = managers
  tab.slider = slider as unknown as AppSharedMediaTab['slider']
  document.body.append(tab.container)
  tab.setPeer(peerId)
  ;(await tab.fillProfileElements())?.()
  await tab.loadSidebarMedia(true)
  await settle()
  return tab
}

const cornerButton = (tab: AppSharedMediaTab) => tab.content.querySelector<HTMLElement>('.btn-corner')!

beforeEach(() => {
  rootScope.myId = 1
  resetPeerMirror()
  resetSharedMediaHistories()
  vi.mocked(addChatUsers).mockClear()
  applyPeerOps([{ op: 'upsert', peers: [
    channel(100, { megagroup: true }, { admin_rights: { _: 'chatAdminRights', pFlags: { invite_users: true } } }),
    channel(101, { megagroup: true }, { default_banned_rights: { _: 'chatBannedRights', pFlags: { invite_users: true }, until_date: 0 } }),
  ] }])
})

afterEach(() => {
  tabs.splice(0).forEach((tab) => tab.destroy())
  document.body.replaceChildren()
  rootScope.myId = 0
})

describe('«Добавить участников» из профиля (0б-8, tweb sharedMedia.tsx:903-911)', () => {
  it('с правом invite_users вкладка помечена can-add-members; клик по угловой кнопке — addChatUsers({peerId, slider})', async() => {
    const tab = await openTab(INVITER)
    expect(tab.container.classList.contains('can-add-members')).toBe(true)

    cornerButton(tab).click()
    expect(addChatUsers).toHaveBeenCalledWith({ peerId: INVITER, slider })
  })

  it('без права invite_users класса нет — кнопка не показывается стилями вкладки', async() => {
    const tab = await openTab(MEMBER)
    expect(tab.container.classList.contains('can-add-members')).toBe(false)
  })
})
