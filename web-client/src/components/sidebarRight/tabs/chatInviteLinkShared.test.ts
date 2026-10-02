/**
 * Общее вкладок ссылок (`chatInviteLinkShared.ts`, порт tweb
 * `chatInviteLinkShared.ts` 812502980, задача 0б-3 волны 7): «активность»
 * ссылки (`isActiveInvite`, `:20-34`) и порт `appProfileManager.getChatInviteLink`
 * поверх модели без постоянной ссылки (расхождение 1, О-120).
 */
import { describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { ChatInviteExported } from '@core/managers/groupsManager'
import { getChatInviteLink, isActiveInvite } from './chatInviteLinkShared'

const now = () => Math.floor(Date.now() / 1000)
const invite = (hash: string, over: Partial<ChatInviteExported> = {}): ChatInviteExported =>
  ({ _: 'chatInviteExported', link: `https://t.me.local/+${hash}`, admin_id: 1, date: 0, ...over })

const managersWith = (invites: ChatInviteExported[]) => {
  const groups = {
    getExportedChatInvites: vi.fn(async() => ({ _: 'messages.exportedChatInvites', count: invites.length, invites })),
    editExportedChatInvite: vi.fn(async() => ({ _: 'messages.exportedChatInvite', invite: invite('x') })),
    exportChatInvite: vi.fn(async() => invite('fresh')),
  }
  return { groups, managers: { groups } as unknown as Managers }
}

describe('isActiveInvite', () => {
  it('отозванная, истёкшая и исчерпанная — неактивны; без срока и лимита — активна', () => {
    expect(isActiveInvite(invite('a'))).toBe(true)
    expect(isActiveInvite(invite('a', { pFlags: { revoked: true } }))).toBe(false)
    expect(isActiveInvite(invite('a', { expire_date: now() - 1 }))).toBe(false)
    expect(isActiveInvite(invite('a', { expire_date: now() + 60 }))).toBe(true)
    expect(isActiveInvite(invite('a', { usage_limit: 2, usage: 2 }))).toBe(false)
    expect(isActiveInvite(invite('a', { usage_limit: 2, usage: 1 }))).toBe(true)
  })
})

describe('getChatInviteLink — «постоянная» без поля на проводе (О-120)', () => {
  it('самая старая ссылка без имени, срока, лимита и одобрения; ничего не выпускает', async() => {
    // выдача сервера — от новых к старым
    const { groups, managers } = managersWith([
      invite('newest'),
      invite('named', { title: 'Team' }),
      invite('timed', { expire_date: now() + 60 }),
      invite('approval', { pFlags: { request_needed: true } }),
      invite('oldest'),
      invite('limited', { usage_limit: 5 }),
    ])
    expect((await getChatInviteLink(managers, 20)).link).toBe('https://t.me.local/+oldest')
    expect(groups.getExportedChatInvites).toHaveBeenCalledWith({ chatId: 20 })
    expect(groups.exportChatInvite).not.toHaveBeenCalled()
  })

  it('нет подходящей — выпускает новую', async() => {
    const { groups, managers } = managersWith([invite('named', { title: 'Team' })])
    expect((await getChatInviteLink(managers, 20)).link).toBe('https://t.me.local/+fresh')
    expect(groups.exportChatInvite).toHaveBeenCalledWith({ chatId: 20 })
  })

  it('force — отзывает текущую «постоянную» и выпускает новую (legacy_revoke_permanent)', async() => {
    const { groups, managers } = managersWith([invite('newest'), invite('oldest')])
    expect((await getChatInviteLink(managers, 20, true)).link).toBe('https://t.me.local/+fresh')
    expect(groups.editExportedChatInvite).toHaveBeenCalledWith({ chatId: 20, link: 'https://t.me.local/+oldest', revoked: true })
    expect(groups.exportChatInvite).toHaveBeenCalledTimes(1)
  })
})
