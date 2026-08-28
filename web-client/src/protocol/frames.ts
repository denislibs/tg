// WS envelope: { t: <type>, d: <payload>, pts? }. Mirrors backend docs/contracts.md.

export interface Frame<T = unknown> {
  t: string
  d?: T
  /**
   * Курсор кадра, когда его негде положить В ТЕЛО.
   *
   * У части конструкторов схемы параметра `pts` нет вовсе
   * (`updateMessageReactions`, кадры диалогов): у оригинала такие кадры едут в
   * контейнере `updates`, и порядок им задаёт `seq` КОНТЕЙНЕРА. Наш конверт —
   * тот же контейнер, поэтому курсор едет здесь, а не приписывается к
   * конструктору полем, которого в схеме нет.
   *
   * У кадров, чей конструктор `pts` объявляет (`updateNewMessage`,
   * `updateReadHistoryInbox`, …), курсор по-прежнему внутри тела, и здесь его
   * не будет — дубля одного числа в двух местах не заводим.
   */
  pts?: number
}

// Client -> server
export interface SendMessageFrame {
  chat_id: number
  type?: string
  text?: string
  reply_to_id?: number | null
  client_msg_id: string
  media_id?: number | null
}
export interface ReadFrame { chat_id: number; up_to_seq: number }
export interface TypingFrame { chat_id: number }

// Server -> client
export interface MessageAck { client_msg_id: string; msg_id: number; seq: number; created_at: string }
export interface NewMessage {
  chat_id: number; msg_id: number; seq: number; sender_id: number
  type: string; text: string; media_id: number | null; created_at: string
}
export interface ReadReceipt { chat_id: number; user_id: number; up_to_seq: number }
export interface TypingEvent { chat_id: number; user_id: number }
export interface PresenceEvent { user_id: number; online: boolean; last_seen: number }
export interface ReactionEvent { chat_id: number; msg_id: number; user_id: number; emoji: string; action: 'add' | 'remove' }

export const encodeFrame = (t: string, d?: unknown): string => JSON.stringify({ t, d })
export const decodeFrame = (raw: string): Frame => JSON.parse(raw) as Frame
