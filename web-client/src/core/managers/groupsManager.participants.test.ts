// Участники в форме оригинала (0б-7 волны 7): `getParticipants` с фильтрами
// `ChannelParticipantsFilter` и мутации `appChatsManager` (`editAdmin`,
// `editBanned`, `kickFromChat`, `clearChannelParticipantBannedRights`,
// `hideChatJoinRequest`) поверх наших ручек. Предмет — какая ручка и с каким
// телом уходит на каждый вызов оригинала: знак запретов, перевод срока
// (абсолютный `until_date` → относительный `until_seconds`), битмаск прав
// админа, листание `/members` под фильтр админов.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { newGroupsManager, type ChannelParticipantWire } from './groupsManager'
import type { RestClient } from '../net/restClient'
import { BANNED_RIGHTS_UNTIL_FOREVER } from './constants'

const CHAT_ID = 30
const PEER = -CHAT_ID

type Call = { method: string, path: string, body?: unknown, query?: unknown }

let calls: Call[]
let getImpl: (path: string, query?: Record<string, unknown>) => unknown

const member = (id: number): ChannelParticipantWire => ({ _: 'channelParticipant', user_id: id, date: 1 })
const admin = (id: number): ChannelParticipantWire => ({ _: 'channelParticipantAdmin', user_id: id, date: 1, admin_rights: { _: 'chatAdminRights' } })
const creator = (id: number): ChannelParticipantWire => ({ _: 'channelParticipantCreator', user_id: id, admin_rights: { _: 'chatAdminRights' } })
const kicked = (id: number): ChannelParticipantWire => ({
  _: 'channelParticipantBanned', pFlags: { left: true }, peer: { _: 'peerUser', user_id: id }, kicked_by: 1, date: 1,
  banned_rights: { until_date: 0 },
})
const restricted = (id: number): ChannelParticipantWire => ({
  _: 'channelParticipantBanned', peer: { _: 'peerUser', user_id: id }, kicked_by: 1, date: 1,
  banned_rights: { until_date: 0, pFlags: { send_media: true } },
})
const page = (participants: ChannelParticipantWire[], count = participants.length) => ({
  _: 'channels.channelParticipants', count, participants, chats: [],
  users: participants.map((p) => ({ _: 'user', id: 'user_id' in p ? p.user_id : 0 })),
})

function build() {
  const rest = {
    get: vi.fn(async(path: string, query?: Record<string, unknown>) => {
      calls.push({ method: 'get', path, query })
      return getImpl(path, query)
    }),
    post: vi.fn(async(path: string, body: unknown) => {
      calls.push({ method: 'post', path, body })
      return {}
    }),
    put: vi.fn(async() => ({})),
    patch: vi.fn(async() => ({})),
    del: vi.fn(async(path: string) => {
      calls.push({ method: 'del', path })
      return {}
    }),
  } as unknown as Pick<RestClient, 'post' | 'get' | 'put' | 'patch' | 'del'>
  const peers = { saveApiPeers: vi.fn() }
  const groups = newGroupsManager({
    rest,
    dialogs: { applyNotifySettings: vi.fn(), applyPinned: vi.fn(), applyFolder: vi.fn(), applyRemoved: vi.fn() } as never,
    peers: peers as never,
  })
  return { groups, peers }
}

beforeEach(() => {
  calls = []
  getImpl = () => page([])
})

describe('groupsManager.getParticipants — фильтры оригинала', () => {
  it('поиск/недавние — одна страница `/members` со смещением и `q`', async() => {
    const { groups } = build()
    getImpl = () => page([member(2)], 120)
    const r = await groups.getParticipants({ id: CHAT_ID, filter: { _: 'channelParticipantsSearch', q: 'ив' }, limit: 50, offset: 50 })
    expect(calls).toEqual([{ method: 'get', path: `/chats/${PEER}/members`, query: { offset: 50, limit: 50, q: 'ив' } }])
    expect(r.count).toBe(120)
  })

  it('админы: листает `/members` до короткой страницы и оставляет создателя и админов', async() => {
    const { groups, peers } = build()
    const full = Array.from({ length: 200 }, (_, i) => i === 3 ? admin(4) : member(i + 10))
    getImpl = (_path, query) => (query as { offset: number }).offset === 0 ? page(full, 205) : page([creator(1), member(500)], 205)

    const r = await groups.getParticipants({ id: CHAT_ID, filter: { _: 'channelParticipantsAdmins', q: '' }, limit: 50, offset: 0 })

    expect(calls.map((c) => c.query)).toEqual([{ offset: 0, limit: 200 }, { offset: 200, limit: 200 }])
    expect(r.participants.map((p) => p._)).toEqual(['channelParticipantAdmin', 'channelParticipantCreator'])
    expect(r.count).toBe(2)
    // карточки — только админов, и в зеркало
    expect(r.users.map((u) => u.id)).toEqual([4, 1])
    expect(peers.saveApiPeers).toHaveBeenCalledWith({ users: r.users })
  })

  it('админы и выгнанные — одна страница на весь список: следующая пуста без запроса', async() => {
    const { groups } = build()
    for(const filter of [{ _: 'channelParticipantsAdmins' as const }, { _: 'channelParticipantsKicked' as const, q: '' }]) {
      const r = await groups.getParticipants({ id: CHAT_ID, filter, limit: 50, offset: 2 })
      expect(r.participants).toEqual([])
    }
    expect(calls).toEqual([])
  })

  it('выгнанные — `/bans`, ограниченные — `/restrictions`', async() => {
    const { groups } = build()
    getImpl = (path) => page(path.endsWith('/bans') ? [kicked(7)] : [restricted(8)])
    const k = await groups.getParticipants({ id: CHAT_ID, filter: { _: 'channelParticipantsKicked', q: '' } })
    const b = await groups.getParticipants({ id: CHAT_ID, filter: { _: 'channelParticipantsBanned', q: '' } })
    expect(calls.map((c) => c.path)).toEqual([`/chats/${PEER}/bans`, `/chats/${PEER}/restrictions`])
    expect(k.participants).toEqual([kicked(7)])
    expect(b.participants).toEqual([restricted(8)])
  })
})

describe('groupsManager — мутации `appChatsManager`', () => {
  it('editAdmin: права — битмаском `Rights` бэкенда; пустые права — снять админа', async() => {
    const { groups } = build()
    await groups.editAdmin(CHAT_ID, member(5), {
      _: 'chatAdminRights',
      pFlags: { change_info: true, delete_messages: true, ban_users: true, add_admins: true },
    })
    await groups.editAdmin(CHAT_ID, 6, { _: 'chatAdminRights', pFlags: {} }, '')

    expect(calls).toEqual([
      // change_info 64 | delete_messages 4 | ban_users 8 | add_admins 128 (`domain/rights.go`)
      { method: 'post', path: `/chats/${PEER}/admins`, body: { user_id: 5, rights: 204 } },
      { method: 'del', path: `/chats/${PEER}/admins/6` },
    ])
  })

  it('editBanned: `view_messages` — выгнать; запреты — ограничить с относительным сроком; навсегда — 0', async() => {
    const { groups } = build()
    const now = Math.floor(Date.now() / 1000)
    await groups.editBanned(CHAT_ID, member(5), { _: 'chatBannedRights', until_date: 0, pFlags: { view_messages: true } })
    await groups.editBanned(CHAT_ID, member(5), { _: 'chatBannedRights', until_date: now + 3600, pFlags: { send_media: true, pin_messages: true } })
    await groups.editBanned(CHAT_ID, member(5), { _: 'chatBannedRights', until_date: BANNED_RIGHTS_UNTIL_FOREVER, pFlags: { send_messages: true } })

    expect(calls[0]).toEqual({ method: 'post', path: `/chats/${PEER}/bans`, body: { user_id: 5 } })
    // send_media 2 | pin_messages 8 — маска ЗАПРЕТОВ, без инверсии
    expect(calls[1]).toMatchObject({ method: 'post', path: `/chats/${PEER}/restrictions`, body: { user_id: 5, denied_rights: 10 } })
    const until = (calls[1].body as { until_seconds: number }).until_seconds
    expect(until).toBeGreaterThan(3590)
    expect(until).toBeLessThanOrEqual(3600)
    expect(calls[2]).toEqual({ method: 'post', path: `/chats/${PEER}/restrictions`, body: { user_id: 5, denied_rights: 1, until_seconds: 0 } })
  })

  it('пустые запреты: выгнанного — вернуть из «удалённых», ограниченного — снять ограничение', async() => {
    const { groups } = build()
    const empty = { _: 'chatBannedRights' as const, until_date: 0, pFlags: {} }
    await groups.editBanned(CHAT_ID, kicked(7), empty)
    await groups.clearChannelParticipantBannedRights(CHAT_ID, restricted(8))

    expect(calls).toEqual([
      { method: 'del', path: `/chats/${PEER}/bans/7` },
      { method: 'del', path: `/chats/${PEER}/restrictions/8` },
    ])
  })

  it('kickFromChat — в «удалённые» (`kickFromChannel`); hideChatJoinRequest — одобрить/отклонить', async() => {
    const { groups } = build()
    await groups.kickFromChat(CHAT_ID, 9)
    await groups.hideChatJoinRequest(CHAT_ID, 11, true)
    await groups.hideChatJoinRequest(CHAT_ID, 12, false)

    expect(calls).toEqual([
      { method: 'post', path: `/chats/${PEER}/bans`, body: { user_id: 9 } },
      { method: 'post', path: `/chats/${PEER}/join_requests/11/approve`, body: {} },
      { method: 'post', path: `/chats/${PEER}/join_requests/12/decline`, body: {} },
    ])
  })

  it('заявки — `getChatInviteImporters({requested})` без ссылки идёт в `/join_requests`', async() => {
    const { groups } = build()
    getImpl = () => ({ _: 'messages.chatInviteImporters', count: 1, importers: [{ _: 'chatInviteImporter', user_id: 3, date: 5, pFlags: { requested: true } }] })
    const r = await groups.getChatInviteImporters({ chatId: CHAT_ID, requested: true })
    expect(calls).toEqual([{ method: 'get', path: `/chats/${PEER}/join_requests`, query: undefined }])
    expect(r.importers[0].user_id).toBe(3)
  })
})
