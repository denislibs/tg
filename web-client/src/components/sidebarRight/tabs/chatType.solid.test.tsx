/** @jsxImportSource solid-js */
/**
 * Вкладка «Тип канала / Тип группы» — порт tweb
 * `sidebarRight/tabs/chatType.tsx` (812502980), задача 0б-2 волны 7.
 *
 * Вкладка НАСТОЯЩАЯ — `AppChatTypeTab` из `solidJsTabs/tabs.ts`, открытая
 * существующим `SidebarSlider` (`components/slider.ts`) с `navigationType:
 * 'right'`: класса правой колонки (`sidebarRight/index.ts`, 0б-0) ещё нет,
 * слайдер — тот же, которым он будет. Стабы — только границы: менеджеры
 * воркера, буфер обмена и всплывашка.
 *
 * Предмет: разметка оригинала (заголовок, классы контейнера, порядок секций,
 * радио-форма, ссылка-приглашение, поле ссылки, угловая кнопка); сеть — в
 * момент оригинала (тип меняется по угловой кнопке, а не на каждом изменении);
 * подтверждение «сделать приватным» при снятии имени (`:214-229`); отзыв ссылки
 * попапом (`:103-121`); закрытие по Esc снимает Solid-корень (DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Channel, ChannelFull } from '@core/peers/peer'
import type { ChatInviteExported } from '@core/managers/groupsManager'
import { DEFAULT_TME_ORIGIN } from '@config/app'
import lang from '@/lang'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import appNavigationController from '@core/navigation/appNavigationController'
import SidebarSlider from '@components/slider'
import { AppChatTypeTab } from '@components/solidJsTabs/tabs'

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

const CHANNEL_ID = 20
const GROUP_ID = 30
const CHANNEL: Channel = { _: 'channel', id: CHANNEL_ID, title: 'Channel', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true, creator: true } } as Channel
const GROUP: Channel = { _: 'channel', id: GROUP_ID, title: 'Group', username: 'pubgr', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true, creator: true } } as Channel
const fullOf = (id: number): ChannelFull => ({ _: 'channelFull', id, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null })

// ссылка в форме оригинала — `link` публичный адрес `t.me/+<хеш>` нашего хоста (`core/publicLink.ts`)
const link = (hash: string): ChatInviteExported => ({ _: 'chatInviteExported', link: `${DEFAULT_TME_ORIGIN}/+${hash}`, admin_id: 1, date: 0 })

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let slider: SidebarSlider
let groups: {
  getExportedChatInvites: ReturnType<typeof vi.fn>
  editExportedChatInvite: ReturnType<typeof vi.fn>
  exportChatInvite: ReturnType<typeof vi.fn>
  setType: ReturnType<typeof vi.fn>
  checkUsername: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [CHANNEL, GROUP] }])
  toastNew.mockReset()
  copyTextToClipboard.mockClear()

  groups = {
    getExportedChatInvites: vi.fn(async() => ({ _: 'messages.exportedChatInvites', count: 1, invites: [link('primary')] })),
    editExportedChatInvite: vi.fn(async({ link: url }: { link: string }) => ({ _: 'messages.exportedChatInvite', invite: { ...link('x'), link: url, pFlags: { revoked: true } } })),
    exportChatInvite: vi.fn(async() => link('fresh')),
    setType: vi.fn(async() => {}),
    checkUsername: vi.fn(async(_peerId: number, username: string) => username !== 'takenname'),
  }
  const managers = { groups } as unknown as Managers

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
})

const open = async(chatId: number) => {
  const tab = slider.createTab(AppChatTypeTab)
  await tab.open({ chatId, chatFull: fullOf(chatId) })
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

// глиф иконки (`.tgico`) — символ из частной области Юникода, в подпись не входит
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[-]/g, '').trim()
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const sections = (tab: Tab) => [...tab.scrollable.container.children].slice(1) as HTMLElement[]
const radios = (tab: Tab) => [...tab.scrollable.container.querySelectorAll<HTMLInputElement>('form input[type=radio]')]
const applyBtn = (tab: Tab) => tab.content.querySelector<HTMLButtonElement>(':scope > .btn-corner')!
const linkInput = (tab: Tab) => tab.container.querySelector<HTMLInputElement>('.input-wrapper input')!
const choose = (input: HTMLInputElement) => {
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
const type = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const popupButton = (popupClass: string, key: keyof typeof lang) =>
  [...document.querySelectorAll<HTMLElement>(`.popup.${popupClass} .popup-button`)].find((b) => text(b) === lang[key])!

describe('вкладка «Тип» — разметка оригинала', () => {
  it('приватный канал: заголовок, классы контейнера, порядок секций, радио, ссылка-приглашение, скрытая публичная часть', async() => {
    const tab = await open(CHANNEL_ID)

    expect(text(tab.title)).toBe(lang.ChannelType)
    expect(tab.container.classList.contains('edit-peer-container')).toBe(true)
    expect(tab.container.classList.contains('group-type-container')).toBe(true)

    // :268 — [тип] [приватная ссылка] [публичная часть] ПОСЛЕ корня острова
    const [typeSection, privateSection, publicContainer, ...rest] = sections(tab)
    expect(rest).toHaveLength(0)
    expect(typeSection.className).toBe('sidebar-left-section-container')
    expect(text(typeSection.querySelector('.sidebar-left-h2'))).toBe(lang.ChannelType)

    // :47-55 — две строки радио-формы с подписями, выбрана «приватный» (:409)
    const rows = [...typeSection.querySelectorAll('form > .row')]
    expect(rows.map((row) => text(row.querySelector('.row-title')))).toEqual([lang.ChannelPrivate, lang.ChannelPublic])
    expect(rows.map((row) => text(row.querySelector('.row-subtitle')))).toEqual([lang.ChannelPrivateInfo, lang.ChannelPublicInfo])
    expect(radios(tab).map((input) => input.checked)).toEqual([true, false])

    // :123-136 — ссылка-приглашение и кнопка отзыва
    expect(privateSection.classList.contains('hide')).toBe(false)
    const linkRow = privateSection.querySelector('.row')!
    expect(text(linkRow.querySelector('.row-title'))).toBe(`${DEFAULT_TME_ORIGIN}/+primary`)
    expect(text(linkRow.querySelector('.row-subtitle'))).toBe(lang.ChannelPrivateLinkHelp)
    const revoke = privateSection.querySelector('button')!
    expect(revoke.className).toContain('btn-primary btn-transparent danger')
    expect(text(revoke)).toBe(lang.RevokeLink)

    // :175-197 — публичная часть спрятана, поле ссылки с головой `t.me/`
    expect(publicContainer.tagName).toBe('DIV')
    expect(publicContainer.classList.contains('hide')).toBe(true)
    expect(linkInput(tab).value).toBe('t.me/')
    expect(text(publicContainer.querySelector('.sidebar-left-section-caption'))).toBe(lang['Channel.UsernameAboutChannel'])

    // :199-200 — угловая «Сохранить» в `content`, до изменений скрыта (:149)
    const btn = applyBtn(tab)
    expect(btn.classList.contains('btn-circle')).toBe(true)
    expect(btn.classList.contains('is-visible')).toBe(false)
  })

  it('публичная группа: заголовок и секция — «Тип группы», выбрано «публичная», поле с именем', async() => {
    const tab = await open(GROUP_ID)

    expect(text(tab.title)).toBe(lang.GroupType)
    const [typeSection, privateSection, publicContainer] = sections(tab)
    expect(text(typeSection.querySelector('.sidebar-left-h2'))).toBe(lang.GroupType)
    expect([...typeSection.querySelectorAll('form > .row .row-title')].map(text)).toEqual([lang.MegaPrivate, lang.MegaPublic])
    expect(radios(tab).map((input) => input.checked)).toEqual([false, true])
    expect(privateSection.classList.contains('hide')).toBe(true)
    expect(publicContainer.classList.contains('hide')).toBe(false)
    expect(linkInput(tab).value).toBe('t.me/pubgr')
    expect(text(publicContainer.querySelector('.sidebar-left-section-caption'))).toBe(lang['Channel.UsernameAboutGroup'])
  })
})

describe('вкладка «Тип» — сеть в момент оригинала', () => {
  it('смена типа и ввод имени сеть НЕ трогают; сохраняет угловая кнопка — один вызов, затем вкладка закрыта', async() => {
    const tab = await open(CHANNEL_ID)

    choose(radios(tab)[1])
    expect(sections(tab)[1].classList.contains('hide')).toBe(true)
    expect(sections(tab)[2].classList.contains('hide')).toBe(false)

    type(linkInput(tab), 't.me/newname')
    await pause(250) // проверка имени — за debounce 150 мс (`usernameInputField.ts:28`)
    await settle()

    // занятость — ручкой ЧАТА (`channels.checkUsername`, О-14), один раз за debounce
    expect(groups.checkUsername).toHaveBeenCalledTimes(1)
    expect(groups.checkUsername).toHaveBeenCalledWith(toPeerId(CHANNEL_ID, true), 'newname')
    expect(linkInput(tab).classList.contains('valid')).toBe(true)
    expect(applyBtn(tab).classList.contains('is-visible')).toBe(true)
    expect(groups.setType).not.toHaveBeenCalled()

    click(applyBtn(tab))
    await settle()

    expect(groups.setType).toHaveBeenCalledTimes(1)
    expect(groups.setType).toHaveBeenCalledWith(toPeerId(CHANNEL_ID, true), true, 'newname')
    await pause(400)
    expect(tab.container.isConnected).toBe(false)
  })

  it('негодное имя — ошибка поля «Link.Invalid», кнопки нет', async() => {
    const tab = await open(CHANNEL_ID)
    choose(radios(tab)[1])

    type(linkInput(tab), 't.me/a_')
    await pause(250)
    await settle()

    expect(linkInput(tab).classList.contains('error')).toBe(true)
    expect(text(tab.container.querySelector('.input-field-error-label'))).toBe(lang['Link.Invalid'])
    expect(applyBtn(tab).classList.contains('is-visible')).toBe(false)
    expect(groups.checkUsername).not.toHaveBeenCalled()
  })

  it('занятое имя — ошибка поля «Link.Taken», кнопки нет', async() => {
    const tab = await open(CHANNEL_ID)
    choose(radios(tab)[1])

    type(linkInput(tab), 't.me/takenname')
    await pause(250)
    await settle()

    expect(groups.checkUsername).toHaveBeenCalledWith(toPeerId(CHANNEL_ID, true), 'takenname')
    expect(text(tab.container.querySelector('.input-field-error-label'))).toBe(lang['Link.Taken'])
    expect(applyBtn(tab).classList.contains('is-visible')).toBe(false)
  })

  it('снять имя: подтверждение с прежним @именем, после «OK» — setType(false), вкладка закрыта', async() => {
    const tab = await open(GROUP_ID)

    choose(radios(tab)[0])
    expect(applyBtn(tab).classList.contains('is-visible')).toBe(true)

    click(applyBtn(tab))
    await settle()
    expect(groups.setType).not.toHaveBeenCalled()
    const description = document.querySelector('.popup.popup-confirmation .popup-description')
    expect(text(description)).toContain('@pubgr')

    click(popupButton('popup-confirmation', 'OK'))
    await settle()

    expect(groups.setType).toHaveBeenCalledTimes(1)
    expect(groups.setType).toHaveBeenCalledWith(toPeerId(GROUP_ID, true), false, '')
    await pause(400)
    expect(tab.container.isConnected).toBe(false)
  })

  it('отказ сервера — вкладка остаётся, кнопка снова доступна (:262-265)', async() => {
    const tab = await open(CHANNEL_ID)
    groups.setType.mockRejectedValueOnce(new Error('409'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    choose(radios(tab)[1])
    type(linkInput(tab), 't.me/racename')
    await pause(250)
    await settle()
    click(applyBtn(tab))
    await settle()
    await pause(400)

    expect(groups.setType).toHaveBeenCalledTimes(1)
    expect(tab.container.isConnected).toBe(true)
    expect(applyBtn(tab).disabled).toBe(false)
    expect(error).toHaveBeenCalled()
  })

  it('клик по ссылке копирует её и показывает тост (:126-129)', async() => {
    const tab = await open(CHANNEL_ID)
    click(sections(tab)[1].querySelector('.row')!)

    expect(copyTextToClipboard).toHaveBeenCalledWith(`${DEFAULT_TME_ORIGIN}/+primary`)
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'LinkCopied' })
  })

  it('«Отозвать ссылку» — попап оригинала; отзыв только по кнопке попапа, строка показывает новую ссылку', async() => {
    const tab = await open(CHANNEL_ID)
    const revoke = sections(tab)[1].querySelector('button')!

    click(revoke)
    await settle()
    expect(document.querySelector('.popup.popup-peer.revoke-link')).not.toBeNull()
    expect(text(document.querySelector('.popup.revoke-link .popup-title'))).toBe(lang.RevokeLink)
    expect(groups.editExportedChatInvite).not.toHaveBeenCalled()

    click(popupButton('revoke-link', 'RevokeButton'))
    await settle()

    expect(groups.editExportedChatInvite).toHaveBeenCalledWith({ chatId: CHANNEL_ID, link: `${DEFAULT_TME_ORIGIN}/+primary`, revoked: true })
    expect(groups.exportChatInvite).toHaveBeenCalledWith({ chatId: CHANNEL_ID })
    expect(text(sections(tab)[1].querySelector('.row .row-title'))).toBe(`${DEFAULT_TME_ORIGIN}/+fresh`)
    expect(revoke.hasAttribute('disabled')).toBe(false)
  })
})

describe('вкладка «Тип» — закрытие', () => {
  it('Esc закрывает вкладку; через 250 мс узла нет, Solid-корни сняты (DoD 5)', async() => {
    const tab = await open(GROUP_ID)
    const [, privateSection, publicContainer] = sections(tab)
    const privateRadio = radios(tab)[0]

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await pause(400)

    expect(tab.container.isConnected).toBe(false)
    expect(document.querySelector('.group-type-container')).toBeNull()

    // радио-форма снятого корня больше не переключает секции
    choose(privateRadio)
    expect(privateSection.classList.contains('hide')).toBe(true)
    expect(publicContainer.classList.contains('hide')).toBe(false)
  })
})
