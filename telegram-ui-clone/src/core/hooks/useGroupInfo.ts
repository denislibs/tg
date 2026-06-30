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
  if (role === 'creator') return 'Создатель'
  if (role === 'admin') return 'Админ'
  return isChannel ? 'Подписчик' : 'Участник'
}

export interface GroupInfo {
  isRealChat: boolean
  isChannel: boolean
  isGroup: boolean
  realMembers: RealMember[] | null
  canManageAdmins: boolean
  canInvite: boolean
  canManageDiscussion: boolean
  discussionChatId: number
  enablingDiscussion: boolean
  inviteLinks: InviteLink[]
  requireApproval: boolean
  setRequireApproval: React.Dispatch<React.SetStateAction<boolean>>
  creatingInvite: boolean
  copiedToken: string | null
  joinRequests: JoinRequest[]
  editMember: RealMember | null
  setEditMember: React.Dispatch<React.SetStateAction<RealMember | null>>
  approveJoinRequest: (userId: number) => Promise<void>
  declineJoinRequest: (userId: number) => Promise<void>
  saveRights: (userId: number, bitmask: number) => Promise<void>
  removeRights: (userId: number) => Promise<void>
  enableDiscussion: () => Promise<void>
  createInvite: () => Promise<void>
  copyInvite: (token: string) => Promise<void>
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
  const [discussionChatId, setDiscussionChatId] = useState(0)
  const [enablingDiscussion, setEnablingDiscussion] = useState(false)

  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([])
  const [requireApproval, setRequireApproval] = useState(false)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])

  useEffect(() => {
    if (!isRealChat) {
      setRealMembers(null)
      setCanManageAdmins(false)
      setCanInvite(false)
      setInviteLinks([])
      setJoinRequests([])
      setCanManageDiscussion(false)
      setDiscussionChatId(0)
      return
    }
    let alive = true
    // Viewer role drives whether the rights editor / invite section are available.
    void managers.groups.card(numericId).then((c) => {
      if (!alive) return
      const isCreator = c.myRole === 'creator'
      setCanManageAdmins(isCreator || (c.myRights & MANAGE_ADMINS) !== 0)
      setCanManageDiscussion(isChannel && (isCreator || (c.myRights & CHANGE_INFO) !== 0))
      setDiscussionChatId(c.discussionChatId ?? 0)
      const inviteOk = isCreator || (c.myRights & INVITE_USERS) !== 0
      setCanInvite(inviteOk)
      if (inviteOk) {
        void managers.groups.listInvites(numericId).then((links) => {
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
  }, [isRealChat, numericId, managers, isChannel])

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

  async function createInvite() {
    if (creatingInvite) return
    setCreatingInvite(true)
    try {
      const link = await managers.groups.createInvite(numericId, { requiresApproval: requireApproval })
      setInviteLinks((prev) => [{ token: link.token, uses: 0, url: link.url, requiresApproval: link.requiresApproval }, ...prev])
    } finally {
      setCreatingInvite(false)
    }
  }

  async function copyInvite(token: string) {
    const fullUrl = `${location.origin}/join/${token}`
    try {
      await navigator.clipboard.writeText(fullUrl)
    } catch {
      // clipboard may be unavailable (insecure context); still show feedback
    }
    setCopiedToken(token)
    setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 1500)
  }

  return {
    isRealChat,
    isChannel,
    isGroup,
    realMembers,
    canManageAdmins,
    canInvite,
    canManageDiscussion,
    discussionChatId,
    enablingDiscussion,
    inviteLinks,
    requireApproval,
    setRequireApproval,
    creatingInvite,
    copiedToken,
    joinRequests,
    editMember,
    setEditMember,
    approveJoinRequest,
    declineJoinRequest,
    saveRights,
    removeRights,
    enableDiscussion,
    createInvite,
    copyInvite,
  }
}
