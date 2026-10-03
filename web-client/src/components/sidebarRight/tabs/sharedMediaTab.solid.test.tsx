/** @jsxImportSource solid-js */
// Вкладка общих медиа `AppSharedMediaTab` (`sharedMediaTab.ts` + содержимое
// `sharedMedia.solid.tsx`, порт tweb `sidebarRight/tabs/sharedMediaTab.tsx` и
// `sharedMedia.tsx`), шаг К-5 волны 7.
//
// Настоящие: вкладка, её Solid-содержимое, класс `AppSearchSuper`, зеркало
// карточек. Заглушены — профиль `PeerProfile` (корень `.profile-content` с
// узлом класса внутри, предмет `peerProfile*.solid.test.tsx`), шапка-карусель
// `PeerProfileAvatars` (предмет `peerProfileAvatars.test.ts`). Менеджеры —
// фейк ручек, которые зовёт класс; слайдер — фейк `createTab`/`open`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onCleanup } from 'solid-js'
import type { PeerProfileProps } from '@components/peerProfile.solid'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { resetSharedMediaHistories } from '@components/sharedMediaHistories'
import type { Channel, UserReal } from '@core/peers/peer'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import { AppEditChatTab, AppEditContactTab } from '@components/solidJsTabs/tabs'
import AppSharedMediaTab from './sharedMediaTab'

const profiles = vi.hoisted(() => ({ mounted: 0, disposed: 0, last: undefined as undefined | { peerId: PeerId, threadId?: number } }))
vi.mock('@components/peerProfile.solid', () => ({
  default: (props: PeerProfileProps) => {
    ++profiles.mounted
    profiles.last = { peerId: props.peerId, threadId: props.threadId }
    onCleanup(() => ++profiles.disposed)
    const div = document.createElement('div')
    div.className = 'profile-content'
    div.append(props.avatarsContainer!, props.searchSuperContainer!)
    return div
  },
}))

const avatars = vi.hoisted(() => [] as { cleanup: ReturnType<typeof vi.fn>, setPeer: ReturnType<typeof vi.fn> }[])
vi.mock('@components/peerProfileAvatars', () => ({
  default: class {
    container = document.createElement('div')
    info = document.createElement('div')
    hasPhoto = false
    setPeer = vi.fn(async() => {})
    setCollapsed = vi.fn()
    updateHeaderFilled = () => {}
    cleanup = vi.fn()
    constructor() {
      avatars.push(this)
    }
  },
}))

const ME = 1
const CONTACT = 7
const STRANGER = 8
const GROUP: PeerId = -100
const CHANNEL: PeerId = -200
const ADMIN_CHANNEL: PeerId = -201
const FORUM: PeerId = -300
const THREAD = 55

const channel = (id: number, pFlags: Channel['pFlags'], extra: Partial<Channel> = {}): Channel => ({
  _: 'channel', id, title: 'C' + id, photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags,
  default_banned_rights: { _: 'chatBannedRights', pFlags: {}, until_date: 0 }, ...extra,
} as Channel)
const user = (id: number): UserReal => ({ _: 'user', id, first_name: 'U' + id, pFlags: {} } as UserReal)

function fakeManagers() {
  const searchCounters = vi.fn(async(_peerId: number, filters: string[], _threadId?: number) => filters.map((filter) => ({ filter, count: 2 })))
  const searchHistory = vi.fn(async(_options: { peerId: number, threadId?: number }) => ({ messages: [], count: 0 }))
  const channelParticipants = vi.fn(async() => ({ _: 'channels.channelParticipants', count: 0, participants: [], chats: [], users: [] }))
  const profileGifts = vi.fn(async() => [{}])
  const managers = {
    messages: { searchCounters, searchHistory },
    peers: { fillMirror: async() => {} },
    groups: { channelParticipants, addMember: vi.fn(), removeMember: vi.fn(), unban: vi.fn() },
    stories: { pinnedStories: async() => [] },
    chats: { savedDialogs: async() => ({}) },
    stars: { profileGifts },
    presence: { get: async() => undefined },
    contacts: { getContactsPeerIds: async() => [], isContact: async(peerId: PeerId) => peerId === CONTACT },
    channels: { search: async() => ({}) },
    dialogs: { getDialogs: async() => ({ dialogs: [] }) },
  } as unknown as Managers
  return { managers, searchCounters, searchHistory, channelParticipants, profileGifts }
}

const settle = async() => {
  for(let i = 0; i < 10; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let fake: ReturnType<typeof fakeManagers>
let slider: { createTab: ReturnType<typeof vi.fn>, onCloseBtnClick: ReturnType<typeof vi.fn>, deleteTab: ReturnType<typeof vi.fn>, open: ReturnType<typeof vi.fn> }
const tabs: AppSharedMediaTab[] = []

/** Как `chat.ts`: `createSharedMediaTab()` → `setPeer` → `fillProfileElements` → `loadSidebarMedia(true)`. */
async function openTab(peerId: PeerId, threadId?: number) {
  const tab = new AppSharedMediaTab(undefined, false)
  tabs.push(tab)
  tab.managers = fake.managers
  tab.slider = slider as unknown as AppSharedMediaTab['slider']
  document.body.append(tab.container)
  tab.setPeer(peerId, threadId)
  ;(await tab.fillProfileElements())?.()
  await tab.loadSidebarMedia(true)
  await settle()
  return tab
}

const menuTab = (tab: AppSharedMediaTab, type: string) => tab.searchSuper.mediaTabsMap.get(type as 'members')!.menuTab!
/** Карандаш — в первом пункте перехода шапки, рядом с заголовком (tweb `:549`). */
const editBtn = (tab: AppSharedMediaTab) => tab.header.querySelector<HTMLElement>('.transition-item .btn-icon')!

beforeEach(() => {
  rootScope.myId = ME
  resetPeerMirror()
  resetSharedMediaHistories()
  profiles.mounted = profiles.disposed = 0
  avatars.length = 0
  fake = fakeManagers()
  const open = vi.fn()
  slider = { createTab: vi.fn(() => ({ open })), onCloseBtnClick: vi.fn(), deleteTab: vi.fn(), open }
  applyPeerOps([{ op: 'upsert', peers: [
    user(CONTACT), user(STRANGER),
    channel(100, { megagroup: true }, { admin_rights: { _: 'chatAdminRights', pFlags: { change_info: true } } }),
    channel(200, { broadcast: true }),
    channel(201, { broadcast: true }, { admin_rights: { _: 'chatAdminRights', pFlags: {} } }),
    channel(300, { megagroup: true, forum: true }),
  ] }])
})

afterEach(() => {
  tabs.splice(0).forEach((tab) => tab.destroy())
  document.body.replaceChildren()
  rootScope.myId = 0
})

describe('AppSharedMediaTab — жизнь класса (tweb sharedMediaTab.tsx)', () => {
  it('setPeer на той же вкладке не пересоздаёт AppSearchSuper; вкладка на другого пира — свой', async() => {
    const a = await openTab(GROUP)
    const searchSuper = a.searchSuper
    expect(a.setPeer(GROUP)).toBe(false)
    a.setPeer(CHANNEL)
    expect(a.searchSuper).toBe(searchSuper)
    expect(searchSuper.searchContext.peerId).toBe(CHANNEL)

    const b = await openTab(CONTACT)
    expect(b.searchSuper).not.toBe(searchSuper)
  })

  it('профиль и AppSearchSuper — в одной прокрутке вкладки: узел класса внутри .profile-content', async() => {
    const tab = await openTab(GROUP)
    const content = tab.scrollable.container.querySelector('.profile-content')!
    expect(content.contains(tab.searchSuper.container)).toBe(true)
    expect(tab.container.classList.contains('shared-media-container')).toBe(true)
    expect(tab.container.classList.contains('profile-container')).toBe(true)
  })

  it('destroy снимает Solid-корень профиля, AppSearchSuper и карусель', async() => {
    const tab = await openTab(GROUP)
    const destroy = vi.spyOn(tab.searchSuper, 'destroy')
    expect(profiles.mounted).toBe(1)
    tabs.splice(tabs.indexOf(tab), 1)
    tab.destroy()
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(profiles.disposed).toBe(1)
    expect(avatars[0].cleanup).toHaveBeenCalled()
    expect(tab.container.isConnected).toBe(false)
  })

  it('«Избранное» — без профиля (noProfile): вкладки shared media сразу в .profile-content', async() => {
    const tab = await openTab(ME)
    expect(tab.noProfile).toBe(true)
    expect(profiles.mounted).toBe(0)
    expect(tab.searchSuper.container.parentElement!.classList.contains('profile-content')).toBe(true)
  })
})

describe('тред комментариев (решение 2026-10-03, tweb chat.ts:1007)', () => {
  it('участники — весь список группы; медиа — только треда; подарков и историй нет', async() => {
    const tab = await openTab(GROUP, THREAD)
    expect(profiles.last).toEqual({ peerId: GROUP, threadId: THREAD })

    // счётчики вкладок и выборка — с тредом (`appSearchSuper.ts:2728-2729`)
    expect(fake.searchCounters).toHaveBeenCalledWith(GROUP, expect.any(Array), THREAD)
    // участники: вкладка видна и грузит список группы (без фильтра треда)
    expect(menuTab(tab, 'members').classList.contains('hide')).toBe(false)
    expect(fake.channelParticipants).toHaveBeenCalledWith(GROUP, expect.any(Number), expect.any(Number))
    // подарки в треде скрыты (`:3070`) и не запрашиваются
    expect(menuTab(tab, 'gifts').classList.contains('hide')).toBe(true)
    expect(fake.profileGifts).not.toHaveBeenCalled()

    tab.searchSuper.selectTab(tab.searchSuper.mediaTabs.findIndex((t) => t.type === 'media'))
    await settle()
    expect(fake.searchHistory).toHaveBeenCalledWith(expect.objectContaining({ peerId: GROUP, threadId: THREAD }))
  })

  it('без треда та же группа считает медиа всей группы', async() => {
    await openTab(GROUP)
    expect(fake.searchCounters).toHaveBeenCalledWith(GROUP, expect.any(Array), undefined)
  })

  it('тема форума: вкладки участников нет (`!threadId || !isForum`)', async() => {
    const tab = await openTab(FORUM, THREAD)
    expect(menuTab(tab, 'members').classList.contains('hide')).toBe(true)
    expect(fake.channelParticipants).not.toHaveBeenCalled()
  })
})

describe('кнопка «Изменить» (tweb sharedMedia.tsx:131-163, :675-703)', () => {
  const visible = (tab: AppSharedMediaTab) => !editBtn(tab).classList.contains('hide')

  it('видна: контакт, админ канала, группа с change_info; скрыта: не контакт, не админ, своя «Избранное»', async() => {
    expect(visible(await openTab(CONTACT))).toBe(true)
    expect(visible(await openTab(ADMIN_CHANNEL))).toBe(true)
    expect(visible(await openTab(GROUP))).toBe(true)
    expect(visible(await openTab(STRANGER))).toBe(false)
    expect(visible(await openTab(CHANNEL))).toBe(false)
    expect(visible(await openTab(ME))).toBe(false)
  })

  it('группа/канал → AppEditChatTab({chatId}), контакт → AppEditContactTab(peerId)', async() => {
    editBtn(await openTab(GROUP)).click()
    expect(slider.createTab).toHaveBeenLastCalledWith(AppEditChatTab)
    expect(slider.open).toHaveBeenLastCalledWith({ chatId: 100 })

    editBtn(await openTab(CONTACT)).click()
    expect(slider.createTab).toHaveBeenLastCalledWith(AppEditContactTab)
    expect(slider.open).toHaveBeenLastCalledWith(CONTACT)
  })
})
