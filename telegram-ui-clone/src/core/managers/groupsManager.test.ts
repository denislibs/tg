// src/core/managers/groupsManager.test.ts
import { describe, it, expect } from 'vitest'
import { newGroupsManager } from './groupsManager'
import type { RestClient } from '../net/restClient'

type PostCall = { path: string; body: unknown }

function fakeRest(opts: { postReturn?: unknown; getReturn?: unknown }) {
  const posts: PostCall[] = []
  const gets: string[] = []
  const dels: string[] = []
  const rest = {
    async post<R>(path: string, body: unknown): Promise<R> {
      posts.push({ path, body })
      return (opts.postReturn ?? {}) as R
    },
    async get<R>(path: string): Promise<R> {
      gets.push(path)
      return (opts.getReturn ?? {}) as R
    },
    async del<R>(path: string): Promise<R> {
      dels.push(path)
      return {} as R
    },
  } as unknown as RestClient
  return { rest, posts, gets, dels }
}

describe('GroupsManager', () => {
  it('createGroup POSTs /groups with snake_case body and returns chat_id', async () => {
    const { rest, posts } = fakeRest({ postReturn: { chat_id: 42 } })
    const mgr = newGroupsManager({ rest })
    const id = await mgr.createGroup({ title: 'My Group', about: 'hi', username: 'mg', isPublic: true })
    expect(id).toBe(42)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/groups')
    expect(posts[0].body).toEqual({ title: 'My Group', about: 'hi', username: 'mg', is_public: true })
  })

  it('createGroup defaults about/username/is_public', async () => {
    const { rest, posts } = fakeRest({ postReturn: { chat_id: 7 } })
    const mgr = newGroupsManager({ rest })
    await mgr.createGroup({ title: 'Solo' })
    expect(posts[0].body).toEqual({ title: 'Solo', about: '', username: '', is_public: false })
  })

  it('setMute POSTs /chats/{id}/mute with muted flag', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest })
    await mgr.setMute(9, true)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/9/mute')
    expect(posts[0].body).toEqual({ muted: true })
  })

  it('addMember POSTs /chats/{id}/members with user_id', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest })
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
    const mgr = newGroupsManager({ rest })
    const card = await mgr.card(5)
    expect(gets[0]).toBe('/chats/5/card')
    expect(card).toEqual({
      id: 5, type: 'group', title: 'T', username: 'u', about: 'a',
      memberCount: 12, isPublic: true, myRole: 'admin', myRights: 7, muted: false,
      discussionChatId: 88,
    })
  })

  it('card defaults discussionChatId to 0 when absent', async () => {
    const { rest } = fakeRest({
      getReturn: {
        id: 5, type: 'channel', title: 'T', username: 'u', about: 'a',
        member_count: 1, is_public: true, my_role: 'creator', my_rights: 0, muted: false,
      },
    })
    const mgr = newGroupsManager({ rest })
    const card = await mgr.card(5)
    expect(card.discussionChatId).toBe(0)
  })

  it('promoteAdmin POSTs /chats/{id}/admins with user_id + rights bitmask', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest })
    await mgr.promoteAdmin(5, 11, 129)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/admins')
    expect(posts[0].body).toEqual({ user_id: 11, rights: 129 })
  })

  it('demoteAdmin DELETEs /chats/{id}/admins/{userId}', async () => {
    const { rest, dels } = fakeRest({})
    const mgr = newGroupsManager({ rest })
    await mgr.demoteAdmin(5, 11)
    expect(dels).toHaveLength(1)
    expect(dels[0]).toBe('/chats/5/admins/11')
  })

  it('createInvite POSTs /chats/{id}/invite_links and maps requires_approval', async () => {
    const { rest, posts } = fakeRest({ postReturn: { token: 'abc', url: 'http://x/join/abc', requires_approval: true } })
    const mgr = newGroupsManager({ rest })
    const r = await mgr.createInvite(5, { usageLimit: 10, requiresApproval: true })
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/invite_links')
    expect(posts[0].body).toEqual({ usage_limit: 10, requires_approval: true })
    expect(r).toEqual({ token: 'abc', url: 'http://x/join/abc', requiresApproval: true })
  })

  it('createInvite defaults usage_limit=null and requires_approval=false', async () => {
    const { rest, posts } = fakeRest({ postReturn: { token: 't', url: 'u', requires_approval: false } })
    const mgr = newGroupsManager({ rest })
    await mgr.createInvite(5)
    expect(posts[0].body).toEqual({ usage_limit: null, requires_approval: false })
  })

  it('listInvites GETs /chats/{id}/invite_links and maps requires_approval', async () => {
    const { rest, gets } = fakeRest({
      getReturn: { invite_links: [{ token: 't', uses: 3, url: 'u', requires_approval: true }] },
    })
    const mgr = newGroupsManager({ rest })
    const links = await mgr.listInvites(5)
    expect(gets[0]).toBe('/chats/5/invite_links')
    expect(links).toEqual([{ token: 't', uses: 3, url: 'u', requiresApproval: true }])
  })

  it('joinByToken POSTs /join/{token} and returns status', async () => {
    const { rest, posts } = fakeRest({ postReturn: { status: 'requested' } })
    const mgr = newGroupsManager({ rest })
    const r = await mgr.joinByToken('tok123')
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/join/tok123')
    expect(posts[0].body).toEqual({})
    expect(r).toEqual({ status: 'requested' })
  })

  it('listJoinRequests maps {requests:[{user_id}]} to number[]', async () => {
    const { rest, gets } = fakeRest({ getReturn: { requests: [{ user_id: 11 }, { user_id: 22 }] } })
    const mgr = newGroupsManager({ rest })
    const ids = await mgr.listJoinRequests(5)
    expect(gets[0]).toBe('/chats/5/join_requests')
    expect(ids).toEqual([11, 22])
  })

  it('approveRequest POSTs /chats/{id}/join_requests/{userId}/approve', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest })
    await mgr.approveRequest(5, 11)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/join_requests/11/approve')
    expect(posts[0].body).toEqual({})
  })

  it('declineRequest POSTs /chats/{id}/join_requests/{userId}/decline', async () => {
    const { rest, posts } = fakeRest({})
    const mgr = newGroupsManager({ rest })
    await mgr.declineRequest(5, 11)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/chats/5/join_requests/11/decline')
    expect(posts[0].body).toEqual({})
  })
})
