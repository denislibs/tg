// src/core/hooks/useGroupInfo.ts
//
// ViewModel for UserInfoPanel's group/channel sections: loads the server-backed
// card/members/invites/join-requests via managers and exposes the derived flags
// (isRealChat/isChannel/isGroup), data and admin actions. The View stays render-only.
import { useEffect, useState } from 'react'
import type { Chat } from '../../data'
import { useManagers } from './useManagers'

// Admin-rights bits, mirroring tweb's userPermissions.tsx (one toggle per right).
export const RIGHTS: { label: string; bit: number }[] = [
  { label: 'Публикация', bit: 1 },
  { label: 'Редактирование', bit: 2 },
  { label: 'Удаление', bit: 4 },
  { label: 'Бан', bit: 8 },
  { label: 'Приглашения', bit: 16 },
  { label: 'Закрепление', bit: 32 },
  { label: 'Изменение инфо', bit: 64 },
  { label: 'Назначение админов', bit: 128 },
]
const MANAGE_ADMINS = 128
const INVITE_USERS = 16
const CHANGE_INFO = 64

export interface RealMember {
  userId: number
  role: string
  online: boolean
  displayName: string
  username?: string
  avatarUrl?: string
}

interface InviteLink {
  token: string
  uses: number
  url: string
  requiresApproval: boolean
}

interface JoinRequest {
  userId: number
  displayName: string
}

export function roleLabel(role: string, isChannel: boolean): string {
  if (role === 'creator') return 'владелец'
  if (role === 'admin') return 'админ'
  return isChannel ? 'подписчик' : ''
}

export interface GroupInfo {
  isRealChat: boolean
  isChannel: boolean
  isGroup: boolean
  realMembers: RealMember[] | null
  canManageAdmins: boolean
  canInvite: boolean
  canManageDiscussion: boolean
  // управление темами (форум) — создатель/CHANGE_INFO группы
  canManageTopics: boolean
  // доступ к статистике (tweb chatFull.can_view_stats) — создатель/админ канала
  // или супергруппы
  canViewStats: boolean
  discussionChatId: number
  enablingDiscussion: boolean
  inviteLinks: InviteLink[]
  joinRequests: JoinRequest[]
  editMember: RealMember | null
  setEditMember: React.Dispatch<React.SetStateAction<RealMember | null>>
  approveJoinRequest: (userId: number) => Promise<void>
  declineJoinRequest: (userId: number) => Promise<void>
  saveRights: (userId: number, bitmask: number) => Promise<void>
  removeRights: (userId: number) => Promise<void>
  enableDiscussion: () => Promise<void>
  refreshMembers: () => Promise<void>
}

export function useGroupInfo(chat: Chat): GroupInfo {
  const managers = useManagers()

  const isChannel = chat.type === 'channel'
  const isGroup = chat.type === 'group'

  // Real (server-backed) group/channel: chat.id is a numeric string.
  const numericId = Number(chat.id)
  const isRealChat = (isGroup || isChannel) && Number.isFinite(numericId) && String(numericId) === chat.id

  const [realMembers, setRealMembers] = useState<RealMember[] | null>(null)
  const [canManageAdmins, setCanManageAdmins] = useState(false)
  const [canInvite, setCanInvite] = useState(false)
  const [editMember, setEditMember] = useState<RealMember | null>(null)
  // Channel discussions: admin gate (creator or CHANGE_INFO) + enabled state.
  const [canManageDiscussion, setCanManageDiscussion] = useState(false)
  const [canManageTopics, setCanManageTopics] = useState(false)
  const [canViewStats, setCanViewStats] = useState(false)
  const [discussionChatId, setDiscussionChatId] = useState(0)
  const [enablingDiscussion, setEnablingDiscussion] = useState(false)

  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([])
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])

  useEffect(() => {
    if (!isRealChat) {
      setRealMembers(null)
      setCanManageAdmins(false)
      setCanInvite(false)
      setInviteLinks([])
      setJoinRequests([])
      setCanManageDiscussion(false)
      setCanManageTopics(false)
      setCanViewStats(false)
      setDiscussionChatId(0)
      return
    }
    let alive = true
    // Viewer role drives whether the rights editor / invite section are available.
    void managers.groups.card(numericId).then((c) => {
      if (!alive) return
      const isCreator = c.myRole === 'creator'
      // Статистику видят создатель и админы (супер)группы/канала (can_view_stats).
      setCanViewStats((isChannel || isGroup) && (isCreator || c.myRole === 'admin'))
      setCanManageAdmins(isCreator || (c.myRights & MANAGE_ADMINS) !== 0)
      setCanManageDiscussion(isChannel && (isCreator || (c.myRights & CHANGE_INFO) !== 0))
      setCanManageTopics(isGroup && (isCreator || (c.myRights & CHANGE_INFO) !== 0))
      setDiscussionChatId(c.discussionChatId ?? 0)
      const inviteOk = isCreator || (c.myRights & INVITE_USERS) !== 0
      setCanInvite(inviteOk)
      if (inviteOk) {
        void managers.groups.listInvites(numericId).then(async (links) => {
          // primary-ссылка существует всегда (tweb chatFull.exported_invite):
          // у старых групп без ссылок создаём её лениво
          if (links.length === 0) {
            const l = await managers.groups.createInvite(numericId).catch(() => null)
            if (l) links = [{ token: l.token, uses: 0, url: l.url, requiresApproval: l.requiresApproval }]
          }
          if (alive) setInviteLinks(links)
        })
        void managers.groups.listJoinRequests(numericId).then(async (ids) => {
          if (!ids.length) {
            if (alive) setJoinRequests([])
            return
          }
          const peers = await managers.peers.getUsers(ids)
          const byId = new Map(peers.map((p) => [p.id, p]))
          if (!alive) return
          setJoinRequests(
            ids.map((id) => ({
              userId: id,
              displayName: byId.get(id)?.displayName || byId.get(id)?.username || `#${id}`,
            })),
          )
        })
      }
    })
    void managers.groups.members(numericId).then(async (mem) => {
      const peers = await managers.peers.getUsers(mem.map((m) => m.userId))
      const byId = new Map(peers.map((p) => [p.id, p]))
      if (!alive) return
      setRealMembers(
        mem.map((m) => ({
          userId: m.userId,
          role: m.role,
          online: m.online,
          displayName: byId.get(m.userId)?.displayName || byId.get(m.userId)?.username || `#${m.userId}`,
          username: byId.get(m.userId)?.username,
          avatarUrl: byId.get(m.userId)?.avatarUrl,
        })),
      )
    })
    return () => {
      alive = false
    }
  }, [isRealChat, numericId, managers, isChannel, isGroup])

  // Refresh the members section/count (used after approving a join request).
  async function refreshMembers() {
    const mem = await managers.groups.members(numericId)
    const peers = await managers.peers.getUsers(mem.map((m) => m.userId))
    const byId = new Map(peers.map((p) => [p.id, p]))
    setRealMembers(
      mem.map((m) => ({
        userId: m.userId,
        role: m.role,
        online: m.online,
        displayName: byId.get(m.userId)?.displayName || byId.get(m.userId)?.username || `#${m.userId}`,
      })),
    )
  }

  async function approveJoinRequest(userId: number) {
    await managers.groups.approveRequest(numericId, userId)
    setJoinRequests((prev) => prev.filter((r) => r.userId !== userId))
    void refreshMembers()
  }

  async function declineJoinRequest(userId: number) {
    await managers.groups.declineRequest(numericId, userId)
    setJoinRequests((prev) => prev.filter((r) => r.userId !== userId))
  }

  async function saveRights(userId: number, bitmask: number) {
    await managers.groups.promoteAdmin(numericId, userId, bitmask)
    setRealMembers((prev) =>
      prev ? prev.map((m) => (m.userId === userId ? { ...m, role: bitmask ? 'admin' : 'member' } : m)) : prev,
    )
    setEditMember(null)
  }

  async function removeRights(userId: number) {
    await managers.groups.demoteAdmin(numericId, userId)
    setRealMembers((prev) =>
      prev ? prev.map((m) => (m.userId === userId ? { ...m, role: 'member' } : m)) : prev,
    )
    setEditMember(null)
  }

  async function enableDiscussion() {
    if (enablingDiscussion) return
    setEnablingDiscussion(true)
    try {
      const id = await managers.channels.enableDiscussion(numericId)
      setDiscussionChatId(id)
    } finally {
      setEnablingDiscussion(false)
    }
  }

  return {
    isRealChat,
    isChannel,
    isGroup,
    realMembers,
    canManageAdmins,
    canInvite,
    canManageDiscussion,
    canManageTopics,
    canViewStats,
    discussionChatId,
    enablingDiscussion,
    inviteLinks,
    joinRequests,
    editMember,
    setEditMember,
    approveJoinRequest,
    declineJoinRequest,
    saveRights,
    removeRights,
    enableDiscussion,
    refreshMembers,
  }
}
