import type { CallLog, ConvMsg } from '../data'
import type { Message } from './models'
import { serviceMsgText } from './serviceMsg'

// Format an ISO timestamp as local 24h "HH:MM"; returns '' on an invalid date.
// The renderer's formatTime renders this as-is in 24h mode and converts to AM/PM
// in 12h mode, so the bubble shows a real clock time, not the raw ISO string.
function hhmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Human label for a replied-to media message that has no caption (Telegram shows
// these in the quote line, e.g. "Фотография"). Экспорт: тот же лейбл использует
// пин-бар и экран закреплённых для медиа без подписи.
export function replyMediaLabel(type?: string): string {
  switch (type) {
    case 'photo': return 'Фотография'
    case 'video': return 'Видео'
    case 'roundVideo': return 'Видеосообщение'
    case 'voice': return 'Голосовое сообщение'
    case 'audio': return 'Аудио'
    case 'document': return 'Файл'
    case 'sticker': return 'Стикер'
    case 'geo': return 'Геолокация'
    case 'contact': return 'Контакт'
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
  // Send-as (Telegram send_as): сообщение авторства канала/группы — рисуется
  // входящим от имени send-as личности (как автофорвард поста канала), даже если
  // реальный отправитель — я. Реальный senderId в бабле не показываем.
  const out = meId != null && m.senderId === meId && !m.sendAs
  // Voice messages get their own bubble; service events render as a centered
  // pill (no sender/ticks); other media render via the generic media bubble
  // (keyed off mediaId), so everything else maps to 'text'.
  // Секретное медиа приходит с проводным type:'encrypted' — вид ('photo'|'video'|
  // 'document'|'audio') лежит в расшифрованном secretMedia.mediaType. Он и решает
  // ветку рендера (SecretMediaBubble рисуется вместо RealMediaBubble по m.secretMedia).
  const secretType = m.secretMedia?.mediaType
  const convType =
    m.type === 'voice' ? 'voice'
    : m.type === 'roundVideo' ? 'roundVideo'
    : m.type === 'call' ? 'call'
    : m.type === 'poll' ? 'poll'
    : m.type === 'checklist' ? 'checklist'
    : m.type === 'giveaway' ? 'giveaway'
    : m.type === 'geo' ? 'geo'
    : m.type === 'contact' ? 'contact'
    : m.type === 'gift' ? 'gift'
    : m.type === 'sticker' ? 'sticker'
    : m.type === 'service' ? 'service'
    : secretType === 'photo' || secretType === 'video' || secretType === 'document' || secretType === 'audio' ? secretType
    : m.type === 'photo' || m.type === 'video' || m.type === 'document' || m.type === 'audio' ? m.type
    : 'text'
  // Предложение фото профиля (service-сообщение suggest_photo): распарсиваем
  // action, чтобы показать у получателя кнопку «Установить фото».
  let photoSuggestion: { accepted: boolean } | undefined
  if (convType === 'service' && m.text.startsWith('{')) {
    try {
      const a = JSON.parse(m.text) as { action?: string; accepted?: boolean }
      if (a.action === 'suggest_photo') photoSuggestion = { accepted: !!a.accepted }
    } catch {
      /* не suggest_photo — обычная сервисная пилюля */
    }
  }
  return {
    id: m.id,
    chatId: m.chatId,
    clientId: m.clientId,
    type: convType,
    out,
    text: convType === 'service' ? serviceMsgText(m.text, out) : m.text,
    photoSuggestion,
    entities: m.entities,
    time: hhmm(m.createdAt),
    createdAt: m.createdAt,
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
    webPage: m.webPage,
    factCheck: m.factCheck,
    effect: m.effect,
    poll: m.poll,
    checklist: m.checklist,
    giveaway: m.giveaway,
    gift: m.gift,
    replyMarkup: m.replyMarkup,
    reactions: m.reactions,
    starReaction: m.starReaction,
    geo: m.geo,
    contact: m.contact,
    mediaId: m.mediaId ?? undefined,
    mediaWidth: m.mediaWidth,
    mediaHeight: m.mediaHeight,
    mediaMime: m.mediaMime,
    mediaBlur: m.mediaBlur,
    mediaHasThumb: m.mediaHasThumb,
    mediaDuration: m.mediaDuration,
    mediaSize: m.mediaSize,
    mediaName: m.mediaName,
    paidMedia: m.paidMedia,
    groupedId: m.groupedId ?? undefined,
    localUrl: m.localUrl,
    // Send-as: автор бабла — канал/группа (её title), клик-профиль отключаем
    // (senderId скрыт). Иначе — обычная логика имени участника группы.
    sender: m.sendAs ? m.sendAs.title : (!out && opts?.senderName ? opts.senderName : undefined),
    senderId: m.sendAs ? undefined : (!out ? m.senderId : undefined),
    edited: m.editedAt != null,
    views: m.views,
    forwards: m.forwards,
    mediaUnread: m.mediaUnread || undefined,
    deleted: m.deleted ?? false,
    forwardFrom: m.fwdFromUserId != null ? { name: opts?.forwardFromName ?? 'Неизвестно' } : undefined,
    // Секретное сообщение: флаг + таймер самоуничтожения (destructAt ставит сервер
    // после прочтения получателем; ttlSeconds — «взведённый» TTL до этого).
    secret: m.secret || undefined,
    secretMedia: m.secretMedia,
    ttlSeconds: m.ttlSeconds ?? undefined,
    destructAt: m.destructAt ?? undefined,
    reply: m.replyTo
      ? {
          name: m.replyTo.senderId === meId ? 'Вы' : opts?.replyToName ?? 'Сообщение',
          // Ответ с цитатой (reply quote): показываем выделенный фрагмент вместо
          // превью всего сообщения. Иначе — обычная логика:
          // медиа без подписи → метка типа, с подписью → текст подписи.
          text: m.replyTo.quoteText || m.replyTo.text || replyMediaLabel(m.replyTo.type),
          // entity-оффсеты заданы по полному тексту оригинала, для цитаты они не
          // совпадают → форматирование фрагмента опускаем.
          entities: m.replyTo.quoteText ? undefined : (m.replyTo.text ? m.replyTo.entities : undefined),
          seq: m.replyTo.seq,
          mediaId: m.replyTo.mediaId,
          mediaType: m.replyTo.type,
          quote: m.replyTo.quoteText ? true : undefined,
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
