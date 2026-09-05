import type { MessageEntity, MessageReactions } from './core/models'
import type { MessageMedia } from './core/media/messageMedia'
import type { MessageActionStarGift } from './core/messages/messageAction'

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
  createdAt?: string // абсолютное время создания (ISO) — для live-локации/отсчётов
  /** дата сообщения, СЕКУНДЫ эпохи (`message.date`) — ею считается «трансляция
   *  закончилась» (`date + period <= now`, порт tweb `isLiveExpired`) и дата
   *  подарка. Не производная от `createdAt`: у схемы это и есть исходное
   *  значение, а ISO — его представление. */
  date?: number
  /** время правки, СЕКУНДЫ эпохи (`message.edit_date`). У живой трансляции этим
   *  же полем едет время последнего обновления координат — своего времени у гео
   *  в схеме нет вовсе. */
  editDate?: number
  status?: MsgStatus
  edited?: boolean // shows the "изменено" marker before the time
  // сообщение закреплено в чате (Telegram message.pFlags.pinned): в кластере
  // времени первым идёт глиф pinnedchat_filled (tweb messageRender.ts:301-303)
  pinned?: boolean
  views?: number // channel-post view count ("9.2K 👁"); undefined for non-posts
  forwards?: number // channel-post forward count (Telegram message.forwards); undefined for non-posts
  /** Агрегат реакций — тот же конструктор, что на проводе (`messageReactions`).
   *  Платная ⭐-реакция ОТДЕЛЬНЫМ полем не живёт: она чип того же вектора
   *  (`reactionPaid`), а мой вклад звёздами — `top_reactors` с `pFlags.my`.
   *  Имя и фото реагировавшего чип берёт из зеркала пиров: в
   *  `recent_reactions` едет `Peer`, а не мини-карточка. */
  reactions?: MessageReactions
  mediaUnread?: boolean // голосовое/кружок не прослушано получателем (точка у обеих сторон)
  forwardFrom?: { name: string; color?: string } // "Переслано от X"
  // Предложение фото профиля (service-сообщение suggest_photo): у получателя под
  // превью — кнопка «Установить фото»; accepted скрывает её на всех устройствах.
  photoSuggestion?: { accepted: boolean }
  reply?: { name: string; text: string; entities?: MessageEntity[]; color?: string; seq?: number; mediaId?: number; mediaType?: string; quote?: boolean }
  /** кросс-чат ответ (tweb ReplyToAnotherChat): ключ ЧАТА оригинала. Готового
   *  снимка превью рядом больше нет: недоступный оригинал выражают
   *  `reply_to.reply_from`/`reply_media`, и `reply` строится уже из них. */
  replyToPeerId?: number
  // media (history read model — render the bubble fully, no per-media meta request)
  mediaId?: number
  /** Вложение ОДНИМ конструктором объединения `MessageMedia` — то же значение,
   *  что в `Message.media`, и это ВСЕ виды вложения: файл, гео, визитка, опрос,
   *  чек-лист, розыгрыш, карточка ссылки и платное медиа. Отдельных полей
   *  `geo`/`contact`/`poll`/`checklist`/`giveaway`/`webPage`/`paidMedia` рядом
   *  больше нет: они были копией того же значения, разложенной по восьми ключам.
   *  Бабл читает вложение так же, как врапперы tweb: `media._`, `doc.type`,
   *  `doc.w`/`doc.h`, `doc.attributes`, `photo.sizes`
   *  (см. `core/media/messageMedia.ts`). */
  media?: MessageMedia
  groupedId?: number // медиагруппа (Telegram grouped_id) — подряд идущие с одним id рендерятся одним грид-баблом
  localUrl?: string // object-URL локального файла — мгновенное превью исходящего медиа во время аплоада
  albumItems?: ConvMsg[] // собранные элементы альбома (только у сводного ConvMsg type 'album')
  /** ДЕЙСТВИЕ подарка (type 'gift'). Подарок — служебное сообщение, а не вид
   *  вложения: конструктора `messageMediaStarGift` в схеме нет вовсе. Здесь
   *  лежит ссылка на само действие, а не его пересборка. */
  gift?: MessageActionStarGift
  replyMarkup?: import('./core/markup/replyMarkup').ReplyMarkup // клавиатура сообщения бота (TL-объединение ReplyMarkup)
  // «проверка фактов» (Telegram factCheck): блок в бабле (текст + сущности + опц. страна)
  factCheck?: import('./core/models').FactCheck
  // расшифровка голосового/видео-кружка (Telegram transcribeAudio) — текст под баблом
  transcription?: string
  /** лог 1:1 звонка (tweb messageActionPhoneCall): исход + длительность */
  call?: CallLog
  /** секретное сообщение (E2E) — включает таймер самоуничтожения в бабле */
  secret?: boolean
  /** E2E-медиа секретного чата — рисуется отдельной веткой (fetch+decrypt) */
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
  /** дата последнего сообщения (или черновика) — СЕКУНДЫ эпохи, как на проводе.
   *  Именно ТАЙМСТАМП, а не готовая подпись: подпись строит место рендера
   *  (`ChatListItem` → `formatDateAccordingToTodayNew`, порт tweb
   *  `appDialogsManager.ts:2242`), потому что живой узел `IntlDateElement`
   *  переписывает себя на смену языка сам. Строка, отформатированная здесь,
   *  застывала бы в языке момента проекции. `undefined` — ни сообщения, ни
   *  черновика: у оригинала это `lastTimeSpan.replaceChildren()` (:2064). */
  date?: number
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
}
