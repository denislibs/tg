// Участники в форме оригинала: `getParticipants` с фильтрами
// `ChannelParticipantsFilter` (одна ручка `/participants`, кэш 60 с, ручной
// фильтр админов по `q`), `getParticipant`, `getOnlines` и мутации
// `appChatsManager` (`editAdmin`, `editBanned`, `kickFromChat`,
// `clearChannelParticipantBannedRights`, `hideChatJoinRequest`) поверх наших
// ручек. Предмет — какая ручка и с каким телом уходит на каждый вызов
// оригинала: знак запретов, перевод срока (абсолютный `until_date` →
// относительный `until_seconds`), битмаск прав админа, ранг, местный апдейт
// участника (`generateUpdateChannelParticipant`) и сброс кэша.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { newGroupsManager, type ChannelParticipantWire } from './groupsManager'
import type { RestClient } from '../net/restClient'
import { BANNED_RIGHTS_UNTIL_FOREVER } from './constants'

const CHAT_ID = 30
const PEER = -CHAT_ID
const ME = 1

type Call = { method: string, path: string, body?: unknown, query?: unknown }

let calls: Call[]
let getImpl: (path: string, query?: Record<string, unknown>) => unknown

const member = (id: number): ChannelParticipantWire => ({ _: 'channelParticipant', user_id: id, date: 1 })
const admin = (id: number): ChannelParticipantWire => ({ _: 'channelParticipantAdmin', user_id: id, promoted_by: 1, date: 1, admin_rights: { _: 'chatAdminRights' } })
const creator = (id: number): ChannelParticipantWire => ({ _: 'channelParticipantCreator', user_id: id, admin_rights: { _: 'chatAdminRights' } })
const kicked = (id: number): ChannelParticipantWire => ({
  _: 'channelParticipantBanned', pFlags: { left: true }, peer: { _: 'peerUser', user_id: id }, kicked_by: 1, date: 1,
  banned_rights: { until_date: 0 },
})
const restricted = (id: number): ChannelParticipantWire => ({
  _: 'channelParticipantBanned', peer: { _: 'peerUser', user_id: id }, kicked_by: 1, date: 1,
  banned_rights: { until_date: 0, pFlags: { send_media: true } },
})
const page = (participants: ChannelParticipantWire[], count = participants.length, names: Record<number, string> = {}) => ({
  _: 'channels.channelParticipants', count, participants, chats: [],
  users: participants.map((p) => {
    const id = 'user_id' in p ? p.user_id : 0
    return { _: 'user', id, first_name: names[id] ?? 'u' + id }
  }),
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
  const onChannelParticipant = vi.fn()
  const groups = newGroupsManager({
    rest,
    dialogs: { applyNotifySettings: vi.fn(), applyPinned: vi.fn(), applyFolder: vi.fn(), applyRemoved: vi.fn() } as never,
    peers: peers as never,
    getMeId: () => ME,
    onChannelParticipant,
  })
  return { groups, peers, onChannelParticipant }
}

beforeEach(() => {
  calls = []
  getImpl = () => page([])
})

describe('groupsManager.getParticipants — фильтры оригинала', () => {
  it('одна ручка `/participants`: фильтр, смещение, лимит и `q` — как есть, `count` — всего', async() => {
    const { groups, peers } = build()
    getImpl = () => page([member(2)], 120)
    const r = await groups.getParticipants({ id: CHAT_ID, filter: { _: 'channelParticipantsSearch', q: 'ив' }, limit: 50, offset: 50 })
    expect(calls).toEqual([{ method: 'get', path: `/chats/${PEER}/participants`, query: { filter: 'search', offset: 50, limit: 50, q: 'ив' } }])
    expect(r.count).toBe(120)
    expect(peers.saveApiPeers).toHaveBeenCalledWith({ users: r.users })
  })

  it('каждый конструктор фильтра — своё значение `filter=`; недавние по умолчанию, лимит 200', async() => {
    const { groups } = build()
    await groups.getParticipants({ id: CHAT_ID })
    const filters = [
      { _: 'channelParticipantsAdmins' as const },
      { _: 'channelParticipantsKicked' as const, q: '' },
      { _: 'channelParticipantsBanned' as const, q: '' },
      { _: 'channelParticipantsBots' as const },
      { _: 'channelParticipantsContacts' as const, q: '' },
      { _: 'channelParticipantsMentions' as const, q: 'а', top_msg_id: 77 },
    ]
    for(const filter of filters) await groups.getParticipants({ id: CHAT_ID, filter, limit: 50 })

    expect(calls.map((c) => c.query)).toEqual([
      { filter: 'recent', offset: 0, limit: 200 },
      { filter: 'admins', offset: 0, limit: 50 },
      { filter: 'kicked', offset: 0, limit: 50 },
      { filter: 'banned', offset: 0, limit: 50 },
      { filter: 'bots', offset: 0, limit: 50 },
      { filter: 'contacts', offset: 0, limit: 50 },
      { filter: 'mentions', offset: 0, limit: 50, q: 'а', top_msg_id: 77 },
    ])
  })

  it('админы с `q` — выдача фильтруется вручную по карточкам ответа (`MANUALLY_FILTER`)', async() => {
    const { groups } = build()
    getImpl = () => page([creator(1), admin(4), admin(5)], 3, { 1: 'Иван', 4: 'Пётр', 5: 'Иванна' })
    const r = await groups.getParticipants({ id: CHAT_ID, filter: { _: 'channelParticipantsAdmins', q: 'иван' }, limit: 50 })
    expect(r.participants.map((p) => 'user_id' in p && p.user_id)).toEqual([1, 5])
    // счёт сервера не трогаем, как оригинал (`{...result, participants}`)
    expect(r.count).toBe(3)
  })

  it('выгнанные и ограниченные — тот же контейнер, конструкторы как есть', async() => {
    const { groups } = build()
    getImpl = (_path, query) => page((query as { filter: string }).filter === 'kicked' ? [kicked(7)] : [restricted(8)])
    const k = await groups.getParticipants({ id: CHAT_ID, filter: { _: 'channelParticipantsKicked', q: '' } })
    const b = await groups.getParticipants({ id: CHAT_ID, filter: { _: 'channelParticipantsBanned', q: '' } })
    expect(k.participants).toEqual([kicked(7)])
    expect(b.participants).toEqual([restricted(8)])
  })

  it('кэш 60 с: тот же запрос не идёт в сеть, сброс — `invalidateChannelParticipants` по чату', async() => {
    vi.useFakeTimers()
    try {
      const { groups } = build()
      const ask = () => groups.getParticipants({ id: CHAT_ID, filter: { _: 'channelParticipantsRecent' }, limit: 100 })
      await ask()
      await ask()
      expect(calls).toHaveLength(1)

      // чужой чат кэш этого не трогает
      groups.invalidateChannelParticipants(CHAT_ID + 1)
      await ask()
      expect(calls).toHaveLength(1)

      groups.invalidateChannelParticipants(CHAT_ID)
      await ask()
      expect(calls).toHaveLength(2)

      vi.advanceTimersByTime(61_000)
      await ask()
      expect(calls).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('упавший запрос в кэше не остаётся', async() => {
    const { groups } = build()
    getImpl = () => { throw new Error('net') }
    await expect(groups.getParticipants({ id: CHAT_ID })).rejects.toThrow('net')
    getImpl = () => page([member(2)])
    const r = await groups.getParticipants({ id: CHAT_ID })
    expect(r.participants).toEqual([member(2)])
    expect(calls).toHaveLength(2)
  })
})

describe('groupsManager.getParticipant / getOnlines', () => {
  it('getParticipant — `/participants/{userID}`, карточки — в зеркало', async() => {
    const { groups, peers } = build()
    getImpl = () => ({ _: 'channels.channelParticipant', participant: admin(5), chats: [], users: [{ _: 'user', id: 5 }] })
    const p = await groups.getParticipant(CHAT_ID, 5)
    expect(calls).toEqual([{ method: 'get', path: `/chats/${PEER}/participants/5`, query: undefined }])
    expect(p).toEqual(admin(5))
    expect(peers.saveApiPeers).toHaveBeenCalledWith({ users: [{ _: 'user', id: 5 }] })
  })

  it('getParticipant — отказ сервера доезжает до вызывающего', async() => {
    const { groups } = build()
    getImpl = () => { throw Object.assign(new Error('400'), { type: 'USER_NOT_PARTICIPANT' }) }
    await expect(groups.getParticipant(CHAT_ID, 5)).rejects.toMatchObject({ type: 'USER_NOT_PARTICIPANT' })
  })

  it('getOnlines — `/onlines` с кэшем 60 с', async() => {
    const { groups } = build()
    getImpl = () => ({ _: 'chatOnlines', onlines: 42 })
    expect(await groups.getOnlines(CHAT_ID)).toBe(42)
    expect(await groups.getOnlines(CHAT_ID)).toBe(42)
    expect(calls).toEqual([{ method: 'get', path: `/chats/${PEER}/onlines`, query: undefined }])
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
      { method: 'post', path: `/chats/${PEER}/admins`, body: { user_id: 5, rights: 204, rank: '' } },
      { method: 'del', path: `/chats/${PEER}/admins/6` },
    ])
  })

  it('editAdmin: ранг уходит телом; местный апдейт — админ с `promoted_by` = я', async() => {
    const { groups, onChannelParticipant } = build()
    const rights = { _: 'chatAdminRights' as const, pFlags: { pin_messages: true as const } }
    await groups.editAdmin(CHAT_ID, member(5), rights, 'модер')
    expect(calls[0]).toMatchObject({ body: { user_id: 5, rank: 'модер' } })
    expect(onChannelParticipant).toHaveBeenCalledWith(expect.objectContaining({
      _: 'updateChannelParticipant',
      channel_id: CHAT_ID,
      user_id: 5,
      new_participant: expect.objectContaining({ _: 'channelParticipantAdmin', user_id: 5, promoted_by: ME, rank: 'модер', admin_rights: rights }),
    }))

    await groups.editAdmin(CHAT_ID, 6, { _: 'chatAdminRights', pFlags: {} }, '')
    expect(onChannelParticipant.mock.lastCall![0]).toMatchObject({ user_id: 6, new_participant: { _: 'channelParticipant', user_id: 6 } })
  })

  it('мутация сбрасывает кэш страниц участников ДО рассылки местного апдейта', async() => {
    const { groups, onChannelParticipant } = build()
    await groups.getParticipants({ id: CHAT_ID })
    onChannelParticipant.mockImplementation(() => void groups.getParticipants({ id: CHAT_ID }))
    await groups.kickFromChat(CHAT_ID, member(5))
    expect(calls.filter((c) => c.method === 'get')).toHaveLength(2)
  })

  it('editBanned: местный апдейт — `prev` как был, `new` — забаненный (выгнанный — с `left`) или ничего', async() => {
    const { groups, onChannelParticipant } = build()
    await groups.kickFromChat(CHAT_ID, member(5))
    expect(onChannelParticipant.mock.lastCall![0]).toMatchObject({
      channel_id: CHAT_ID,
      user_id: 5,
      prev_participant: member(5),
      new_participant: { _: 'channelParticipantBanned', pFlags: { left: true }, kicked_by: ME, peer: { _: 'peerUser', user_id: 5 } },
    })

    await groups.clearChannelParticipantBannedRights(CHAT_ID, restricted(8))
    const cleared = onChannelParticipant.mock.lastCall![0]
    expect(cleared.prev_participant).toEqual(restricted(8))
    expect(cleared.new_participant).toBeUndefined()

    // участник ключом пира — `prev` обычным участником с тем же id
    await groups.editBanned(CHAT_ID, 9, { _: 'chatBannedRights', until_date: 0, pFlags: { send_media: true } })
    expect(onChannelParticipant.mock.lastCall![0]).toMatchObject({
      user_id: 9,
      prev_participant: { _: 'channelParticipant', user_id: 9 },
      new_participant: { _: 'channelParticipantBanned', banned_rights: { pFlags: { send_media: true } } },
    })
    expect(onChannelParticipant.mock.lastCall![0].new_participant.pFlags).toBeUndefined()
  })

  it('addMember — местный апдейт с новым участником', async() => {
    const { groups, onChannelParticipant } = build()
    await groups.addMember(PEER, 12)
    expect(calls).toEqual([{ method: 'post', path: `/chats/${PEER}/members`, body: { user_id: 12 } }])
    expect(onChannelParticipant).toHaveBeenCalledWith(expect.objectContaining({
      channel_id: CHAT_ID, user_id: 12, prev_participant: undefined, new_participant: expect.objectContaining({ _: 'channelParticipant', user_id: 12 }),
    }))
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
    expect(calls).toEqual([{ method: 'get', path: `/chats/${PEER}/join_requests`, query: { limit: 50 } }])
    expect(r.importers[0].user_id).toBe(3)
  })

  it('заявки — страница: смещение по последнему (`offset_date`/`offset_user`), поиск `q`, лимит', async() => {
    const { groups } = build()
    getImpl = () => ({ _: 'messages.chatInviteImporters', count: 0, importers: [] })
    await groups.getChatInviteImporters({ chatId: CHAT_ID, requested: true, q: 'ив', offsetDate: 100, offsetUserId: 3, limit: 20 })
    expect(calls[0].query).toEqual({ limit: 20, q: 'ив', offset_date: 100, offset_user: 3 })
  })
})

// Ревью #409 п. 2: сервер шлёт кадр участника и актору (его прочим
// устройствам), а устройство, применившее мутацию местно, свой дубль
// отбрасывает — даже если кадр по WS обогнал ответ HTTP.
describe('groupsManager — серверный дубль местного апдейта участника', () => {
  const frame = (actor: number, user: number) => ({
    _: 'updateChannelParticipant' as const, channel_id: CHAT_ID, date: 1, actor_id: actor, user_id: user,
  })

  it('кадр, обогнавший ответ, — дубль; второй такой же — уже нет', async() => {
    const { groups } = build()
    const pending = groups.editBanned(CHAT_ID, member(5), { _: 'chatBannedRights', until_date: 0, pFlags: { send_media: true } })
    // кадр пришёл, пока запрос ещё не вернулся
    expect(groups.isLocalParticipantEcho(frame(ME, 5))).toBe(true)
    await pending
    expect(groups.isLocalParticipantEcho(frame(ME, 5))).toBe(false)
  })

  it('чужой актор и другой участник — не дубль', async() => {
    const { groups } = build()
    await groups.editAdmin(CHAT_ID, member(6), { _: 'chatAdminRights', pFlags: { pin_messages: true } })
    expect(groups.isLocalParticipantEcho(frame(2, 6))).toBe(false)
    expect(groups.isLocalParticipantEcho(frame(ME, 7))).toBe(false)
    expect(groups.isLocalParticipantEcho(frame(ME, 6))).toBe(true)
  })

  it('упавший запрос ожидание снимает', async() => {
    const failing = newGroupsManager({
      rest: { post: vi.fn(async() => { throw new Error('403') }) } as never,
      dialogs: {} as never,
      peers: { saveApiPeers: vi.fn() } as never,
      getMeId: () => ME,
    })
    await expect(failing.addMember(PEER, 8)).rejects.toThrow('403')
    expect(failing.isLocalParticipantEcho(frame(ME, 8))).toBe(false)
  })
})
