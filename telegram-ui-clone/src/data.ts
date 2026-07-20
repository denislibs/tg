import type { MessageEntity, GeoData } from './core/models'

export type ChatType = 'private' | 'group' | 'channel' | 'bot' | 'saved' | 'secret'
// sending → часики до message_ack; error → красный значок (send отвергнут/упал),
// как tweb sendingStatus.ts (sending / check / checks / sendingerror).
export type MsgStatus = 'sending' | 'sent' | 'read' | 'error'

export interface MediaItem {
  gradient: string
  emoji?: string
}

export interface ConvMsg {
  id?: number // stable backend message id (real chats) — used as the React key
  chatId?: number // backend chat id — for bot-callback (inline keyboard)
  clientId?: string // optimistic client id; a stable key that survives the ack
  type:
    | 'date'
    | 'service'
    | 'text'
    | 'sticker'
    | 'voice'
    | 'photo'
    | 'video'
    | 'album'
    | 'document'
    | 'audio'
    | 'roundVideo'
    | 'call'
    | 'poll'
    | 'geo'
    | 'contact'
    | 'gift'
  out?: boolean
  sender?: string
  senderId?: number // backend user id of the sender (real group chats) — for "open chat"
  senderColor?: string
  text?: string // also used as media caption
  entities?: MessageEntity[] // rich-text formatting spans over `text`
  emoji?: string
  time?: string
  createdAt?: string // абсолютное время создания (ISO) — для live-локации/отсчётов
  status?: MsgStatus
  edited?: boolean // shows the "изменено" marker before the time
  views?: number // channel-post view count ("9.2K 👁"); undefined for non-posts
  reactions?: { emoji: string; count: number; mine: boolean }[] // чипы реакций под сообщением
  geo?: GeoData // гео-точка (type 'geo') + venue/live location
  contact?: { userId: number; name: string; phone: string } // контакт (type 'contact')
  mediaUnread?: boolean // голосовое/кружок не прослушано получателем (точка у обеих сторон)
  deleted?: boolean
  forwardFrom?: { name: string; color?: string } // "Переслано от X"
  reply?: { name: string; text: string; entities?: MessageEntity[]; color?: string; seq?: number; mediaId?: number; mediaType?: string }
  duration?: string // voice message length, e.g. "0:14"
  waveform?: number[] // voice waveform bar heights (0..1)
  // media (history read model — render the bubble fully, no per-media meta request)
  mediaId?: number
  mediaWidth?: number // real media dims → reserve box, no shift
  mediaHeight?: number
  mediaMime?: string
  mediaBlur?: string // base64 blur preview (LQIP placeholder)
  mediaHasThumb?: boolean
  mediaDuration?: number
  mediaSize?: number
  mediaName?: string
  media?: MediaItem // single photo/video placeholder
  album?: MediaItem[] // album grid (2–10)
  groupedId?: string // медиагруппа (Telegram grouped_id) — подряд идущие с одним id рендерятся одним грид-баблом
  localUrl?: string // object-URL локального файла — мгновенное превью исходящего медиа во время аплоада
  albumItems?: ConvMsg[] // собранные элементы альбома (только у сводного ConvMsg type 'album')
  poll?: import('./core/models').Poll // опрос (type 'poll')
  gift?: import('./core/managers/starsManager').GiftInfo // подарок (type 'gift')
  replyMarkup?: import('./core/managers/botsManager').ReplyMarkup // inline-клавиатура сообщения бота
  videoDuration?: string // overlay on video / round video
  // document
  document?: { name: string; size: string; ext: string; color: string }
  // audio / music
  audio?: { title: string; artist: string; duration: string }
  // link preview attached to a text message
  webPage?: { siteName: string; title: string; description?: string; gradient?: string; emoji?: string }
  /** лог 1:1 звонка (tweb messageActionPhoneCall): исход + длительность */
  call?: CallLog
  /** секретное сообщение (E2E) — включает таймер самоуничтожения в бабле */
  secret?: boolean
  /** self-destruct: TTL после прочтения (сек) + абсолютный дедлайн (ISO) */
  ttlSeconds?: number | null
  destructAt?: string | null
}

export interface CallLog {
  video: boolean
  reason: 'ok' | 'missed' | 'busy' | 'cancelled'
  duration?: number // секунды; есть только у состоявшегося (ok)
}

// A minimal peer identity used to open a private chat from a click (member row,
// group sender, search result) before any dialog exists.
export interface OpenPeer {
  id: number
  displayName: string
  username?: string | null
  avatarUrl?: string
  /** открыть существующий чат по id (группа/канал-источник в «Избранном») */
  chatId?: number
}

export interface Chat {
  id: string
  name: string
  avatar: string
  avatarText?: string
  avatarEmoji?: string
  avatarUrl?: string // resolved/stored peer avatar (real chats)
  peerId?: number // private-chat peer's user id (for presence/last-seen)
  date: string
  preview: string
  verified?: boolean
  muted?: boolean
  pinned?: boolean // закреплён вверху списка
  archived?: boolean // убран в «Архив»
  isForum?: boolean // темы (форум-группа): вместо ленты — список топиков
  autoDeletePeriod?: number // период автоудаления сообщений (сек, 0/undefined — выкл)
  selected?: boolean
  unread?: number
  sent?: boolean // last message is mine (show a tick in the list)
  read?: boolean // ...and the peer has read it (✓✓ instead of ✓)
  previewMediaId?: number // last message is a photo → small thumbnail before the preview
  forwarded?: boolean // last message was forwarded → show a forward arrow before the preview
  draftPreview?: string // облачный черновик → красный «Черновик: » вместо последнего сообщения
  type: ChatType
  owned?: boolean
  status?: string // header subtitle: "last seen recently" / "12 345 members" / "4 566 subscribers"
  online?: boolean // private chats: show the green online dot
  username?: string
  description?: string
  links?: { label: string; value: string }[]
}
