/** @jsxImportSource solid-js */
/**
 * Вкладка прав участника — порт tweb `sidebarRight/tabs/chatUserPermissions.tsx`
 * (812502980), задача 0б-7 волны 7 (П-1).
 *
 * Вкладка НАСТОЯЩАЯ — `AppUserPermissionsTab` (через `openUserPermissionsTab`),
 * открытая настоящим `SidebarSlider` (`navigationType: 'right'`). Стабы — только
 * границы: менеджеры воркера.
 *
 * Предмет:
 *  - разметка (секция «Что может…» со строкой пользователя над тумблерами;
 *    подпись прав админа; «Разжаловать»; «Длительность» и кнопки участника);
 *  - сеть — в момент оригинала: по угловой галочке (или «Save» подтверждения на
 *    закрытии), а не на каждом изменении тумблера (риск 1 этапа 0б);
 *  - «Разжаловать»/«Заблокировать» подменяют действие сохранения
 *    (`saveSomethingDifferent`);
 *  - закрытие снимает Solid-корень (DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Channel } from '@core/peers/peer'
import type { ChannelParticipantWire } from '@core/managers/groupsManager'
import { BANNED_RIGHTS_UNTIL_FOREVER } from '@core/managers/constants'
import lang from '@/lang'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import appNavigationController from '@core/navigation/appNavigationController'
import SidebarSlider from '@components/slider'
import { openUserPermissionsTab, AppUserPermissionsTab } from '@components/solidJsTabs/tabs'

const ME = 1
const GROUP_ID = 30
const USER_ID = 7

const group = (over: Partial<Channel> = {}): Channel => ({
  _: 'channel', id: GROUP_ID, title: 'Group', photo: { _: 'chatPhotoEmpty' }, date: 0,
  pFlags: { megagroup: true, creator: true },
  ...over,
} as Channel)

const member: ChannelParticipantWire = { _: 'channelParticipant', user_id: USER_ID, date: 1 }
const OTHER_ADMIN = 5
const admin: ChannelParticipantWire = {
  _: 'channelParticipantAdmin', user_id: USER_ID, promoted_by: OTHER_ADMIN, date: 1,
  admin_rights: { _: 'chatAdminRights', pFlags: { change_info: true, pin_messages: true } },
}
const restricted: ChannelParticipantWire = {
  _: 'channelParticipantBanned', peer: { _: 'peerUser', user_id: USER_ID }, kicked_by: ME, date: 100,
  banned_rights: { until_date: 0, pFlags: { send_media: true } },
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
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

beforeEach(() => {
  resetPeerMirror()
  rootScope.myId = ME
  applyPeerOps([{ op: 'upsert', peers: [group(), { _: 'user', id: USER_ID, first_name: 'Ivan', pFlags: {} }] }])
  groups = {
    editAdmin: vi.fn(async() => {}),
    editBanned: vi.fn(async() => {}),
    kickFromChat: vi.fn(async() => {}),
    clearChannelParticipantBannedRights: vi.fn(async() => {}),
  }
  const managers = {
    groups,
    peers: {
      getPeers: vi.fn(async(ids: PeerId[]) => ids.map((id) => ({ _: 'user', id, first_name: 'Ivan', pFlags: {} }))),
      fillMirror: vi.fn(async() => {}),
    },
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

const open = async(participant: ChannelParticipantWire, isAdmin?: boolean) => {
  const createTab = vi.spyOn(slider, 'createTab')
  openUserPermissionsTab(slider, GROUP_ID, participant, isAdmin)
  const tab = createTab.mock.results[0].value as InstanceType<typeof AppUserPermissionsTab>
  createTab.mockRestore()
  await tab.shown
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[-]/g, '').trim()
const sections = (tab: Tab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
const toggles = (tab: Tab) => [...sections(tab)[0].querySelectorAll<HTMLInputElement>('label.row input.checkbox-field-input')]
const saveIcon = (tab: Tab) => tab.header.querySelector<HTMLElement>('.btn-icon.primary.appear-zoom')!
const button = (tab: Tab, key: keyof typeof lang) =>
  [...tab.scrollable.container.querySelectorAll<HTMLElement>('button')].find((b) => text(b) === lang[key])
const flip = (input: HTMLInputElement) => {
  input.checked = !input.checked
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const popupButton = (popup: Element, label: string) =>
  [...popup.querySelectorAll<HTMLElement>('.popup-button')].find((b) => text(b) === label)!

describe('права админа', () => {
  it('заголовок и разметка: строка пользователя над тумблерами, подпись прав, «Разжаловать»', async() => {
    const tab = await open(admin, true)

    expect(text(tab.title)).toBe(lang.EditAdmin)
    expect(tab.container.classList.contains('user-permissions-container')).toBe(true)
    const [rights] = sections(tab)
    expect(text(rights.querySelector('.sidebar-left-section-name'))).toBe(lang.EditAdminWhatCanDo)
    // :89-120 — строка пользователя стоит ПЕРЕД заголовком секции
    const content = rights.querySelector('.sidebar-left-section-content')!
    expect(content.firstElementChild!.classList.contains('chatlist-container')).toBe(true)
    expect(content.querySelector('.chatlist-container [data-peer-id]')!.getAttribute('data-peer-id')).toBe(String(USER_ID))
    // без `add_admins` — «не сможет назначать» (`attachAdminRightsCaption`)
    expect(text(rights.querySelector('.sidebar-left-section-caption'))).toBe(lang['Channel.Admin.AdminRestricted'])
    expect(button(tab, 'Channel.Admin.Dismiss')).toBeTruthy()
    // права админа без изменений — галочка свёрнута
    expect(saveIcon(tab).classList.contains('appear-zoom--active')).toBe(false)
  })

  it('тумблер сеть не трогает; галочка шлёт `editAdmin` с правами и закрывает вкладку', async() => {
    const tab = await open(admin, true)
    const addAdmins = toggles(tab)[toggles(tab).length - 1]

    flip(addAdmins)
    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))
    expect(text(sections(tab)[0].querySelector('.sidebar-left-section-caption'))).toBe(lang['Channel.Admin.AdminAccess'])
    expect(groups.editAdmin).not.toHaveBeenCalled()

    click(saveIcon(tab))
    await waitFor(() => !tab.container.isConnected)
    expect(groups.editAdmin).toHaveBeenCalledTimes(1)
    expect(groups.editAdmin).toHaveBeenCalledWith(GROUP_ID, admin, {
      _: 'chatAdminRights',
      pFlags: { change_info: true, pin_messages: true, add_admins: true },
    }, '')
  })

  it('«Разжаловать» — `editAdmin` с пустыми правами вместо сохранения', async() => {
    const tab = await open(admin, true)

    click(button(tab, 'Channel.Admin.Dismiss')!)
    await waitFor(() => !tab.container.isConnected)
    expect(groups.editAdmin).toHaveBeenCalledWith(GROUP_ID, admin, { _: 'chatAdminRights', pFlags: {} }, '')
  })

  it('назначение участника: галочка видна сразу, «Разжаловать» нет; создатель видит все права', async() => {
    const tab = await open(member, true)

    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))
    expect(button(tab, 'Channel.Admin.Dismiss')).toBeUndefined()
    click(saveIcon(tab))
    await waitFor(() => !tab.container.isConnected)
    expect(groups.editAdmin).toHaveBeenCalledWith(GROUP_ID, member, expect.objectContaining({ _: 'chatAdminRights' }), '')
  })

  it('админ правит назначенного не им админа — тумблеры заблокированы, «Разжаловать» нет', async() => {
    applyPeerOps([{ op: 'upsert', peers: [group({ pFlags: { megagroup: true }, admin_rights: { _: 'chatAdminRights', pFlags: { add_admins: true, ban_users: true } } })] }])
    const tab = await open(admin, true)

    expect(text(sections(tab)[0].querySelector('.sidebar-left-section-caption'))).toBe(lang.EditAdminCantEdit)
    expect(button(tab, 'Channel.Admin.Dismiss')).toBeUndefined()
  })

  it('админ правит назначенного им самим админа (`promoted_by` = я) — «Разжаловать» есть (ревью #401, п. 5)', async() => {
    applyPeerOps([{ op: 'upsert', peers: [group({ pFlags: { megagroup: true }, admin_rights: { _: 'chatAdminRights', pFlags: { add_admins: true, ban_users: true } } })] }])
    const tab = await open({ ...admin, promoted_by: ME } as ChannelParticipantWire, true)

    expect(text(sections(tab)[0].querySelector('.sidebar-left-section-caption'))).not.toBe(lang.EditAdminCantEdit)
    expect(button(tab, 'Channel.Admin.Dismiss')).toBeTruthy()
  })

  it('ранг (:368-405): поле «Подпись» с рангом админа, правка уходит в `editAdmin`', async() => {
    const tab = await open({ ...admin, rank: 'модер' } as ChannelParticipantWire, true)
    const rankSection = sections(tab).find((el) => text(el.querySelector('.sidebar-left-section-name')) === lang.EditAdminRank)!
    expect(rankSection).toBeTruthy()
    expect(text(rankSection.querySelector('.sidebar-left-section-caption'))).toBe(lang.EditAdminRankInfo.replace('%1$s', lang.ChatAdmin))
    const field = rankSection.querySelector<HTMLElement>('.input-field-input')!
    expect(text(field)).toBe('модер')

    field.textContent = 'зам'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))
    saveIcon(tab).click()
    await waitFor(() => groups.editAdmin.mock.calls.length > 0)
    expect(groups.editAdmin.mock.calls[0][3]).toBe('зам')
  })

  it('у канала поля ранга нет', async() => {
    applyPeerOps([{ op: 'upsert', peers: [group({ pFlags: { broadcast: true, creator: true } })] }])
    const tab = await open(admin, true)
    expect(sections(tab).some((el) => text(el.querySelector('.sidebar-left-section-name')) === lang.EditAdminRank)).toBe(false)
  })
})

describe('ограничения участника', () => {
  it('заголовок и разметка: «Что может…», «Длительность», «Удалить исключение», «Заблокировать»', async() => {
    const tab = await open(restricted)

    expect(text(tab.title)).toBe(lang.UserRestrictions)
    expect(text(sections(tab)[0].querySelector('.sidebar-left-section-name'))).toBe(lang.UserRestrictionsCanDo)
    expect(text(sections(tab)[1].querySelector('.row-title'))).toBe(lang['UserPermissions.Duration'])
    expect(button(tab, 'GroupPermission.Delete')).toBeTruthy()
    expect(button(tab, 'UserRestrictionsBlock')).toBeTruthy()
    // :531-563 — подпись «Ограничил(а) … в …»
    expect(sections(tab)[2].querySelector('.sidebar-left-section-caption a')).not.toBeNull()
  })

  it('тумблер сеть не трогает; галочка шлёт `editBanned` с запретами навсегда', async() => {
    const tab = await open(member)
    // [send_messages, send_media, invite_users, pin_messages, change_info]
    flip(toggles(tab)[1])
    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))
    expect(groups.editBanned).not.toHaveBeenCalled()

    click(saveIcon(tab))
    await waitFor(() => !tab.container.isConnected)
    expect(groups.editBanned).toHaveBeenCalledWith(GROUP_ID, member, {
      _: 'chatBannedRights',
      until_date: BANNED_RIGHTS_UNTIL_FOREVER,
      pFlags: { send_media: true },
    })
  })

  it('«Удалить исключение» — `clearChannelParticipantBannedRights`', async() => {
    const tab = await open(restricted)

    click(button(tab, 'GroupPermission.Delete')!)
    await waitFor(() => !tab.container.isConnected)
    expect(groups.clearChannelParticipantBannedRights).toHaveBeenCalledWith(GROUP_ID, restricted)
    expect(groups.editBanned).not.toHaveBeenCalled()
  })

  it('«Заблокировать и удалить» спрашивает подтверждение, затем `kickFromChat`', async() => {
    const tab = await open(member)

    click(button(tab, 'UserRestrictionsBlock')!)
    const popup = await waitFor(() => document.querySelector('.popup-confirmation'))
    expect(text(popup.querySelector('.popup-title'))).toBe(lang.ChannelBlockUser)
    expect(groups.kickFromChat).not.toHaveBeenCalled()

    popupButton(popup, lang.Remove).click()
    await waitFor(() => !tab.container.isConnected)
    expect(groups.kickFromChat).toHaveBeenCalledWith(GROUP_ID, member)
  })
})

describe('закрытие', () => {
  it('Esc без изменений: сети нет, через 250 мс узла нет, корень состояния снят (DoD 5)', async() => {
    const tab = await open(restricted)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await pause(400)

    expect(tab.container.isConnected).toBe(false)
    expect(document.querySelector('.user-permissions-container')).toBeNull()
    expect(tab.isConfirmationNeededOnClose).toBeUndefined()
    expect(groups.editBanned).not.toHaveBeenCalled()
  })
})
