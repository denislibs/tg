// Пиры и чаты в форме оригинала (MTProto): объединения `User`, `Chat`,
// `UserStatus`, `UserProfilePhoto`, `ChatPhoto` схемы с дискриминатором `_`.
//
// Зеркало `backend/internal/domain/mtpeer.go` и `mtchat.go` (шаги A–C) — то же
// самое с той стороны провода. Фаза 0 перехода на TL: имена конструкторов и
// полей взяты из схемы БУКВАЛЬНО (`schema/schema.json`), сериализация пока
// JSON; сверка со схемой механическая — `peer.schema.test.ts`.
//
// ── Зачем, если у нас уже были `Peer` и `User` ───────────────────────────────
// Прежние формы отвечали на вопросы, которые мы догадались задать:
//  • ПЯТЬ полей на одну аватарку (`avatar_url`, `avatar_preview`,
//    `photo_media_id`, `photo_url`, `photo_preview`), причём id медиа
//    приходилось выпарсивать РЕГУЛЯРКОЙ из собственной же строки
//    (`useAvatarSrc.ts:10-16` — `/media/(\d+)/content`). Здесь это одно поле
//    `photo: UserProfilePhoto` с готовым `photo_id`, то есть ровно тем, чего
//    ждёт воркерный `downloadMediaURL`;
//  • `online: true` без срока годности: потерянный кадр присутствия оставлял
//    человека онлайн НАВСЕГДА. У `userStatusOnline` есть `expires`, и клиент
//    гасит статус сам (порт `appUsersManager.ts:880-889`);
//  • ВИД ЧАТА строкой (`ChatKind = 'private'|'group'|'channel'|…`) и 84
//    инлайновых сравнения `type === '…'` в 25 файлах. В схеме это выбор
//    конструктора (`chat` против `channel`) плюс `pFlags`, а сравнения собраны
//    в предикаты — `core/peers/predicates.ts`.
//
// ── Правила фазы 0 (те же, что у медиа и разметки) ──────────────────────────
//  • у каждого объекта есть дискриминатор `_` со значением predicate схемы;
//  • поля `flags` в объекте НЕТ: битовая маска живёт только на проводе;
//  • булевы флаги схемы (`flags.N?true`) собраны в `pFlags` и всегда несут
//    литерал `true`; «выключено» — ОТСУТСТВИЕ ключа, не `false` и не `null`;
//  • `bytes` (`stripped_thumb`) на JSON-проводе фазы 0 едет base64-строкой —
//    ровно как `photoStrippedSize.bytes` у медиа и `keyboardButtonCallback.data`
//    у разметки. Из-за этого же тип из `@layer` здесь не годится напрямую, см.
//    докблок `peer.schema.test.ts`.

import type { MyPhoto } from '../media/messageMedia'
import { NULL_PEER_ID, toPeerId } from './peerId'

// ── UserProfilePhoto / ChatPhoto ────────────────────────────────────────────

/** userProfilePhotoEmpty#4f11bae1 = UserProfilePhoto; */
export interface UserProfilePhotoEmpty { _: 'userProfilePhotoEmpty' }

/** userProfilePhoto#82d1f706 flags:# has_video:flags.0?true personal:flags.2?true
 *  photo_id:long stripped_thumb:flags.1?bytes dc_id:int = UserProfilePhoto;
 *
 *  `dc_id` — реквизит транспорта MTProto, предмета не имеет (см. правило
 *  «чего НЕ копируем» в `docs/readiness/tl-program.md`). */
export interface UserProfilePhotoReal {
  _: 'userProfilePhoto'
  pFlags?: Partial<{ has_video: true; personal: true }>
  photo_id: number
  /** base64 JPEG-подложка (в схеме `bytes`) — та же, что `photoStrippedSize.bytes`. */
  stripped_thumb?: string
}

export type UserProfilePhoto = UserProfilePhotoEmpty | UserProfilePhotoReal

/** chatPhotoEmpty#37c1011c = ChatPhoto; */
export interface ChatPhotoEmpty { _: 'chatPhotoEmpty' }

/** chatPhoto#1c6e1c11 flags:# has_video:flags.0?true photo_id:long
 *  stripped_thumb:flags.1?bytes dc_id:int = ChatPhoto; */
export interface ChatPhotoReal {
  _: 'chatPhoto'
  pFlags?: Partial<{ has_video: true }>
  photo_id: number
  stripped_thumb?: string
}

export type ChatPhoto = ChatPhotoEmpty | ChatPhotoReal

/**
 * Единственный вопрос, который задают аватарке: «какое медиа скачивать».
 * Заменяет регулярку `/media/(\d+)/content` по собственной же строке — id
 * приезжает готовым. `0` — фото нет (`*PhotoEmpty` либо ключа не было вовсе).
 *
 * Порт `utils/peers/getPeerPhoto.ts` (там же он отсеивает `*Empty`).
 */
export function getPeerPhotoId(photo: UserProfilePhoto | ChatPhoto | undefined): number {
  return photo && photo._ !== 'userProfilePhotoEmpty' && photo._ !== 'chatPhotoEmpty' ? photo.photo_id : 0
}

/** stripped-подложка аватарки (base64 JPEG) или `''`. */
export function getPeerPhotoStrippedThumb(photo: UserProfilePhoto | ChatPhoto | undefined): string {
  return photo && photo._ !== 'userProfilePhotoEmpty' && photo._ !== 'chatPhotoEmpty'
    ? photo.stripped_thumb ?? ''
    : ''
}

// ── UserStatus ──────────────────────────────────────────────────────────────

/** userStatusEmpty#9d05049 = UserStatus; */
export interface UserStatusEmpty { _: 'userStatusEmpty' }
/** userStatusOnline#edb93949 expires:int = UserStatus;
 *
 *  `expires` — unix-секунды, ДЕДЛАЙН статуса (у нас это TTL ключа
 *  `presence:{id}` в Redis). Клиент обязан сам погасить онлайн по его
 *  наступлении — иначе потерянный кадр оставляет человека онлайн навсегда. */
export interface UserStatusOnline { _: 'userStatusOnline'; expires: number }
/** userStatusOffline#8c703f expires:int = UserStatus; (в схеме параметр зовётся
 *  `was_online`) */
export interface UserStatusOffline { _: 'userStatusOffline'; was_online: number }
/** userStatusRecently#7b197dc8 flags:# by_me:flags.0?true = UserStatus;
 *
 *  «Был(а) недавно» — это САМ КОНСТРУКТОР, а не флаг `last_seen_visible` рядом
 *  с обнулённым временем: правило приватности выражено выбором варианта. */
export interface UserStatusRecently { _: 'userStatusRecently'; pFlags?: Partial<{ by_me: true }> }
/** userStatusLastWeek#541a1d1a flags:# by_me:flags.0?true = UserStatus; */
export interface UserStatusLastWeek { _: 'userStatusLastWeek'; pFlags?: Partial<{ by_me: true }> }
/** userStatusLastMonth#65899777 flags:# by_me:flags.0?true = UserStatus; */
export interface UserStatusLastMonth { _: 'userStatusLastMonth'; pFlags?: Partial<{ by_me: true }> }

export type UserStatus =
  | UserStatusEmpty
  | UserStatusOnline
  | UserStatusOffline
  | UserStatusRecently
  | UserStatusLastWeek
  | UserStatusLastMonth

/**
 * Порт `appUsersManager.isUserOnline` (`appUsersManager.ts:880-889`): онлайн —
 * это `userStatusOnline`, У КОТОРОГО ЕЩЁ НЕ ИСТЁК `expires`. Второе условие и
 * есть починка дефекта «потерянный кадр оставляет человека онлайн навсегда»:
 * срок годности приехал с провода, гасит его клиент.
 *
 * `now` — аргумент (unix-секунды), чтобы предикат оставался чистым и
 * тестируемым; вызывающий передаёт `Date.now() / 1000`.
 */
export function isUserStatusOnline(status: UserStatus | undefined, now: number): boolean {
  return status?._ === 'userStatusOnline' && status.expires > now
}

/** Момент «был(а) в сети» в unix-секундах; `0` — точного времени нет
 *  (скрыто правилом приватности либо статуса нет вовсе). */
export function userStatusWasOnline(status: UserStatus | undefined): number {
  if (status?._ === 'userStatusOffline') return status.was_online
  if (status?._ === 'userStatusOnline') return status.expires
  return 0
}

// ── User ────────────────────────────────────────────────────────────────────

/** userEmpty#d3bc4b7a id:long = User; */
export interface UserEmpty { _: 'userEmpty'; id: number }

/**
 * user#31774388 flags:# self:flags.10?true contact:flags.11?true
 * mutual_contact:flags.12?true deleted:flags.13?true bot:flags.14?true
 * verified:flags.17?true premium:flags.28?true … id:long
 * first_name:flags.1?string last_name:flags.2?string username:flags.3?string
 * phone:flags.4?string photo:flags.5?UserProfilePhoto status:flags.6?UserStatus
 * … = User;
 *
 * КРАТКАЯ форма — та, что едет вместе с сообщениями, диалогами и списками. Bio
 * и день рождения здесь отсутствуют ПО СХЕМЕ: их место — `userFull`. У нас
 * граница шла не по этой линии (`bio`/`birthday` жили в «своей» витрине `/me`,
 * а `verified`/`premium` — в «полной чужой» `/users/{id}`).
 *
 * Объявлены ровно те булевы флаги, у которых есть предмет; остальные из схемы
 * (support, scam, fake, bot_*, stories_*, …) не объявляются вовсе, а не
 * выставляются наугад — то же правило, что на бэкенде.
 *
 * `emoji_status_emoticon` — КЛИЕНТСКИЙ параметр (`schema_additional_params.json`,
 * механизм оригинала: префикс `flags.-1?` = «на провод не идёт»), а не схемный
 * `emoji_status:EmojiStatus`. Предмет частично другой: у нас unicode-символ, в
 * схеме `document_id` кастом-эмодзи — заполнить его нечем до подсистемы
 * кастом-эмодзи (решение №6 разбора).
 */
export interface UserReal {
  _: 'user'
  pFlags?: Partial<{
    self: true
    contact: true
    mutual_contact: true
    deleted: true
    bot: true
    verified: true
    premium: true
  }>
  id: number
  first_name?: string
  last_name?: string
  username?: string
  /** Видимость номера решает ПРАВИЛО ПРИВАТНОСТИ, а не поле пира (решение №5):
   *  не пускает — ключа просто нет. */
  phone?: string
  photo?: UserProfilePhoto
  status?: UserStatus
  emoji_status_emoticon?: string
}

export type User = UserEmpty | UserReal

/** birthday#6c8e1e06 flags:# day:int month:int year:flags.0?int = Birthday; */
export interface Birthday { _: 'birthday'; day: number; month: number; year?: number }

/**
 * userFull#06cbe645 flags:# blocked:flags.0?true … id:long about:flags.1?string
 * … ttl_period:flags.14?int … birthday:flags2.5?Birthday = UserFull;
 *
 * ПОЛНАЯ форма — то, что запрашивается один раз при открытии профиля, в
 * отличие от краткой `user`, которая едет с каждым списком.
 */
export interface UserFull {
  _: 'userFull'
  pFlags?: Partial<{ blocked: true; phone_calls_available: true; video_calls_available: true }>
  id: number
  /** наш `users.bio` */
  about?: string
  /** период автоудаления переписки с этим пиром, сек; отсутствует — выключено */
  ttl_period?: number
  birthday?: Birthday
}

/**
 * users.userFull#3b6d152e full_user:UserFull chats:Vector<Chat>
 * users:Vector<User> = users.UserFull;
 *
 * ОТВЕТ на запрос профиля целиком: полная форма ВМЕСТЕ с краткой. Именно он
 * свёл наши три витрины пользователя к паре оригинала — `/me` и `/users/{id}`
 * отдают ОДИН И ТОТ ЖЕ конструктор, и вопрос «где живёт verified, а где bio»
 * перестал быть нашим: он решён схемой.
 */
export interface UsersUserFull {
  _: 'users.userFull'
  full_user: UserFull
  chats: Chat[]
  users: UserReal[]
}

// ── Права ───────────────────────────────────────────────────────────────────

/**
 * chatAdminRights#5fb224d5 flags:# change_info:flags.0?true
 * post_messages:flags.1?true edit_messages:flags.2?true
 * delete_messages:flags.3?true ban_users:flags.4?true invite_users:flags.5?true
 * pin_messages:flags.7?true add_admins:flags.9?true … = ChatAdminRights;
 *
 * Единственный параметр конструктора — сама маска, поэтому объект целиком
 * состоит из `pFlags`. НАЛИЧИЕ `admin_rights` у чата и есть признак «зритель
 * админ» (решение №3): поля роли (`my_role`) больше нет ни на одной стороне.
 */
export interface ChatAdminRights {
  _: 'chatAdminRights'
  pFlags?: Partial<{
    change_info: true
    post_messages: true
    edit_messages: true
    delete_messages: true
    ban_users: true
    invite_users: true
    pin_messages: true
    add_admins: true
  }>
}

/**
 * chatBannedRights#9f120418 flags:# view_messages:flags.0?true
 * send_messages:flags.1?true send_media:flags.2?true … change_info:flags.10?true
 * invite_users:flags.15?true pin_messages:flags.17?true … until_date:int
 * = ChatBannedRights;
 *
 * Что участнику НЕЛЬЗЯ. ⚠️ Знак: это ЗАПРЕТЫ, а не разрешения — выставленный
 * флаг означает «не может». Инверсию делает бэкенд один раз
 * (`NewChatBannedRights`), клиент читает готовое. `until_date === 0` —
 * бессрочно, ровно как читает оригинал.
 */
export interface ChatBannedRights {
  _: 'chatBannedRights'
  pFlags?: Partial<{
    send_messages: true
    send_media: true
    invite_users: true
    pin_messages: true
    change_info: true
  }>
  until_date: number
}

// ── Chat ────────────────────────────────────────────────────────────────────

/** chatEmpty#29562865 id:long = Chat; */
export interface ChatEmpty { _: 'chatEmpty'; id: number }

/**
 * chat#41cbf256 flags:# creator:flags.0?true left:flags.2?true
 * deactivated:flags.5?true … id:long title:string photo:ChatPhoto
 * participants_count:int date:int version:int
 * admin_rights:flags.14?ChatAdminRights
 * default_banned_rights:flags.18?ChatBannedRights = Chat;
 *
 * БАЗОВАЯ группа. ОБЪЯВЛЕНА, НО НЕ ПРОИЗВОДИТСЯ (решение №2): `username`,
 * `forum`, `slowmode`, `gigagroup` в схеме есть только у `channel`, поэтому
 * любая наша группа — `channel` + `pFlags.megagroup`. Объявление нужно, чтобы
 * ветвление по `_` (портируемое из оригинала) знало о ней и не сваливало её в
 * ветку канала.
 *
 * `version` — реквизит синхронизации MTProto, предмета не имеет.
 */
export interface ChatReal {
  _: 'chat'
  pFlags?: Partial<{ creator: true; left: true; deactivated: true }>
  id: number
  title: string
  photo: ChatPhoto
  participants_count: number
  date: number
  admin_rights?: ChatAdminRights
  default_banned_rights?: ChatBannedRights
}

/** chatForbidden#6592a1a7 id:long title:string = Chat; */
export interface ChatForbidden { _: 'chatForbidden'; id: number; title: string }

/**
 * channel#1c32b11c flags:# creator:flags.0?true left:flags.2?true
 * broadcast:flags.5?true megagroup:flags.8?true signatures:flags.11?true
 * slowmode_enabled:flags.22?true forum:flags.30?true has_link:flags.20?true …
 * id:long title:string username:flags.6?string photo:ChatPhoto date:int
 * admin_rights:flags.14?ChatAdminRights banned_rights:flags.15?ChatBannedRights
 * default_banned_rights:flags.18?ChatBannedRights
 * participants_count:flags.17?int signature_profiles:flags2.12?true
 * send_paid_messages_stars:flags2.14?long = Chat;
 *
 * И канал, и супергруппа — разница ТОЛЬКО в `pFlags.broadcast`/`megagroup`.
 * Это тот конструктор, который у нас производится всегда.
 *
 * `admin_rights` — права ЗРИТЕЛЯ (их наличие = «зритель админ»),
 * `banned_rights` — персональные ограничения зрителя, `default_banned_rights`
 * — ограничения обычного участника.
 */
export interface Channel {
  _: 'channel'
  pFlags?: Partial<{
    creator: true
    left: true
    broadcast: true
    megagroup: true
    signatures: true
    signature_profiles: true
    slowmode_enabled: true
    forum: true
    has_link: true
  }>
  id: number
  title: string
  username?: string
  photo: ChatPhoto
  date: number
  admin_rights?: ChatAdminRights
  banned_rights?: ChatBannedRights
  default_banned_rights?: ChatBannedRights
  participants_count?: number
  /** плата за сообщение в звёздах; отсутствует — выключено */
  send_paid_messages_stars?: number
}

/** channelForbidden#17d493d5 flags:# broadcast:flags.5?true
 *  megagroup:flags.8?true id:long access_hash:long title:string
 *  until_date:flags.16?int = Chat; */
export interface ChannelForbidden {
  _: 'channelForbidden'
  pFlags?: Partial<{ broadcast: true; megagroup: true }>
  id: number
  title: string
  until_date?: number
}

export type Chat = ChatEmpty | ChatReal | ChatForbidden | Channel | ChannelForbidden

// ── Полные карточки ─────────────────────────────────────────────────────────

/** chatFull#2633421b flags:# can_set_username:flags.7?true … id:long
 *  about:string … pinned_msg_id:flags.6?int … = ChatFull;
 *
 *  Объявлена, но не производится — парно к `chat` (решение №2). */
export interface ChatFullReal {
  _: 'chatFull'
  pFlags?: Partial<{ can_set_username: true }>
  id: number
  about: string
  pinned_msg_id?: number
}

/**
 * channelFull#a04e8d3a flags:# hidden_prehistory:flags.10?true … id:long
 * about:string participants_count:flags.0?int … read_inbox_max_id:int
 * read_outbox_max_id:int unread_count:int chat_photo:Photo …
 * pinned_msg_id:flags.5?int linked_chat_id:flags.14?long
 * slowmode_seconds:flags.17?int … ttl_period:flags.24?int
 * available_reactions:flags.30?ChatReactions
 * send_paid_messages_stars:flags2.21?long = ChatFull;
 *
 * `chat_photo` здесь — ПОЛНОЕ `Photo` с лестницей размеров (медиавьювер
 * открывает аватарку), а не `chatPhoto` с одним id. `null` — фото нет: в
 * оригинале там стоял бы `photoEmpty`, но объединение `Photo` относится к
 * подсистеме медиа, где `photoEmpty` не объявлен; шов закроется вместе с ней.
 */
export interface ChannelFull {
  _: 'channelFull'
  pFlags?: Partial<{ hidden_prehistory: true }>
  id: number
  about: string
  read_inbox_max_id: number
  read_outbox_max_id: number
  unread_count: number
  chat_photo: MyPhoto | null
  participants_count?: number
  pinned_msg_id?: number
  /** чат обсуждения канала; отсутствует — обсуждения нет */
  linked_chat_id?: number
  slowmode_seconds?: number
  ttl_period?: number
  available_reactions?: ChatReactions
  send_paid_messages_stars?: number
}

export type ChatFull = ChatFullReal | ChannelFull

/**
 * Знаковый ключ чата обсуждения канала; `NULL_PEER_ID` — обсуждения нет.
 *
 * ВНИМАНИЕ на знак, та же граница, что у `peerKey` ниже: `linked_chat_id:long`
 * в схеме — СЫРОЙ ПОЛОЖИТЕЛЬНЫЙ id чата (как `channel.id`), знаковый вид носят
 * только поля с именем `peer_id`. Прежняя витрина отдавала здесь уже готовый
 * ключ (`discussion_peer_id`), поэтому перевод — новый и единственный: сравнить
 * сырой id с `NULL_PEER_ID` через «> 0» показалось бы верным и выключило бы
 * обсуждения ровно наоборот.
 */
export function getLinkedChatPeerId(full: ChannelFull | undefined): PeerId {
  return full?.linked_chat_id ? toPeerId(full.linked_chat_id, true) : NULL_PEER_ID
}

/**
 * messages.chatFull#e5d7d19c full_chat:ChatFull chats:Vector<Chat>
 * users:Vector<User> = messages.ChatFull;
 *
 * ОТВЕТ экрана информации о чате И кадр `chat_update` — один и тот же объект.
 * Прежде наша `ChatCard` ехала двумя разными формами: плоско с `id` у ручки и
 * вложенно в кадре.
 */
export interface MessagesChatFull {
  _: 'messages.chatFull'
  full_chat: ChannelFull
  chats: Chat[]
  users: UserReal[]
}

/**
 * Знаковый ключ карточки: у пользователя `+id`, у чата `-id`.
 *
 * ВНИМАНИЕ на границу. Внутри конструкторов `id` — ПОЛОЖИТЕЛЬНЫЙ сырой
 * идентификатор, ровно как в схеме (`channel.id`, `channelFull.id`,
 * `peerChannel.channel_id`). Знаковый вид едет только там, где поле называется
 * `peer_id` / `*_peer_id`. Перепутать эти два числа — самая дешёвая ошибка
 * здесь, поэтому переход между ними живёт в одной функции.
 */
export function peerKey(peer: User | Chat): PeerId {
  return peer._ === 'user' || peer._ === 'userEmpty' ? +peer.id : -Math.abs(+peer.id)
}

// ── Политика реакций чата ───────────────────────────────────────────────────

/** reactionEmoji#1b2286b8 emoticon:string = Reaction; */
export interface ReactionEmoji { _: 'reactionEmoji'; emoticon: string }

/** chatReactionsNone#eafc32bc = ChatReactions; */
export interface ChatReactionsNone { _: 'chatReactionsNone' }
/** chatReactionsAll#52928bca flags:# allow_custom:flags.0?true = ChatReactions; */
export interface ChatReactionsAll { _: 'chatReactionsAll'; pFlags?: Partial<{ allow_custom: true }> }
/** chatReactionsSome#661d4037 reactions:Vector<Reaction> = ChatReactions; */
export interface ChatReactionsSome { _: 'chatReactionsSome'; reactions: ReactionEmoji[] }

export type ChatReactions = ChatReactionsNone | ChatReactionsAll | ChatReactionsSome
