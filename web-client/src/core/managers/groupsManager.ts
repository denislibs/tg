// src/core/managers/groupsManager.ts
import type { RestClient } from '../net/restClient'
import type { DialogsManager } from './dialogsManager'
import type { PeersManager } from './peersManager'
import type { Channel, ChannelFull, ChatAdminRights, ChatBannedRights, MessagesChatFull, UserReal, UserStatus } from '../peers/peer'
import { getPeerId } from '../peers/peerId'
import type { Peer } from '../peers/peerId'
import { adminRightsMask, allowedFromBannedRights, deniedMask } from '../peers/rights'
import { BANNED_RIGHTS_UNTIL_FOREVER } from './constants'
import { MUTE_UNTIL_FOREVER } from '../dialogs/notifySettings'
import type { MissingInvitee } from '@layer'
import { WIRE_FOLDER_ARCHIVE, type MyMessage, type RawMyMessage } from '../models'
import { generateMessageId } from '../history/messageId'
import type { MessagesManager } from './messagesManager'
import type { Chat } from '../peers/peer'
import type { PeerNotifySettings } from '../dialogs/notifySettings'
import { isPeerMuted } from '../dialogs/notifySettings'
import { publicLinkFromTelegramPath } from '../publicLink'
import { toPeerId } from '../peers/peerId'
import tsNow from '@helpers/tsNow'

/** Участник чата: наша роль + статус присутствия (объединение `UserStatus`). */
export interface ChatMember { userId: number; role: string; status?: UserStatus }

/**
 * Ответ `POST /groups` — `messages.invitedUsers` (ответ `messages.createChat`
 * оригинала). Из контейнера `Updates` на проводе у нас приезжают только векторы
 * пиров: пачка апдейтов пуста, служебное «создал(а) группу» идёт кадром WS.
 */
interface MessagesInvitedUsers {
  _: 'messages.invitedUsers'
  updates: { _: 'updates'; chats: Channel[]; users: UserReal[] }
  missing_invitees: MissingInvitee[]
}

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

/**
 * Фильтр `channels.getParticipants` (`ChannelParticipantsFilter` схемы) в объёме
 * вкладок правой колонки: поиск/недавние — «Участники», админы — «Администраторы»,
 * выгнанные — «Удалённые», ограниченные — исключения прав группы.
 */
export type ChannelParticipantsFilter =
  | { _: 'channelParticipantsRecent' }
  | { _: 'channelParticipantsSearch'; q: string }
  | { _: 'channelParticipantsAdmins'; q?: string }
  | { _: 'channelParticipantsKicked'; q: string }
  | { _: 'channelParticipantsBanned'; q: string }

/** Страница листания `/members` под фильтр админов (`getParticipants`). */
const ADMINS_PAGE = 200

/** Ключ пользователя участника — для ручек, которые адресуют его по id. */
const participantPeerId = (participant: PeerId | ChannelParticipantWire) =>
  typeof participant === 'object' ? participantUserId(participant) : participant

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

/**
 * Хеш ссылки-приглашения — хвост её адреса. Сервер отдаёт путь диплинка
 * клиента (`/join/<хеш>`), а ссылка в форме оригинала — публичная
 * `t.me/+<хеш>` (`toPublicInvite`); хеш один и тот же в обеих.
 */
export const inviteHash = (link: string): string => link.slice(link.lastIndexOf('/') + 1).replace(/^\+/, '')

/**
 * Ссылка в форме оригинала: `link` — полный публичный адрес, как
 * `chatInviteExported.link` у tweb (`https://t.me/+<хеш>`). У нас хост
 * публичных ссылок свой (`core/publicLink.ts`, страница `/+{hash}` рендерит
 * бэкенд, `public_page.go`), путь — 1:1 с t.me.
 */
const toPublicInvite = (l: ChatInviteExported): ChatInviteExported => ({
  ...l,
  link: publicLinkFromTelegramPath('+' + inviteHash(l.link)),
})

/** Ключ пира чата: ручки адресуют чат знаковым ключом, tweb — положительным `chatId`. */
const chatPeerId = (chatId: ChatId) => toPeerId(chatId as number, true)

/** Срок ссылки на проводе — ОТНОСИТЕЛЬНЫЙ (`expire_seconds` от «сейчас», 0 — бессрочно),
 *  у оригинала — абсолютный `expire_date` (0 — бессрочно). */
const toExpireSeconds = (expireDate?: number) => expireDate ? Math.max(1, expireDate - tsNow(true)) : 0

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
  // Токен — хвост адреса, а не отдельное поле провода; `url` — путь диплинка
  // клиента, как его отдаёт сервер (читатели приклеивают к нему `origin`).
  token: inviteHash(l.link),
  url: '/join/' + inviteHash(l.link),
  uses: l.usage ?? 0,
  requiresApproval: !!l.pFlags?.request_needed,
  expiresAt: l.expire_date ? new Date(l.expire_date * 1000).toISOString() : undefined,
  title: l.title ?? '',
  usageLimit: l.usage_limit ?? null,
  revoked: !!l.pFlags?.revoked,
})

/**
 * Тема форум-группы — СТРОКА списка: состояние чтения, место в списке и
 * разрешённое последнее сообщение.
 *
 * Выжимок последнего сообщения (`lastText`, `lastType`, `lastAt` и склеенное
 * СЕРВЕРОМ `lastSenderName`) здесь больше нет: сообщение приезжает вектором
 * `messages` контейнера, строка адресует его числом `top_message`, а имя
 * автора собирает клиент из карточки пира — тот же ход, что сделан у диалогов.
 *
 * Ушли и `msgCount` с `pos`: счётчика сообщений темы у оригинала не бывает
 * вовсе, а порядок задаёт сам вектор.
 */
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
  isGeneral: boolean
  createdBy: number
  /** непрочитанные сообщения темы (чужие, как у диалога) */
  unread: number
  /** непрочитанные упоминания зрителя в теме */
  unreadMentions: number
  /** тема заглушена этим пользователем */
  muted: boolean
  /** seq последнего сообщения темы (для пометки «прочитано») */
  lastMsgSeq: number
  /** последнее сообщение темы ЦЕЛИКОМ — разрешено по `top_message` */
  lastMessage?: MyMessage
}

/**
 * `forumTopic` — строка на проводе. Наших параметров у неё три, и все три
 * объявлены клиентскими в `schema/schema_additional_params.json`:
 * `root_msg_id` (у оригинала id темы И ЕСТЬ номер её корня),
 * `icon_emoji_emoticon` (у схемы это номер документа кастомного эмодзи) и флаг
 * `is_general` (у оригинала General узнают по id == 1).
 */
export interface ForumTopicWire {
  _: 'forumTopic'
  pFlags?: { my?: true; closed?: true; pinned?: true; hidden?: true; is_general?: true }
  id: number
  date: number
  peer: Peer
  title: string
  icon_color: number
  icon_emoji_emoticon?: string
  root_msg_id?: number
  from_id: Peer
  top_message: number
  read_inbox_max_id: number
  unread_count: number
  unread_mentions_count: number
  notify_settings: PeerNotifySettings
}

/** `messages.forumTopics` — контейнер списка тем. */
export interface MessagesForumTopics {
  _: 'messages.forumTopics'
  count: number
  topics: ForumTopicWire[]
  messages: RawMyMessage[]
  chats: Chat[]
  users: UserReal[]
}

/**
 * Строка провода → строка модели. Переводится ровно одно — ПРОСТРАНСТВО
 * НОМЕРОВ: `top_message` сравнивается с `message.id`, и оставить его серверным
 * значило бы сравнивать числа из разных пространств (то же делает оригинал в
 * `saveConversation`).
 *
 * Заглушённость ВЫЧИСЛЯЕТСЯ по сроку (`notify_settings.mute_until`), а не
 * приезжает булевым полем: тот же предикат, что у диалога.
 */
const mapTopic = (
  r: ForumTopicWire,
  messages?: Pick<MessagesManager, 'getMessageByPeer'>,
  now = Math.floor(Date.now() / 1000),
): TopicRow => {
  const peerId = getPeerId(r.peer)
  const topMessage = generateMessageId(r.top_message)
  return {
    id: r.id,
    peerId,
    rootMsgId: r.root_msg_id ?? 0,
    title: r.title,
    iconColor: r.icon_color,
    iconEmoji: r.icon_emoji_emoticon ?? '',
    closed: !!r.pFlags?.closed,
    hidden: !!r.pFlags?.hidden,
    pinned: !!r.pFlags?.pinned,
    isGeneral: !!r.pFlags?.is_general,
    createdBy: getPeerId(r.from_id),
    unread: r.unread_count ?? 0,
    unreadMentions: r.unread_mentions_count ?? 0,
    muted: isPeerMuted(r.notify_settings, now),
    lastMsgSeq: topMessage,
    lastMessage: messages?.getMessageByPeer(peerId, topMessage),
  }
}

export function newGroupsManager({ rest, dialogs, peers, messages }: {
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
  // Владелец сообщений: контейнер списка тем несёт вектор `messages`, и
  // последнее сообщение темы разрешается по ссылке `top_message` — тем же
  // порядком, что у контейнера диалогов. Опционален по той же причине, что у
  // диалогов: тесты, которых контейнер не касается, его не задают, и тогда
  // строка просто остаётся без превью, а не падает.
  messages?: Pick<MessagesManager, 'saveApiMessages' | 'getMessageByPeer'>
}) {
  /**
   * tweb `appChatsManager.editBanned(id, participant, rights)`: `view_messages`
   * — выгнать (у нас список «удалённых», `POST /bans`), пустые запреты — снять
   * бан или ограничение, иначе — ограничить. Срок у оригинала абсолютный
   * (`until_date`, `BANNED_RIGHTS_UNTIL_FOREVER`/0 — навсегда), у ручки —
   * относительный (`until_seconds`, 0 — навсегда).
   */
  const editBanned = async(chatId: ChatId, participant: PeerId | ChannelParticipantWire, rights: ChatBannedRights): Promise<void> => {
    const peerId = chatPeerId(chatId)
    const userId = participantPeerId(participant)
    const pFlags = rights.pFlags ?? {}
    if (pFlags.view_messages) {
      await rest.post(`/chats/${peerId}/bans`, { user_id: userId })
      return
    }

    const denied = deniedMask(pFlags)
    if (!denied) {
      const wasKicked = typeof participant === 'object' && participant._ === 'channelParticipantBanned' && !!participant.pFlags?.left
      await rest.del(`/chats/${peerId}/${wasKicked ? 'bans' : 'restrictions'}/${userId}`)
      return
    }

    const untilDate = rights.until_date
    const untilSeconds = !untilDate || untilDate >= BANNED_RIGHTS_UNTIL_FOREVER ? 0 : Math.max(1, untilDate - tsNow(true))
    await rest.post(`/chats/${peerId}/restrictions`, { user_id: userId, denied_rights: denied, until_seconds: untilSeconds })
  }

  return {
    /**
     * Создать группу. Ответ — СОЗДАННЫЙ объект (`messages.chatFull`), а не его
     * адрес в безымянной обёртке: у оригинала `messages.createChat` отвечает
     * пачкой с новым чатом внутри.
     *
     * Карточка сразу уезжает в зеркало пиров — иначе экран, открытый по
     * возвращённому ключу, ждал бы отдельного запроса за тем, что уже пришло.
     */
    // Порт `appChatsManager.createChat` (tweb 812502980 `appChatsManager.ts:627-637`):
    // ответ `messages.invitedUsers` — созданный чат в `updates.chats[0]`
    // (пиры пачки — в зеркало, как `processUpdateMessage` оригинала) и те, кого
    // настройка приватности не дала позвать. `InputUser` оригинала у нас —
    // ключ пользователя (`access_hash` не копируем, tl-program.md).
    async createChat(title: string, userIds: number[]): Promise<{ chatId: number; missingInvitees: MissingInvitee[] }> {
      const r = await rest.post<MessagesInvitedUsers>('/groups', { title, member_ids: userIds })
      peers.saveApiPeers(r.updates)
      return { chatId: r.updates.chats[0].id, missingInvitees: r.missing_invitees }
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
    // Созданная тема — та же СТРОКА, что едет в списке: своей формы у ответа
    // нет. Наружу отдаём пару адресов, которой пользуется вызывающий.
    async createTopic(peerId: number, title: string, iconColor: number, iconEmoji = ''): Promise<{ id: number; rootMsgId: number }> {
      const r = await rest.post<ForumTopicWire>(`/chats/${peerId}/topics`, { title, icon_color: iconColor, icon_emoji: iconEmoji })
      return { id: r.id, rootMsgId: r.root_msg_id ?? 0 }
    },
    /**
     * Список тем контейнером `messages.forumTopics`.
     *
     * Порядок обязателен и он же — порядок оригинала: сначала в хранилища
     * втекают ПИРЫ и СООБЩЕНИЯ, и только потом разрешаются ссылки на них.
     * Иначе `getMessageByPeer(peerId, top_message)` не нашёл бы ничего, а имя
     * автора превью собирать было бы не из кого.
     */
    async listTopics(peerId: number): Promise<TopicRow[]> {
      const r = await rest.get<MessagesForumTopics>(`/chats/${peerId}/topics`)
      peers?.saveApiPeers({ chats: r.chats, users: r.users })
      await messages?.saveApiMessages(r.messages)
      return (r.topics ?? []).map((t) => mapTopic(t, messages))
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
    /**
     * Свободно ли публичное имя для ЭТОГО чата — порт `appChatsManager.checkUsername`
     * (tweb `:1082-1087`, `channels.checkUsername`). Ответ — `Bool`; своё имя чата
     * свободно. Отказы приезжают ошибкой с именем (`HttpError.type`): негодная форма —
     * `USERNAME_INVALID`, нет права менять инфо — `CHAT_ADMIN_REQUIRED`; ветвится по
     * ним поле `UsernameInputField`, как у оригинала.
     */
    async checkUsername(peerId: number, username: string): Promise<boolean> {
      const res = await rest.get<{ _: string }>(`/chats/${peerId}/username/available`, { u: username })
      return res._ === 'boolTrue'
    },
    async setType(peerId: number, isPublic: boolean, username: string): Promise<void> {
      await rest.put(`/chats/${peerId}/type`, { is_public: isPublic, username })
    },
    /**
     * Права участников по умолчанию и медленный режим — порт пары
     * `appChatsManager.editChatDefaultBannedRights` (`:887-901`) +
     * `toggleSlowMode` (`:1188-1196`) ОДНИМ вызовом: бэкенд хранит пару одной
     * ручкой `PUT /chats/{id}/permissions` (`group_handler.go::SetPermissions`
     * перезаписывает оба поля), и раздельная запись второй половины затирала бы
     * первую значением из устаревшего зеркала. Запреты (`chatBannedRights`) едут
     * нашим битмаском «что можно» — перевод в `allowedFromBannedRights`.
     */
    async editChatDefaultBannedRights(peerId: number, rights: ChatBannedRights, slowmodeSeconds: number): Promise<void> {
      await rest.put(`/chats/${peerId}/permissions`, { permissions: allowedFromBannedRights(rights), slowmode_seconds: slowmodeSeconds })
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
    /**
     * Ограниченные участники — порт `appProfileManager.getChannelParticipants`
     * с фильтром `channelParticipantsBanned` (`:744-790`): ограниченный остаётся в
     * чате (у выгнанного — `left`, его список `listBans`). Ручка отдаёт список
     * целиком, без `offset`/`limit`; карточек `users` в ответе нет — строки
     * объявляют пробел зеркала сами (`peers.fillMirror` у `PeerTitle`/`avatar`).
     */
    async channelParticipantsBanned(peerId: number): Promise<ChannelsChannelParticipants> {
      const r = await rest.get<ChannelsChannelParticipants>(`/chats/${peerId}/restrictions`)
      peers.saveApiPeers({ users: r.users ?? [] })
      return r
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
    /**
     * Страница участников КОНТЕЙНЕРОМ — порт `appProfileManager.getChannelParticipants`
     * в объёме вкладки «Участники» shared media (`components/appSearchSuper.ts::
     * loadMembers`, tweb `:1720-1724`): `offset`/`limit` уходят ручке как есть
     * (`group_handler.go::ListMembers` их читает, дефолт 200), назад — сырой
     * `channels.channelParticipants` с конструкторами участников и `count`.
     * Карточки из вектора `users` сразу уезжают в зеркало (`saveApiPeers`),
     * как у оригинала (`appProfileManager.ts:653-656` — `saveApiUsers`): строка
     * списка читает карточку синхронно, и к моменту ответа она уже там.
     *
     * `members` выше остаётся плоской формой без пагинации для экранов
     * редактирования группы; эта ручка — для списка, который листает.
     *
     * `q` — фильтр `channelParticipantsSearch` (`appProfileManager.getParticipants`
     * с `filter: {_: 'channelParticipantsSearch', q}`): выбор отправителя в поиске
     * по чату (`components/chat/topbarSearch.solid.tsx`, tweb `topbarSearch.tsx:184-190`).
     */
    async channelParticipants(peerId: PeerId, offset: number, limit: number, q?: string): Promise<ChannelsChannelParticipants> {
      const query: Record<string, string | number> = { offset, limit }
      if (q) query.q = q
      const r = await rest.get<ChannelsChannelParticipants>(`/chats/${peerId}/members`, query)
      // `chats` контейнера у этой ручки пуст всегда (`group_handler.go::ListMembers`
      // кладёт только карточки участников) — в зеркало едут `users`.
      peers.saveApiPeers({ users: r.users })
      return r
    },
    async promoteAdmin(peerId: number, userId: number, rights: number): Promise<void> {
      await rest.post(`/chats/${peerId}/admins`, { user_id: userId, rights })
    },
    async demoteAdmin(peerId: number, userId: number): Promise<void> {
      await rest.del(`/chats/${peerId}/admins/${userId}`)
    },
    // ── Участники в форме оригинала — порт `appProfileManager.getParticipants`
    // и мутаций `appChatsManager` (`editAdmin`, `editBanned`, `kickFromChat`,
    // `clearChannelParticipantBannedRights`, `hideChatJoinRequest`) в объёме
    // вкладок правой колонки (0б-7 волны 7: админы, участники, удалённые,
    // заявки, права участника). Ключ — положительный `chatId`, участник —
    // конструктор провода или ключ пира, как у оригинала.
    //
    // Расхождения (бэкенд, Б-115…Б-117 плана каркаса):
    //  • фильтра админов у ручки нет — `channelParticipantsAdmins` листает
    //    `/members` целиком и оставляет создателя и админов; выгнанные и
    //    ограниченные — свои ручки без страниц и без поиска `q`;
    //  • `rank` админа на проводе нет — `editAdmin` его не передаёт;
    //  • ответа `Updates` у мутаций нет: кадр `chat_participant` не приходит,
    //    списки перечитываются по `chat_update` (`AppSelectPeers`).

    /** tweb `appProfileManager.getParticipants({id, filter, limit, offset})`. */
    async getParticipants({ id, filter = { _: 'channelParticipantsRecent' }, limit = 200, offset = 0 }: {
      id: ChatId; filter?: ChannelParticipantsFilter; limit?: number; offset?: number
    }): Promise<ChannelsChannelParticipants> {
      const peerId = chatPeerId(id)
      switch (filter._) {
        case 'channelParticipantsAdmins': {
          // одна страница на весь список: смещение по отфильтрованному не совпадает с серверным
          if (offset) return { _: 'channels.channelParticipants', count: 0, participants: [], chats: [], users: [] }
          const participants: ChannelParticipantWire[] = []
          const users: UserReal[] = []
          for (let pageOffset = 0; ; pageOffset += ADMINS_PAGE) {
            const r = await rest.get<ChannelsChannelParticipants>(`/chats/${peerId}/members`, {
              offset: pageOffset,
              limit: ADMINS_PAGE,
              ...(filter.q ? { q: filter.q } : {}),
            })
            const page = r.participants ?? []
            const admins = page.filter((p) => p._ === 'channelParticipantCreator' || p._ === 'channelParticipantAdmin')
            const adminIds = new Set(admins.map(participantUserId))
            participants.push(...admins)
            users.push(...(r.users ?? []).filter((u) => adminIds.has(u.id)))
            if (page.length < ADMINS_PAGE) break
          }
          peers.saveApiPeers({ users })
          return { _: 'channels.channelParticipants', count: participants.length, participants, chats: [], users }
        }
        case 'channelParticipantsKicked':
        case 'channelParticipantsBanned': {
          if (offset) return { _: 'channels.channelParticipants', count: 0, participants: [], chats: [], users: [] }
          const r = await rest.get<ChannelsChannelParticipants>(`/chats/${peerId}/${filter._ === 'channelParticipantsKicked' ? 'bans' : 'restrictions'}`)
          peers.saveApiPeers({ users: r.users ?? [] })
          return r
        }
        default: {
          const query: Record<string, string | number> = { offset, limit }
          if (filter._ === 'channelParticipantsSearch' && filter.q) query.q = filter.q
          const r = await rest.get<ChannelsChannelParticipants>(`/chats/${peerId}/members`, query)
          peers.saveApiPeers({ users: r.users })
          return r
        }
      }
    },
    /** tweb `appChatsManager.editAdmin(id, participant, rights, rank)`: пустые права — снять админа. */
    async editAdmin(chatId: ChatId, participant: PeerId | ChannelParticipantWire, rights: ChatAdminRights, _rank?: string): Promise<void> {
      const peerId = chatPeerId(chatId)
      const userId = participantPeerId(participant)
      if (!Object.keys(rights.pFlags ?? {}).length) {
        await rest.del(`/chats/${peerId}/admins/${userId}`)
        return
      }

      await rest.post(`/chats/${peerId}/admins`, { user_id: userId, rights: adminRightsMask(rights.pFlags) })
    },
    editBanned,
    /** tweb `appChatsManager.clearChannelParticipantBannedRights`. */
    async clearChannelParticipantBannedRights(chatId: ChatId, participant: PeerId | ChannelParticipantWire): Promise<void> {
      await editBanned(chatId, participant, { _: 'chatBannedRights', until_date: 0, pFlags: {} })
    },
    /** tweb `appChatsManager.kickFromChat` → `kickFromChannel` (базовых групп нет). */
    async kickFromChat(chatId: ChatId, participant: PeerId | ChannelParticipantWire): Promise<void> {
      await editBanned(chatId, participant, { _: 'chatBannedRights', until_date: 0, pFlags: { view_messages: true } })
    },
    /** tweb `appChatsManager.hideChatJoinRequest(chatId, userId, approved)`. */
    async hideChatJoinRequest(chatId: ChatId, userId: UserId, approved: boolean): Promise<void> {
      await rest.post(`/chats/${chatPeerId(chatId)}/join_requests/${userId}/${approved ? 'approve' : 'decline'}`, {})
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
    // ── Ссылки в форме оригинала — порт `appChatInvitesManager` (tweb
    // `lib/appManagers/appChatInvitesManager.ts`) в объёме вкладок ссылок
    // правой колонки (`sidebarRight/tabs/chatInviteLink*.solid.tsx`, 0б-3).
    // Ключ — `chatId` (положительный), ссылка адресуется `link` — полным
    // публичным адресом (`toPublicInvite`), как у оригинала. Ответы —
    // конструкторы провода, без переклейки в плоскую витрину.
    //
    // Нет на бэкенде (О-120…О-124 волны 7): `admin_id`-фильтр и
    // `getAdminsWithInvites`, постоянная ссылка (`permanent`,
    // `messages.exportedChatInviteReplaced`), заявки по ссылке (`requested`),
    // подписки (`subscription_pricing`), страницы и поиск вступивших.

    /** tweb `getExportedChatInvites({chatId, revoked})` (без `adminId` — О-121). Карточки
     *  создателей (`users`) — в зеркало: строка «Ссылку создал» читает их синхронно. */
    async getExportedChatInvites({ chatId, revoked }: { chatId: ChatId; revoked?: boolean }): Promise<MessagesExportedChatInvites> {
      const r = await rest.get<MessagesExportedChatInvites & { users?: UserReal[] }>(`/chats/${chatPeerId(chatId)}/invite_links${revoked ? '?revoked=true' : ''}`)
      peers.saveApiPeers({ users: r.users })
      return { _: r._, count: r.count, invites: (r.invites ?? []).map(toPublicInvite) }
    },
    /** tweb `exportChatInvite` (без `stars` — О-123). `usageLimit: 0` — без лимита, `expireDate: 0` — бессрочно. */
    async exportChatInvite({ chatId, title, requestNeeded, usageLimit, expireDate }: {
      chatId: ChatId; title?: string; requestNeeded?: boolean; usageLimit?: number; expireDate?: number
    }): Promise<ChatInviteExported> {
      const r = await rest.post<MessagesExportedChatInvite>(`/chats/${chatPeerId(chatId)}/invite_links`, {
        title: title || undefined,
        usage_limit: usageLimit || null,
        requires_approval: !!requestNeeded,
        expire_seconds: toExpireSeconds(expireDate),
      })
      return toPublicInvite(r.invite)
    },
    /**
     * tweb `editExportedChatInvite`. Отзыв (`revoked`) — одним признаком; иначе
     * едут все поля формы, как у оригинала (`usageLimit: 0` — без лимита,
     * `expireDate: 0` — бессрочно). Ответ — всегда `messages.exportedChatInvite`:
     * замены постоянной ссылки (`…Replaced` с `new_invite`) сервер не производит (О-120).
     */
    async editExportedChatInvite({ chatId, link, revoked, expireDate, requestNeeded, title, usageLimit }: {
      chatId: ChatId; link: string; revoked?: boolean; expireDate?: number; requestNeeded?: boolean; title?: string; usageLimit?: number
    }): Promise<MessagesExportedChatInvite> {
      const body: Record<string, unknown> = revoked ? { revoked: true } : {
        title: title ?? '',
        requires_approval: !!requestNeeded,
        usage_limit: usageLimit || null,
        expire_seconds: toExpireSeconds(expireDate),
      }
      const r = await rest.patch<MessagesExportedChatInvite>(`/chats/${chatPeerId(chatId)}/invite_links/${inviteHash(link)}`, body)
      return { ...r, invite: toPublicInvite(r.invite) }
    },
    /** tweb `deleteExportedChatInvite(chatId, link)` — удаление навсегда (отзыв — `editExportedChatInvite({revoked})`). */
    async deleteExportedChatInvite(chatId: ChatId, link: string): Promise<void> {
      await rest.del(`/chats/${chatPeerId(chatId)}/invite_links/${inviteHash(link)}`)
    },
    /** tweb `deleteRevokedExportedChatInvites(chatId, adminId)` (без `adminId` — О-121). */
    async deleteRevokedExportedChatInvites(chatId: ChatId): Promise<void> {
      await rest.del(`/chats/${chatPeerId(chatId)}/revoked_invite_links`)
    },
    /**
     * tweb `getChatInviteImporters({chatId, link, limit, offsetDate, offsetUserId, q, requested})`
     * в объёме сервера: вошедшие по ссылке, первые 50 (`usecase InviteImporters`),
     * без страниц и поиска (О-124); заявки (`requested`) — ручка `/join_requests` (0б-7). Карточки из вектора `users` —
     * в зеркало, как у оригинала (`saveApiUsers`): строка списка читает их синхронно.
     */
    async getChatInviteImporters({ chatId, link, requested }: { chatId: ChatId; link?: string; requested?: boolean }): Promise<MessagesChatInviteImporters> {
      // заявки (`requested` без ссылки, вкладка «Заявки» 0б-7) — своя ручка
      // `/join_requests`, тот же конструктор `chatInviteImporter` с `requested`
      const path = requested && !link ?
        `/chats/${chatPeerId(chatId)}/join_requests` :
        `/chats/${chatPeerId(chatId)}/invite_links/${inviteHash(link!)}/importers`
      const r = await rest.get<MessagesChatInviteImporters & { users?: UserReal[] }>(path)
      peers.saveApiPeers({ users: r.users })
      return r
    },
    /**
     * Порт `appChatInvitesManager.importChatInvite` (tweb 812502980
     * `appChatInvitesManager.ts:92-104`): ответ — `Updates` с чатом ссылки в
     * `chats[0]`, пиры пачки — в зеркало (`processUpdateMessage` оригинала),
     * наружу — ключ чата. Заявка на вступление — отказ `INVITE_REQUEST_SENT`
     * (имя отказа доезжает до вызывающего, `HttpError.type`).
     */
    async importChatInvite(hash: string): Promise<PeerId> {
      const r = await rest.post<MessagesInvitedUsers['updates']>(`/join/${hash}`, {})
      peers.saveApiPeers(r)
      return toPeerId(r.chats[0].id, true)
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
