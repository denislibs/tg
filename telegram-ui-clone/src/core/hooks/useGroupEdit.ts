// src/core/hooks/useGroupEdit.ts
// ViewModel экранов редактирования группы (tweb sidebarRight editChat и под-табы):
// карточка с настройками, участники/админы, инвайт-ссылки, чёрный список +
// действия. Все мутации перезагружают карточку (и список диалогов, когда меняется
// то, что видно в сайдбаре: название/фото/тип).
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GroupCard } from '../managers/groupsManager'
import type { Peer } from '../managers/peersManager'
import type { User } from '../managers/authManager'
import { loadChats, useChatsStore } from '../../stores/chatsStore'

// Битовая маска «возможностей участников» (зеркало domain.MemberPerms).
export const PERMS = [
  { label: 'Send Messages', bit: 1 },
  { label: 'Send Media', bit: 2 },
  { label: 'Add Users', bit: 4 },
  { label: 'Pin Messages', bit: 8 },
  { label: 'Change Chat Info', bit: 16 },
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
  avatarUrl?: string
  role: string
  rights: number
}

export interface BannedRow {
  userId: number
  name: string
  avatarUrl?: string
}

interface Managers {
  groups: {
    card(chatId: number): Promise<GroupCard>
    members(chatId: number): Promise<{ userId: number; role: string; online: boolean }[]>
    editInfo(chatId: number, args: { title: string; about?: string; username?: string }): Promise<void>
    setType(chatId: number, isPublic: boolean, username: string): Promise<void>
    setPermissions(chatId: number, permissions: number, slowmodeSeconds: number): Promise<void>
    setReactions(chatId: number, mode: 'all' | 'some' | 'none', emojis: string[]): Promise<void>
    setHistory(chatId: number, visible: boolean): Promise<void>
    listInvites(chatId: number): Promise<{ token: string; uses: number; url: string; requiresApproval: boolean }[]>
    createInvite(chatId: number, opts?: { requiresApproval?: boolean }): Promise<{ token: string; url: string; requiresApproval: boolean }>
    revokeInvite(chatId: number, token: string): Promise<void>
    listBans(chatId: number): Promise<{ userId: number; bannedBy: number }[]>
    ban(chatId: number, userId: number): Promise<void>
    unban(chatId: number, userId: number): Promise<void>
    removeMember(chatId: number, userId: number): Promise<void>
    addMember(chatId: number, userId: number): Promise<void>
    promoteAdmin(chatId: number, userId: number, rights: number): Promise<void>
    demoteAdmin(chatId: number, userId: number): Promise<void>
    setPhoto(chatId: number, mediaId: number): Promise<void>
    deleteGroup(chatId: number): Promise<void>
  }
  media: { upload(args: { bytes: ArrayBuffer; mime: string; size: number; width?: number; height?: number }): Promise<number> }
  peers: { getUsers(ids: number[]): Promise<Peer[]> }
  auth: { me(): Promise<User | null> }
  chats: { listDialogs(): Promise<import('../models').Dialog[]> }
}

export interface GroupEdit {
  card: GroupCard | null
  members: EditMember[]
  admins: EditMember[]
  invites: { token: string; url: string; requiresApproval: boolean }[]
  bans: BannedRow[]
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
  createInvite: () => Promise<void>
  revokeInvite: (token: string) => Promise<void>
  kick: (userId: number) => Promise<void>
  ban: (userId: number) => Promise<void>
  unban: (userId: number) => Promise<void>
  addMember: (userId: number) => Promise<void>
  promote: (userId: number, rights: number) => Promise<void>
  demote: (userId: number) => Promise<void>
  deleteOrLeave: () => Promise<void>
}

const MANAGE_ADMINS = 128
const BAN_USERS = 8

export function useGroupEdit(chatId: number, managers: Managers): GroupEdit {
  const [card, setCard] = useState<GroupCard | null>(null)
  const [members, setMembers] = useState<EditMember[]>([])
  const [invites, setInvites] = useState<{ token: string; url: string; requiresApproval: boolean }[]>([])
  const [bans, setBans] = useState<BannedRow[]>([])
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((x) => x + 1), [])

  const isCreator = card?.myRole === 'creator'
  const canBan = isCreator || (card?.myRole === 'admin' && (card.myRights & BAN_USERS) !== 0)
  const canManageAdmins = isCreator || (card?.myRole === 'admin' && (card.myRights & MANAGE_ADMINS) !== 0)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const c = await managers.groups.card(chatId)
        if (!alive) return
        setCard(c)
        const ms = await managers.groups.members(chatId)
        const users = await managers.peers.getUsers(ms.map((m) => m.userId))
        const byId = new Map(users.map((u) => [u.id, u]))
        if (!alive) return
        setMembers(ms.map((m) => ({
          userId: m.userId,
          name: byId.get(m.userId)?.displayName || `User ${m.userId}`,
          username: byId.get(m.userId)?.username || undefined,
          avatarUrl: byId.get(m.userId)?.avatarUrl || undefined,
          role: m.role,
          rights: 0,
        })))
        const canInvite = c.myRole === 'creator' || c.myRole === 'admin'
        if (canInvite) {
          const inv = await managers.groups.listInvites(chatId)
          if (alive) setInvites(inv.map((l) => ({ token: l.token, url: l.url, requiresApproval: l.requiresApproval })))
          const bs = await managers.groups.listBans(chatId).catch(() => [])
          const banUsers = await managers.peers.getUsers(bs.map((b) => b.userId))
          const banById = new Map(banUsers.map((u) => [u.id, u]))
          if (alive) {
            setBans(bs.map((b) => ({
              userId: b.userId,
              name: banById.get(b.userId)?.displayName || `User ${b.userId}`,
              avatarUrl: banById.get(b.userId)?.avatarUrl || undefined,
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

  const refreshDialogs = () => loadChats(managers)

  return {
    card, members, admins, invites, bans, canBan, canManageAdmins, isCreator, reload,
    saveInfo: async (title, about) => {
      await managers.groups.editInfo(chatId, { title, about, username: card?.username ?? '' })
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
    createInvite: async () => {
      await managers.groups.createInvite(chatId)
      reload()
    },
    revokeInvite: async (token) => {
      await managers.groups.revokeInvite(chatId, token)
      reload()
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
      if (isCreator) await managers.groups.deleteGroup(chatId)
      else {
        const me = await managers.auth.me()
        if (me) await managers.groups.removeMember(chatId, me.id)
      }
      // диалог уберёт кадр chat_removed; на всякий случай — рефетч
      useChatsStore.getState().removeDialog(chatId)
      await refreshDialogs()
    },
  }
}
