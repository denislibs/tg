// src/core/models.ts
import { mapGiftInfo, type RawGiftInfo, type GiftInfo } from './managers/starsManager'
import { mapReplyMarkup, type ReplyMarkup } from './managers/botsManager'
import type { EmojiEffectKind } from './effects/emojiEffects'

export type ChatKind = 'private' | 'group' | 'channel' | 'saved'

// A rich-text formatting span over a message's text (Telegram MessageEntity model).
// `offset`/`length` are UTF-16 code units (plain JS string indices), so the same
// numbers slice the text identically here and on the backend. `url` is set only
// for 'text_link'. The set mirrors what the composer can produce.
export type EntityType =
  | 'bold' | 'italic' | 'underline' | 'strikethrough'
  | 'code' | 'pre' | 'spoiler' | 'blockquote' | 'text_link' | 'text_mention' | 'custom_emoji'
export interface MessageEntity {
  type: EntityType
  offset: number
  length: number
  url?: string
  language?: string
  /** target user for 'text_mention' (упоминание юзера без username) */
  user_id?: number
  /** sticker-document (media id) that replaces the spanned fallback glyph for
   * 'custom_emoji' (Telegram messageEntityCustomEmoji.document_id) */
  document_id?: number
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
  theme_id?: string
  chat_id: number
  type: ChatKind
  last_read_seq: number
  peer_read_seq?: number
  unread: number
  unread_mentions_count?: number
  unread_reactions?: number
  muted?: boolean
  pinned?: boolean
  archived?: boolean
  is_forum?: boolean
  notify_preview?: boolean
  notify_sound?: string
  title?: string
  username?: string
  photo_url?: string
  peer?: { id: number; display_name: string; avatar_url: string; verified?: boolean; premium?: boolean; emoji_status?: string }
  last_message?: { seq: number; text: string; sender_id: number; at: string; media_id?: number; type?: string; forwarded?: boolean; sender_name?: string }
}

export interface Dialog {
  chatId: number
  type: ChatKind
  lastReadSeq: number
  /** the OTHER side's read horizon (read_outbox) — outgoing seq <= this ⇒ ✓✓ */
  peerReadSeq: number
  unread: number
  /** непрочитанные упоминания зрителя (Telegram unread_mentions_count) — бейдж «@» */
  unreadMentions?: number
  /** непрочитанные реакции на сообщения зрителя (Telegram unread_reactions_count) — бейдж-сердце */
  unreadReactions?: number
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
  // id темы оформления чата (пресет chatThemes.ts); ''/undefined — тема не задана
  themeId?: string
  title?: string
  username?: string
  /** фото группы/канала (content-путь /media/N/content; у private — peer.avatarUrl) */
  photoUrl?: string
  peer?: { id: number; displayName: string; avatarUrl: string; verified?: boolean; premium?: boolean; emojiStatus?: string }
  lastMessage?: { seq: number; text: string; senderId: number; at: string; mediaId?: number; mediaType?: string; forwarded?: boolean; senderName?: string }
}

// Серверное превью ссылки (Telegram webPage): снимок og-тегов первой ссылки
// текстового сообщения. Приходит с историей (web_page) или догоняющим
// realtime-кадром web_page_update (превью строится после отправки).
export interface RawWebPage {
  url?: string
  site_name?: string
  title?: string
  description?: string
  image_url?: string
}

export interface WebPageData {
  url?: string
  siteName: string
  title: string
  description?: string
  imageUrl?: string
}

export function mapWebPage(w: RawWebPage): WebPageData {
  return {
    url: w.url || undefined,
    siteName: w.site_name ?? '',
    title: w.title ?? '',
    description: w.description || undefined,
    imageUrl: w.image_url || undefined,
  }
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
  reply_to?: { msg_id: number; seq: number; sender_id: number; text: string; entities?: MessageEntity[] | null; type: string; media_id?: number; quote_text?: string } | null
  poll_id?: number | null
  poll?: RawPoll | null
  checklist_id?: number | null
  checklist?: RawChecklist | null
  giveaway_id?: number | null
  giveaway?: RawGiveaway | null
  media_w?: number
  media_h?: number
  media_mime?: string
  media_blur?: string
  media_has_thumb?: boolean
  media_duration?: number
  media_size?: number
  media_name?: string
  views?: number
  forwards?: number
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
  web_page?: RawWebPage | null
  /** вид эффекта сообщения (наш аналог Telegram message effects) */
  effect?: string | null
  /** платное медиа (Telegram paid media): цена в звёздах + заблокировано ли для
   * зрителя. У заблокированного media_id отсутствует — только blur/размеры/цена. */
  paid_media?: { price: number; locked: boolean } | null
  /** платная ⭐-реакция (Telegram paid/star reactions): суммарно потрачено звёзд
   * (total) и личный вклад зрителя (mine). Отсутствует — платных реакций нет. */
  star_reaction?: { total: number; mine?: number } | null
  /** «проверка фактов» (Telegram factCheck): текст + сущности + опц. страна ISO2 */
  factcheck?: RawFactCheck | null
  /** send-as (Telegram send_as): отображаемый автор (канал/группа) вместо
   * sender_id, который остаётся реальным. Отсутствует — обычная отправка. */
  send_as?: { chat_id: number; title?: string; photo_id?: number } | null
}

// «Проверка фактов» (Telegram factCheck): пояснение автора/админа канала к посту.
export interface RawFactCheck {
  text: string
  entities?: MessageEntity[] | null
  country?: string
}

export interface FactCheck {
  text: string
  entities?: MessageEntity[]
  country?: string
}

export function mapFactCheck(f: RawFactCheck): FactCheck {
  return {
    text: f.text ?? '',
    entities: f.entities ?? undefined,
    country: f.country || undefined,
  }
}

// Агрегат одной реакции на сообщении (emoji + счётчик + «моя»), tweb ReactionCount.
export interface ReactionCount {
  emoji: string
  count: number
  mine: boolean
}

// E2E-медиа секретного чата. Файл шифруется своим AES-ключом; ciphertext лежит на
// сервере как непрозрачный blob (media_id), а keyB64/ivB64 приезжают ВНУТРИ
// зашифрованного payload сообщения. Заполняется только клиентской расшифровкой —
// сервер никогда не отдаёт эти поля (см. RawMessage: их там нет).
export interface SecretMedia {
  mediaId: number
  keyB64: string
  ivB64: string
  name: string
  mime: string
  size: number
  /** вид медиа приложения ('photo'|'video'|'document') — как у обычной отправки */
  mediaType: string
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
  replyTo?: { msgId: number; seq: number; senderId: number; text: string; entities?: MessageEntity[]; type: string; mediaId?: number; quoteText?: string } | null
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
  /** number of times a channel post was forwarded (Telegram message.forwards) */
  forwards?: number
  /** голосовое/кружок ещё не прослушано получателем (Telegram media_unread) */
  mediaUnread?: boolean
  /** опрос сообщения типа 'poll' (представление для зрителя) */
  poll?: Poll
  /** чек-лист сообщения типа 'checklist' (представление для зрителя) */
  checklist?: Checklist
  /** розыгрыш сообщения типа 'giveaway' (представление для зрителя) */
  giveaway?: Giveaway
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
  /** E2E-медиа секретного чата (расшифровывается на просмотре из mediaId+key+iv).
   * Инжектится клиентской расшифровкой (worker/bridge/history) — НЕ проводное поле. */
  secretMedia?: SecretMedia
  /** серверное превью первой ссылки текстового сообщения (Telegram webPage) */
  webPage?: WebPageData
  /** «проверка фактов» на сообщении (Telegram factCheck) — блок в бабле */
  factCheck?: FactCheck
  /** вид полноэкранного эффекта сообщения (наш аналог Telegram message effects) */
  effect?: EmojiEffectKind
  /** платное медиа (Telegram paid media): цена в звёздах + заблокировано ли для
   * зрителя. Заблокированное — без mediaId (только blur/размеры), раскрывается
   * после разблокировки за Stars. */
  paidMedia?: { price: number; locked: boolean }
  /** платная ⭐-реакция (Telegram paid/star reactions): суммарно потрачено звёзд
   * на сообщение (total) + личный вклад зрителя (mine). undefined — реакций нет. */
  starReaction?: { total: number; mine: number }
  /** send-as (Telegram send_as): отображаемый автор (канал/группа) — бабл
   * рисуется от его имени; senderId остаётся реальным. undefined — обычная. */
  sendAs?: { chatId: number; title: string; photoId?: number }
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

// Чек-лист (backend ChecklistInfo): заголовок + пункты с отметками «выполнено».
export interface RawChecklistItem {
  id: number
  text: string
  marked_by: number[] // user id, отметившие пункт выполненным
}

export interface RawChecklist {
  id: number
  title: string
  items: RawChecklistItem[]
  others_can_add: boolean
  others_can_mark: boolean
}

export interface ChecklistItem {
  id: number
  text: string
  markedBy: number[]
}

export interface Checklist {
  id: number
  title: string
  items: ChecklistItem[]
  othersCanAdd: boolean
  othersCanMark: boolean
}

export function mapChecklist(r: RawChecklist): Checklist {
  return {
    id: r.id,
    title: r.title,
    items: (r.items ?? []).map((it) => ({ id: it.id, text: it.text, markedBy: it.marked_by ?? [] })),
    othersCanAdd: !!r.others_can_add,
    othersCanMark: !!r.others_can_mark,
  }
}

// Розыгрыш (backend GiveawayInfo): приз + победители + участие зрителя.
export interface RawGiveaway {
  id: number
  chat_id: number
  prize_kind: 'premium' | 'stars'
  months: number
  stars: number
  winners_count: number
  until_date: number // unix millis
  status: 'active' | 'finished'
  participants: number
  participating: boolean
  winner_ids?: number[] | null
  i_won: boolean
}

export interface Giveaway {
  id: number
  chatId: number
  prizeKind: 'premium' | 'stars'
  months: number
  stars: number
  winnersCount: number
  untilDate: number
  status: 'active' | 'finished'
  participants: number
  participating: boolean
  winnerIds: number[]
  iWon: boolean
}

export function mapGiveaway(r: RawGiveaway): Giveaway {
  return {
    id: r.id,
    chatId: r.chat_id,
    prizeKind: r.prize_kind,
    months: r.months ?? 0,
    stars: r.stars ?? 0,
    winnersCount: r.winners_count ?? 0,
    untilDate: r.until_date ?? 0,
    status: r.status,
    participants: r.participants ?? 0,
    participating: !!r.participating,
    winnerIds: r.winner_ids ?? [],
    iWon: !!r.i_won,
  }
}

// Состояние бустов канала (backend BoostStatus).
export interface RawBoostStatus {
  level: number
  boosts_count: number
  current_level_boosts: number
  next_level_boosts: number
  boosted_by_me: boolean
  slots: number
}

export interface BoostStatus {
  level: number
  boostsCount: number
  currentLevelBoosts: number
  nextLevelBoosts: number
  boostedByMe: boolean
  slots: number
}

export function mapBoostStatus(r: RawBoostStatus): BoostStatus {
  return {
    level: r.level ?? 0,
    boostsCount: r.boosts_count ?? 0,
    currentLevelBoosts: r.current_level_boosts ?? 0,
    nextLevelBoosts: r.next_level_boosts ?? 0,
    boostedByMe: !!r.boosted_by_me,
    slots: r.slots ?? 0,
  }
}

// boostProgress — доля заполнения полосы текущего уровня [0..1] и сколько бустов
// осталось до следующего уровня (порог tweb: (boosts-current)/(next-current)).
export function boostProgress(s: Pick<BoostStatus, 'boostsCount' | 'currentLevelBoosts' | 'nextLevelBoosts'>): {
  progress: number
  need: number
} {
  const span = s.nextLevelBoosts - s.currentLevelBoosts
  const progress = span > 0 ? Math.min(Math.max((s.boostsCount - s.currentLevelBoosts) / span, 0), 1) : 1
  return { progress, need: Math.max(s.nextLevelBoosts - s.boostsCount, 0) }
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

// Предложенный в канал пост (backend suggested_posts): статус pending|approved|
// rejected; publishAt/createdAt/decidedAt — unix-миллисекунды (0 — нет значения).
export type SuggestedPostStatus = 'pending' | 'approved' | 'rejected'

export interface RawSuggestedPost {
  id: number
  chat_id: number
  author_id: number
  author_name?: string
  text: string
  entities?: MessageEntity[] | null
  media_id?: number | null
  publish_at?: number
  status: SuggestedPostStatus
  created_at: number
  decided_by?: number
  decided_at?: number
}

export interface SuggestedPost {
  id: number
  chatId: number
  authorId: number
  authorName?: string
  text: string
  entities?: MessageEntity[]
  mediaId?: number | null
  publishAt?: number
  status: SuggestedPostStatus
  createdAt: number
  decidedBy?: number
  decidedAt?: number
}

export function mapSuggestedPost(r: RawSuggestedPost): SuggestedPost {
  return {
    id: r.id,
    chatId: r.chat_id,
    authorId: r.author_id,
    authorName: r.author_name || undefined,
    text: r.text,
    entities: r.entities?.length ? r.entities : undefined,
    mediaId: r.media_id && r.media_id > 0 ? r.media_id : undefined,
    publishAt: r.publish_at || undefined,
    status: r.status,
    createdAt: r.created_at,
    decidedBy: r.decided_by || undefined,
    decidedAt: r.decided_at || undefined,
  }
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
  entities?: MessageEntity[]
  replyToId: number | null
  updatedAt: string
}

export function mapDraft(r: RawDraft): Draft {
  return {
    chatId: r.chat_id,
    text: r.text,
    entities: r.entities?.length ? r.entities : undefined,
    replyToId: r.reply_to_id ?? null,
    updatedAt: r.updated_at,
  }
}

export function mapDialog(r: RawDialog): Dialog {
  return {
    chatId: r.chat_id,
    type: r.type,
    lastReadSeq: r.last_read_seq,
    peerReadSeq: r.peer_read_seq ?? 0,
    unread: r.unread,
    unreadMentions: r.unread_mentions_count || undefined,
    unreadReactions: r.unread_reactions || undefined,
    muted: !!r.muted,
    pinned: !!r.pinned,
    archived: !!r.archived,
    isForum: r.is_forum || undefined,
    notifyPreview: r.notify_preview ?? true,
    notifySound: r.notify_sound ?? 'default',
    autoDeletePeriod: r.auto_delete_period ?? 0,
    themeId: r.theme_id || undefined,
    title: r.title,
    username: r.username,
    photoUrl: r.photo_url || undefined,
    peer: r.peer
      ? { id: r.peer.id, displayName: r.peer.display_name, avatarUrl: r.peer.avatar_url, verified: r.peer.verified, premium: r.peer.premium, emojiStatus: r.peer.emoji_status }
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

// Валидные виды эффектов сообщения (бэк уже санитизирует по whitelist; здесь —
// страховка типобезопасности при маппинге проводного значения в union-тип).
const EFFECT_KINDS = new Set<EmojiEffectKind>(['fireworks', 'confetti', 'hearts', 'thumbs', 'poop', 'cake'])
export function mapEffect(e?: string | null): EmojiEffectKind | undefined {
  return e && EFFECT_KINDS.has(e as EmojiEffectKind) ? (e as EmojiEffectKind) : undefined
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
    checklist: r.checklist ? mapChecklist(r.checklist) : undefined,
    giveaway: r.giveaway ? mapGiveaway(r.giveaway) : undefined,
    editedAt: r.edited_at ?? null,
    deleted: r.deleted ?? false,
    fwdFromUserId: r.fwd_from_user_id ?? null,
    fwdFromChatId: r.fwd_from_chat_id ?? null,
    fwdFromMsgId: r.fwd_from_msg_id ?? null,
    fwdDate: r.fwd_date ?? null,
    replyTo: r.reply_to
      ? { msgId: r.reply_to.msg_id, seq: r.reply_to.seq, senderId: r.reply_to.sender_id, text: r.reply_to.text, entities: r.reply_to.entities ?? undefined, type: r.reply_to.type, mediaId: r.reply_to.media_id && r.reply_to.media_id > 0 ? r.reply_to.media_id : undefined, quoteText: r.reply_to.quote_text || undefined }
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
    forwards: r.forwards,
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
    webPage: r.web_page ? mapWebPage(r.web_page) : undefined,
    factCheck: r.factcheck ? mapFactCheck(r.factcheck) : undefined,
    effect: mapEffect(r.effect),
    paidMedia: r.paid_media ? { price: r.paid_media.price, locked: r.paid_media.locked } : undefined,
    starReaction: r.star_reaction ? { total: r.star_reaction.total, mine: r.star_reaction.mine ?? 0 } : undefined,
    sendAs: r.send_as ? { chatId: r.send_as.chat_id, title: r.send_as.title ?? '', photoId: r.send_as.photo_id } : undefined,
  }
}
