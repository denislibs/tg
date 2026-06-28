// src/core/managers/groupsManager.ts
import type { RestClient } from '../net/restClient'

export interface GroupCard {
  id: number; type: string; title: string; username: string; about: string
  memberCount: number; isPublic: boolean; myRole: string; myRights: number; muted: boolean
  discussionChatId: number
}

export function newGroupsManager({ rest }: { rest: Pick<RestClient, 'post' | 'get' | 'del'> }) {
  return {
    async createGroup(args: { title: string; about?: string; username?: string; isPublic?: boolean }): Promise<number> {
      const r = await rest.post<{ chat_id: number }>('/groups', {
        title: args.title, about: args.about ?? '', username: args.username ?? '', is_public: args.isPublic ?? false,
      })
      return r.chat_id
    },
    async addMember(chatId: number, userId: number): Promise<void> {
      await rest.post(`/chats/${chatId}/members`, { user_id: userId })
    },
    async setMute(chatId: number, muted: boolean): Promise<void> {
      await rest.post(`/chats/${chatId}/mute`, { muted })
    },
    async card(chatId: number): Promise<GroupCard> {
      const c = await rest.get<{ id: number; type: string; title: string; username: string; about: string; member_count: number; is_public: boolean; my_role: string; my_rights: number; muted: boolean; discussion_chat_id?: number }>(`/chats/${chatId}/card`)
      return { id: c.id, type: c.type, title: c.title, username: c.username, about: c.about, memberCount: c.member_count, isPublic: c.is_public, myRole: c.my_role, myRights: c.my_rights, muted: c.muted, discussionChatId: c.discussion_chat_id ?? 0 }
    },
    async members(chatId: number): Promise<{ userId: number; role: string; online: boolean }[]> {
      const r = await rest.get<{ members: { user_id: number; role: string; online: boolean }[] }>(`/chats/${chatId}/members`)
      return (r.members ?? []).map((m) => ({ userId: m.user_id, role: m.role, online: m.online }))
    },
    async promoteAdmin(chatId: number, userId: number, rights: number): Promise<void> {
      await rest.post(`/chats/${chatId}/admins`, { user_id: userId, rights })
    },
    async demoteAdmin(chatId: number, userId: number): Promise<void> {
      await rest.del(`/chats/${chatId}/admins/${userId}`)
    },
    async createInvite(chatId: number, opts?: { usageLimit?: number; requiresApproval?: boolean }): Promise<{ token: string; url: string; requiresApproval: boolean }> {
      const r = await rest.post<{ token: string; url: string; requires_approval: boolean }>(`/chats/${chatId}/invite_links`, { usage_limit: opts?.usageLimit ?? null, requires_approval: opts?.requiresApproval ?? false })
      return { token: r.token, url: r.url, requiresApproval: r.requires_approval }
    },
    async listInvites(chatId: number): Promise<{ token: string; uses: number; url: string; requiresApproval: boolean }[]> {
      const r = await rest.get<{ invite_links: { token: string; uses: number; url: string; requires_approval: boolean }[] }>(`/chats/${chatId}/invite_links`)
      return (r.invite_links ?? []).map((l) => ({ token: l.token, uses: l.uses, url: l.url, requiresApproval: l.requires_approval }))
    },
    async joinByToken(token: string): Promise<{ status: 'requested' | 'joined' }> {
      return rest.post<{ status: 'requested' | 'joined' }>(`/join/${token}`, {})
    },
    async listJoinRequests(chatId: number): Promise<number[]> {
      const r = await rest.get<{ requests: { user_id: number }[] }>(`/chats/${chatId}/join_requests`)
      return (r.requests ?? []).map((x) => x.user_id)
    },
    async approveRequest(chatId: number, userId: number): Promise<void> { await rest.post(`/chats/${chatId}/join_requests/${userId}/approve`, {}) },
    async declineRequest(chatId: number, userId: number): Promise<void> { await rest.post(`/chats/${chatId}/join_requests/${userId}/decline`, {}) },
  }
}
export type GroupsManager = ReturnType<typeof newGroupsManager>
