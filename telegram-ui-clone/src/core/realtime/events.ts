// src/core/realtime/events.ts
import type { MessageEntity, RawGeo } from '../models'
// Worker -> UI event names (over SuperMessagePort.emit). Live frames AND /sync
// catch-up both surface through these, so the UI handles them uniformly.
export const RT = {
  newMessage: 'rt:new_message',
  editMessage: 'rt:edit_message',
  deleteMessage: 'rt:delete_message',
  pinMessage: 'rt:pin_message',
  read: 'rt:read',
  mediaRead: 'rt:media_read',
  typing: 'rt:typing',
  presence: 'rt:presence',
  reaction: 'rt:reaction',
  ack: 'rt:ack',
  messageError: 'rt:message_error',
  call: 'rt:call',
  chatRemoved: 'rt:chat_removed',
  draftUpdate: 'rt:draft_update',
  dialogPin: 'rt:dialog_pin',
  dialogArchive: 'rt:dialog_archive',
  pollUpdate: 'rt:poll_update',
  boostUpdate: 'rt:boost_update',
  giveawayUpdate: 'rt:giveaway_update',
  balanceUpdate: 'rt:balance_update',
  groupCall: 'rt:group_call',
  botCallbackAnswer: 'rt:bot_callback_answer',
  geoLiveUpdate: 'rt:geo_live_update',
  webPageUpdate: 'rt:web_page_update',
  secretRequest: 'rt:secret_chat_request',
  secretAccept: 'rt:secret_chat_accept',
  secretReject: 'rt:secret_chat_reject',
  state: 'rt:state',
} as const

export type ConnState = 'connecting' | 'ready' | 'reconnecting' | 'offline'

export interface NewMessageEvt { chat_id: number; msg_id: number; seq: number; sender_id: number; type: string; text: string; entities?: MessageEntity[] | null; media_id: number | null; created_at: string; thread_root_id?: number | null; reply_to_id?: number | null; reply_quote_text?: string; reply_quote_offset?: number | null; fwd_from_user_id?: number | null; fwd_from_chat_id?: number | null; fwd_from_msg_id?: number | null; fwd_date?: string | null; media_unread?: boolean; sender_name?: string; grouped_id?: string | null; geo?: RawGeo | null; contact?: { user_id: number; name?: string; phone?: string } | null; gift?: import('../models').RawMessage['gift']; reply_markup?: import('../models').RawMessage['reply_markup'];
  // Медиа-мета live-кадра (те же ключи, что history read model) — файл/фото
  // рисуется полноценно сразу, без ожидания перезагрузки истории.
  media_w?: number; media_h?: number; media_mime?: string; media_blur?: string; media_has_thumb?: boolean; media_duration?: number; media_size?: number; media_name?: string;
  /** E2E-медиа секретного чата — инжектится воркером после расшифровки enc_body (не проводное поле сервера) */
  secret_media?: import('../models').SecretMedia;
  /** вид эффекта сообщения (наш аналог Telegram message effects) */
  effect?: string | null }
export interface EditMessageEvt { chat_id: number; msg_id: number; seq: number; text: string; entities?: MessageEntity[] | null; edited_at: string; reply_markup?: import('../models').RawMessage['reply_markup'] }
// Live-обновление координат гео-трансляции (geo_live_update).
export interface GeoLiveUpdateEvt { chat_id: number; msg_id: number; seq: number; geo: RawGeo }
// Догоняющее серверное превью ссылки (web_page_update): строится после
// отправки, кадр патчит уже отрисованное сообщение карточкой web page.
export interface WebPageUpdateEvt { chat_id: number; msg_id: number; seq: number; web_page: import('../models').RawWebPage }
// Ответ бота на callback уже после таймаута синхронного ожидания — тост по WS.
export interface BotCallbackAnswerEvt { text: string; alert: boolean }
// Рукопожатие секретного чата (request/accept/reject) — realtimeBridge
// маппит snake_case-кадр в этот camelCase-вид; воркер бродкастит сырой payload.
export interface SecretHandshakeEvt {
  chatId: number
  initiatorId: number
  responderId: number
  initiatorPub?: string // base64 (в request)
  responderPub?: string // base64 (в accept)
  state: string
}
export interface DeleteMessageEvt { chat_id: number; msg_id: number; seq: number; for_me: boolean }
export interface PinMessageEvt { chat_id: number; msg_id: number; pinned: boolean }
export interface ReadEvt { chat_id: number; user_id: number; up_to_seq: number }
// Голосовое/кружок прослушано получателем → у сообщения гаснет точка media_unread.
export interface MediaReadEvt { chat_id: number; msg_id: number }
// Меня удалили из группы / я вышел — диалог убирается из списка.
export interface ChatRemovedEvt { chat_id: number; removed: true }
// Черновик изменён на другом устройстве/вкладке (draft null — удалён).
export interface DraftUpdateEvt { chat_id: number; draft: import('../models').RawDraft | null }
// upload_* — на время аплоада медиа (tweb sendMessageUpload*Action: «отправляет файл/фото/…»)
export type TypingAction = 'typing' | 'voice' | 'video' | 'upload_file' | 'upload_photo' | 'upload_video' | 'upload_audio'
export interface TypingEvt { chat_id: number; user_id: number; action?: TypingAction }
export interface PresenceEvt { user_id: number; online: boolean; last_seen: number }
export interface ReactionEvt { chat_id: number; msg_id: number; user_id: number; author_id?: number; emoji: string; action: 'add' | 'remove' }
export interface AckEvt { client_msg_id: string; msg_id: number; seq: number; created_at: string }
// Server rejected a send (e.g. text too long). The client drops it from the outbox
// (no infinite retry) and removes the optimistic bubble.
export interface MessageErrorEvt { client_msg_id: string; reason: string }

// One envelope for every 1:1 call signaling frame (call_request / call_accept /
// call_decline / call_end / call_signal); `d.from_user_id` is stamped by the server.
export interface CallFrameEvt {
  t: 'call_request' | 'call_accept' | 'call_decline' | 'call_end' | 'call_signal'
  d: Record<string, unknown> & { from_user_id: number; call_id?: string }
}
