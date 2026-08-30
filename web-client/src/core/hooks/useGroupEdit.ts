// src/core/hooks/useGroupEdit.ts
// ViewModel экранов редактирования группы (tweb sidebarRight editChat и под-табы):
// карточка с настройками, участники/админы, инвайт-ссылки, чёрный список +
// действия. Все мутации перезагружают карточку (и список диалогов, когда меняется
// то, что видно в сайдбаре: название/фото/тип).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useManagers } from './useManagers'
import type { ChatCard, InviteLink } from '../managers/groupsManager'
import type { DiscussionCandidate } from '../managers/channelsManager'
import type { ChatMember } from '../managers/groupsManager'
import type { UserReal } from '../peers/peer'
import { getLinkedChatPeerId, getPeerPhotoId } from '../peers/peer'
import { hasRights } from '../peers/rights'
import { NULL_PEER_ID } from '../peers/peerId'
import { getUserTitle } from '../peers/getPeerTitle'
import type { PeerProfile } from '../managers/authManager'

// Битовая маска «возможностей участников» (зеркало domain.MemberPerms).
export const PERMS = [
  { label: 'UserRestrictionsSend', bit: 1 },
  { label: 'UserRestrictionsSendMedia', bit: 2 },
  { label: 'UserRestrictionsInviteUsers', bit: 4 },
  { label: 'UserRestrictionsPinMessages', bit: 8 },
  { label: 'UserRestrictionsChangeInfo', bit: 16 },
] as const
export const ALL_PERMS = 31

// Шаги слайдера медленного режима (tweb RangeStepsSelector).
export const SLOWMODE_STEPS = [0, 5, 10, 30, 60, 300, 900, 3600]
export const slowmodeLabel = (sec: number): string =>
  sec === 0 ? 'Нет' : sec < 60 ? `${sec} сек` : sec < 3600 ? `${sec / 60} мин` : '1 ч'

export interface EditMember {
  userId: number
  name: string
  username?: string
  /** id медиа аватарки (`user.photo.photo_id`); прежний `avatarUrl` был строкой
   *  `/media/N/content`, из которой этот же номер выпарсивался регуляркой. */
  photoId?: number
  role: string
  rights: number
}

export interface BannedRow {
  userId: number
  name: string
  photoId?: number
}

// Строка гранулярного ограничения (Telegram ChatBannedRights): битовая маска
// ЗАПРЕЩённых прав + срок (undefined — бессрочно).
export interface RestrictedRow {
  userId: number
  name: string
  photoId?: number
  deniedRights: number
  untilDate?: string
}

// Строка вступившего по инвайт-ссылке (Telegram chatInviteImporter): имя резолвится.
export interface ImporterRow {
  userId: number
  name: string
  photoId?: number
  joinedAt: string
}

// Аргументы создания ссылки (tweb editChatInviteLink «Save»).
export interface CreateInviteOpts { title?: string; usageLimit?: number; requiresApproval?: boolean; expireSeconds?: number }
// Частичный патч ссылки (Telegram editExportedChatInvite).
export interface InvitePatch { title?: string; usageLimit?: number | null; requiresApproval?: boolean; expireSeconds?: number; revoked?: boolean }
// Инфо о связанной группе-обсуждении (для экрана Discussion).
export interface DiscussionGroup { peerId: PeerId; title: string; username: string; memberCount: number }

interface Managers {
  groups: {
    card(chatId: PeerId): Promise<ChatCard | null>
    members(peerId: PeerId): Promise<ChatMember[]>
    editInfo(chatId: number, args: { title: string; about?: string; username?: string }): Promise<void>
    setType(chatId: number, isPublic: boolean, username: string): Promise<void>
    setPermissions(chatId: number, permissions: number, slowmodeSeconds: number): Promise<void>
    setReactions(chatId: number, mode: 'all' | 'some' | 'none', emojis: string[]): Promise<void>
    setHistory(chatId: number, visible: boolean): Promise<void>
    setChargeStars(chatId: number, chargeStars: number): Promise<void>
    listInvites(chatId: number, revoked?: boolean): Promise<InviteLink[]>
    createInvite(chatId: number, opts?: CreateInviteOpts): Promise<InviteLink>
    editInvite(chatId: number, token: string, patch: InvitePatch): Promise<InviteLink>
    inviteImporters(chatId: number, token: string): Promise<{ importers: { userId: number; joinedAt: string }[]; count: number }>
    deleteInvite(chatId: number, token: string): Promise<void>
    deleteAllRevoked(chatId: number): Promise<void>
    listBans(chatId: number): Promise<{ userId: number; bannedBy: number }[]>
    ban(chatId: number, userId: number): Promise<void>
    unban(chatId: number, userId: number): Promise<void>
    listRestrictions(chatId: number): Promise<{ userId: number; deniedRights: number; untilDate?: string; restrictedBy: number }[]>
    restrictMember(chatId: number, userId: number, deniedRights: number, untilSeconds?: number): Promise<void>
    unrestrictMember(chatId: number, userId: number): Promise<void>
    removeMember(chatId: number, userId: number): Promise<void>
    addMember(chatId: number, userId: number): Promise<void>
    promoteAdmin(chatId: number, userId: number, rights: number): Promise<void>
    demoteAdmin(chatId: number, userId: number): Promise<void>
    setPhoto(chatId: number, mediaId: number): Promise<void>
    deleteGroup(chatId: number): Promise<void>
  }
  channels: {
    enableDiscussion(channelId: number): Promise<number>
    linkDiscussion(channelId: number, groupId: number): Promise<number>
    unlinkDiscussion(channelId: number): Promise<void>
    discussionCandidates(channelId: number): Promise<DiscussionCandidate[]>
    setSignatures(channelId: number, signatures: boolean, profiles: boolean): Promise<void>
  }
  media: { upload(args: { bytes: ArrayBuffer; mime: string; size: number; width?: number; height?: number }): Promise<number> }
  peers: { getUsers(ids: PeerId[]): Promise<UserReal[]> }
  auth: { me(): Promise<PeerProfile | null> }
  // Task 4 (действия без оптимистики, fix ревью Important): self-leave
  // (removeMember(chatId, me.id)) применяет владельца локально сразу после
  // успеха — не дожидаясь WS chat_removed (см. deleteOrLeave ниже).
  // Task 6: `refresh()` — сетевой догон владельца списка диалогов (заменил
  // `chats.listDialogs()` + `loadChats`, диалоговая половина которого снесена).
  // `refresh()` отдаёт опубликованную операцию (или null, если ответ совпал с
  // памятью) — здесь она не нужна, ждём только завершения догона.
  dialogs: { applyRemoved(chatId: number): Promise<void>; refresh(): Promise<unknown> }
}

export interface GroupEdit {
  card: ChatCard | null
  members: EditMember[]
  admins: EditMember[]
  invites: InviteLink[]
  revokedInvites: InviteLink[]
  bans: BannedRow[]
  restricted: RestrictedRow[]
  canBan: boolean
  canManageAdmins: boolean
  isCreator: boolean
  reload: () => void
  saveInfo: (title: string, about: string) => Promise<void>
  savePhoto: (blob: Blob, width: number, height: number) => Promise<void>
  saveType: (isPublic: boolean, username: string) => Promise<'ok' | 'taken' | 'invalid'>
  savePermissions: (permissions: number, slowmodeSeconds: number) => Promise<void>
  saveReactions: (mode: 'all' | 'some' | 'none', emojis: string[]) => Promise<void>
  saveHistory: (visible: boolean) => Promise<void>
  saveChargeStars: (chargeStars: number) => Promise<void>
  saveSignatures: (signatures: boolean, profiles: boolean) => Promise<void>
  createInvite: (opts?: CreateInviteOpts) => Promise<void>
  editInvite: (token: string, patch: InvitePatch) => Promise<void>
  loadImporters: (token: string) => Promise<ImporterRow[]>
  deleteInvite: (token: string) => Promise<void>
  deleteAllRevoked: () => Promise<void>
  enableDiscussion: () => Promise<void>
  linkDiscussion: (groupId: number) => Promise<void>
  unlinkDiscussion: () => Promise<void>
  loadDiscussionCandidates: () => Promise<DiscussionCandidate[]>
  loadDiscussionGroup: () => Promise<DiscussionGroup | null>
  kick: (userId: number) => Promise<void>
  ban: (userId: number) => Promise<void>
  unban: (userId: number) => Promise<void>
  restrict: (userId: number, deniedRights: number, untilSeconds?: number) => Promise<void>
  unrestrict: (userId: number) => Promise<void>
  addMember: (userId: number) => Promise<void>
  promote: (userId: number, rights: number) => Promise<void>
  demote: (userId: number) => Promise<void>
  deleteOrLeave: () => Promise<void>
}

export function useGroupEdit(chatId: number): GroupEdit {
  const managers: Managers = useManagers()
  const [card, setCard] = useState<ChatCard | null>(null)
  const [members, setMembers] = useState<EditMember[]>([])
  const [invites, setInvites] = useState<InviteLink[]>([])
  const [revokedInvites, setRevokedInvites] = useState<InviteLink[]>([])
  const [bans, setBans] = useState<BannedRow[]>([])
  const [restricted, setRestricted] = useState<RestrictedRow[]>([])
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((x) => x + 1), [])

  // Роль и права — у конструктора `channel`: `pFlags.creator` и НАЛИЧИЕ
  // `admin_rights` (полей `my_role`/`my_rights` на проводе больше нет).
  const isCreator = !!(card && card.chat.pFlags?.creator)
  const canBan = hasRights(card?.chat, 'ban_users')
  const canManageAdmins = hasRights(card?.chat, 'add_admins')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const c = await managers.groups.card(chatId)
        if (!alive || !c) return
        setCard(c)
        const ms = await managers.groups.members(chatId)
        const users = await managers.peers.getUsers(ms.map((m) => m.userId))
        const byId = new Map(users.map((u) => [u.id, u]))
        if (!alive) return
        setMembers(ms.map((m) => ({
          userId: m.userId,
          name: getUserTitle(byId.get(m.userId)),
          username: byId.get(m.userId)?.username || undefined,
          photoId: getPeerPhotoId(byId.get(m.userId)?.photo) || undefined,
          role: m.role,
          rights: 0,
        })))
        // Разделы ссылок/банов/ограничений — админские (tweb `just_admin`).
        const canInvite = hasRights(c.chat, 'just_admin')
        if (canInvite) {
          const inv = await managers.groups.listInvites(chatId)
          if (alive) setInvites(inv)
          const revoked = await managers.groups.listInvites(chatId, true).catch(() => [])
          if (alive) setRevokedInvites(revoked)
          const bs = await managers.groups.listBans(chatId).catch(() => [])
          const banUsers = await managers.peers.getUsers(bs.map((b) => b.userId))
          const banById = new Map(banUsers.map((u) => [u.id, u]))
          if (alive) {
            setBans(bs.map((b) => ({
              userId: b.userId,
              name: getUserTitle(banById.get(b.userId)),
              photoId: getPeerPhotoId(banById.get(b.userId)?.photo) || undefined,
            })))
          }
          const rs = await managers.groups.listRestrictions(chatId).catch(() => [])
          const resUsers = await managers.peers.getUsers(rs.map((r) => r.userId))
          const resById = new Map(resUsers.map((u) => [u.id, u]))
          if (alive) {
            setRestricted(rs.map((r) => ({
              userId: r.userId,
              name: getUserTitle(resById.get(r.userId)),
              photoId: getPeerPhotoId(resById.get(r.userId)?.photo) || undefined,
              deniedRights: r.deniedRights,
              untilDate: r.untilDate,
            })))
          }
        }
      } catch {
        // карточка недоступна (нас удалили и т.п.) — экран просто останется пустым
      }
    })()
    return () => {
      alive = false
    }
  }, [chatId, managers, tick])

  const admins = useMemo(() => members.filter((m) => m.role === 'creator' || m.role === 'admin'), [members])

  const refreshDialogs = () => managers.dialogs.refresh()

  return {
    card, members, admins, invites, revokedInvites, bans, restricted, canBan, canManageAdmins, isCreator, reload,
    saveInfo: async (title, about) => {
      await managers.groups.editInfo(chatId, { title, about, username: card?.chat.username ?? '' })
      reload()
      await refreshDialogs()
    },
    savePhoto: async (blob, width, height) => {
      const bytes = await blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: blob.size, width, height })
      await managers.groups.setPhoto(chatId, mediaId)
      reload()
      await refreshDialogs()
    },
    saveType: async (isPublic, username) => {
      try {
        await managers.groups.setType(chatId, isPublic, username)
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        return msg.includes('taken') || msg.includes('409') ? 'taken' : 'invalid'
      }
      reload()
      return 'ok'
    },
    savePermissions: async (permissions, slowmodeSeconds) => {
      await managers.groups.setPermissions(chatId, permissions, slowmodeSeconds)
      reload()
    },
    saveReactions: async (mode, emojis) => {
      await managers.groups.setReactions(chatId, mode, emojis)
      reload()
    },
    saveHistory: async (visible) => {
      await managers.groups.setHistory(chatId, visible)
      reload()
    },
    saveChargeStars: async (chargeStars) => {
      await managers.groups.setChargeStars(chatId, chargeStars)
      reload()
    },
    saveSignatures: async (signatures, profiles) => {
      await managers.channels.setSignatures(chatId, signatures, profiles)
      reload()
    },
    createInvite: async (opts?: CreateInviteOpts) => {
      await managers.groups.createInvite(chatId, opts)
      reload()
    },
    editInvite: async (token, patch) => {
      await managers.groups.editInvite(chatId, token, patch)
      reload()
    },
    loadImporters: async (token) => {
      const { importers } = await managers.groups.inviteImporters(chatId, token)
      const users = await managers.peers.getUsers(importers.map((i) => i.userId))
      const byId = new Map(users.map((u) => [u.id, u]))
      return importers.map((i) => ({
        userId: i.userId,
        name: getUserTitle(byId.get(i.userId)),
        photoId: getPeerPhotoId(byId.get(i.userId)?.photo) || undefined,
        joinedAt: i.joinedAt,
      }))
    },
    deleteInvite: async (token) => {
      await managers.groups.deleteInvite(chatId, token)
      reload()
    },
    deleteAllRevoked: async () => {
      await managers.groups.deleteAllRevoked(chatId)
      reload()
    },
    enableDiscussion: async () => {
      await managers.channels.enableDiscussion(chatId)
      reload()
      await refreshDialogs()
    },
    linkDiscussion: async (groupId) => {
      await managers.channels.linkDiscussion(chatId, groupId)
      reload()
      await refreshDialogs()
    },
    unlinkDiscussion: async () => {
      await managers.channels.unlinkDiscussion(chatId)
      reload()
      await refreshDialogs()
    },
    loadDiscussionCandidates: () => managers.channels.discussionCandidates(chatId),
    loadDiscussionGroup: async () => {
      // Знаковый ключ обсуждения: `linked_chat_id` конструктора — СЫРОЙ
      // положительный id, переводит его одна функция.
      const peerId = getLinkedChatPeerId(card?.fullChat)
      if (peerId === NULL_PEER_ID) return null
      const c = await managers.groups.card(peerId)
      if (!c) return null
      return { peerId, title: c.chat.title, username: c.chat.username ?? '', memberCount: c.chat.participants_count ?? 0 }
    },
    kick: async (userId) => {
      await managers.groups.removeMember(chatId, userId)
      reload()
    },
    ban: async (userId) => {
      await managers.groups.ban(chatId, userId)
      reload()
    },
    unban: async (userId) => {
      await managers.groups.unban(chatId, userId)
      reload()
    },
    restrict: async (userId, deniedRights, untilSeconds) => {
      await managers.groups.restrictMember(chatId, userId, deniedRights, untilSeconds)
      reload()
    },
    unrestrict: async (userId) => {
      await managers.groups.unrestrictMember(chatId, userId)
      reload()
    },
    addMember: async (userId) => {
      await managers.groups.addMember(chatId, userId)
      reload()
    },
    promote: async (userId, rights) => {
      await managers.groups.promoteAdmin(chatId, userId, rights)
      reload()
    },
    demote: async (userId) => {
      await managers.groups.demoteAdmin(chatId, userId)
      reload()
    },
    deleteOrLeave: async () => {
      if (isCreator) {
        // deleteGroup сам зовёт dialogs.applyRemoved после успеха (groupsManager.ts, Task 4).
        await managers.groups.deleteGroup(chatId)
      } else {
        const me = await managers.auth.me()
        if (me) {
          await managers.groups.removeMember(chatId, me.user.id)
          // Fix (ревью Task 4, Important): removeMember обслуживает и кик
          // ДРУГОГО участника (см. `remove` выше), сам не знает, ушёл ли Я —
          // здесь контекст однозначен (self-leave: userId===me.id), поэтому
          // применяем сразу после успеха, не дожидаясь WS chat_removed (порт
          // tweb appChatsManager.leaveChat/leaveChannel → onChatUpdated).
          await managers.dialogs.applyRemoved(chatId)
        }
      }
      // Рефетч ниже — подстраховка (папки/архив/прочие поля списка, которые
      // applyRemoved не трогает при уже отсутствующем диалоге): /chats больше
      // не вернёт этот чат, reconcileById не пересоздаст то, что не изменилось.
      await refreshDialogs()
    },
  }
}
