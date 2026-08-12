// src/core/managers/groupsManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newGroupsManager } from './groupsManager'
import type { RestClient } from '../net/restClient'

type PostCall = { path: string; body: unknown }

// Task 4 (действия без оптимистики): groupsManager получает владельца диалогов
// как зависимость (см. workerCore.ts) и зовёт его применялки ПОСЛЕ успешного
// REST-ответа. Большинству тестов ниже (createGroup/addMember/card/…) владелец
// не нужен вовсе — фейк с одними vi.fn() достаточен, чтобы конструктор
// типизировался; для проверки самого факта вызова (см. блок «действия без
// оптимистики» ниже) читаем conкретный мок.
const fakeDialogs = () => ({
  applyMute: vi.fn(),
  applyPinned: vi.fn(),
  applyArchived: vi.fn(),
  applyRemoved: vi.fn(),
})

function fakeRest(opts: { postReturn?: unknown; getReturn?: unknown; patchReturn?: unknown }) {
  const posts: PostCall[] = []
  const gets: string[] = []
  const dels: string[] = []
  const patches: PostCall[] = []
  const rest = {
    async post<R>(path: string, body: unknown): Promise<R> {
      posts.push({ path, body })
      return (opts.postReturn ?? {}) as R
    },
    async get<R>(path: string): Promise<R> {
      gets.push(path)
      return (opts.getReturn ?? {}) as R
    },
    async patch<R>(path: string, body: unknown): Promise<R> {
      patches.push({ path, body })
      return (opts.patchReturn ?? {}) as R
    },
    async del<R>(path: string): Promise<R> {
      dels.push(path)
      return {} as R
    },
  } as unknown as RestClient
  return { rest, posts, gets, dels, patches }
}

describe('GroupsManager', () => {
  it('createGroup POSTs /groups with snake_case body and returns chat_id', async () => {
    const { rest, posts } = fakeRest({ postReturn: { chat_id: 42 } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const id = await mgr.createGroup({ title: 'My Group', about: 'hi', username: 'mg', isPublic: true })
    expect(id).toBe(42)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/groups')
    expect(posts[0].body).toEqual({ title: 'My Group', about: 'hi', username: 'mg', is_public: true, member_ids: [] })
  })

  it('createGroup defaults about/username/is_public', async () => {
    const { rest, posts } = fakeRest({ postReturn: { chat_id: 7 } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.createGroup({ title: 'Solo' })
    expect(posts[0].body).toEqual({ title: 'Solo', about: '', username: '', is_public: false, member_ids: [] })
  })

  it('setMute POSTs /chats/{id}/mute with muted flag', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.setMute(9, true)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/9/mute')
    expect(posts[0].body).toEqual({ muted: true, until: null })
  })

  it('setMute передаёт until для временного mute', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.setMute(9, true, 1700000000)
    expect(posts[0].body).toEqual({ muted: true, until: 1700000000 })
  })

  it('addMember POSTs /chats/{id}/members with user_id', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.addMember(3, 11)
    expect(posts[0].path).toBe('/chats/3/members')
    expect(posts[0].body).toEqual({ user_id: 11 })
  })

  it('card maps snake_case to camelCase', async () => {
    const { rest, gets } = fakeRest({
      getReturn: {
        id: 5, type: 'group', title: 'T', username: 'u', about: 'a',
        member_count: 12, is_public: true, my_role: 'admin', my_rights: 7, muted: false,
        discussion_chat_id: 88,
      },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const card = await mgr.card(5)
    expect(gets[0]).toBe('/chats/5/card')
    expect(card).toEqual({
      id: 5, type: 'group', title: 'T', username: 'u', about: 'a',
      memberCount: 12, isPublic: true, myRole: 'admin', myRights: 7, muted: false,
      discussionChatId: 88,
      defaultPermissions: 31, slowmodeSeconds: 0, reactionsMode: 'all', reactionsAllowed: [], historyForNew: true, chargeStars: 0,
      signatures: false, signatureProfiles: false,
    })
  })

  it('card defaults discussionChatId to 0 when absent', async () => {
    const { rest } = fakeRest({
      getReturn: {
        id: 5, type: 'channel', title: 'T', username: 'u', about: 'a',
        member_count: 1, is_public: true, my_role: 'creator', my_rights: 0, muted: false,
      },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const card = await mgr.card(5)
    expect(card.discussionChatId).toBe(0)
  })

  it('promoteAdmin POSTs /chats/{id}/admins with user_id + rights bitmask', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.promoteAdmin(5, 11, 129)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/admins')
    expect(posts[0].body).toEqual({ user_id: 11, rights: 129 })
  })

  it('demoteAdmin DELETEs /chats/{id}/admins/{userId}', async () => {
    const { rest, dels } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.demoteAdmin(5, 11)
    expect(dels).toHaveLength(1)
    expect(dels[0]).toBe('/chats/5/admins/11')
  })

  it('createInvite POSTs /chats/{id}/invite_links and maps requires_approval', async () => {
    const { rest, posts } = fakeRest({ postReturn: { token: 'abc', url: 'http://x/join/abc', requires_approval: true } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const r = await mgr.createInvite(5, { usageLimit: 10, requiresApproval: true, expireSeconds: 3600 })
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/invite_links')
    expect(posts[0].body).toEqual({ usage_limit: 10, requires_approval: true, expire_seconds: 3600 })
    expect(r).toEqual({ token: 'abc', url: 'http://x/join/abc', uses: 0, requiresApproval: true, title: '', usageLimit: null, revoked: false })
  })

  it('createInvite defaults usage_limit=null, requires_approval=false, expire_seconds=0', async () => {
    const { rest, posts } = fakeRest({ postReturn: { token: 't', url: 'u', requires_approval: false } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.createInvite(5)
    expect(posts[0].body).toEqual({ usage_limit: null, requires_approval: false, expire_seconds: 0 })
  })

  it('createInvite maps expires_at from the response', async () => {
    const { rest } = fakeRest({ postReturn: { token: 'abc', url: 'u', requires_approval: false, expires_at: '2026-08-01T00:00:00Z' } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const r = await mgr.createInvite(5, { expireSeconds: 3600 })
    expect(r.expiresAt).toBe('2026-08-01T00:00:00Z')
  })

  it('listInvites GETs /chats/{id}/invite_links and maps requires_approval', async () => {
    const { rest, gets } = fakeRest({
      getReturn: { invite_links: [{ token: 't', uses: 3, url: 'u', requires_approval: true }] },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const links = await mgr.listInvites(5)
    expect(gets[0]).toBe('/chats/5/invite_links')
    expect(links).toEqual([{ token: 't', uses: 3, url: 'u', requiresApproval: true, title: '', usageLimit: null, revoked: false }])
  })

  it('listInvites appends ?revoked=true when requesting revoked links', async () => {
    const { rest, gets } = fakeRest({
      getReturn: { invite_links: [{ token: 'r', url: 'u', requires_approval: false, revoked: true }] },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const links = await mgr.listInvites(5, true)
    expect(gets[0]).toBe('/chats/5/invite_links?revoked=true')
    expect(links[0].revoked).toBe(true)
  })

  it('deleteInvite DELETEs /chats/{id}/invite_links/{token} (hard delete)', async () => {
    const { rest, dels } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.deleteInvite(5, 'tok')
    expect(dels).toHaveLength(1)
    expect(dels[0]).toBe('/chats/5/invite_links/tok')
  })

  it('deleteAllRevoked DELETEs /chats/{id}/revoked_invite_links', async () => {
    const { rest, dels } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.deleteAllRevoked(5)
    expect(dels).toHaveLength(1)
    expect(dels[0]).toBe('/chats/5/revoked_invite_links')
  })

  it('editInvite PATCHes only present fields and maps the result', async () => {
    const { rest, patches } = fakeRest({ patchReturn: { token: 't', uses: 5, url: 'u', requires_approval: true, title: 'Renamed', usage_limit: null, revoked: false } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const r = await mgr.editInvite(5, 't', { title: 'Renamed', requiresApproval: true })
    expect(patches).toHaveLength(1)
    expect(patches[0].path).toBe('/chats/5/invite_links/t')
    expect(patches[0].body).toEqual({ title: 'Renamed', requires_approval: true })
    expect(r).toEqual({ token: 't', uses: 5, url: 'u', requiresApproval: true, title: 'Renamed', usageLimit: null, revoked: false })
  })

  it('editInvite sends usage_limit:null for unlimited and revoked flag', async () => {
    const { rest, patches } = fakeRest({ patchReturn: { token: 't', url: 'u', requires_approval: false, revoked: true } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.editInvite(5, 't', { usageLimit: null, expireSeconds: 0, revoked: true })
    expect(patches[0].body).toEqual({ usage_limit: null, expire_seconds: 0, revoked: true })
  })

  it('inviteImporters GETs importers and maps user_id/joined_at + count', async () => {
    const { rest, gets } = fakeRest({ getReturn: { importers: [{ user_id: 11, joined_at: '2026-08-01T00:00:00Z' }], count: 1 } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const r = await mgr.inviteImporters(5, 't')
    expect(gets[0]).toBe('/chats/5/invite_links/t/importers')
    expect(r).toEqual({ importers: [{ userId: 11, joinedAt: '2026-08-01T00:00:00Z' }], count: 1 })
  })

  it('joinByToken POSTs /join/{token} and returns status', async () => {
    const { rest, posts } = fakeRest({ postReturn: { status: 'requested' } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const r = await mgr.joinByToken('tok123')
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/join/tok123')
    expect(posts[0].body).toEqual({})
    expect(r).toEqual({ status: 'requested' })
  })

  it('listJoinRequests maps {requests:[{user_id}]} to number[]', async () => {
    const { rest, gets } = fakeRest({ getReturn: { requests: [{ user_id: 11 }, { user_id: 22 }] } })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const ids = await mgr.listJoinRequests(5)
    expect(gets[0]).toBe('/chats/5/join_requests')
    expect(ids).toEqual([11, 22])
  })

  it('approveRequest POSTs /chats/{id}/join_requests/{userId}/approve', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.approveRequest(5, 11)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/join_requests/11/approve')
    expect(posts[0].body).toEqual({})
  })

  it('declineRequest POSTs /chats/{id}/join_requests/{userId}/decline', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.declineRequest(5, 11)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/join_requests/11/decline')
    expect(posts[0].body).toEqual({})
  })

  it('listTopics maps per-topic dialog-состояние (unread/muted/last_out/last_seq)', async () => {
    const { rest, gets } = fakeRest({
      getReturn: {
        topics: [{
          id: 1, chat_id: 5, root_msg_id: 10, title: 'T', icon_color: 2,
          closed: false, created_by: 7, msg_count: 4,
          unread: 3, unread_mentions: 1, muted: true, last_out: true, last_seq: 42,
        }],
      },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const topics = await mgr.listTopics(5)
    expect(gets[0]).toBe('/chats/5/topics')
    expect(topics[0]).toMatchObject({
      id: 1, chatId: 5, rootMsgId: 10, unread: 3, unreadMentions: 1, muted: true, lastOut: true, lastMsgSeq: 42,
    })
  })

  it('listTopics defaults new fields to 0/false when absent', async () => {
    const { rest } = fakeRest({
      getReturn: { topics: [{ id: 1, chat_id: 5, root_msg_id: 0, title: 'G', icon_color: 0, closed: false, created_by: 7, msg_count: 0 }] },
    })
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    const topics = await mgr.listTopics(5)
    expect(topics[0]).toMatchObject({ unread: 0, unreadMentions: 0, muted: false, lastOut: false, lastMsgSeq: 0 })
  })

  it('readTopic POSTs /chats/{id}/topics/{rootMsgId}/read with up_to_seq', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.readTopic(5, 10, 42)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/topics/10/read')
    expect(posts[0].body).toEqual({ up_to_seq: 42 })
  })

  it('setTopicMuted POSTs /chats/{id}/topics/{rootMsgId}/mute with muted flag', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest, dialogs: fakeDialogs() })
    await mgr.setTopicMuted(5, 10, true)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/topics/10/mute')
    expect(posts[0].body).toEqual({ muted: true })
  })
})

// Task 4 (действия без оптимистики): setMute/setPin/setArchive/deleteGroup зовут
// применялку владельца ПОСЛЕ успешного REST-ответа, а на ошибке — не зовут вовсе
// (порт tweb invokeApi(...).then(saveUpdate)). setMute — детальный fail/success
// RED/GREEN разбор с РЕАЛЬНЫМ dialogsManager живёт в dialogsManager.test.ts (там
// же и мутация «применялка перед await»); здесь — по одному компактному
// unit-тесту на каждую строку проводки (лёгкий фейк, без owner целиком).
describe('GroupsManager: действия без оптимистики (Task 4)', () => {
  it('setPin: успех — dialogs.applyPinned зовётся с итоговым pinned', async () => {
    const { rest } = fakeRest({})
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs })
    await mgr.setPin(9, true)
    expect(dialogs.applyPinned).toHaveBeenCalledWith(9, true)
  })

  it('setPin: RPC упал (лимит) — dialogs.applyPinned не зовётся', async () => {
    const rest = { post: vi.fn(async () => { throw new Error('pin limit') }) } as unknown as RestClient
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs })
    await expect(mgr.setPin(9, true)).rejects.toThrow('pin limit')
    expect(dialogs.applyPinned).not.toHaveBeenCalled()
  })

  it('setArchive: успех — dialogs.applyArchived зовётся с итоговым archived', async () => {
    const { rest } = fakeRest({})
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs })
    await mgr.setArchive(9, true)
    expect(dialogs.applyArchived).toHaveBeenCalledWith(9, true)
  })

  it('setArchive: RPC упал — dialogs.applyArchived не зовётся', async () => {
    const rest = { post: vi.fn(async () => { throw new Error('offline') }) } as unknown as RestClient
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs })
    await expect(mgr.setArchive(9, true)).rejects.toThrow('offline')
    expect(dialogs.applyArchived).not.toHaveBeenCalled()
  })

  it('deleteGroup: DELETEs /chats/{id}, затем зовёт dialogs.applyRemoved', async () => {
    const { rest, dels } = fakeRest({})
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs })
    await mgr.deleteGroup(9)
    expect(dels).toEqual(['/chats/9'])
    expect(dialogs.applyRemoved).toHaveBeenCalledWith(9)
  })

  it('deleteGroup: RPC упал — dialogs.applyRemoved не зовётся', async () => {
    const rest = { del: vi.fn(async () => { throw new Error('offline') }) } as unknown as RestClient
    const dialogs = fakeDialogs()
    const mgr = newGroupsManager({ rest, dialogs })
    await expect(mgr.deleteGroup(9)).rejects.toThrow('offline')
    expect(dialogs.applyRemoved).not.toHaveBeenCalled()
  })
})
