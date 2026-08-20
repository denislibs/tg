import type { MessageEntity, GeoData } from './core/models'
import type { MessageMedia } from './core/media/messageMedia'

export type ChatType = 'private' | 'group' | 'channel' | 'bot' | 'saved' | 'secret'
// sending → часики до message_ack; error → красный значок (send отвергнут/упал),
// как tweb sendingStatus.ts (sending / check / checks / sendingerror).
export type MsgStatus = 'sending' | 'sent' | 'read' | 'error'

export interface ConvMsg {
  id?: number // stable backend message id (real chats) — used as the React key
  peerId?: number // backend chat id — for bot-callback (inline keyboard)
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
    | 'checklist'
    | 'geo'
    | 'contact'
    | 'gift'
    | 'giveaway'
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
  // сообщение закреплено в чате (Telegram message.pFlags.pinned): в кластере
  // времени первым идёт глиф pinnedchat_filled (tweb messageRender.ts:301-303)
  pinned?: boolean
  views?: number // channel-post view count ("9.2K 👁"); undefined for non-posts
  forwards?: number // channel-post forward count (Telegram message.forwards); undefined for non-posts
  // чипы реакций под сообщением; recent — КЛЮЧИ последних реагировавших
  // (бэк отдаёт их только когда список доступен — tweb reactions.can_see_list).
  // Имя и фото чип берёт из зеркала пиров: на проводе едет вектор `Peer`, а не
  // мини-карточка (см. `core/models.ts::ReactionCount`).
  reactions?: { emoji: string; count: number; mine: boolean; recent?: PeerId[] }[]
  starReaction?: { total: number; mine: number } // платная ⭐-реакция (сумма звёзд + вклад зрителя)
  geo?: GeoData // гео-точка (type 'geo') + venue/live location
  contact?: { userId: number; name: string; phone: string } // контакт (type 'contact')
  mediaUnread?: boolean // голосовое/кружок не прослушано получателем (точка у обеих сторон)
  deleted?: boolean
  forwardFrom?: { name: string; color?: string } // "Переслано от X"
  // Предложение фото профиля (service-сообщение suggest_photo): у получателя под
  // превью — кнопка «Установить фото»; accepted скрывает её на всех устройствах.
  photoSuggestion?: { accepted: boolean }
  reply?: { name: string; text: string; entities?: MessageEntity[]; color?: string; seq?: number; mediaId?: number; mediaType?: string; quote?: boolean }
  /** кросс-чат ответ (tweb ReplyToAnotherChat): id исходного чата оригинала +
   * готовый снимок превью. При наличии replyToPeerId `reply` строится из снимка. */
  replyToPeerId?: number
  replySnapshotName?: string
  replySnapshotText?: string
  // media (history read model — render the bubble fully, no per-media meta request)
  mediaId?: number
  // платное медиа (Telegram paid media): цена в звёздах + заблокировано ли для зрителя
  paidMedia?: { price: number; locked: boolean }
  /** Вложение в форме оригинала (`messageMediaPhoto`/`messageMediaDocument`) —
   *  то же значение, что в `Message.media`. Бабл читает его так же, как врапперы
   *  tweb: `doc.type`, `doc.w`/`doc.h`, `doc.attributes`, `photo.sizes`
   *  (см. `core/media/messageMedia.ts`). */
  media?: MessageMedia
  groupedId?: string // медиагруппа (Telegram grouped_id) — подряд идущие с одним id рендерятся одним грид-баблом
  localUrl?: string // object-URL локального файла — мгновенное превью исходящего медиа во время аплоада
  albumItems?: ConvMsg[] // собранные элементы альбома (только у сводного ConvMsg type 'album')
  poll?: import('./core/models').Poll // опрос (type 'poll')
  checklist?: import('./core/models').Checklist // чек-лист (type 'checklist')
  giveaway?: import('./core/models').Giveaway // розыгрыш (type 'giveaway')
  gift?: import('./core/managers/starsManager').GiftInfo // подарок (type 'gift')
  replyMarkup?: import('./core/markup/replyMarkup').ReplyMarkup // клавиатура сообщения бота (TL-объединение ReplyMarkup)
  // карточка превью ссылки под текстовым сообщением (сервер собирает её из
  // og-тегов; картинка — наше медиа, см. WebPageData)
  webPage?: import('./core/models').WebPageData
  // «проверка фактов» (Telegram factCheck): блок в бабле (текст + сущности + опц. страна)
  factCheck?: import('./core/models').FactCheck
  // расшифровка голосового/видео-кружка (Telegram transcribeAudio) — текст под баблом
  transcription?: string
  /** лог 1:1 звонка (tweb messageActionPhoneCall): исход + длительность */
  call?: CallLog
  /** секретное сообщение (E2E) — включает таймер самоуничтожения в бабле */
  secret?: boolean
  /** E2E-медиа секретного чата — рендерится через SecretMediaBubble (fetch+decrypt) */
  secretMedia?: import('./core/models').SecretMedia
  /** self-destruct: TTL после прочтения (сек) + абсолютный дедлайн (ISO) */
  ttlSeconds?: number | null
  destructAt?: string | null
  /** вид полноэкранного эффекта сообщения (наш аналог Telegram message effects) */
  effect?: import('./core/effects/emojiEffects').EmojiEffectKind
}

export interface CallLog {
  video: boolean
  reason: 'ok' | 'missed' | 'busy' | 'cancelled'
  duration?: number // секунды; есть только у состоявшегося (ok)
}

// Минимальная личность пира, по клику на которую открывают диалог (строка
// участника, автор в группе, результат поиска) — ещё до того, как диалог
// существует. `id` здесь ЗНАКОВЫЙ ключ: открыть можно и человека, и
// группу/канал-источник, а различает их знак, а не второе поле рядом (прежняя
// пара `id` + `chatId` описывала это двумя числами).
export interface OpenPeer {
  id: PeerId
  /** имя собирает клиент (`core/peers/getPeerTitle.ts`) — `display_name` с
   *  провода убран; здесь лежит уже собранное. */
  title: string
  username?: string | null
  /** id медиа аватарки; 0/undefined — фото нет */
  photoId?: number
}

export interface Chat {
  /** знаковый ключ пира строкой (`String(peerId)`). Отдельного поля
   *  «собеседник приватного чата» рядом БОЛЬШЕ НЕТ: у приватного диалога ключ
   *  и есть id собеседника, прежняя пара `id` + `peerId` описывала одно и то
   *  же двумя числами. Число — `Number(chat.id)`. */
  id: string
  name: string
  avatar: string
  avatarText?: string
  avatarEmoji?: string
  /** id медиа аватарки — `user.photo.photo_id` / `chat.photo.photo_id`.
   *  Прежний `avatarUrl` был строкой `/media/N/content`, из которой этот же
   *  номер приходилось выпарсивать обратно регуляркой (`useAvatarSrc.ts:10-16`);
   *  теперь он приезжает готовым — ровно тем, чего ждёт `downloadMediaURL`.
   *  0/undefined — фото нет. */
  photoId?: number
  /** stripped-превью аватарки/фото чата (base64 JPEG, `photo.stripped_thumb`) */
  avatarPreview?: string
  isBot?: boolean // peer — бот: скрыть звонок, не давать секрет/группу/контакт
  date: string
  preview: string
  verified?: boolean
  premium?: boolean // Telegram Premium subscriber → gold star badge next to the name
  emojiStatus?: string // unicode emoji shown after the name (undefined when unset)
  muted?: boolean
  pinned?: boolean // закреплён вверху списка
  archived?: boolean // убран в «Архив»
  isForum?: boolean // темы (форум-группа): вместо ленты — список топиков
  autoDeletePeriod?: number // период автоудаления сообщений (сек, 0/undefined — выкл)
  selected?: boolean
  unread?: number
  unreadMentions?: number // непрочитанные упоминания → отдельный бейдж «@»
  unreadReactions?: number // непрочитанные реакции → отдельный бейдж-сердце
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
