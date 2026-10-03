/** @jsxImportSource solid-js */
/**
 * Вкладка «Изменить» группы и канала — порт tweb
 * `sidebarRight/tabs/editChat.tsx` (812502980), задача 0б-1 волны 7 (К-5).
 *
 * Вкладка НАСТОЯЩАЯ — `AppEditChatTab` из `solidJsTabs/tabs.ts`, открытая
 * настоящим `SidebarSlider` (`components/slider.ts`, навигация `'right'`, как у
 * `appSidebarRight`). Стабы — только границы: менеджеры воркера.
 *
 * Предмет:
 *  - модель сохранения оригинала (`save`, :408-436): правка полей сети не
 *    трогает, угловая галочка шлёт всё одним разом и закрывает вкладку;
 *    закрытие без галочки — отказ от правки, сети нет;
 *  - видимость строк по виду чата и правам (`hasRights`, :160-260): создатель
 *    группы и канала, админ группы, админ канала, участник группы. Базовых
 *    групп (`chat`) сервер не производит — «группа» у нас всегда мегагруппа;
 *  - строки открывают портированные вкладки слайдером (`createTab(…).open`);
 *  - тумблеры пишут сразу, живое обновление прав из зеркала пиров, удаление
 *    чата закрывает вкладку по исходу попапа.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Channel, ChannelFull } from '@core/peers/peer'
import lang from '@/lang'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import appNavigationController from '@core/navigation/appNavigationController'
import SidebarSlider from '@components/slider'
import {
  AppChatAdministratorsTab,
  AppChatInviteLinksTab,
  AppChatMembersTab,
  AppChatRequestsTab,
  AppChatTypeTab,
  AppEditChatTab,
  AppGroupPermissionsTab,
  AppRemovedUsersTab,
} from '@components/solidJsTabs/tabs'

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@components/toast')>()),
  toastNew,
}))

const ME = 1
const GROUP_ID = 30
const CHANNEL_ID = 20

const ADMIN_ALL = {
  _: 'chatAdminRights' as const,
  pFlags: { change_info: true, invite_users: true, ban_users: true, post_messages: true, pin_messages: true } as const,
}

const group = (extra: Partial<Channel> = {}): Channel => ({
  _: 'channel', id: GROUP_ID, title: 'Group', photo: { _: 'chatPhotoEmpty' }, date: 0,
  ...extra,
  pFlags: { megagroup: true, ...extra.pFlags },
} as Channel)
const channel = (extra: Partial<Channel> = {}): Channel => ({
  _: 'channel', id: CHANNEL_ID, title: 'Channel', photo: { _: 'chatPhotoEmpty' }, date: 0,
  ...extra,
  pFlags: { broadcast: true, ...extra.pFlags },
} as Channel)
const fullOf = (id: number, extra: Partial<ChannelFull> = {}): ChannelFull => ({
  _: 'channelFull', id, about: 'About', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null, ...extra,
})

// секция «Администраторы / Участники / Удалённые» (`editChat.tsx:849-873`, 0б-7)
const GROUP_PEOPLE = [lang['PeerInfo.Administrators'], lang.GroupMembers, lang.ChannelBlockedUsers]
const CHANNEL_PEOPLE = [lang['PeerInfo.Administrators'], lang['PeerInfo.Subscribers'], lang.ChannelBlockedUsers]

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let slider: SidebarSlider
let groups: Record<string, ReturnType<typeof vi.fn>>
let channels: Record<string, ReturnType<typeof vi.fn>>
let dialogs: Record<string, ReturnType<typeof vi.fn>>
let cards: Map<number, { chat: Channel, fullChat: ChannelFull }>

beforeEach(() => {
  resetPeerMirror()
  toastNew.mockReset()
  rootScope.myId = ME
  cards = new Map()
  groups = {
    card: vi.fn(async(peerId: number) => {
      const card = cards.get(peerId)
      return card ? { peerId, ...card } : null
    }),
    editInfo: vi.fn(async() => {}),
    setPhoto: vi.fn(async() => {}),
    setForum: vi.fn(async() => {}),
    setHistory: vi.fn(async() => {}),
    deleteGroup: vi.fn(async() => {}),
    // предзагрузка списка ссылок (`AppChatInviteLinksTab.getInitArgs`) — на клике строки
    getExportedChatInvites: vi.fn(async() => ({ _: 'messages.exportedChatInvites', count: 0, invites: [] })),
    exportChatInvite: vi.fn(async() => ({ _: 'chatInviteExported', link: 'https://t.me/+x', admin_id: ME, date: 0 })),
    removeMember: vi.fn(async() => {}),
  }
  channels = { setSignatures: vi.fn(async() => {}) }
  dialogs = { applyRemoved: vi.fn(async() => {}) }
  const managers = {
    groups,
    channels,
    dialogs,
    media: { upload: vi.fn(async() => 77) },
    peers: { fillMirror: vi.fn(async() => {}) },
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

const open = async(chat: Channel, full: ChannelFull = fullOf(chat.id)) => {
  cards.set(-chat.id, { chat, fullChat: full })
  applyPeerOps([{ op: 'upsert', peers: [chat] }])
  const tab = slider.createTab(AppEditChatTab)
  await tab.open({ chatId: chat.id })
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

// глиф иконки (`.tgico`) — символ из частной области Юникода, в подпись не входит
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[\uE000-\uF8FF]/g, '').trim()
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
// у строки с тумблером свой пустой `.row-title` у поля — берётся первый
const rowTitles = (tab: Tab) =>
  [...tab.scrollable.container.querySelectorAll('.row')].map((el) => text(el.querySelector('.row-title')))
const row = (tab: Tab, key: keyof typeof lang) =>
  [...tab.scrollable.container.querySelectorAll<HTMLElement>('.row')].find((el) => text(el.querySelector('.row-title')) === lang[key])
const corner = (tab: Tab) => tab.content.querySelector<HTMLButtonElement>('.btn-corner')
const fields = (tab: Tab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('.input-wrapper .input-field-input')]
const type = (input: HTMLElement, value: string) => {
  input.textContent = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const deleteButton = (tab: Tab) => tab.scrollable.container.querySelector<HTMLElement>('button.danger')

describe('вкладка «Изменить» — сохранение как у оригинала', () => {
  it('правка полей сети не трогает; галочка шлёт название и описание одним вызовом и закрывает вкладку', async() => {
    const tab = await open(group({ pFlags: { megagroup: true, creator: true } }))

    expect(text(tab.title)).toBe(lang.Edit)
    expect(tab.container.classList.contains('edit-peer-container')).toBe(true)
    expect(tab.container.classList.contains('edit-group-container')).toBe(true)
    expect(corner(tab)).toBeNull()

    const [name, about] = fields(tab)
    type(name, 'Renamed')
    type(about, 'New about')
    await settle()

    expect(groups.editInfo).not.toHaveBeenCalled()
    const btn = corner(tab)!
    expect(btn.classList.contains('is-visible')).toBe(true)
    expect(btn.hasAttribute('disabled')).toBe(false)

    click(btn)
    await settle()

    expect(groups.editInfo).toHaveBeenCalledTimes(1)
    expect(groups.editInfo).toHaveBeenCalledWith(-GROUP_ID, { title: 'Renamed', about: 'New about', username: '' })
    await pause(400)
    expect(tab.container.isConnected).toBe(false)
  })

  it('пустое название — галочка видна, но выключена; возврат к исходному прячет её', async() => {
    const tab = await open(group({ pFlags: { megagroup: true, creator: true } }))
    const [name] = fields(tab)

    type(name, '')
    await settle()
    expect(corner(tab)!.hasAttribute('disabled')).toBe(true)

    type(name, 'Group')
    await settle()
    expect(corner(tab)).toBeNull()
  })

  it('закрытие без галочки — отказ от правки: сети нет, Solid-корень снят', async() => {
    const tab = await open(group({ pFlags: { megagroup: true, creator: true } }))
    type(fields(tab)[0], 'Renamed')
    await settle()

    slider.onCloseBtnClick()
    await pause(400)

    expect(groups.editInfo).not.toHaveBeenCalled()
    expect(groups.setPhoto).not.toHaveBeenCalled()
    expect(tab.container.isConnected).toBe(false)
    expect(tab.scrollable.container.querySelector('.input-wrapper')).toBeNull()
  })
})

describe('вкладка «Изменить» — строки по виду чата и правам', () => {
  it('создатель группы: тип, ссылки, разрешения, темы с подписью тем; история; «Удалить и выйти»', async() => {
    const tab = await open(group({ pFlags: { megagroup: true, creator: true } }))

    expect(rowTitles(tab)).toEqual([lang.GroupType, lang.InviteLinks, lang.ChannelPermissions, lang.Topics, ...GROUP_PEOPLE, lang.ChatHistory])
    expect(text(row(tab, 'GroupType')!.querySelector('.row-subtitle'))).toBe(lang.TypePrivateGroup)
    expect(tab.scrollable.container.textContent).toContain(lang.ForumToggleDescription)
    expect(text(deleteButton(tab))).toBe(lang.DeleteAndExitButton)
    // аватар редактируемый — `AvatarEdit`, не `.disable-hover`
    expect(tab.scrollable.container.querySelector('button.avatar-edit')).not.toBeNull()
    expect(tab.scrollable.container.querySelector('.avatar-edit.disable-hover')).toBeNull()
  })

  it('создатель канала: тип и ссылки, без разрешений и тем; подписи; «Удалить канал»', async() => {
    const tab = await open(channel({ username: 'pub', pFlags: { broadcast: true, creator: true } }))

    expect(rowTitles(tab)).toEqual([lang.ChannelType, lang.InviteLinks, ...CHANNEL_PEOPLE, lang.ChannelSignMessages])
    expect(text(row(tab, 'ChannelType')!.querySelector('.row-subtitle'))).toBe(lang.TypePublic)
    expect(tab.scrollable.container.textContent).toContain(lang.DiscussionInfo)
    expect(tab.scrollable.container.textContent).toContain(lang.ChannelSignMessagesInfo)
    expect(text(deleteButton(tab))).toBe(lang['PeerInfo.DeleteChannel'])
  })

  it('админ группы (инфо, приглашения, баны): ссылки и разрешения, без типа, тем, истории и удаления', async() => {
    const tab = await open(group({ admin_rights: ADMIN_ALL }))

    expect(rowTitles(tab)).toEqual([lang.InviteLinks, lang.ChannelPermissions, ...GROUP_PEOPLE])
    expect(tab.scrollable.container.textContent).toContain(lang.DiscussionInfo)
    expect(deleteButton(tab)).toBeNull()
  })

  it('админ канала без прав инфо и приглашений: аватар не редактируется, поля выключены, только подписи', async() => {
    const tab = await open(channel({ admin_rights: { _: 'chatAdminRights', pFlags: { post_messages: true } } }))

    expect(rowTitles(tab)).toEqual([...CHANNEL_PEOPLE, lang.ChannelSignMessages])
    expect(tab.scrollable.container.querySelector('.avatar-edit.disable-hover')).not.toBeNull()
    expect(fields(tab).every((field) => field.hasAttribute('disabled'))).toBe(true)
    expect(deleteButton(tab)).toBeNull()
  })

  it('участник группы с запретом менять инфо: ни одной строки, поля выключены', async() => {
    const tab = await open(group({ default_banned_rights: { _: 'chatBannedRights', until_date: 0, pFlags: { change_info: true } } }))

    expect(rowTitles(tab)).toEqual(GROUP_PEOPLE)
    expect(fields(tab).every((field) => field.hasAttribute('disabled'))).toBe(true)
    expect(corner(tab)).toBeNull()
    expect(deleteButton(tab)).toBeNull()
  })

  it('права меняются в зеркале пиров — строки следом (`chat_update`)', async() => {
    const tab = await open(group({ admin_rights: ADMIN_ALL }))
    expect(rowTitles(tab)).toEqual([lang.InviteLinks, lang.ChannelPermissions, ...GROUP_PEOPLE])

    applyPeerOps([{ op: 'upsert', peers: [group({ admin_rights: { _: 'chatAdminRights', pFlags: { invite_users: true } } })] }])
    await settle()

    expect(rowTitles(tab)).toEqual([lang.InviteLinks, ...GROUP_PEOPLE])
  })

  // `editChat.tsx:700-708`: строка «Заявки» — у админа с правом приглашать и
  // только при `requests_pending`; сервер счётчика пока не шлёт (Б-115)
  it('«Заявки» — только при `requests_pending`; счётчики секции участников — как у оригинала', async() => {
    const tab = await open(
      group({ admin_rights: ADMIN_ALL, participants_count: 1234 }),
      fullOf(GROUP_ID, { requests_pending: 3, participants_count: 1234 }),
    )

    expect(rowTitles(tab)).toEqual([lang.InviteLinks, lang.MemberRequests, lang.ChannelPermissions, ...GROUP_PEOPLE])
    expect(text(row(tab, 'MemberRequests')!.querySelector('.row-subtitle'))).toBe('3')
    // `administratorsCount` — `count || 1` (:303-312); удалённых нет — `NoBlockedUsers` (:318-321)
    expect(text(row(tab, 'PeerInfo.Administrators')!.querySelector('.row-subtitle'))).toBe('1')
    expect(text(row(tab, 'GroupMembers')!.querySelector('.row-subtitle'))).toBe('1 234')
    expect(text(row(tab, 'ChannelBlockedUsers')!.querySelector('.row-subtitle'))).toBe(lang.NoBlockedUsers)
  })
})

describe('вкладка «Изменить» — переходы и тумблеры', () => {
  it('строки открывают портированные вкладки слайдером с полезной нагрузкой оригинала', async() => {
    const tab = await open(group({ pFlags: { megagroup: true, creator: true } }), fullOf(GROUP_ID, { about: 'x' }))
    const opened: { ctor: unknown, payload: unknown }[] = []
    vi.spyOn(slider, 'createTab').mockImplementation(((ctor: unknown) => ({
      open: (payload: unknown) => {
        opened.push({ ctor, payload })
        return Promise.resolve()
      },
    })) as never)

    click(row(tab, 'GroupType')!)
    click(row(tab, 'InviteLinks')!)
    click(row(tab, 'ChannelPermissions')!)

    expect(opened.map((o) => o.ctor)).toEqual([AppChatTypeTab, AppChatInviteLinksTab, AppGroupPermissionsTab])
    expect(opened[0].payload).toMatchObject({ chatId: GROUP_ID, chatFull: { about: 'x' } })
    expect(opened[1].payload).toMatchObject({ chatId: GROUP_ID })
    expect(opened[2].payload).toEqual({ chatId: GROUP_ID })
  })

  // `editChat.tsx:700-708`, `:849-873` — вкладки 0б-7
  it('строки участников открывают вкладки 0б-7 с полезной нагрузкой оригинала', async() => {
    const tab = await open(group({ pFlags: { megagroup: true, creator: true } }), fullOf(GROUP_ID, { requests_pending: 1 }))
    const opened: { ctor: unknown, payload: unknown }[] = []
    vi.spyOn(slider, 'createTab').mockImplementation(((ctor: unknown) => ({
      open: (payload: unknown) => {
        opened.push({ ctor, payload })
        return Promise.resolve()
      },
    })) as never)

    click(row(tab, 'MemberRequests')!)
    click(row(tab, 'PeerInfo.Administrators')!)
    click(row(tab, 'GroupMembers')!)
    click(row(tab, 'ChannelBlockedUsers')!)

    expect(opened.map((o) => o.ctor)).toEqual([AppChatRequestsTab, AppChatAdministratorsTab, AppChatMembersTab, AppRemovedUsersTab])
    expect(opened.map((o) => o.payload)).toEqual([GROUP_ID, { chatId: GROUP_ID }, GROUP_ID, { chatId: GROUP_ID }])
  })

  it('тумблер тем пишет сразу и перечитывает карточку; история — сразу', async() => {
    const tab = await open(group({ pFlags: { megagroup: true, creator: true } }))
    groups.card.mockClear()

    click(row(tab, 'Topics')!.querySelector('input')!)
    await settle()
    expect(groups.setForum).toHaveBeenCalledWith(-GROUP_ID, true)
    expect(groups.card).toHaveBeenCalledWith(-GROUP_ID)

    click(row(tab, 'ChatHistory')!.querySelector('input')!)
    await settle()
    expect(groups.setHistory).toHaveBeenCalledWith(-GROUP_ID, false)
    expect(groups.editInfo).not.toHaveBeenCalled()
  })

  it('темы у группы с обсуждением не включаются — тост, тумблер на месте', async() => {
    const tab = await open(group({ pFlags: { megagroup: true, creator: true } }), fullOf(GROUP_ID, { linked_chat_id: 5 }))

    click(row(tab, 'Topics')!.querySelector('input')!)
    await settle()

    expect(groups.setForum).not.toHaveBeenCalled()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'ChannelTopicsDiscussionForbidden' })
    expect(row(tab, 'Topics')!.querySelector('input')!.checked).toBe(false)
  })

  it('подпись сообщений канала пишется сразу, второй тумблер появляется под первым', async() => {
    const tab = await open(channel({ pFlags: { broadcast: true, creator: true } }))
    expect(row(tab, 'ChannelSignMessagesWithProfile')).toBeUndefined()

    click(row(tab, 'ChannelSignMessages')!.querySelector('input')!)
    await settle()

    expect(channels.setSignatures).toHaveBeenCalledWith(-CHANNEL_ID, true, false)
    expect(row(tab, 'ChannelSignMessagesWithProfile')).not.toBeUndefined()
  })

  it('«Удалить и выйти» открывает попап удаления; выход закрывает вкладку', async() => {
    const tab = await open(group({ pFlags: { megagroup: true, creator: true } }))

    click(deleteButton(tab)!)
    await settle()
    const popup = document.querySelector('.popup.popup-delete-chat')
    expect(popup).not.toBeNull()

    click(popup!.querySelector('.popup-button.danger')!)
    await settle()
    expect(groups.removeMember).toHaveBeenCalledWith(-GROUP_ID, ME)

    await pause(400)
    expect(tab.container.isConnected).toBe(false)
  })
})
