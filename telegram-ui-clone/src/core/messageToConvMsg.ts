import type { CallLog, ConvMsg } from '../data'
import type { Message } from './models'

// Format an ISO timestamp as local 24h "HH:MM"; returns '' on an invalid date.
// The renderer's formatTime renders this as-is in 24h mode and converts to AM/PM
// in 12h mode, so the bubble shows a real clock time, not the raw ISO string.
function hhmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Human label for a replied-to media message that has no caption (Telegram shows
// these in the quote line, e.g. "Фотография").
function replyMediaLabel(type?: string): string {
  switch (type) {
    case 'photo': return 'Фотография'
    case 'video': return 'Видео'
    case 'roundVideo': return 'Видеосообщение'
    case 'voice': return 'Голосовое сообщение'
    case 'audio': return 'Аудио'
    case 'document': return 'Файл'
    case 'sticker': return 'Стикер'
    default: return ''
  }
}

// Convert a backend Message into the renderer's ConvMsg shape.
// meId decides out/in. For outgoing messages status is 'read' (double check) once
// the peer has read up to this message's seq (opts.readUpToSeq, tracked by the
// caller from rt:read events), otherwise 'sent'.
// opts.senderName, when provided for an incoming message, populates `sender`
// so group bubbles can show the author name/avatar (the renderer picks a color).
export function messageToConvMsg(
  m: Message,
  meId: number | null,
  opts?: { senderName?: string; readUpToSeq?: number; forwardFromName?: string; replyToName?: string },
): ConvMsg {
  const out = meId != null && m.senderId === meId
  // Voice messages get their own bubble; service events render as a centered
  // pill (no sender/ticks); other media render via the generic media bubble
  // (keyed off mediaId), so everything else maps to 'text'.
  const convType =
    m.type === 'voice' ? 'voice'
    : m.type === 'call' ? 'call'
    : m.type === 'service' ? 'service'
    : m.type === 'photo' || m.type === 'video' || m.type === 'document' || m.type === 'audio' ? m.type
    : 'text'
  return {
    id: m.id,
    clientId: m.clientId,
    type: convType,
    out,
    text: m.text,
    entities: m.entities,
    time: hhmm(m.createdAt),
    // sending → до message_ack (оптимистичный id < 0); error → send отвергнут;
    // после ack id становится серверным и статус сам «дорастает» до sent/read.
    status: out
      ? m.failed
        ? 'error'
        : m.id < 0
          ? 'sending'
          : opts?.readUpToSeq != null && m.seq <= opts.readUpToSeq
            ? 'read'
            : 'sent'
      : undefined,
    call: m.type === 'call' ? parseCallLog(m.text) : undefined,
    mediaId: m.mediaId ?? undefined,
    mediaWidth: m.mediaWidth,
    mediaHeight: m.mediaHeight,
    mediaMime: m.mediaMime,
    mediaBlur: m.mediaBlur,
    mediaHasThumb: m.mediaHasThumb,
    mediaDuration: m.mediaDuration,
    mediaSize: m.mediaSize,
    mediaName: m.mediaName,
    sender: !out && opts?.senderName ? opts.senderName : undefined,
    senderId: !out ? m.senderId : undefined,
    edited: m.editedAt != null,
    views: m.views,
    deleted: m.deleted ?? false,
    forwardFrom: m.fwdFromUserId != null ? { name: opts?.forwardFromName ?? 'Неизвестно' } : undefined,
    reply: m.replyTo
      ? {
          name: m.replyTo.senderId === meId ? 'Вы' : opts?.replyToName ?? 'Сообщение',
          // Replied media with no caption → a type label ("Фотография"/"Видео"/…);
          // with a caption → the caption text (a thumbnail is shown alongside).
          text: m.replyTo.text || replyMediaLabel(m.replyTo.type),
          entities: m.replyTo.text ? m.replyTo.entities : undefined,
          seq: m.replyTo.seq,
          mediaId: m.replyTo.mediaId,
          mediaType: m.replyTo.type,
        }
      : undefined,
  }
}

// Лог звонка хранится в text как JSON (см. callEngine.logCallMessage).
function parseCallLog(text: string): CallLog {
  try {
    const p = JSON.parse(text) as Partial<CallLog>
    return {
      video: !!p.video,
      reason: p.reason === 'ok' || p.reason === 'missed' || p.reason === 'busy' ? p.reason : 'cancelled',
      duration: typeof p.duration === 'number' ? p.duration : undefined,
    }
  } catch {
    return { video: false, reason: 'cancelled' }
  }
}
