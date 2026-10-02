/** @jsxImportSource solid-js */
/**
 * Вкладка «Новая ссылка / Изменить ссылку» правой колонки — порт tweb
 * `sidebarRight/tabs/editChatInviteLink.tsx` (812502980), задача 0б-3 волны 7.
 *
 * Вкладка НАСТОЯЩАЯ (`AppEditChatInviteLinkTab`), открытая синглтоном
 * `AppSidebarRight` (`@/test/sidebarRight`). Стабы — только менеджеры воркера.
 *
 * Предмет: разметка оригинала (имя, одобрение — только у канала, два
 * ступенчатых селектора со строками), сеть — ТОЛЬКО по угловой галке (а не на
 * каждом изменении), событие `finish` и закрытие, предзаполнение правки,
 * закрытие по Esc снимает Solid-корень (DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Channel } from '@core/peers/peer'
import type { ChatInviteExported } from '@core/managers/groupsManager'
import lang from '@/lang'
import { DEFAULT_TME_ORIGIN } from '@config/app'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { installSidebarRight } from '@/test/sidebarRight'
import { AppEditChatInviteLinkTab } from '@components/solidJsTabs/tabs'

const CHANNEL_ID = 20
const GROUP_ID = 30
const CHANNEL: Channel = { _: 'channel', id: CHANNEL_ID, title: 'Channel', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true, creator: true } } as Channel
const GROUP: Channel = { _: 'channel', id: GROUP_ID, title: 'Group', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true, creator: true } } as Channel

const now = () => Math.floor(Date.now() / 1000)
const invite = (hash: string, over: Partial<ChatInviteExported> = {}): ChatInviteExported =>
  ({ _: 'chatInviteExported', link: `${DEFAULT_TME_ORIGIN}/+${hash}`, admin_id: 1, date: now() - 60, ...over })

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let column: ReturnType<typeof installSidebarRight>
let groups: { exportChatInvite: ReturnType<typeof vi.fn>, editExportedChatInvite: ReturnType<typeof vi.fn> }

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [CHANNEL, GROUP] }])
  groups = {
    exportChatInvite: vi.fn(async() => invite('fresh')),
    editExportedChatInvite: vi.fn(async({ link }: { link: string }) => ({ _: 'messages.exportedChatInvite', invite: { ...invite('x'), link } })),
  }
  column = installSidebarRight({ groups } as unknown as Managers)
})

afterEach(async() => {
  column.dispose()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const open = async(chatId: number, edited?: ChatInviteExported) => {
  const tab = column.sidebar.createTab(AppEditChatInviteLinkTab)
  const finish = vi.fn()
  tab.eventListener.addEventListener('finish', finish)
  await tab.open({ chatId, invite: edited })
  await settle()
  return { tab, finish }
}

type Tab = Awaited<ReturnType<typeof open>>['tab']

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[-]/g, '').trim()
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const sections = (tab: Tab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
const corner = (tab: Tab) => tab.content.querySelector<HTMLButtonElement>(':scope > .btn-corner')!
const options = (section: HTMLElement) => [...section.querySelectorAll('.range-setting-selector-option')]
const scrub = (section: HTMLElement, index: number) => {
  const seek = section.querySelector<HTMLInputElement>('.range-steps-selector input.progress-line__seek')!
  seek.value = '' + index
  seek.dispatchEvent(new Event('input', { bubbles: true }))
}
const type = (input: HTMLElement, value: string) => {
  input.textContent = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('«Новая ссылка» — разметка оригинала', () => {
  it('канал: имя, одобрение админом, срок и лимит ступенями со строками; угловая галка видна', async() => {
    const { tab } = await open(CHANNEL_ID)

    expect(text(tab.title)).toBe(lang.NewLink)
    const [name, approve, period, uses, ...rest] = sections(tab)
    expect(rest).toHaveLength(0)

    // :333-341 — поле имени и подпись
    expect(name.querySelector('.input-wrapper .input-field')).not.toBeNull()
    expect(text(name.querySelector('.input-field label'))).toBe(lang.LinkNameHint)
    expect(text(name.querySelector('.sidebar-left-section-caption'))).toBe(lang.LinkNameHelp)

    // :357-369 — одобрение тумблером; подпись — ветка неплатной ссылки (:139-140)
    expect(text(approve.querySelector('.row-title'))).toBe(lang.ApproveNewMembers)
    expect(approve.querySelector('.row-checkbox-field-toggle')).not.toBeNull()
    expect(text(approve.querySelector('.sidebar-left-section-caption'))).toBe(lang['InviteLink.AdminApproval.Disabled'])

    // :152-231 — «1 час, 1 день, 1 неделя, ∞», выбрано ∞; строка «Срок действия — Никогда»
    expect(text(period.querySelector('.sidebar-left-section-name'))).toBe(lang.LimitByPeriod)
    expect(options(period).map(text)).toEqual(['1 hour', '1 day', '1 week', '∞'])
    expect(options(period).map((o) => o.classList.contains('is-chosen'))).toEqual([false, false, false, true])
    expect(text(period.querySelector('.row'))).toBe(lang['EditInvitation.ExpiryDate'] + lang['EditInvitation.Never'])
    expect(text(period.querySelector('.sidebar-left-section-caption'))).toBe(lang.TimeLimitHelp)

    // :233-318 — «1, 10, 50, 100, ∞», выбрано ∞; строка «Число пользователей — Без ограничений»
    expect(text(uses.querySelector('.sidebar-left-section-name'))).toBe(lang.LimitNumberOfUses)
    expect(options(uses).map(text)).toEqual(['1', '10', '50', '100', '∞'])
    expect(text(uses.querySelector('.row'))).toBe(lang['EditInvitation.NumberOfUsers'] + lang['EditInvitation.Unlimited'])
    expect(uses.classList.contains('hide')).toBe(false)

    expect(corner(tab).classList.contains('is-visible')).toBe(true)
  })

  it('группа: секции одобрения нет (оно под `isBroadcast`, :342-370)', async() => {
    const { tab } = await open(GROUP_ID)
    expect(sections(tab).map((s) => text(s.querySelector('.sidebar-left-section-name')))).toEqual(['', lang.LimitByPeriod, lang.LimitNumberOfUses])
  })
})

describe('«Новая ссылка» — сохранение', () => {
  it('изменения сеть не трогают; галка — один exportChatInvite, событие finish и закрытие', async() => {
    const { tab, finish } = await open(GROUP_ID)
    const [name, period, uses] = sections(tab)

    type(name.querySelector<HTMLElement>('.input-field-input')!, 'Team')
    scrub(period, 0) // 1 час
    scrub(uses, 1) // 10
    await settle()

    expect(text(period.querySelector('.row'))).not.toContain(lang['EditInvitation.Never'])
    expect(groups.exportChatInvite).not.toHaveBeenCalled()

    const before = now()
    click(corner(tab))
    await settle()

    expect(groups.exportChatInvite).toHaveBeenCalledTimes(1)
    const [args] = groups.exportChatInvite.mock.calls[0]
    expect(args).toMatchObject({ chatId: GROUP_ID, title: 'Team', requestNeeded: false, usageLimit: 10 })
    expect(args.expireDate).toBeGreaterThanOrEqual(before + 3600)
    expect(args.expireDate).toBeLessThanOrEqual(now() + 3600)
    expect(groups.editExportedChatInvite).not.toHaveBeenCalled()

    expect(finish).toHaveBeenCalledWith(invite('fresh'))
    await pause(400)
    expect(tab.container.isConnected).toBe(false)
  })

  it('правка: поля из ссылки; одобрение прячет лимит; галка — editExportedChatInvite по ссылке', async() => {
    const edited = invite('team', { title: 'Team', usage: 3, usage_limit: 10, pFlags: { request_needed: true } })
    const { tab } = await open(CHANNEL_ID, edited)

    expect(text(tab.title)).toBe(lang['InviteLinks.Edit'])
    const [name, approve, , uses] = sections(tab)
    expect(text(name.querySelector('.input-field-input'))).toBe('Team')
    expect(approve.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true)
    expect(uses.classList.contains('hide')).toBe(true)

    click(corner(tab))
    await settle()

    // с одобрением лимит не уходит (:77); срок — бессрочно (∞)
    expect(groups.editExportedChatInvite).toHaveBeenCalledWith({
      chatId: CHANNEL_ID, link: edited.link, expireDate: 0, requestNeeded: true, title: 'Team', usageLimit: 0,
    })
    expect(groups.exportChatInvite).not.toHaveBeenCalled()
  })
})

describe('«Новая ссылка» — закрытие', () => {
  it('Esc закрывает вкладку без сети; через 250 мс узла нет, Solid-корень снят (DoD 5)', async() => {
    const { tab } = await open(CHANNEL_ID)
    const [, approve, , uses] = sections(tab)
    const toggle = approve.querySelector<HTMLInputElement>('input[type=checkbox]')!

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await pause(400)

    expect(tab.container.isConnected).toBe(false)
    expect(groups.exportChatInvite).not.toHaveBeenCalled()

    // тумблер снятого корня больше не прячет секцию лимита
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))
    expect(uses.classList.contains('hide')).toBe(false)
  })
})
