// src/core/dialogToChat.ts
import type { Chat } from '../data'
import type { Dialog, Draft } from './models'
import { serviceMsgText } from './serviceMsg'

export const GRADIENTS = [
  'linear-gradient(135deg,#42e695,#3bb2b8)',
  'linear-gradient(135deg,#f7971e,#ffd200)',
  'linear-gradient(135deg,#6a11cb,#2575fc)',
  'linear-gradient(135deg,#ff5f6d,#ffc371)',
  'linear-gradient(135deg,#5b86e5,#36d1dc)',
  'linear-gradient(135deg,#f857a6,#ff5858)',
  'linear-gradient(135deg,#9a7ff0,#6f8df5)',
  'linear-gradient(135deg,#11998e,#38ef7d)',
]

export function gradientFor(id: number): string {
  return GRADIENTS[Math.abs(id) % GRADIENTS.length]
}

// Reserved id of the official "Telegram" service account (mirrors the backend's
// domain.ServiceUserID). Rendered with the Telegram-plane avatar, not initials.
export const SERVICE_USER_ID = 777000
const SERVICE_GRADIENT = 'linear-gradient(135deg,#54a9eb,#2a82d6)'

export function fmtWhen(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}

// A human label for a media message with no caption (tweb shows these in grey).
export function mediaLabel(type?: string): string {
  switch (type) {
    case 'photo': return 'Фото'
    case 'video': return 'Видео'
    case 'roundVideo': return 'Видеосообщение'
    case 'voice': return 'Голосовое сообщение'
    case 'audio': return 'Аудио'
    case 'document': return 'Файл'
    case 'sticker': return 'Стикер'
    case 'call': return 'Звонок'
    default: return ''
  }
}

export function dialogToChat(d: Dialog, meId?: number | null, draft?: Draft): Chat {
  const isSaved = d.type === 'saved'
  const isService = d.peer?.id === SERVICE_USER_ID
  const name = isSaved
    ? 'Избранное'
    : d.peer?.displayName?.trim() || d.title?.trim() || `Chat ${d.chatId}`
  const lm = d.lastMessage
  // Sidebar tick: only when the LAST message is mine and it's not a broadcast
  // channel. ✓✓ once the peer's read horizon (peerReadSeq) reaches its seq.
  const lastMine = lm != null && meId != null && lm.senderId === meId && d.type !== 'channel'
  // Preview text = caption, or a grey type label for caption-less media; prefix
  // "Вы: " for my own last message (tweb-style), the sender's first name for
  // someone else's message in a group. Service pills show their text without
  // any prefix. У лога звонка text — служебный JSON, в превью всегда идёт лейбл.
  const isServiceMsg = lm?.mediaType === 'service'
  let preview = lm
    ? isServiceMsg
      ? serviceMsgText(lm.text)
      : lm.mediaType === 'call' ? mediaLabel('call') : lm.text || mediaLabel(lm.mediaType)
    : ''
  // Forwarded last message: a forward arrow stands in front (no "Вы:" prefix, like
  // Telegram) — the arrow itself signals it wasn't authored here.
  const forwarded = !!lm?.forwarded
  if (preview && !forwarded && !isServiceMsg) {
    if (lastMine) preview = `Вы: ${preview}`
    else if (d.type === 'group' && lm?.senderName) preview = `${lm.senderName}: ${preview}`
  }
  // Черновик заменяет превью последнего сообщения (tweb getLastMessageForDialog:
  // красный «Черновик: » + текст; тики/стрелка пересылки не показываются).
  const hasDraft = !!draft?.text.trim()
  return {
    id: String(d.chatId),
    name,
    // Saved Messages: blue gradient + bookmark icon. Telegram service account:
    // blue gradient + the Telegram-plane logo. Otherwise the peer's photo or a
    // per-id gradient with initials.
    avatar: isSaved
      ? 'linear-gradient(135deg,#4f9bff,#2575fc)'
      : isService
        ? SERVICE_GRADIENT
        : gradientFor(d.chatId),
    avatarText: name.charAt(0).toUpperCase() || '?',
    avatarEmoji: isSaved ? 'saved' : isService ? 'tg-logo' : undefined,
    avatarUrl: isSaved || isService ? undefined : d.peer?.avatarUrl || d.photoUrl || undefined,
    peerId: d.peer?.id,
    verified: d.peer?.verified || undefined,
    date: hasDraft && (!lm?.at || draft!.updatedAt > lm.at) ? fmtWhen(draft!.updatedAt) : fmtWhen(lm?.at),
    preview,
    draftPreview: hasDraft ? draft!.text : undefined,
    type: d.type,
    muted: d.muted || undefined,
    pinned: d.pinned || undefined,
    archived: d.archived || undefined,
    autoDeletePeriod: d.autoDeletePeriod || undefined,
    unread: d.unread > 0 ? d.unread : undefined,
    sent: (lastMine && !hasDraft) || undefined,
    read: lastMine && !hasDraft && lm!.seq <= d.peerReadSeq ? true : undefined,
    previewMediaId: !hasDraft && lm?.mediaType === 'photo' && lm.mediaId ? lm.mediaId : undefined,
    forwarded: (forwarded && !hasDraft) || undefined,
  }
}
