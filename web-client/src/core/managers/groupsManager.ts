// src/core/managers/groupsManager.ts
import type { RestClient } from '../net/restClient'
import type { DialogsManager } from './dialogsManager'
import type { PeersManager } from './peersManager'
import type { Channel, ChannelFull, MessagesChatFull, UserReal, UserStatus } from '../peers/peer'
import { getPeerId } from '../peers/peerId'
import type { Peer } from '../peers/peerId'
import { deniedMask } from '../peers/rights'
import { MUTE_UNTIL_FOREVER } from '../dialogs/notifySettings'
import { WIRE_FOLDER_ARCHIVE } from '../models'

/** Участник чата: наша роль + статус присутствия (объединение `UserStatus`). */
export interface ChatMember { userId: number; role: string; status?: UserStatus }

/**
 * Карточка чата — ПАРА конструкторов, как у профиля пользователя
 * (`authManager.PeerProfile` = `user` + `userFull`). Прежняя плоская `GroupCard`
 * из 18 полей исчезла вместе с витриной, которая её отдавала: после шага C
 * ручка `GET /chats/{peerID}/card` возвращает `messages.chatFull` — тот же
 * объект, что едет кадром `chat_update`.
 *
 * Чего здесь БОЛЬШЕ НЕТ и где оно теперь:
 *  • `type` — не поле, а ВЫБОР КОНСТРУКТОРА плюс `pFlags.broadcast`/`megagroup`
 *    (`core/peers/predicates.ts`);
 *  • `my_role`/`my_rights` — `chat.pFlags.creator` и НАЛИЧИЕ `chat.admin_rights`
 *    (`core/peers/rights.ts`, решение №3 разбора);
 *  • `is_public` — наличие `chat.username` (`isPublic`);
 *  • `default_permissions` («что можно») — `chat.default_banned_rights`
 *    («что НЕЛЬЗЯ», ⚠ обратный знак);
 *  • `history_for_new` — `fullChat.pFlags.hidden_prehistory` с ИНВЕРСИЕЙ;
 *  • `reactions_mode`/`reactions_allowed` — объединение
 *    `fullChat.available_reactions: ChatReactions`;
 *  • `discussion_peer_id` — `fullChat.linked_chat_id`, причём там СЫРОЙ
 *    положительный id чата (как в схеме), а не знаковый ключ; перевод знака
 *    живёт в одной функции — `getLinkedChatPeerId` (`core/peers/peer.ts`).
 */
export interface ChatCard {
  /** знаковый ключ чата (`-id`) — поле уровня ответа, вне конструкторов */
  peerId: PeerId
  /** краткая форма (`chat_full.chats[0]`): вид чата и права зрителя. Та же
   *  карточка уезжает в зеркало пиров — см. `card()`. */
  chat: Channel
  /** полная форма: экран информации о чате */
  fullChat: ChannelFull
}

/**
 * Разбор ответа карточки. Ответ И ЕСТЬ конструктор `messages.chatFull` —
 * обёртки вокруг него больше нет: раскладываем его на пару (`full_chat` +
 * первый элемент `chats`).
 *
 * `peer_id` из ответа ушёл — он выводим из самой краткой карточки; `creator_id`
 * ушёл как мёртвый: его никто не читал, только хранил. «Создатель ли я» —
 * `pFlags.creator` краткой карточки.
 *
 * `chats[0]` не оказался `channel` — карточки нет: базовый `chat` бэкенд не
 * производит вовсе (решение №2), а `chatEmpty`/`*Forbidden` в этой ручке не
 * бывают (на них она отвечает ошибкой доступа).
 */
/**
 * Участник — КОНСТРУКТОР объединения `ChannelParticipant`: роль выражена
 * выбором, а не строкой в записи. Права висят на том конструкторе, у которого
 * они бывают; у обычного участника их нет вовсе.
 *
 * «Выгнан» и «ограничен, но в чате» — ОДИН конструктор
 * (`channelParticipantBanned`), разницу выражает `pFlags.left`.
 */
export type ChannelParticipantWire =
  | { _: 'channelParticipant'; user_id: number; date: number }
  | { _: 'channelParticipantSelf'; user_id: number; date: number }
  | { _: 'channelParticipantCreator'; user_id: number; admin_rights: unknown }
  | { _: 'channelParticipantAdmin'; user_id: number; date: number; admin_rights: unknown }
  | {
      _: 'channelParticipantBanned'
      pFlags?: { left?: true }
      peer: Peer
      kicked_by: number
      date: number
      banned_rights: { until_date: number; pFlags?: Record<string, true> }
    }
  | { _: 'channelParticipantLeft'; peer: Peer }

/** channels.channelParticipants — контейнер списка. Присутствие живёт на
 *  карточках `users`, а не на строке участника. */
export interface ChannelsChannelParticipants {
  _: 'channels.channelParticipants'
  count: number
  participants: ChannelParticipantWire[]
  chats: unknown[]
  users: UserReal[]
}

/** Роль по конструктору — обратный перевод для экранов, которые ей оперируют. */
export function participantRole(p: ChannelParticipantWire): string {
  switch (p._) {
    case 'channelParticipantCreator': return 'creator'
    case 'channelParticipantAdmin': return 'admin'
    default: return 'member'
  }
}

/** id участника: у забаненного и ушедшего он лежит в ссылке на пир. */
export function participantUserId(p: ChannelParticipantWire): number {
  if (p._ === 'channelParticipantBanned' || p._ === 'channelParticipantLeft') {
    return p.peer._ === 'peerUser' ? p.peer.user_id : 0
  }
  return p.user_id
}

export function mapChatCard(r: MessagesChatFull): ChatCard | null {
  const chat = r?.chats?.[0]
  if (!chat || chat._ !== 'channel') return null
  return { peerId: getPeerId({ _: 'peerChannel', channel_id: chat.id }), chat, fullChat: r.full_chat }
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

/**
 * `chatInviteExported` — конструктор ссылки. Адрес ОДИН (`link`): токен из него
 * выводится, а не едет рядом вторым именем того же значения. Признаки живут в
 * `pFlags`, где «выключено» это отсутствие ключа; сроки — в секундах эпохи.
 */
export interface ChatInviteExported {
  _: 'chatInviteExported'
  pFlags?: { revoked?: true; request_needed?: true }
  link: string
  admin_id: number
  date: number
  expire_date?: number
  usage_limit?: number
  usage?: number
  title?: string
}

/** Контейнеры ответа: одна ссылка и список. */
export interface MessagesExportedChatInvite { _: 'messages.exportedChatInvite'; invite: ChatInviteExported }
export interface MessagesExportedChatInvites { _: 'messages.exportedChatInvites'; count: number; invites: ChatInviteExported[] }

/** `chatInviteImporter` — вошедший ИЛИ ждущий одобрения: разницу выражает
 *  `pFlags.requested`, а не два разных списка. */
export interface ChatInviteImporter {
  _: 'chatInviteImporter'
  pFlags?: { requested?: true }
  user_id: number
  date: number
  approved_by?: number
}

export interface MessagesChatInviteImporters {
  _: 'messages.chatInviteImporters'
  count: number
  importers: ChatInviteImporter[]
}

const mapInvite = (l: ChatInviteExported): InviteLink => ({
  // Токен — хвост адреса, а не отдельное поле провода.
  token: l.link.slice(l.link.lastIndexOf('/') + 1),
  url: l.link,
  uses: l.usage ?? 0,
  requiresApproval: !!l.pFlags?.request_needed,
  expiresAt: l.expire_date ? new Date(l.expire_date * 1000).toISOString() : undefined,
  title: l.title ?? '',
  usageLimit: l.usage_limit ?? null,
  revoked: !!l.pFlags?.revoked,
})

// Тема форум-группы (строка списка: тема + последнее сообщение треда).
export interface TopicRow {
  id: number
  peerId: number
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
  id: number; peer_id: number; root_msg_id: number; title: string; icon_color: number
  icon_emoji?: string | null; closed: boolean; hidden?: boolean; pinned?: boolean; pos?: number
  is_general?: boolean; created_by: number; msg_count: number
  last_text?: string | null; last_type?: string | null; last_sender_name?: string | null; last_at?: string | null
  unread?: number; unread_mentions?: number; muted?: boolean; last_out?: boolean; last_seq?: number
}

const mapTopic = (r: RawTopic): TopicRow => ({
  id: r.id, peerId: r.peer_id, rootMsgId: r.root_msg_id, title: r.title, iconColor: r.icon_color,
  iconEmoji: r.icon_emoji ?? '', closed: r.closed, hidden: r.hidden ?? false, pinned: r.pinned ?? false,
  pos: r.pos ?? 0, isGeneral: r.is_general ?? false,
  createdBy: r.created_by, msgCount: r.msg_count ?? 0,
  lastText: r.last_text ?? '', lastType: r.last_type ?? '', lastSenderName: r.last_sender_name ?? '',
  lastAt: r.last_at ?? undefined,
  unread: r.unread ?? 0, unreadMentions: r.unread_mentions ?? 0, muted: r.muted ?? false,
  lastOut: r.last_out ?? false, lastMsgSeq: r.last_seq ?? 0,
})

export function newGroupsManager({ rest, dialogs, peers }: {
  rest: Pick<RestClient, 'post' | 'get' | 'put' | 'patch' | 'del'>
  // Task 4 (действия без оптимистики): владелец списка диалогов — сеть-сначала,
  // локальный апдейт стоит там же, где сетевой вызов (порт tweb toggleDialogPin:
  // invokeApi(...).then(saveUpdate)).
  dialogs: Pick<DialogsManager, 'applyNotifySettings' | 'applyPinned' | 'applyFolder' | 'applyRemoved'>
  // Владелец карточек пиров: ответ карточки чата несёт векторы `chats`/`users`,
  // и они обязаны доехать до зеркала — порт `appProfileManager.getChannelFull`
  // → `saveFullPeerResult` → `appPeersManager.saveApiPeers(result)`
  // (`appProfileManager.ts:224-227`). Без этого вызова конструктор `channel` не
  // попадает в зеркало главного потока вовсе, и предикаты вида чата вместе с
  // правами отвечают «нет» на всё.
  peers: Pick<PeersManager, 'saveApiPeers'>
}) {
  return {
    /**
     * Создать группу. Ответ — СОЗДАННЫЙ объект (`messages.chatFull`), а не его
     * адрес в безымянной обёртке: у оригинала `messages.createChat` отвечает
     * пачкой с новым чатом внутри.
     *
     * Карточка сразу уезжает в зеркало пиров — иначе экран, открытый по
     * возвращённому ключу, ждал бы отдельного запроса за тем, что уже пришло.
     */
    async createGroup(args: { title: string; about?: string; username?: string; isPublic?: boolean; memberIds?: number[] }): Promise<number> {
      const r = await rest.post<MessagesChatFull>('/groups', {
        title: args.title, about: args.about ?? '', username: args.username ?? '', is_public: args.isPublic ?? false,
        member_ids: args.memberIds ?? [],
      })
      peers.saveApiPeers(r)
      return mapChatCard(r)?.peerId ?? 0
    },
    async addMember(peerId: number, userId: number): Promise<void> {
      await rest.post(`/chats/${peerId}/members`, { user_id: userId })
    },
    async setPhoto(peerId: number, mediaId: number): Promise<void> {
      await rest.put(`/chats/${peerId}/photo`, { media_id: mediaId })
    },
    // until — unix-секунды окончания временного mute (tweb «For 1 Hour…»);
    // muted=true без until — навсегда.
    async setMute(peerId: number, muted: boolean, until?: number): Promise<void> {
      await rest.post(`/chats/${peerId}/mute`, { muted, until: until ?? null })
      // Оптимистики нет (Task 4, порт tweb toggleDialogPin): применяем ПОСЛЕ
      // ответа сети. Кросс-таб/другие устройства получат то же самое кадром
      // dialog_mute (workerCore.ts::dispatch → dialogs.applyNotifySettings).
      //
      // Собираем ТОТ ЖЕ конструктор, что построит бэкенд (usecase/chat/group.go
      // ::SetMute): «навсегда» — не отдельный флаг, а далёкий срок; «снять» —
      // отсутствие переопределения. Второго способа сказать то же самое (пары
      // `muted` + `until`) больше нет ни на одной стороне.
      dialogs.applyNotifySettings(peerId, {
        _: 'peerNotifySettings',
        ...(muted ? { mute_until: until ?? MUTE_UNTIL_FOREVER } : {}),
      })
    },
    // ── Форум-топики ──
    async setForum(peerId: number, enabled: boolean): Promise<void> {
      await rest.post(`/chats/${peerId}/forum`, { enabled })
    },
    async createTopic(peerId: number, title: string, iconColor: number, iconEmoji = ''): Promise<{ id: number; rootMsgId: number }> {
      const r = await rest.post<{ id: number; root_msg_id: number }>(`/chats/${peerId}/topics`, { title, icon_color: iconColor, icon_emoji: iconEmoji })
      return { id: r.id, rootMsgId: r.root_msg_id }
    },
    async listTopics(peerId: number): Promise<TopicRow[]> {
      const r = await rest.get<{ topics: RawTopic[] }>(`/chats/${peerId}/topics`)
      return (r.topics ?? []).map(mapTopic)
    },
    async closeTopic(peerId: number, topicId: number, closed: boolean): Promise<void> {
      await rest.post(`/chats/${peerId}/topics/${topicId}/close`, { closed })
    },
    async editTopic(peerId: number, topicId: number, title: string, iconColor: number, iconEmoji = ''): Promise<void> {
      await rest.patch(`/chats/${peerId}/topics/${topicId}`, { title, icon_color: iconColor, icon_emoji: iconEmoji })
    },
    async setTopicHidden(peerId: number, topicId: number, hidden: boolean): Promise<void> {
      await rest.post(`/chats/${peerId}/topics/${topicId}/hide`, { hidden })
    },
    async setTopicPinned(peerId: number, topicId: number, pinned: boolean): Promise<void> {
      await rest.post(`/chats/${peerId}/topics/${topicId}/pin`, { pinned })
    },
    // Пометить тему прочитанной до upToSeq (Telegram readDiscussion с threadId).
    // Адресуется по rootMsgId (пара chat+root — ключ состояния темы на бэке).
    async readTopic(peerId: number, rootMsgId: number, upToSeq: number): Promise<void> {
      await rest.post(`/chats/${peerId}/topics/${rootMsgId}/read`, { up_to_seq: upToSeq })
    },
    // Вкл/выкл уведомления темы для пользователя (адресуется по rootMsgId).
    async setTopicMuted(peerId: number, rootMsgId: number, muted: boolean): Promise<void> {
      await rest.post(`/chats/${peerId}/topics/${rootMsgId}/mute`, { muted })
    },

    // Закрепить/открепить диалог вверху списка (лимит 5 — бэк вернёт 400: при
    // ошибке apply не зовётся вовсе, дальше диалог как был).
    async setPin(peerId: number, pinned: boolean): Promise<void> {
      await rest.post(`/chats/${peerId}/pin`, { pinned })
      dialogs.applyPinned(peerId, pinned)
    },
    // Убрать диалог в архив / вернуть из архива.
    async setArchive(peerId: number, archived: boolean): Promise<void> {
      await rest.post(`/chats/${peerId}/archive`, { archived })
      dialogs.applyFolder(peerId, archived ? WIRE_FOLDER_ARCHIVE : 0)
    },
    /**
     * Карточка чата. Порт `appProfileManager.getChannelFull` →
     * `saveFullPeerResult` (`:224-227`): пиры ответа сохраняются ПЕРВЫМИ и лишь
     * потом отдаётся полная форма. Именно этот вызов и делает живыми предикаты
     * вида чата и права по ключу пира на главном потоке.
     */
    async card(peerId: PeerId): Promise<ChatCard | null> {
      const r = await rest.get<MessagesChatFull>(`/chats/${peerId}/card`)
      peers.saveApiPeers(r)
      return mapChatCard(r)
    },
    async editInfo(peerId: number, args: { title: string; about?: string; username?: string }): Promise<void> {
      await rest.patch(`/chats/${peerId}`, { title: args.title, about: args.about ?? '', username: args.username ?? '' })
    },
    async setType(peerId: number, isPublic: boolean, username: string): Promise<void> {
      await rest.put(`/chats/${peerId}/type`, { is_public: isPublic, username })
    },
    async setPermissions(peerId: number, permissions: number, slowmodeSeconds: number): Promise<void> {
      await rest.put(`/chats/${peerId}/permissions`, { permissions, slowmode_seconds: slowmodeSeconds })
    },
    async setReactions(peerId: number, mode: 'all' | 'some' | 'none', emojis: string[]): Promise<void> {
      await rest.put(`/chats/${peerId}/reactions`, { mode, emojis })
    },
    async setHistory(peerId: number, visible: boolean): Promise<void> {
      await rest.put(`/chats/${peerId}/history`, { visible })
    },
    // Плата за сообщение в звёздах (Telegram paid messages); 0 — выключить.
    async setChargeStars(peerId: number, chargeStars: number): Promise<void> {
      await rest.put(`/chats/${peerId}/charge_stars`, { charge_stars: chargeStars })
    },
    async listBans(peerId: number): Promise<{ userId: number; bannedBy: number }[]> {
      const r = await rest.get<ChannelsChannelParticipants>(`/chats/${peerId}/bans`)
      return (r.participants ?? []).map((p) => ({
        userId: participantUserId(p),
        bannedBy: p._ === 'channelParticipantBanned' ? p.kicked_by : 0,
      }))
    },
    async ban(peerId: number, userId: number): Promise<void> {
      await rest.post(`/chats/${peerId}/bans`, { user_id: userId })
    },
    async unban(peerId: number, userId: number): Promise<void> {
      await rest.del(`/chats/${peerId}/bans/${userId}`)
    },
    // Гранулярные ограничения участника (Telegram editBanned / ChatBannedRights):
    // deniedRights — битовая маска запрещённых прав (PERMS), untilSeconds — срок
    // (0/undefined — бессрочно).
    async listRestrictions(peerId: number): Promise<{ userId: number; deniedRights: number; untilDate?: string; restrictedBy: number }[]> {
      const r = await rest.get<ChannelsChannelParticipants>(`/chats/${peerId}/restrictions`)
      // Ограниченный — ТОТ ЖЕ конструктор, что и выгнанный, только без флага
      // `left`. Чем именно ограничен — маска запретов внутри `banned_rights`;
      // `until_date` в СЕКУНДАХ эпохи, 0 значит «бессрочно».
      return (r.participants ?? []).flatMap((p) => {
        if (p._ !== 'channelParticipantBanned') return []
        return [{
          userId: participantUserId(p),
          deniedRights: deniedMask(p.banned_rights.pFlags),
          untilDate: p.banned_rights.until_date ? new Date(p.banned_rights.until_date * 1000).toISOString() : undefined,
          restrictedBy: p.kicked_by,
        }]
      })
    },
    async restrictMember(peerId: number, userId: number, deniedRights: number, untilSeconds?: number): Promise<void> {
      await rest.post(`/chats/${peerId}/restrictions`, { user_id: userId, denied_rights: deniedRights, until_seconds: untilSeconds ?? 0 })
    },
    async unrestrictMember(peerId: number, userId: number): Promise<void> {
      await rest.del(`/chats/${peerId}/restrictions/${userId}`)
    },
    async removeMember(peerId: number, userId: number): Promise<void> {
      await rest.del(`/chats/${peerId}/members/${userId}`)
    },
    // Hard-delete ссылки (Telegram deleteExportedChatInvite). Отзыв — через
    // editInvite({revoked:true}) (PATCH), а не этот метод.
    async deleteInvite(peerId: number, token: string): Promise<void> {
      await rest.del(`/chats/${peerId}/invite_links/${token}`)
    },
    // Удалить все отозванные ссылки чата (Telegram deleteRevokedExportedChatInvites).
    async deleteAllRevoked(peerId: number): Promise<void> {
      await rest.del(`/chats/${peerId}/revoked_invite_links`)
    },
    // Удаляет чат целиком (для всех участников) — в отличие от removeMember,
    // которым выходит один конкретный участник (в т.ч. может быть кем угодно —
    // «удаляемый я» не всегда), здесь однозначно: мой собственный диалог тоже
    // пропадает, поэтому applyRemoved зовём сразу после успеха, не дожидаясь
    // WS chat_removed (Task 4, тот же приём, что и mute/pin/archive выше).
    async deleteGroup(peerId: number): Promise<void> {
      await rest.del(`/chats/${peerId}`)
      dialogs.applyRemoved(peerId)
    },
    // Участники чата: id + роль + СТАТУС (объединение `UserStatus`, а не
    // булев `online` без срока годности — см. PresenceEvt).
    async members(peerId: PeerId): Promise<ChatMember[]> {
      const r = await rest.get<ChannelsChannelParticipants>(`/chats/${peerId}/members`)
      // Присутствие берётся с КАРТОЧКИ пользователя (`user.status`), а не со
      // строки участника: у оригинала оно живёт там, и второго дома у него нет.
      const byId = new Map((r.users ?? []).map((u) => [u.id, u]))
      return (r.participants ?? []).map((p) => {
        const id = participantUserId(p)
        return { userId: id, role: participantRole(p), status: byId.get(id)?.status }
      })
    },
    async promoteAdmin(peerId: number, userId: number, rights: number): Promise<void> {
      await rest.post(`/chats/${peerId}/admins`, { user_id: userId, rights })
    },
    async demoteAdmin(peerId: number, userId: number): Promise<void> {
      await rest.del(`/chats/${peerId}/admins/${userId}`)
    },
    async createInvite(peerId: number, opts?: { title?: string; usageLimit?: number; requiresApproval?: boolean; expireSeconds?: number }): Promise<InviteLink> {
      const r = await rest.post<MessagesExportedChatInvite>(`/chats/${peerId}/invite_links`, { title: opts?.title, usage_limit: opts?.usageLimit ?? null, requires_approval: opts?.requiresApproval ?? false, expire_seconds: opts?.expireSeconds ?? 0 })
      return mapInvite(r.invite)
    },
    // revoked=true — список отозванных ссылок (Telegram getExportedChatInvites
    // revoked flag); по умолчанию — активные.
    async listInvites(peerId: number, revoked = false): Promise<InviteLink[]> {
      const r = await rest.get<MessagesExportedChatInvites>(`/chats/${peerId}/invite_links${revoked ? '?revoked=true' : ''}`)
      return (r.invites ?? []).map(mapInvite)
    },
    // Частичный PATCH ссылки (Telegram editExportedChatInvite): revoked:true — отзыв,
    // usageLimit:null — снять лимит, expireSeconds:0 — сделать бессрочной.
    async editInvite(peerId: number, token: string, patch: { title?: string; usageLimit?: number | null; requiresApproval?: boolean; expireSeconds?: number; revoked?: boolean }): Promise<InviteLink> {
      const body: Record<string, unknown> = {}
      if (patch.title !== undefined) body.title = patch.title
      if (patch.usageLimit !== undefined) body.usage_limit = patch.usageLimit
      if (patch.requiresApproval !== undefined) body.requires_approval = patch.requiresApproval
      if (patch.expireSeconds !== undefined) body.expire_seconds = patch.expireSeconds
      if (patch.revoked !== undefined) body.revoked = patch.revoked
      const r = await rest.patch<MessagesExportedChatInvite>(`/chats/${peerId}/invite_links/${token}`, body)
      return mapInvite(r.invite)
    },
    // Список вступивших по ссылке (Telegram chatInviteImporters).
    async inviteImporters(peerId: number, token: string): Promise<{ importers: { userId: number; joinedAt: string }[]; count: number }> {
      const r = await rest.get<MessagesChatInviteImporters>(`/chats/${peerId}/invite_links/${token}/importers`)
      return {
        importers: (r.importers ?? []).map((i) => ({ userId: i.user_id, joinedAt: new Date(i.date * 1000).toISOString() })),
        count: r.count ?? 0,
      }
    },
    /**
     * Войти по ссылке. Ответ — конструктор `chatInviteImporter`: «вошёл» и
     * «заявка отправлена» это ОДИН предмет с флагом `requested`, а не строка
     * состояния. Тот же конструктор приезжает и в списке заявок.
     */
    async joinByToken(token: string): Promise<{ status: 'requested' | 'joined' }> {
      const r = await rest.post<ChatInviteImporter>(`/join/${token}`, {})
      return { status: r.pFlags?.requested ? 'requested' : 'joined' }
    },
    async listJoinRequests(peerId: number): Promise<number[]> {
      const r = await rest.get<MessagesChatInviteImporters>(`/chats/${peerId}/join_requests`)
      return (r.importers ?? []).map((x) => x.user_id)
    },
    async approveRequest(peerId: number, userId: number): Promise<void> { await rest.post(`/chats/${peerId}/join_requests/${userId}/approve`, {}) },
    async declineRequest(peerId: number, userId: number): Promise<void> { await rest.post(`/chats/${peerId}/join_requests/${userId}/decline`, {}) },
  }
}
export type GroupsManager = ReturnType<typeof newGroupsManager>
