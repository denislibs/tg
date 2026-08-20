// src/core/messages/messageAction.ts
//
// Служебное действие в форме оригинала (MTProto): объединение `MessageAction`
// схемы с дискриминатором `_`. Зеркало `backend/internal/domain/mtmessage.go`
// (шаги A–C программы TL).
//
// ── Что здесь заменило собой ────────────────────────────────────────────────
// Действие ехало JSON-СТРОКОЙ ВНУТРИ ТЕКСТА сообщения, а клиент опознавал его
// по `raw.startsWith('{')` (`serviceMsg.ts:43` до этого шага) — то есть
// дискриминатор был подделан дважды: сначала `type === 'service'`, потом
// строковое поле `action` внутри распарсенного JSON. Вместе с JSON ушли три
// серверные склейки: имена пиров (`actor`, `user`, `chat` строками рядом с
// идентификаторами), превью закреплённого (`msg_name`/`msg_text`, обрезанный до
// 100 символов НА СЕРВЕРЕ) и готовая русская фраза у создания темы форума.
//
// ── Сервер производит настоящие конструкторы, клиент уточняет до синтетических
// Ровно так работает оригинал (`appMessagesManager.ts:5215-5238`): сервер
// сообщает ФАКТ, а формулировку выбирает клиент. Поэтому `leave` и `kick_user`
// — ОДИН конструктор на проводе (`messageActionChatDeleteUser`), а
// `messageActionChatLeave`/`ChatJoined`/`ChatAddUsers` появляются только здесь,
// в `refineMessageAction`. Смешивать нельзя: серверная и клиентская формы
// разъедутся ровно там, где раньше разъезжались десять проводных форм
// сообщения.
//
// Синтетические конструкторы объявлены в `schema/schema_additional_params.json`
// самим оригиналом (наш `layer.d.ts` побайтово совпадает с ним) — заводить
// механизм не надо, надо им воспользоваться.
//
// ── Почему тип из `@layer` здесь не годится напрямую ────────────────────────
// Та же причина, что у пиров и медиа: `@layer` печатает `long` как
// `string | number` (у нас всюду число), а `messageActionChatEditPhoto.photo`
// тянет схемный `Photo` вместо нашего `MyPhoto` (`core/media/messageMedia.ts`),
// у которого `bytes` ступеней — base64-строка, а не `Uint8Array`.
import type { ChatBannedRights } from '../peers/peer'
import type { MyPhoto } from '../media/messageMedia'

/** messageActionChatCreate#bd47cbad title:string users:Vector<long> = MessageAction; */
export interface MessageActionChatCreate {
  _: 'messageActionChatCreate'
  title: string
  users: number[]
}

/** messageActionChatEditTitle#b5a1ce5a title:string = MessageAction; */
export interface MessageActionChatEditTitle {
  _: 'messageActionChatEditTitle'
  title: string
}

/** messageActionChatEditPhoto#7fcb13a8 photo:Photo = MessageAction;
 *
 *  Новая аватарка едет ВНУТРИ действия, а не полем `media_id` рядом с ним:
 *  у `messageService` поля `media` в схеме нет вовсе. */
export interface MessageActionChatEditPhoto {
  _: 'messageActionChatEditPhoto'
  photo?: MyPhoto
}

/** messageActionChatAddUser#15cefd00 users:Vector<long> = MessageAction;
 *
 *  ТОЛЬКО идентификаторы — имя собирает клиент из зеркала карточек. Вектор, а
 *  не одно число: оригинал умеет добавить нескольких за раз. */
export interface MessageActionChatAddUser {
  _: 'messageActionChatAddUser'
  users: number[]
}

/** messageActionChatDeleteUser#a43f30cc user_id:long = MessageAction;
 *
 *  И «удалил», И «вышел сам» — ОДИН конструктор. Различие выводит клиент, см.
 *  `refineMessageAction`. */
export interface MessageActionChatDeleteUser {
  _: 'messageActionChatDeleteUser'
  user_id: number
}

/** messageActionChatJoinedByLink#031224c3 inviter_id:long = MessageAction;
 *
 *  `inviter_id` — тот, кто ССЫЛКУ СОЗДАЛ; вошедший и так известен, он
 *  `from_id` самого сообщения. */
export interface MessageActionChatJoinedByLink {
  _: 'messageActionChatJoinedByLink'
  inviter_id: number
}

/** messageActionPinMessage#94bd38ed = MessageAction;
 *
 *  НИ ОДНОГО ПАРАМЕТРА. Цель закрепления — `reply_to` самого служебного
 *  сообщения, превью строит клиент. */
export interface MessageActionPinMessage {
  _: 'messageActionPinMessage'
}

/** messageActionSetMessagesTTL#3c134d7b flags:# period:int … = MessageAction; */
export interface MessageActionSetMessagesTTL {
  _: 'messageActionSetMessagesTTL'
  period: number
}

/** messageActionTopicCreate#0d999256 flags:# … title:string icon_color:int … */
export interface MessageActionTopicCreate {
  _: 'messageActionTopicCreate'
  title: string
  icon_color: number
}

/** messageActionSuggestProfilePhoto#57de635e photo:Photo = MessageAction;
 *
 *  `accepted` — НАШ параметр вне схемы (объявлен в
 *  `schema_additional_params.json`): у оригинала принятое предложение видно по
 *  тому, что фото стало аватаркой, у нас признак хранится на действии. */
export interface MessageActionSuggestProfilePhoto {
  _: 'messageActionSuggestProfilePhoto'
  photo?: MyPhoto
  accepted?: boolean
}

/** messageActionSuggestedPostApproval#ee7a1596 flags:# rejected:flags.0?true …
 *
 *  `channel_id` — НАШ параметр вне схемы: у оригинала пилюля лежит В САМОМ
 *  канале, у нас решение приходит автору в чат с сервисным аккаунтом. Едет
 *  ССЫЛКА (знаковый ключ пира), а не название — имя собирает клиент. */
export interface MessageActionSuggestedPostApproval {
  _: 'messageActionSuggestedPostApproval'
  pFlags?: Partial<{ rejected: true }>
  channel_id?: PeerId
}

/** phoneCallDiscardReason* — почему звонок кончился. Три конструктора: `ok` и
 *  `cancelled` оба Hangup, различает их НАЛИЧИЕ `duration`. */
export type PhoneCallDiscardReason =
  | { _: 'phoneCallDiscardReasonMissed' }
  | { _: 'phoneCallDiscardReasonBusy' }
  | { _: 'phoneCallDiscardReasonHangup' }

/** messageActionPhoneCall#80e11a7f flags:# video:flags.2?true call_id:long
 *  reason:flags.0?PhoneCallDiscardReason duration:flags.1?int = MessageAction;
 *
 *  `call_id` (обязательный) не производится: идентификатор звонка у нас uuid
 *  сигнальных кадров, на сообщение он не сохраняется. */
export interface MessageActionPhoneCall {
  _: 'messageActionPhoneCall'
  pFlags?: Partial<{ video: true }>
  reason?: PhoneCallDiscardReason
  duration?: number
}

/** messageActionRestrict#d1500001 user_id:long banned_rights:ChatBannedRights
 *
 *  НАШ СОБСТВЕННЫЙ конструктор в своём пространстве id: у оригинала
 *  ограничение прав не порождает сообщения в ленте вовсе (оно уходит в журнал
 *  администратора, которого у нас нет), а пилюля живая. */
export interface MessageActionRestrict {
  _: 'messageActionRestrict'
  user_id: number
  banned_rights?: ChatBannedRights
}

// ── Синтетические конструкторы: их производит ТОЛЬКО клиент ────────────────

/** messageActionChatLeave — человек вышел САМ (уточнение
 *  `messageActionChatDeleteUser`, `from_id == user_id`). */
export interface MessageActionChatLeave {
  _: 'messageActionChatLeave'
  user_id: number
}

/** messageActionChatJoined — человек добавил САМ СЕБЯ (уточнение
 *  `messageActionChatAddUser` с одним пользователем, равным `from_id`). */
export interface MessageActionChatJoined {
  _: 'messageActionChatJoined'
  users: number[]
}

/** messageActionChatJoinedYou — то же, но вошёл ЗРИТЕЛЬ («Вы …»). Суффикс
 *  `You` — приём самого оригинала, у него так объявлены обе пары
 *  (`ChatJoined`/`ChatJoinedYou`, `ChatReturn`/`ChatReturnYou`). */
export interface MessageActionChatJoinedYou {
  _: 'messageActionChatJoinedYou'
  users: number[]
}

/** messageActionChatAddUsers — добавили НЕСКОЛЬКИХ за раз (уточнение
 *  `messageActionChatAddUser` с вектором длиннее одного). */
export interface MessageActionChatAddUsers {
  _: 'messageActionChatAddUsers'
  users: number[]
}

/** messageActionDiscussionStarted — плашка «Обсуждение началось» под корневым
 *  постом в ветке комментариев. Тоже КЛИЕНТСКИЙ конструктор оригинала
 *  (`generateThreadServiceStartMessage`): сервер её не присылает и не может —
 *  сообщения с таким смыслом в чате нет, есть только сам пост. */
export interface MessageActionDiscussionStarted {
  _: 'messageActionDiscussionStarted'
}

/**
 * Объединение `MessageAction`: тринадцать конструкторов схемы, которые
 * производит наш сервер, плюс четыре СИНТЕТИЧЕСКИХ, которые производит только
 * клиент (`refineMessageAction`).
 *
 * `messageActionChatReturn`/`ChatReturnYou` объявлены оригиналом, но здесь НЕ
 * производятся: «вернулся» отличается от «присоединился» историей членства, а
 * её ни строка действия, ни сервер не несут. Выдумывать различие нельзя —
 * пропуск назван, а не забыт.
 */
export type MessageAction =
  | MessageActionChatCreate
  | MessageActionChatEditTitle
  | MessageActionChatEditPhoto
  | MessageActionChatAddUser
  | MessageActionChatDeleteUser
  | MessageActionChatJoinedByLink
  | MessageActionPinMessage
  | MessageActionSetMessagesTTL
  | MessageActionTopicCreate
  | MessageActionSuggestProfilePhoto
  | MessageActionSuggestedPostApproval
  | MessageActionPhoneCall
  | MessageActionRestrict
  | MessageActionChatLeave
  | MessageActionChatJoined
  | MessageActionChatJoinedYou
  | MessageActionChatAddUsers
  | MessageActionDiscussionStarted

/**
 * Уточнение серверного конструктора до синтетического — порт
 * `appMessagesManager.ts:5215-5238`.
 *
 * `fromId` — ЗНАКОВЫЙ ключ автора служебного сообщения, `meId` — зрителя.
 * Возвращает ТО ЖЕ значение, когда уточнять нечего: вызывающий кладёт результат
 * обратно без ветвления.
 */
export function refineMessageAction(action: MessageAction, fromId: PeerId | undefined, meId: PeerId | null): MessageAction {
  if (action._ === 'messageActionChatDeleteUser') {
    // Вышел сам: сервер сообщил факт «участника в чате больше нет», а кто
    // именно его убрал — видно по совпадению автора с целью.
    return action.user_id === fromId ? { _: 'messageActionChatLeave', user_id: action.user_id } : action
  }
  if (action._ !== 'messageActionChatAddUser') return action
  if (action.users.length !== 1) return { _: 'messageActionChatAddUsers', users: action.users }
  if (action.users[0] !== fromId) return action
  return action.users[0] === meId
    ? { _: 'messageActionChatJoinedYou', users: action.users }
    : { _: 'messageActionChatJoined', users: action.users }
}
