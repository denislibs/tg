// src/core/hooks/useGroupInfo.ts
//
// ViewModel for UserInfoPanel's group/channel sections: loads the server-backed
// card/invites/join-requests via managers and exposes the derived flags
// (isRealChat/isChannel/isGroup), data and admin actions. The View stays render-only.
//
// Список участников хук НЕ грузит (задача 13 плана shared media, пункт 6): его
// владелец — класс `AppSearchSuper` (`loadMembers` → `groups.channelParticipants`),
// а живые изменения состава он же перечитывает по `rt:chat_update`
// (расхождение 32 в шапке класса). Плоский `groups.members` остаётся экранам
// редактирования группы (`useGroupEdit`, `AddMembersScreen`). Пин —
// `useGroupInfo.test.tsx`.
import { useEffect, useState } from 'react'
import type { Chat } from '../../data'
import { useManagers } from './useManagers'
import type { UserStatus } from '../peers/peer'
import { getLinkedChatPeerId } from '../peers/peer'
import { getUserTitle } from '../peers/getPeerTitle'
import { hasRights } from '../peers/rights'
import { NULL_PEER_ID } from '../peers/peerId'

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

/** Участник для экрана прав (`userInfo/RightsEditor.tsx`); собирается панелью
 *  из `Participant` класса и зеркала карточек (`UserInfoPanel.tsx`,
 *  `openUserPermissions`). */
export interface RealMember {
  userId: number
  role: string
  /** Присутствие — КОНСТРУКТОР `UserStatus` целиком, а не булев `online`:
   *  «онлайн» это `userStatusOnline` с ещё не истёкшим `expires`
   *  (`isUserStatusOnline`), а «был(а) недавно» — отдельный вариант, который
   *  парой «булево + время» было не выразить. Ключа нет — статус скрыт
   *  правилом приватности. */
  status?: UserStatus
  /** имя собирает клиент (`getUserTitle`) — `display_name` с провода убран */
  title: string
  username?: string
  /** id медиа аватарки (`user.photo.photo_id`); 0/undefined — фото нет */
  photoId?: number
}

interface InviteLink {
  token: string
  uses: number
  url: string
  requiresApproval: boolean
}

interface JoinRequest {
  userId: number
  title: string
}

export interface GroupInfo {
  isRealChat: boolean
  isChannel: boolean
  isGroup: boolean
  canManageAdmins: boolean
  canInvite: boolean
  canManageDiscussion: boolean
  // доступ к статистике (tweb chatFull.can_view_stats) — создатель/админ канала
  // или супергруппы
  canViewStats: boolean
  /** ЗНАКОВЫЙ ключ группы обсуждения; `0` — обсуждения нет (не «> 0»!). */
  discussionPeerId: PeerId
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
}

export function useGroupInfo(chat: Chat): GroupInfo {
  const managers = useManagers()

  const isChannel = chat.type === 'channel'
  const isGroup = chat.type === 'group'

  // Real (server-backed) group/channel: chat.id is a numeric string.
  const numericId = Number(chat.id)
  const isRealChat = (isGroup || isChannel) && Number.isFinite(numericId) && String(numericId) === chat.id

  const [canManageAdmins, setCanManageAdmins] = useState(false)
  const [canInvite, setCanInvite] = useState(false)
  const [editMember, setEditMember] = useState<RealMember | null>(null)
  // Channel discussions: admin gate (creator or CHANGE_INFO) + enabled state.
  const [canManageDiscussion, setCanManageDiscussion] = useState(false)
  const [canViewStats, setCanViewStats] = useState(false)
  const [discussionPeerId, setDiscussionPeerId] = useState<PeerId>(NULL_PEER_ID)
  const [enablingDiscussion, setEnablingDiscussion] = useState(false)

  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([])
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])

  useEffect(() => {
    if (!isRealChat) {
      setCanManageAdmins(false)
      setCanInvite(false)
      setInviteLinks([])
      setJoinRequests([])
      setCanManageDiscussion(false)
      setCanViewStats(false)
      setDiscussionPeerId(NULL_PEER_ID)
      return
    }
    let alive = true
    // Права зрителя — у КОНСТРУКТОРА `channel` (`pFlags.creator` + наличие
    // `admin_rights`), а не у поля `my_role`/битмаска `my_rights`, которых на
    // проводе больше нет. Ветвление внутри `hasRights` — порт tweb.
    void managers.groups.card(numericId).then((c) => {
      if (!alive || !c) return
      // Статистику видят создатель и админы (супер)группы/канала (can_view_stats):
      // `just_admin` — то же «я админ», что и в оригинале (создателю `hasRights`
      // отвечает «да» на любое действие).
      setCanViewStats((isChannel || isGroup) && hasRights(c.chat, 'just_admin'))
      setCanManageAdmins(hasRights(c.chat, 'add_admins'))
      setCanManageDiscussion(isChannel && hasRights(c.chat, 'change_info'))
      setDiscussionPeerId(getLinkedChatPeerId(c.fullChat))
      // tweb `invite_links`: раздел ссылок доступен админу с `invite_users`
      // (создателю — всегда). Это НЕ то же, что «участнику можно звать людей»
      // (`invite_users` у обычного участника читается из ЗАПРЕТОВ).
      const inviteOk = hasRights(c.chat, 'invite_links')
      setCanInvite(inviteOk)
      if (inviteOk) {
        void managers.groups.listInvites(numericId).then(async (links) => {
          // primary-ссылка существует всегда (tweb chatFull.exported_invite):
          // у старых групп без ссылок создаём её лениво
          if (links.length === 0) {
            const l = await managers.groups.createInvite(numericId).catch(() => null)
            if (l) links = [l]
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
            ids.map((id) => ({ userId: id, title: getUserTitle(byId.get(id)) })),
          )
        })
      }
    })
    return () => {
      alive = false
    }
  }, [isRealChat, numericId, managers, isChannel, isGroup])

  async function approveJoinRequest(userId: number) {
    await managers.groups.approveRequest(numericId, userId)
    setJoinRequests((prev) => prev.filter((r) => r.userId !== userId))
  }

  async function declineJoinRequest(userId: number) {
    await managers.groups.declineRequest(numericId, userId)
    setJoinRequests((prev) => prev.filter((r) => r.userId !== userId))
  }

  async function saveRights(userId: number, bitmask: number) {
    await managers.groups.promoteAdmin(numericId, userId, bitmask)
    setEditMember(null)
  }

  async function removeRights(userId: number) {
    await managers.groups.demoteAdmin(numericId, userId)
    setEditMember(null)
  }

  async function enableDiscussion() {
    if (enablingDiscussion) return
    setEnablingDiscussion(true)
    try {
      const id = await managers.channels.enableDiscussion(numericId)
      setDiscussionPeerId(id)
    } finally {
      setEnablingDiscussion(false)
    }
  }

  return {
    isRealChat,
    isChannel,
    isGroup,
    canManageAdmins,
    canInvite,
    canManageDiscussion,
    canViewStats,
    discussionPeerId,
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
  }
}
