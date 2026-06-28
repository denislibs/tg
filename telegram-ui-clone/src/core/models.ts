// src/core/models.ts
export type ChatKind = 'private' | 'group' | 'channel' | 'saved'

// A rich-text formatting span over a message's text (Telegram MessageEntity model).
// `offset`/`length` are UTF-16 code units (plain JS string indices), so the same
// numbers slice the text identically here and on the backend. `url` is set only
// for 'text_link'. The set mirrors what the composer can produce.
export type EntityType =
  | 'bold' | 'italic' | 'underline' | 'strikethrough'
  | 'code' | 'pre' | 'spoiler' | 'blockquote' | 'text_link'
export interface MessageEntity {
  type: EntityType
  offset: number
  length: number
  url?: string
  language?: string
}

export interface RawDialog {
  chat_id: number
  type: ChatKind
  last_read_seq: number
  peer_read_seq?: number
  unread: number
  muted?: boolean
  title?: string
  username?: string
  peer?: { id: number; display_name: string; avatar_url: string; verified?: boolean }
  last_message?: { seq: number; text: string; sender_id: number; at: string; media_id?: number; type?: string; forwarded?: boolean }
}

export interface Dialog {
  chatId: number
  type: ChatKind
  lastReadSeq: number
  /** the OTHER side's read horizon (read_outbox) — outgoing seq <= this ⇒ ✓✓ */
  peerReadSeq: number
  unread: number
  muted: boolean
  title?: string
  username?: string
  peer?: { id: number; displayName: string; avatarUrl: string; verified?: boolean }
  lastMessage?: { seq: number; text: string; senderId: number; at: string; mediaId?: number; mediaType?: string; forwarded?: boolean }
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
  edited_at?: string | null
  deleted?: boolean
  fwd_from_user_id?: number | null
  fwd_from_chat_id?: number | null
  fwd_from_msg_id?: number | null
  fwd_date?: string | null
  reply_to?: { msg_id: number; seq: number; sender_id: number; text: string; entities?: MessageEntity[] | null; type: string; media_id?: number } | null
  media_w?: number
  media_h?: number
  media_mime?: string
  media_blur?: string
  media_has_thumb?: boolean
  media_duration?: number
  media_size?: number
  media_name?: string
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
  /** Stable client-side id for an optimistic message; preserved across the ack
   * (when `id`/`seq` are rewritten to server values) so the React key never
   * changes and the bubble isn't remounted mid-animation. */
  clientId?: string
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
}

export function mapDialog(r: RawDialog): Dialog {
  return {
    chatId: r.chat_id,
    type: r.type,
    lastReadSeq: r.last_read_seq,
    peerReadSeq: r.peer_read_seq ?? 0,
    unread: r.unread,
    muted: !!r.muted,
    title: r.title,
    username: r.username,
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
  }
}
