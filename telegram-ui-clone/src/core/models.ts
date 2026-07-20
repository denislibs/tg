// src/core/models.ts
import { mapGiftInfo, type RawGiftInfo, type GiftInfo } from './managers/starsManager'
import { mapReplyMarkup, type ReplyMarkup } from './managers/botsManager'

export type ChatKind = 'private' | 'group' | 'channel' | 'saved'

// A rich-text formatting span over a message's text (Telegram MessageEntity model).
// `offset`/`length` are UTF-16 code units (plain JS string indices), so the same
// numbers slice the text identically here and on the backend. `url` is set only
// for 'text_link'. The set mirrors what the composer can produce.
export type EntityType =
  | 'bold' | 'italic' | 'underline' | 'strikethrough'
  | 'code' | 'pre' | 'spoiler' | 'blockquote' | 'text_link' | 'text_mention'
export interface MessageEntity {
  type: EntityType
  offset: number
  length: number
  url?: string
  language?: string
  /** target user for 'text_mention' (упоминание юзера без username) */
  user_id?: number
}

// GeoData — гео-точка сообщения. venue: title/address; live location: livePeriod
// (сек, present → трансляция), heading, liveStopped, editedAt (время последнего
// обновления координат — для «обновлено N мин назад»).
export interface GeoData {
  lat: number
  lng: number
  title?: string
  address?: string
  livePeriod?: number
  heading?: number
  liveStopped?: boolean
  editedAt?: string
}

// RawGeo — гео на проводе (snake_case), как отдаёт бэк.
export interface RawGeo {
  lat: number
  lng: number
  title?: string
  address?: string
  live_period?: number
  heading?: number
  live_stopped?: boolean
  edited_at?: string
}

// mapGeo нормализует проводной гео-объект в GeoData (camelCase).
export function mapGeo(g: RawGeo): GeoData {
  return {
    lat: g.lat, lng: g.lng,
    title: g.title, address: g.address,
    livePeriod: g.live_period, heading: g.heading,
    liveStopped: g.live_stopped, editedAt: g.edited_at,
  }
}

export interface RawDialog {
  auto_delete_period?: number
  chat_id: number
  type: ChatKind
  last_read_seq: number
  peer_read_seq?: number
  unread: number
  muted?: boolean
  pinned?: boolean
  archived?: boolean
  is_forum?: boolean
  notify_preview?: boolean
  notify_sound?: string
  title?: string
  username?: string
  photo_url?: string
  peer?: { id: number; display_name: string; avatar_url: string; verified?: boolean }
  last_message?: { seq: number; text: string; sender_id: number; at: string; media_id?: number; type?: string; forwarded?: boolean; sender_name?: string }
}

export interface Dialog {
  chatId: number
  type: ChatKind
  lastReadSeq: number
  /** the OTHER side's read horizon (read_outbox) — outgoing seq <= this ⇒ ✓✓ */
  peerReadSeq: number
  unread: number
  muted: boolean
  /** закреплён вверху списка / убран в «Архив» (пер-юзерные флаги, tweb) */
  pinned: boolean
  archived: boolean
  /** в группе включены темы — клиент рендерит список топиков */
  isForum?: boolean
  /** per-chat уведомления: показывать превью текста / звук ('default'|'none') */
  notifyPreview?: boolean
  notifySound?: string
  // период автоудаления сообщений чата в секундах (0/undefined — выключено)
  autoDeletePeriod?: number
  title?: string
  username?: string
  /** фото группы/канала (content-путь /media/N/content; у private — peer.avatarUrl) */
  photoUrl?: string
  peer?: { id: number; displayName: string; avatarUrl: string; verified?: boolean }
  lastMessage?: { seq: number; text: string; senderId: number; at: string; mediaId?: number; mediaType?: string; forwarded?: boolean; senderName?: string }
}

export interface RawMessage {
  id: number
  chat_id: number
  seq: number
  sender_id: number
  type: string
  text: string
  entities?: MessageEntity[] | null
  reply_to_id: number | null
  media_id: number | null
  created_at: string
  thread_root_id?: number | null
  grouped_id?: string | null
  edited_at?: string | null
  deleted?: boolean
  fwd_from_user_id?: number | null
  fwd_from_chat_id?: number | null
  fwd_from_msg_id?: number | null
  fwd_date?: string | null
  reply_to?: { msg_id: number; seq: number; sender_id: number; text: string; entities?: MessageEntity[] | null; type: string; media_id?: number } | null
  poll_id?: number | null
  poll?: RawPoll | null
  media_w?: number
  media_h?: number
  media_mime?: string
  media_blur?: string
  media_has_thumb?: boolean
  media_duration?: number
  media_size?: number
  media_name?: string
  views?: number
  media_unread?: boolean
  reactions?: { emoji: string; count: number; mine?: boolean }[] | null
  geo?: RawGeo | null
  contact?: { user_id: number; name?: string; phone?: string } | null
  gift_id?: number | null
  gift?: RawGiftInfo | null
  reply_markup?: { inline?: { text: string; callback?: string; url?: string; webapp?: string }[][]; keyboard?: string[][]; resize?: boolean; one_time?: boolean } | null
  enc_body?: string | null
  ttl_seconds?: number | null
  destruct_at?: string | null
}

// Агрегат одной реакции на сообщении (emoji + счётчик + «моя»), tweb ReactionCount.
export interface ReactionCount {
  emoji: string
  count: number
  mine: boolean
}

export interface Message {
  id: number
  chatId: number
  seq: number
  senderId: number
  type: string
  text: string
  /** rich-text formatting spans over `text` (undefined/empty = plain) */
  entities?: MessageEntity[]
  replyToId: number | null
  mediaId: number | null
  createdAt: string
  threadRootId: number | null
  /** идентификатор медиагруппы (Telegram grouped_id); null — не в альбоме */
  groupedId?: string | null
  /** object-URL локального файла для мгновенного превью исходящего медиа
   * (пока идёт аплоад и до перезагрузки окна истории) */
  localUrl?: string
  /** Stable client-side id for an optimistic message; preserved across the ack
   * (when `id`/`seq` are rewritten to server values) so the React key never
   * changes and the bubble isn't remounted mid-animation. */
  clientId?: string
  /** Send was rejected (message_error): the bubble stays with a red error mark
   * until the user retries or removes it (tweb sendingerror). */
  failed?: boolean
  editedAt?: string | null
  deleted?: boolean
  // Forward attribution (set when the message was forwarded from elsewhere).
  fwdFromUserId?: number | null
  fwdFromChatId?: number | null
  fwdFromMsgId?: number | null
  fwdDate?: string | null
  /** Lightweight preview of the replied-to message (history read model). */
  replyTo?: { msgId: number; seq: number; senderId: number; text: string; entities?: MessageEntity[]; type: string; mediaId?: number } | null
  /** Media metadata (history read model) — lets the bubble render fully from the
   * message (exact box, blur placeholder, poster, mime, …) with no per-media
   * meta request. */
  mediaWidth?: number
  mediaHeight?: number
  mediaMime?: string
  mediaBlur?: string
  mediaHasThumb?: boolean
  mediaDuration?: number
  mediaSize?: number
  mediaName?: string
  /** deduplicated viewer count for a channel post (undefined = not a channel post) */
  views?: number
  /** голосовое/кружок ещё не прослушано получателем (Telegram media_unread) */
  mediaUnread?: boolean
  /** опрос сообщения типа 'poll' (представление для зрителя) */
  poll?: Poll
  /** агрегаты реакций под сообщением (undefined/пусто — реакций нет) */
  reactions?: ReactionCount[]
  /** гео-точка сообщения типа 'geo' (+ venue/live location) */
  geo?: GeoData
  /** контакт сообщения типа 'contact' (снимок имени/телефона + аккаунт) */
  contact?: { userId: number; name: string; phone: string }
  /** подарок сообщения типа 'gift' (представление для зрителя) */
  gift?: GiftInfo
  /** клавиатура сообщения (inline/reply) — у сообщений бота */
  replyMarkup?: ReplyMarkup
  /** E2E-шифртекст (base64 iv||ciphertext) сообщения типа 'encrypted'; расшифровка на клиенте */
  encBody?: string | null
  /** self-destruct: срок жизни после прочтения (сек) и абсолютный дедлайн (ISO) */
  ttlSeconds?: number | null
  destructAt?: string | null
  /** true — сообщение из секретного чата (после дешифровки text/entities заполнены локально) */
  secret?: boolean
}

// Опрос (backend PollInfo): вопрос + варианты + агрегаты для зрителя.
export interface RawPoll {
  id: number
  question: string
  options: string[]
  anonymous: boolean
  multiple: boolean
  quiz: boolean
  closed: boolean
  correct_option?: number | null
  counts: number[]
  total_voters: number
  my_votes: number[]
}

export interface Poll {
  id: number
  question: string
  options: string[]
  anonymous: boolean
  multiple: boolean
  quiz: boolean
  closed: boolean
  correctOption?: number
  counts: number[]
  totalVoters: number
  myVotes: number[]
}

export function mapPoll(r: RawPoll): Poll {
  return {
    id: r.id,
    question: r.question,
    options: r.options ?? [],
    anonymous: r.anonymous,
    multiple: r.multiple,
    quiz: r.quiz,
    closed: r.closed,
    correctOption: r.correct_option ?? undefined,
    counts: r.counts ?? [],
    totalVoters: r.total_voters ?? 0,
    myVotes: r.my_votes ?? [],
  }
}

// Запланированное сообщение (backend scheduled_messages): очередь до send_at.
export interface RawScheduled {
  id: number
  chat_id: number
  sender_id: number
  type: string
  text: string
  entities?: MessageEntity[] | null
  reply_to_id?: number | null
  media_id?: number | null
  send_at: string
  created_at: string
}

export interface Scheduled {
  id: number
  chatId: number
  type: string
  text: string
  entities?: MessageEntity[]
  sendAt: string
}

export function mapScheduled(r: RawScheduled): Scheduled {
  return { id: r.id, chatId: r.chat_id, type: r.type, text: r.text, entities: r.entities ?? undefined, sendAt: r.send_at }
}

// Облачный черновик (backend drafts): текст инпута с сырыми markdown-маркерами.
export interface RawDraft {
  chat_id: number
  text: string
  entities?: MessageEntity[] | null
  reply_to_id?: number | null
  updated_at: string
}

export interface Draft {
  chatId: number
  text: string
  replyToId: number | null
  updatedAt: string
}

export function mapDraft(r: RawDraft): Draft {
  return { chatId: r.chat_id, text: r.text, replyToId: r.reply_to_id ?? null, updatedAt: r.updated_at }
}

export function mapDialog(r: RawDialog): Dialog {
  return {
    chatId: r.chat_id,
    type: r.type,
    lastReadSeq: r.last_read_seq,
    peerReadSeq: r.peer_read_seq ?? 0,
    unread: r.unread,
    muted: !!r.muted,
    pinned: !!r.pinned,
    archived: !!r.archived,
    isForum: r.is_forum || undefined,
    notifyPreview: r.notify_preview ?? true,
    notifySound: r.notify_sound ?? 'default',
    autoDeletePeriod: r.auto_delete_period ?? 0,
    title: r.title,
    username: r.username,
    photoUrl: r.photo_url || undefined,
    peer: r.peer
      ? { id: r.peer.id, displayName: r.peer.display_name, avatarUrl: r.peer.avatar_url, verified: r.peer.verified }
      : undefined,
    lastMessage: r.last_message
      ? {
          seq: r.last_message.seq,
          text: r.last_message.text,
          senderId: r.last_message.sender_id,
          at: r.last_message.at,
          mediaId: r.last_message.media_id && r.last_message.media_id > 0 ? r.last_message.media_id : undefined,
          mediaType: r.last_message.type || undefined,
          forwarded: r.last_message.forwarded || undefined,
          senderName: r.last_message.sender_name || undefined,
        }
      : undefined,
  }
}

export function mapMessage(r: RawMessage): Message {
  return {
    id: r.id,
    chatId: r.chat_id,
    seq: r.seq,
    senderId: r.sender_id,
    type: r.type,
    text: r.text,
    entities: r.entities ?? undefined,
    replyToId: r.reply_to_id,
    mediaId: r.media_id,
    createdAt: r.created_at,
    threadRootId: r.thread_root_id ?? null,
    groupedId: r.grouped_id ?? null,
    poll: r.poll ? mapPoll(r.poll) : undefined,
    editedAt: r.edited_at ?? null,
    deleted: r.deleted ?? false,
    fwdFromUserId: r.fwd_from_user_id ?? null,
    fwdFromChatId: r.fwd_from_chat_id ?? null,
    fwdFromMsgId: r.fwd_from_msg_id ?? null,
    fwdDate: r.fwd_date ?? null,
    replyTo: r.reply_to
      ? { msgId: r.reply_to.msg_id, seq: r.reply_to.seq, senderId: r.reply_to.sender_id, text: r.reply_to.text, entities: r.reply_to.entities ?? undefined, type: r.reply_to.type, mediaId: r.reply_to.media_id && r.reply_to.media_id > 0 ? r.reply_to.media_id : undefined }
      : null,
    mediaWidth: r.media_w,
    mediaHeight: r.media_h,
    mediaMime: r.media_mime,
    mediaBlur: r.media_blur,
    mediaHasThumb: r.media_has_thumb,
    mediaDuration: r.media_duration,
    mediaSize: r.media_size,
    mediaName: r.media_name,
    views: r.views,
    mediaUnread: r.media_unread,
    reactions: r.reactions?.length
      ? r.reactions.map((x) => ({ emoji: x.emoji, count: x.count, mine: !!x.mine }))
      : undefined,
    geo: r.geo ? mapGeo(r.geo) : undefined,
    contact: r.contact
      ? { userId: r.contact.user_id, name: r.contact.name ?? '', phone: r.contact.phone ?? '' }
      : undefined,
    gift: r.gift ? mapGiftInfo(r.gift) : undefined,
    replyMarkup: r.reply_markup ? mapReplyMarkup(r.reply_markup) : undefined,
    encBody: r.enc_body ?? undefined,
    ttlSeconds: r.ttl_seconds ?? undefined,
    destructAt: r.destruct_at ?? undefined,
  }
}
