// src/core/managers/groupsManager.ts
import type { RestClient } from '../net/restClient'
import { RT } from '../realtime/events'

export interface GroupCard {
  id: number; type: string; title: string; username: string; about: string
  memberCount: number; isPublic: boolean; myRole: string; myRights: number; muted: boolean
  discussionChatId: number
  /** битовая маска возможностей обычных участников (см. PERMS в useGroupEdit) */
  defaultPermissions: number
  slowmodeSeconds: number
  reactionsMode: 'all' | 'some' | 'none'
  reactionsAllowed: string[]
  historyForNew: boolean
  /** плата за сообщение в звёздах (Telegram paid messages); 0 — выключено */
  chargeStars: number
  /** канал: подписывать посты именем автора (Telegram signatures) */
  signatures: boolean
  /** канал: показывать профиль автора под подписью (Telegram signature_profiles) */
  signatureProfiles: boolean
}

// Пригласительная ссылка (Telegram exportedChatInvite). Единый JSON для
// create/list/edit; usageLimit=null — без лимита, expiresAt=undefined — бессрочно.
export interface InviteLink {
  token: string
  url: string
  uses: number
  requiresApproval: boolean
  expiresAt?: string
  title: string
  usageLimit: number | null
  revoked: boolean
}

interface RawInvite {
  token: string; uses?: number; url: string; requires_approval: boolean
  expires_at?: string | null; title?: string | null; usage_limit?: number | null; revoked?: boolean
}

const mapInvite = (l: RawInvite): InviteLink => ({
  token: l.token,
  url: l.url,
  uses: l.uses ?? 0,
  requiresApproval: l.requires_approval,
  expiresAt: l.expires_at ?? undefined,
  title: l.title ?? '',
  usageLimit: l.usage_limit ?? null,
  revoked: l.revoked ?? false,
})

// Тема форум-группы (строка списка: тема + последнее сообщение треда).
export interface TopicRow {
  id: number
  chatId: number
  rootMsgId: number
  title: string
  iconColor: number
  iconEmoji: string
  closed: boolean
  hidden: boolean
  pinned: boolean
  pos: number
  isGeneral: boolean
  createdBy: number
  msgCount: number
  lastText: string
  lastType: string
  lastSenderName: string
  lastAt?: string
  /** непрочитанные сообщения темы (чужие, как у диалога) */
  unread: number
  /** непрочитанные упоминания зрителя в теме */
  unreadMentions: number
  /** тема заглушена этим пользователем */
  muted: boolean
  /** последнее сообщение темы отправлено мной (для галочек) */
  lastOut: boolean
  /** seq последнего сообщения темы (для пометки «прочитано») */
  lastMsgSeq: number
}

interface RawTopic {
  id: number; chat_id: number; root_msg_id: number; title: string; icon_color: number
  icon_emoji?: string | null; closed: boolean; hidden?: boolean; pinned?: boolean; pos?: number
  is_general?: boolean; created_by: number; msg_count: number
  last_text?: string | null; last_type?: string | null; last_sender_name?: string | null; last_at?: string | null
  unread?: number; unread_mentions?: number; muted?: boolean; last_out?: boolean; last_seq?: number
}

const mapTopic = (r: RawTopic): TopicRow => ({
  id: r.id, chatId: r.chat_id, rootMsgId: r.root_msg_id, title: r.title, iconColor: r.icon_color,
  iconEmoji: r.icon_emoji ?? '', closed: r.closed, hidden: r.hidden ?? false, pinned: r.pinned ?? false,
  pos: r.pos ?? 0, isGeneral: r.is_general ?? false,
  createdBy: r.created_by, msgCount: r.msg_count ?? 0,
  lastText: r.last_text ?? '', lastType: r.last_type ?? '', lastSenderName: r.last_sender_name ?? '',
  lastAt: r.last_at ?? undefined,
  unread: r.unread ?? 0, unreadMentions: r.unread_mentions ?? 0, muted: r.muted ?? false,
  lastOut: r.last_out ?? false, lastMsgSeq: r.last_seq ?? 0,
})

export function newGroupsManager({ rest, broadcast }: {
  rest: Pick<RestClient, 'post' | 'get' | 'put' | 'patch' | 'del'>
  // Кросс-таб-эхо мутаций без WS-эха бэка: воркер шлёт событие всем вкладкам.
  broadcast?: (event: string, payload: unknown) => void
}) {
  return {
    async createGroup(args: { title: string; about?: string; username?: string; isPublic?: boolean; memberIds?: number[] }): Promise<number> {
      const r = await rest.post<{ chat_id: number }>('/groups', {
        title: args.title, about: args.about ?? '', username: args.username ?? '', is_public: args.isPublic ?? false,
        member_ids: args.memberIds ?? [],
      })
      return r.chat_id
    },
    async addMember(chatId: number, userId: number): Promise<void> {
      await rest.post(`/chats/${chatId}/members`, { user_id: userId })
    },
    async setPhoto(chatId: number, mediaId: number): Promise<void> {
      await rest.put(`/chats/${chatId}/photo`, { media_id: mediaId })
    },
    // until — unix-секунды окончания временного mute (tweb «For 1 Hour…»);
    // muted=true без until — навсегда.
    async setMute(chatId: number, muted: boolean, until?: number): Promise<void> {
      await rest.post(`/chats/${chatId}/mute`, { muted, until: until ?? null })
      // Кросс-таб-консистентность: у бэка WS-эха mute нет, поэтому ретранслируем
      // мутацию сами — все вкладки (включая инициатора, идемпотентно) обновят стор.
      broadcast?.(RT.dialogMute, { chat_id: chatId, muted })
    },
    // ── Форум-топики ──
    async setForum(chatId: number, enabled: boolean): Promise<void> {
      await rest.post(`/chats/${chatId}/forum`, { enabled })
    },
    async createTopic(chatId: number, title: string, iconColor: number, iconEmoji = ''): Promise<{ id: number; rootMsgId: number }> {
      const r = await rest.post<{ id: number; root_msg_id: number }>(`/chats/${chatId}/topics`, { title, icon_color: iconColor, icon_emoji: iconEmoji })
      return { id: r.id, rootMsgId: r.root_msg_id }
    },
    async listTopics(chatId: number): Promise<TopicRow[]> {
      const r = await rest.get<{ topics: RawTopic[] }>(`/chats/${chatId}/topics`)
      return (r.topics ?? []).map(mapTopic)
    },
    async closeTopic(chatId: number, topicId: number, closed: boolean): Promise<void> {
      await rest.post(`/chats/${chatId}/topics/${topicId}/close`, { closed })
    },
    async editTopic(chatId: number, topicId: number, title: string, iconColor: number, iconEmoji = ''): Promise<void> {
      await rest.patch(`/chats/${chatId}/topics/${topicId}`, { title, icon_color: iconColor, icon_emoji: iconEmoji })
    },
    async setTopicHidden(chatId: number, topicId: number, hidden: boolean): Promise<void> {
      await rest.post(`/chats/${chatId}/topics/${topicId}/hide`, { hidden })
    },
    async setTopicPinned(chatId: number, topicId: number, pinned: boolean): Promise<void> {
      await rest.post(`/chats/${chatId}/topics/${topicId}/pin`, { pinned })
    },
    // Пометить тему прочитанной до upToSeq (Telegram readDiscussion с threadId).
    // Адресуется по rootMsgId (пара chat+root — ключ состояния темы на бэке).
    async readTopic(chatId: number, rootMsgId: number, upToSeq: number): Promise<void> {
      await rest.post(`/chats/${chatId}/topics/${rootMsgId}/read`, { up_to_seq: upToSeq })
    },
    // Вкл/выкл уведомления темы для пользователя (адресуется по rootMsgId).
    async setTopicMuted(chatId: number, rootMsgId: number, muted: boolean): Promise<void> {
      await rest.post(`/chats/${chatId}/topics/${rootMsgId}/mute`, { muted })
    },

    // Закрепить/открепить диалог вверху списка (лимит 5 — бэк вернёт 400).
    async setPin(chatId: number, pinned: boolean): Promise<void> {
      await rest.post(`/chats/${chatId}/pin`, { pinned })
    },
    // Убрать диалог в архив / вернуть из архива.
    async setArchive(chatId: number, archived: boolean): Promise<void> {
      await rest.post(`/chats/${chatId}/archive`, { archived })
    },
    async card(chatId: number): Promise<GroupCard> {
      const c = await rest.get<{
        id: number; type: string; title: string; username: string; about: string
        member_count: number; is_public: boolean; my_role: string; my_rights: number; muted: boolean
        discussion_chat_id?: number
        default_permissions?: number; slowmode_seconds?: number
        reactions_mode?: 'all' | 'some' | 'none'; reactions_allowed?: string[] | null; history_for_new?: boolean
        charge_stars?: number; signatures?: boolean; signature_profiles?: boolean
      }>(`/chats/${chatId}/card`)
      return {
        id: c.id, type: c.type, title: c.title, username: c.username, about: c.about,
        memberCount: c.member_count, isPublic: c.is_public, myRole: c.my_role, myRights: c.my_rights,
        muted: c.muted, discussionChatId: c.discussion_chat_id ?? 0,
        defaultPermissions: c.default_permissions ?? 31,
        slowmodeSeconds: c.slowmode_seconds ?? 0,
        reactionsMode: c.reactions_mode ?? 'all',
        reactionsAllowed: c.reactions_allowed ?? [],
        historyForNew: c.history_for_new ?? true,
        chargeStars: c.charge_stars ?? 0,
        signatures: c.signatures ?? false,
        signatureProfiles: c.signature_profiles ?? false,
      }
    },
    async editInfo(chatId: number, args: { title: string; about?: string; username?: string }): Promise<void> {
      await rest.patch(`/chats/${chatId}`, { title: args.title, about: args.about ?? '', username: args.username ?? '' })
    },
    async setType(chatId: number, isPublic: boolean, username: string): Promise<void> {
      await rest.put(`/chats/${chatId}/type`, { is_public: isPublic, username })
    },
    async setPermissions(chatId: number, permissions: number, slowmodeSeconds: number): Promise<void> {
      await rest.put(`/chats/${chatId}/permissions`, { permissions, slowmode_seconds: slowmodeSeconds })
    },
    async setReactions(chatId: number, mode: 'all' | 'some' | 'none', emojis: string[]): Promise<void> {
      await rest.put(`/chats/${chatId}/reactions`, { mode, emojis })
    },
    async setHistory(chatId: number, visible: boolean): Promise<void> {
      await rest.put(`/chats/${chatId}/history`, { visible })
    },
    // Плата за сообщение в звёздах (Telegram paid messages); 0 — выключить.
    async setChargeStars(chatId: number, chargeStars: number): Promise<void> {
      await rest.put(`/chats/${chatId}/charge_stars`, { charge_stars: chargeStars })
    },
    async listBans(chatId: number): Promise<{ userId: number; bannedBy: number }[]> {
      const r = await rest.get<{ bans: { user_id: number; banned_by: number }[] }>(`/chats/${chatId}/bans`)
      return (r.bans ?? []).map((b) => ({ userId: b.user_id, bannedBy: b.banned_by }))
    },
    async ban(chatId: number, userId: number): Promise<void> {
      await rest.post(`/chats/${chatId}/bans`, { user_id: userId })
    },
    async unban(chatId: number, userId: number): Promise<void> {
      await rest.del(`/chats/${chatId}/bans/${userId}`)
    },
    // Гранулярные ограничения участника (Telegram editBanned / ChatBannedRights):
    // deniedRights — битовая маска запрещённых прав (PERMS), untilSeconds — срок
    // (0/undefined — бессрочно).
    async listRestrictions(chatId: number): Promise<{ userId: number; deniedRights: number; untilDate?: string; restrictedBy: number }[]> {
      const r = await rest.get<{ restrictions: { user_id: number; denied_rights: number; until_date: string | null; restricted_by: number }[] }>(`/chats/${chatId}/restrictions`)
      return (r.restrictions ?? []).map((x) => ({ userId: x.user_id, deniedRights: x.denied_rights, untilDate: x.until_date ?? undefined, restrictedBy: x.restricted_by }))
    },
    async restrictMember(chatId: number, userId: number, deniedRights: number, untilSeconds?: number): Promise<void> {
      await rest.post(`/chats/${chatId}/restrictions`, { user_id: userId, denied_rights: deniedRights, until_seconds: untilSeconds ?? 0 })
    },
    async unrestrictMember(chatId: number, userId: number): Promise<void> {
      await rest.del(`/chats/${chatId}/restrictions/${userId}`)
    },
    async removeMember(chatId: number, userId: number): Promise<void> {
      await rest.del(`/chats/${chatId}/members/${userId}`)
    },
    // Hard-delete ссылки (Telegram deleteExportedChatInvite). Отзыв — через
    // editInvite({revoked:true}) (PATCH), а не этот метод.
    async deleteInvite(chatId: number, token: string): Promise<void> {
      await rest.del(`/chats/${chatId}/invite_links/${token}`)
    },
    // Удалить все отозванные ссылки чата (Telegram deleteRevokedExportedChatInvites).
    async deleteAllRevoked(chatId: number): Promise<void> {
      await rest.del(`/chats/${chatId}/revoked_invite_links`)
    },
    async deleteGroup(chatId: number): Promise<void> {
      await rest.del(`/chats/${chatId}`)
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
    async createInvite(chatId: number, opts?: { title?: string; usageLimit?: number; requiresApproval?: boolean; expireSeconds?: number }): Promise<InviteLink> {
      const r = await rest.post<RawInvite>(`/chats/${chatId}/invite_links`, { title: opts?.title, usage_limit: opts?.usageLimit ?? null, requires_approval: opts?.requiresApproval ?? false, expire_seconds: opts?.expireSeconds ?? 0 })
      return mapInvite(r)
    },
    // revoked=true — список отозванных ссылок (Telegram getExportedChatInvites
    // revoked flag); по умолчанию — активные.
    async listInvites(chatId: number, revoked = false): Promise<InviteLink[]> {
      const r = await rest.get<{ invite_links: RawInvite[] }>(`/chats/${chatId}/invite_links${revoked ? '?revoked=true' : ''}`)
      return (r.invite_links ?? []).map(mapInvite)
    },
    // Частичный PATCH ссылки (Telegram editExportedChatInvite): revoked:true — отзыв,
    // usageLimit:null — снять лимит, expireSeconds:0 — сделать бессрочной.
    async editInvite(chatId: number, token: string, patch: { title?: string; usageLimit?: number | null; requiresApproval?: boolean; expireSeconds?: number; revoked?: boolean }): Promise<InviteLink> {
      const body: Record<string, unknown> = {}
      if (patch.title !== undefined) body.title = patch.title
      if (patch.usageLimit !== undefined) body.usage_limit = patch.usageLimit
      if (patch.requiresApproval !== undefined) body.requires_approval = patch.requiresApproval
      if (patch.expireSeconds !== undefined) body.expire_seconds = patch.expireSeconds
      if (patch.revoked !== undefined) body.revoked = patch.revoked
      const r = await rest.patch<RawInvite>(`/chats/${chatId}/invite_links/${token}`, body)
      return mapInvite(r)
    },
    // Список вступивших по ссылке (Telegram chatInviteImporters).
    async inviteImporters(chatId: number, token: string): Promise<{ importers: { userId: number; joinedAt: string }[]; count: number }> {
      const r = await rest.get<{ importers: { user_id: number; joined_at: string }[]; count: number }>(`/chats/${chatId}/invite_links/${token}/importers`)
      return { importers: (r.importers ?? []).map((i) => ({ userId: i.user_id, joinedAt: i.joined_at })), count: r.count ?? 0 }
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
