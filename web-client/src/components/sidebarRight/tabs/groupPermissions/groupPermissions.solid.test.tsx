/** @jsxImportSource solid-js */
/**
 * Вкладка «Разрешения» группы — порт tweb
 * `sidebarRight/tabs/groupPermissions/groupPermissions.tsx` (812502980), задача 0б-6
 * волны 7.
 *
 * Вкладка НАСТОЯЩАЯ — `AppGroupPermissionsTab` из `solidJsTabs/tabs.ts`, открытая
 * существующим `SidebarSlider` (`components/slider.ts`) с `navigationType: 'right'`
 * (тот же слайдер, что у `AppSidebarRight`). Стабы — только границы: менеджеры
 * воркера и всплывашка.
 *
 * Предмет: разметка оригинала (дамп `15-right-13-group-permissions`: заголовок,
 * классы контейнера, порядок секций, строки-ограничения, ползунок медленного
 * режима, исключения); сеть — в момент оригинала (по угловой галочке или «Save»
 * подтверждения на закрытии, а не на каждом изменении — риск 1 этапа 0б);
 * закрытие по Esc снимает Solid-корень (DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Channel, ChannelFull } from '@core/peers/peer'
import type { ChannelsChannelParticipants } from '@core/managers/groupsManager'
import lang from '@/lang'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import appNavigationController from '@core/navigation/appNavigationController'
import SidebarSlider from '@components/slider'
import { AppGroupPermissionsTab } from '@components/solidJsTabs/tabs'
import rootScope from '@lib/rootScope'
import { RT } from '@core/realtime/events'

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@components/toast')>()),
  toastNew,
}))

const GROUP_ID = 30
const PEER_ID = toPeerId(GROUP_ID, true)
const RESTRICTED_ID = 7
const ADMIN_ID = 1

const group = (over: Partial<Channel> = {}): Channel => ({
  _: 'channel',
  id: GROUP_ID,
  title: 'Group',
  photo: { _: 'chatPhotoEmpty' },
  date: 0,
  pFlags: { megagroup: true, creator: true },
  // участникам запрещено закреплять — тумблер снят
  default_banned_rights: { _: 'chatBannedRights', until_date: 0, pFlags: { pin_messages: true } },
  ...over,
} as Channel)

const FULL: ChannelFull = { _: 'channelFull', id: GROUP_ID, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null, slowmode_seconds: 30 }

const restricted = (count = 1): ChannelsChannelParticipants => ({
  _: 'channels.channelParticipants',
  count,
  participants: count ? [{
    _: 'channelParticipantBanned',
    peer: { _: 'peerUser', user_id: RESTRICTED_ID },
    kicked_by: ADMIN_ID,
    date: 0,
    banned_rights: { until_date: 0, pFlags: { send_media: true, pin_messages: true } },
  }] : [],
  chats: [],
  users: [],
})

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
let groups: {
  card: ReturnType<typeof vi.fn>
  editChatDefaultBannedRights: ReturnType<typeof vi.fn>
  setChargeStars: ReturnType<typeof vi.fn>
  getParticipants: ReturnType<typeof vi.fn>
  getParticipant: ReturnType<typeof vi.fn>
}

const install = (chat: Channel, banned = restricted()) => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [chat] }])
  groups.card.mockImplementation(async() => ({ peerId: PEER_ID, chat, fullChat: FULL }))
  groups.getParticipants.mockImplementation(async() => banned)
}

beforeEach(() => {
  // секция цены раскрывается WAAPI-анимацией высоты (`chargeForMessasgesSection` :61-79)
  Element.prototype.animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation)
  toastNew.mockReset()
  groups = {
    card: vi.fn(),
    editChatDefaultBannedRights: vi.fn(async() => {}),
    setChargeStars: vi.fn(async() => {}),
    getParticipants: vi.fn(),
    getParticipant: vi.fn(),
  }
  install(group())
  const managers = { groups, peers: { fillMirror: vi.fn(async() => {}) } } as unknown as Managers

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
  vi.restoreAllMocks()
  delete (Element.prototype as { animate?: unknown }).animate
})

const open = async() => {
  const tab = slider.createTab(AppGroupPermissionsTab)
  await tab.open({ chatId: GROUP_ID })
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

// глиф иконки (`.tgico`) — символ из частной области Юникода, в подпись не входит
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[-]/g, '').trim()
const sections = (tab: Tab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
const sectionName = (section: Element) => text(section.querySelector('.sidebar-left-section-name'))
const permissionRows = (tab: Tab) => [...sections(tab)[0].querySelectorAll<HTMLElement>('label.row')]
const toggleOf = (row: Element) => row.querySelector<HTMLInputElement>('input.checkbox-field-input')!
const saveIcon = (tab: Tab) => tab.header.querySelector<HTMLElement>('.btn-icon.primary.appear-zoom')!
const seek = (tab: Tab) => tab.container.querySelector<HTMLInputElement>('.range-steps-selector input.progress-line__seek')!
const flip = (input: HTMLInputElement) => {
  input.checked = !input.checked
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
const popupButton = (popup: Element, label: string) =>
  [...popup.querySelectorAll<HTMLElement>('.popup-button')].find((b) => text(b) === label)!

describe('вкладка «Разрешения» — разметка оригинала', () => {
  it('заголовок, классы контейнера, галочка в шапке скрыта, порядок секций', async() => {
    const tab = await open()

    expect(text(tab.title)).toBe(lang.ChannelPermissions)
    expect(tab.container.classList.contains('edit-peer-container')).toBe(true)
    expect(tab.container.classList.contains('group-permissions-container')).toBe(true)
    // :411 — галочка в шапке; без изменений — свёрнута (`appear-zoom` без `--active`)
    expect(saveIcon(tab)).not.toBeNull()
    expect(saveIcon(tab).classList.contains('appear-zoom--active')).toBe(false)

    // :415-427 — [права] [плата за сообщения] [медленный режим] [исключения];
    // секция цены появляется под тумблером платы (тест сохранения платы ниже)
    expect(sections(tab).map(sectionName)).toEqual([
      lang.ChannelPermissionsHeader,
      '',
      lang.Slowmode,
      lang.PrivacyExceptions,
    ])
  })

  it('права — пять строк-ограничений; снятый тумблер = запрет по умолчанию', async() => {
    const tab = await open()
    const rows = permissionRows(tab)

    expect(rows.map((row) => text(row.querySelector('.row-title')))).toEqual([
      lang.UserRestrictionsSend,
      lang.UserRestrictionsSendMedia,
      lang.UserRestrictionsInviteUsers,
      lang.UserRestrictionsPinMessages,
      lang.UserRestrictionsChangeInfo,
    ])
    // `row-with-toggle` дампа снят у HEAD 812502980 (строку размечает `Row.CheckboxFieldToggle`)
    for(const row of rows) {
      expect(row.classList.contains('accordion-row')).toBe(true)
      const field = row.querySelector('.checkbox-field')!
      expect(field.classList.contains('checkbox-field-toggle')).toBe(true)
      expect(field.classList.contains('checkbox-field-toggle-restriction')).toBe(true)
    }
    expect(rows.map((row) => toggleOf(row).checked)).toEqual([true, true, true, false, true])
  })

  it('медленный режим: восемь шагов, выбран шаг из `slowmode_seconds`, подпись — выбранный срок', async() => {
    const tab = await open()
    const slowmode = sections(tab)[2]
    const options = [...slowmode.querySelectorAll('.range-setting-selector-option')]

    expect(options.map((option) => text(option))).toEqual(['Off', '5s', '10s', '30s', '1m', '5m', '15m', '1h'])
    expect(options[0].classList.contains('is-first')).toBe(true)
    expect(options[7].classList.contains('is-last')).toBe(true)
    expect(options.map((option) => option.classList.contains('is-chosen'))).toEqual([false, false, false, true, false, false, false, false])
    expect(seek(tab).value).toBe('3')
    expect(text(slowmode.querySelector('.sidebar-left-section-caption'))).toBe('Members will be able to send only one message every 30 seconds.')
  })

  it('исключения: счётчик в подзаголовке, строка ограниченного — с тем, чего ему нельзя', async() => {
    const tab = await open()
    const exceptions = sections(tab)[3]

    const addRow = exceptions.querySelector('.row')!
    expect(text(addRow.querySelector('.row-title'))).toBe(lang.ChannelAddException)
    expect(text(addRow.querySelector('.row-subtitle'))).toBe('1 exception')
    expect(addRow.querySelector('.row-icon')).not.toBeNull()

    const list = exceptions.querySelector('.chatlist-container > ul.chatlist.chatlist-new')!
    const items = [...list.children] as HTMLElement[]
    expect(items).toHaveLength(1)
    expect(items[0].dataset.peerId).toBe(String(RESTRICTED_ID))
    // `pin_messages` запрещён и всем — в подзаголовок не идёт (:281-285)
    expect(text(items[0].querySelector('.row-subtitle'))).toBe(lang.UserRestrictionsNoSendMedia)
  })

  it('без исключений — «No exceptions», список пуст', async() => {
    install(group(), restricted(0))
    const tab = await open()
    const exceptions = sections(tab)[3]

    expect(text(exceptions.querySelector('.row .row-subtitle'))).toBe(lang['Permissions.NoExceptions'])
    expect(exceptions.querySelector('ul.chatlist')!.children).toHaveLength(0)
  })

  it('исключения: запрос страницы — `getParticipants` с фильтром ограниченных и смещением по строкам', async() => {
    await open()
    expect(groups.getParticipants).toHaveBeenCalledWith({
      id: GROUP_ID, filter: { _: 'channelParticipantsBanned', q: '' }, limit: 50, offset: 0,
    })
  })

  it('исключения живут по `chat_participant` (:307-341): ограничен — строкой, снят — убран, чужой чат не трогает', async() => {
    const tab = await open()
    const exceptions = sections(tab)[3]
    const list = exceptions.querySelector('ul.chatlist')!
    const subtitle = () => text(exceptions.querySelector('.row .row-subtitle'))

    const banned = (userId: number) => ({
      _: 'channelParticipantBanned' as const, peer: { _: 'peerUser' as const, user_id: userId }, kicked_by: ADMIN_ID, date: 0,
      banned_rights: { until_date: 0, pFlags: { send_media: true as const } },
    })
    const frame = (userId: number, prev: unknown, next: unknown, channelId = GROUP_ID) => rootScope.dispatchEventSingle(RT.chatParticipant, {
      _: 'updateChannelParticipant', channel_id: channelId, date: 1, user_id: userId,
      prev_participant: prev as never, new_participant: next as never,
    })

    frame(8, { _: 'channelParticipant', user_id: 8, date: 0 }, banned(8))
    await settle()
    expect([...list.children].map((el) => (el as HTMLElement).dataset.peerId)).toEqual(['8', String(RESTRICTED_ID)])
    expect(subtitle()).toBe('2 exceptions')

    frame(RESTRICTED_ID, restricted().participants[0], undefined)
    await settle()
    expect([...list.children].map((el) => (el as HTMLElement).dataset.peerId)).toEqual(['8'])
    expect(subtitle()).toBe('1 exception')

    frame(9, undefined, banned(9), GROUP_ID + 1)
    await settle()
    expect(list.children).toHaveLength(1)
  })

  it('щелчок по участнику не из списка исключений — `getParticipant` (:242-253)', async() => {
    const participant = { _: 'channelParticipant', user_id: 8, date: 0 }
    groups.getParticipant.mockImplementation(async() => participant)
    const tab = await open()
    const list = sections(tab)[3].querySelector('ul.chatlist')!
    // строка с чужим ключом: карты участника у вкладки нет
    const row = list.firstElementChild!.cloneNode(true) as HTMLElement
    row.dataset.peerId = '8'
    list.append(row)
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(groups.getParticipant).toHaveBeenCalledWith(GROUP_ID, 8)
  })

  it('публичная группа: закрепление и смена профиля закрыты замком, щелчок — тост', async() => {
    install(group({ username: 'pubgr' }))
    const tab = await open()
    const rows = permissionRows(tab)
    const locked = [rows[3], rows[4]]

    for(const row of locked) {
      expect(toggleOf(row).disabled).toBe(true)
      expect(row.querySelector('.checkbox-toggle-circle.with-lock')).not.toBeNull()
    }
    expect(toggleOf(rows[0]).disabled).toBe(false)

    rows[4].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'EditCantEditPermissionsPublic' })
  })
})

describe('вкладка «Разрешения» — сохранение (на галочке/закрытии, не на изменении)', () => {
  it('переключение права показывает галочку и НЕ зовёт сеть; галочка пишет права и медленный режим одним вызовом и закрывает вкладку', async() => {
    const tab = await open()
    flip(toggleOf(permissionRows(tab)[0]))
    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))

    await pause(300)
    expect(groups.editChatDefaultBannedRights).not.toHaveBeenCalled()
    expect(groups.setChargeStars).not.toHaveBeenCalled()

    saveIcon(tab).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await waitFor(() => !tab.container.isConnected)

    expect(groups.editChatDefaultBannedRights).toHaveBeenCalledTimes(1)
    expect(groups.editChatDefaultBannedRights).toHaveBeenCalledWith(PEER_ID, {
      _: 'chatBannedRights',
      until_date: 0x7FFFFFFF,
      pFlags: { send_messages: true, pin_messages: true },
    }, 30)
    // плата не менялась — её ручку не зовём (:116-121)
    expect(groups.setChargeStars).not.toHaveBeenCalled()
  })

  it('возврат права к исходному снимает галочку', async() => {
    const tab = await open()
    const input = toggleOf(permissionRows(tab)[1])
    flip(input)
    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))
    flip(input)
    await waitFor(() => !saveIcon(tab).classList.contains('appear-zoom--active'))
  })

  it('медленный режим: шаг ползунка меняет подпись и уходит в тот же вызов', async() => {
    const tab = await open()
    const input = seek(tab)
    input.value = '7'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))
    expect(text(sections(tab)[2].querySelector('.sidebar-left-section-caption'))).toBe('Members will be able to send only one message every 1 hour.')

    input.value = '0'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(text(sections(tab)[2].querySelector('.sidebar-left-section-caption'))).toBe(lang.SlowmodeInfoOff)
    input.value = '7'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    saveIcon(tab).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await waitFor(() => !tab.container.isConnected)
    expect(groups.editChatDefaultBannedRights).toHaveBeenCalledWith(PEER_ID, expect.objectContaining({ _: 'chatBannedRights' }), 3600)
  })

  it('плата за сообщения: тумблер открывает цену, сохранение пишет её отдельной ручкой', async() => {
    const tab = await open()
    const charge = sections(tab)[1]
    expect(text(charge.querySelector('.row-title'))).toBe(lang['PaidMessages.ChargeForMessages'])
    expect(text(charge.querySelector('.sidebar-left-section-caption'))).toBe(lang['PaidMessages.ChargeForGroupMessagesDescription'])

    flip(toggleOf(charge))
    await waitFor(() => sectionName(sections(tab)[2]) === lang['PaidMessages.SetPrice'] && sections(tab)[2])
    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))
    expect(groups.setChargeStars).not.toHaveBeenCalled()

    saveIcon(tab).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await waitFor(() => !tab.container.isConnected)
    expect(groups.setChargeStars).toHaveBeenCalledTimes(1)
    expect(groups.setChargeStars).toHaveBeenCalledWith(PEER_ID, 1)
    expect(groups.editChatDefaultBannedRights).toHaveBeenCalledTimes(1)
  })

  it('закрытие с изменениями спрашивает «Unsaved Changes»; Save пишет и закрывает', async() => {
    const tab = await open()
    flip(toggleOf(permissionRows(tab)[2]))
    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))

    tab.closeBtn.click()
    const popup = await waitFor(() => document.querySelector('.popup-confirmation'))
    expect(text(popup.querySelector('.popup-title'))).toBe(lang.UnsavedChanges)
    expect(text(popup.querySelector('.popup-description'))).toBe(lang['UnsavedChangesDescription.Group'])
    expect(tab.container.isConnected).toBe(true)
    expect(groups.editChatDefaultBannedRights).not.toHaveBeenCalled()

    popupButton(popup, lang.Save).click()
    await waitFor(() => !tab.container.isConnected)
    expect(groups.editChatDefaultBannedRights).toHaveBeenCalledTimes(1)
    expect(groups.editChatDefaultBannedRights.mock.calls[0][1].pFlags).toEqual({ invite_users: true, pin_messages: true })
  })

  it('Save на подтверждении закрывает ТОЛЬКО эту вкладку — нижняя остаётся открытой (стенд: колонка не схлопывается)', async() => {
    const base = await open()
    const tab = await open()
    flip(toggleOf(permissionRows(tab)[2]))
    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    const popup = await waitFor(() => document.querySelector('.popup-confirmation'))
    popupButton(popup, lang.Save).click()
    await waitFor(() => !tab.container.isConnected)
    await pause(400)

    expect(groups.editChatDefaultBannedRights).toHaveBeenCalledTimes(1)
    expect(base.container.isConnected).toBe(true)
    expect(base.container.classList.contains('active')).toBe(true)
  })

  it('Discard закрывает без записи', async() => {
    const tab = await open()
    flip(toggleOf(permissionRows(tab)[2]))
    await waitFor(() => saveIcon(tab).classList.contains('appear-zoom--active'))

    tab.closeBtn.click()
    const popup = await waitFor(() => document.querySelector('.popup-confirmation'))
    popupButton(popup, lang.Discard).click()

    await waitFor(() => !tab.container.isConnected)
    await pause(300)
    expect(groups.editChatDefaultBannedRights).not.toHaveBeenCalled()
  })
})

describe('вкладка «Разрешения» — закрытие', () => {
  it('Esc без изменений закрывает вкладку без записи; через 250 мс узла нет, Solid-корни сняты (DoD 5)', async() => {
    const tab = await open()
    const rows = permissionRows(tab)
    const icon = saveIcon(tab)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await pause(400)

    expect(tab.container.isConnected).toBe(false)
    expect(document.querySelector('.group-permissions-container')).toBeNull()
    expect(groups.editChatDefaultBannedRights).not.toHaveBeenCalled()
    // корень вкладки снят (`dispose` в `onCloseAfterTimeout`): его секций в узле больше нет
    expect(tab.scrollable.container.querySelector('.sidebar-left-section-container')).toBeNull()
    // корень состояния снят вместе с middleware вкладки
    expect(tab.isConfirmationNeededOnClose).toBeUndefined()

    // корень состояния снят: изменение поля больше не взводит галочку
    flip(toggleOf(rows[0]))
    await pause(300)
    expect(icon.classList.contains('appear-zoom--active')).toBe(false)
  })
})
