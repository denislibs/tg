// src/core/models.ts
import type { ReplyMarkup } from './markup/replyMarkup'
import type { EmojiEffectKind } from './effects/emojiEffects'
import { saveMessageMedia, type MessageMedia, type TextWithEntities } from './media/messageMedia'
import type { MessageEntity } from '@layer'
import { getPeerId, type Peer } from './peers/peerId'
import type { PeerNotifySettings } from './dialogs/notifySettings'
import { generateMessageId } from './history/messageId'
import { refineMessageAction, type MessageAction } from './messages/messageAction'

// Форматирующая разметка текста сообщения — тип ИЗ СХЕМЫ (`@layer`, генерируется
// из `schema/schema.json`), объединение по дискриминатору `_`:
// `{_: 'messageEntityBold', offset, length}`, `{_: 'messageEntityPre', …, language}`,
// `{_: 'messageEntityBlockquote', …, pFlags: {collapsed?: true}}`. Рукописного
// `{type: 'bold', …}` больше нет — ветвление везде через `switch (entity._)`,
// как в оригинале (tweb `lib/richTextProcessor/*`).
//
// `offset`/`length` — UTF-16 code units (обычные индексы JS-строки), поэтому одни
// и те же числа режут текст одинаково у нас и на бэкенде.
//
// Ре-экспорт, а не своё объявление: у сущностей нет ни `bytes`, ни реквизитов
// транспорта (`access_hash`/`file_reference`/`dc_id`), из-за которых у медиа
// пришлось оставить рукописные типы, — то есть тип из схемы годится напрямую
// (`docs/readiness/tl-program.md`, фаза 1).
export type { MessageEntity }

/**
 * dialog#fc89f7f3 flags:# pinned:flags.2?true … peer:Peer top_message:int
 * read_inbox_max_id:int read_outbox_max_id:int unread_count:int
 * unread_mentions_count:int unread_reactions_count:int …
 * notify_settings:PeerNotifySettings folder_id:flags.4?int ttl_period:flags.5?int
 * = Dialog;
 *
 * СТРОКА списка чатов в форме оригинала: состояние чтения и место в списке — и
 * ничего больше. Зеркало `backend/internal/domain/mtdialog.go`.
 *
 * ── Что отсюда исчезло и куда уехало ────────────────────────────────────────
 * Прежний `RawDialog` слил ТРИ объекта схемы в одну плоскую строку. В схеме
 * `/chats` это КОНТЕЙНЕР `messages.dialogs{dialogs, messages, chats, users}`:
 *  • `title`/`username`/`photo`/`is_forum` — поля `Chat`, едут в `chats`;
 *  • `peer: UserReal` (собеседник) — едет в `users`;
 *  • `last_message{…}` — выжимка на девять полей вместе с серверным
 *    `sender_name`; теперь последнее сообщение адресуется ЧИСЛОМ `top_message`
 *    (это seq), а сам объект едет в `messages` контейнера;
 *  • `type: ChatKind` — вид чата подделывался строкой; выражают конструктор
 *    `peer` и флаги `Chat` (`core/peers/predicates.ts`, решение Р8);
 *  • `muted: boolean` — признак БЕЗ СРОКА ГОДНОСТИ, из-за чего «заглушить на
 *    час» работало как «навсегда»; теперь `notify_settings.mute_until`;
 *  • `theme_id` — в схеме её место `chatFull`/`userFull.theme_emoticon`,
 *    в диалоге поля нет вовсе (решение Р7).
 */
export interface RawDialog {
  _: 'dialog'
  pFlags?: Partial<{ pinned: true }>
  /** ссылка на пир — конструктор (`peerUser`/`peerChannel`), а не число */
  peer: Peer
  /** seq ПОСЛЕДНЕГО сообщения чата; объект едет вектором `messages` контейнера */
  top_message: number
  /** горизонт чтения ЗРИТЕЛЯ (прежний `last_read_seq`) */
  read_inbox_max_id: number
  /** горизонт ДРУГОЙ стороны: исходящее с seq ≤ этого — ✓✓ */
  read_outbox_max_id: number
  unread_count: number
  unread_mentions_count: number
  unread_reactions_count: number
  notify_settings: PeerNotifySettings
  /** Черновик ЭТОГО диалога (flags.1?DraftMessage). Место черновика — сам
   *  диалог: от его даты зависит порядок списка, и собирать активность чата из
   *  двух источников значило бы держать две правды об одном факте.
   *
   *  «Черновика нет» — ОТСУТСТВИЕ параметра; `draftMessageEmpty` значит
   *  «черновик СНЯЛИ» и приезжает КАДРОМ, а в строке списка не хранится.
   *  Операции — `core/dialogs/draft.ts`. */
  draft?: DraftMessage
  /** 0 — «все чаты», 1 — архив; ключа нет — папка не указана (решение Р5) */
  folder_id?: 0 | 1
  /** период автоудаления сообщений чата, сек (прежний `auto_delete_period`) */
  ttl_period?: number
  /** НАШ параметр вне схемы (решение Р9): секретный чат — отдельная подсистема
   *  вне периметра порта, но живых гейтов по этому признаку больше десятка. */
  secret?: boolean
}

/**
 * Модель = форма провода плюс два КЛИЕНТСКИХ параметра, ровно как у оригинала
 * (`schema/schema_additional_params.json`, предикат `dialog`):
 *
 *  • `peerId` — знаковый ключ, выведенный из `peer` (`getPeerId`);
 *  • `lastMessage` — РАЗРЕШЁННЫЙ `top_message`.
 *
 * Разрешает ссылку ВОРКЕР (решение Р11): объекты сообщений живут в его SSOT
 * (`messagesManager`), а главный поток держит зеркало только ОТКРЫТЫХ окон и
 * сообщение закрытого чата взять ему неоткуда. Наверх едет целый `Message` —
 * из-за этого в превью списка чатов наконец есть сущности, реплай, альбом и
 * автор-ПИР вместо серверной строки `sender_name`.
 *
 * Маппера полей у диалога больше нет: форма провода и форма модели совпали
 * (тот же исход, что у `peer` на шаге D пиров и у `mapReplyMarkup`), а два
 * клиентских параметра проставляет тот, кто их и вычисляет, —
 * `dialogsManager.toDialog`.
 */
export interface Dialog extends RawDialog {
  /** знаковый ключ диалога ГЛАЗАМИ ЗРИТЕЛЯ: у приватного это id собеседника
   *  (у двух сторон одного разговора он РАЗНЫЙ), у группы/канала `-chatID`. */
  peerId: PeerId
  lastMessage?: MyMessage
}

/** Папка диалога НА ПРОВОДЕ — порт tweb `FOLDER_ID_ARCHIVE`
 *  (`appManagers/constants.ts:38`). Наш клиентский `ARCHIVE_FOLDER_ID` (-1,
 *  `core/folderIds.ts`) с ней не совпадает сознательно — см. докблок там. */
export const WIRE_FOLDER_ARCHIVE = 1

/**
 * Ссылки на диалог: `dialogPeer` (список диалогов), `notifyPeer` (настройки
 * уведомлений), `folderPeer` (папки). Три РАЗНЫХ пространства адресации, а не
 * «пир с довеском»: у `folderPeer` рядом с пиром лежит номер папки, а у
 * `notifyPeer` в схеме есть варианты «все личные»/«все группы»/«все каналы»,
 * которые пиром не выражаются вовсе.
 *
 * Производятся по одному конструктору каждого объединения — зеркало
 * `backend/internal/domain/mtdialog.go`, там же названо, чего нет.
 */
export interface DialogPeer { _: 'dialogPeer'; peer: Peer }
export interface NotifyPeer { _: 'notifyPeer'; peer: Peer }
/** folderPeer#e9baa668 peer:Peer folder_id:int = FolderPeer; */
export interface FolderPeer { _: 'folderPeer'; peer: Peer; folder_id: number }

/** Диалог убран в «Архив». Прежде это было булево поле строки; в схеме архив —
 *  РЕАЛЬНАЯ папка, и вопрос задаётся её номером. */
export function isDialogArchived(dialog: Pick<Dialog, 'folder_id'>): boolean {
  return dialog.folder_id === WIRE_FOLDER_ARCHIVE
}

/**
 * messageReplyHeader#1b97dd66 flags:# … reply_to_msg_id:flags.4?int
 * reply_to_peer_id:flags.0?Peer reply_from:flags.5?MessageFwdHeader
 * reply_media:flags.8?MessageMedia reply_to_top_id:flags.1?int
 * quote_text:flags.6?string quote_entities:flags.7?Vector<MessageEntity>
 * quote_offset:flags.10?int = MessageReplyHeader;
 *
 * ССЫЛКА на отвечаемое сообщение — и только ссылка (решение Р4 разбора). На её
 * месте ехал СНИМОК `{msg_id, seq, sender_id, text, entities, type, media_id,
 * quote_text}`, собранный сервером, — четвёртый экземпляр той же болезни, что
 * уже снята у диалогов, пиров и закрепления. Сообщение клиент берёт из своего
 * хранилища.
 *
 * Схема при этом различает два случая, которые снимок смешивал:
 *  • ЦИТАТА (`quote_text`/`quote_entities`/`quote_offset`) едет ВСЕГДА, когда
 *    она есть: выделенный фрагмент нельзя вывести из оригинала, если оригинал
 *    потом изменили;
 *  • НЕДОСТУПНЫЙ ОРИГИНАЛ (ответ на сообщение из чужого чата) выражается
 *    СТРУКТУРАМИ `reply_from`/`reply_media`, а не плоскими
 *    `reply_snapshot_name` (имя автора строкой) и `reply_snapshot_text`.
 *
 * КОРЕНЬ ТРЕДА — `reply_to_top_id` ЗДЕСЬ ЖЕ; отдельного `thread_root_id` в
 * схеме нет вовсе.
 *
 * `reply_to_msg_id`/`reply_to_top_id` лежат в КЛИЕНТСКОМ пространстве номеров
 * (`core/history/messageId.ts`) — как и `id` самого сообщения: они с ним
 * сравниваются, значит обязаны быть в одном пространстве.
 */
export interface MessageReplyHeader {
  _: 'messageReplyHeader'
  pFlags?: Partial<{ quote: true; forum_topic: true }>
  reply_to_msg_id?: number
  /** чат оригинала, когда он ДРУГОЙ; отсутствует — ответ в своём чате */
  reply_to_peer_id?: Peer
  /** атрибуция автора оригинала, когда сам оригинал зрителю недоступен */
  reply_from?: MessageFwdHeader
  /** вложение недоступного оригинала */
  reply_media?: MessageMedia
  /** корень треда (форум-топик / комментарии) — ВСЕГДА в том же пире */
  reply_to_top_id?: number
  quote_text?: string
  quote_entities?: MessageEntity[]
  quote_offset?: number
}

/**
 * messageReplies#83d60fc2 flags:# comments:flags.0?true replies:int
 * replies_pts:int recent_repliers:flags.1?Vector<Peer> channel_id:flags.0?long
 * max_id:flags.2?int read_max_id:flags.3?int = MessageReplies;
 *
 * ТРЕД под сообщением — параметр самого сообщения, а не отдельный предмет.
 * Схема одним конструктором выражает два разных случая, и различает их
 * `pFlags.comments` (в схеме он делит бит с `channel_id`):
 *  • ПОСТ КАНАЛА с привязанным обсуждением — `comments` + `channel_id` (ключ
 *    группы обсуждения). По нему рисуется футер «N комментариев»
 *    (tweb `appMessagesManager.getMessageWithCommentReplies`, :9237-9247);
 *  • ОТВЕТЫ В ГРУППЕ — голый счёт без флага и без `channel_id`; его оригинал
 *    показывает числом у времени (tweb `bubbles.ts::setBubbleRepliesCount`,
 *    :6410, ветка `message.replies && this.chat.isAnyGroup`, :9699).
 *
 * Прежде счёт комментариев и авторов возила отдельная ручка
 * `GET /channels/{id}/comment_counts` в свою карту рядом с сообщением — форма,
 * у которой в схеме нет предмета. Теперь тред доводится внутри пачки
 * (`usecase/chat/messagescontainer.go::hydrateThreads`).
 *
 * `replies_pts` и `max_id`/`read_max_id` сервер не производит (журнала и
 * горизонта чтения У ТРЕДА у нас нет) — названо в `domain/mtmessage.go` и в
 * `core/messages/message.schema.test.ts`.
 */
export interface MessageReplies {
  _: 'messageReplies'
  pFlags?: Partial<{ comments: true }>
  /** счёт комментариев/ответов; едет и нулевым — «комментировать можно» */
  replies: number
  /** до трёх последних комментаторов — ССЫЛКИ на пиров (стек аватаров футера);
   *  карточки едут вектором `users` того же контейнера */
  recent_repliers?: Peer[]
  /** ключ ГРУППЫ ОБСУЖДЕНИЯ, где живёт тред (только у поста канала) */
  channel_id?: number
}

/** Булевы флаги схемы у обоих конструкторов сообщения. «Выключено» — ОТСУТСТВИЕ
 *  ключа, а не `false` (правило фазы 0, см. `core/peers/peer.ts`).
 *
 *  `out` производит СЕРВЕР (решение Р7 разбора ОТМЕНЕНО, обоснование — в
 *  докблоке `MessageContext.Out` бэкенда): после порта у сообщения от лица
 *  канала автором на проводе становится сам канал, и прежней формулы клиента
 *  «автор это я» вывести стало не из чего. `is_scheduled` — клиентский флаг
 *  самого оригинала, им помечены отложенные. */
export type MessagePFlags = Partial<{
  out: true
  mentioned: true
  media_unread: true
  post: true
  pinned: true
  is_scheduled: true
}>

/** Общее у `message` и `messageService` — то, что читают без ветвления по
 *  конструктору (адрес, автор, дата, ответ, срок самоуничтожения). */
interface MessageCommon {
  pFlags: MessagePFlags
  /** НОМЕР сообщения в чате, в КЛИЕНТСКОМ пространстве
   *  (`core/history/messageId.ts`). Глобального ключа строки больше нет —
   *  идентичность это пара «пир + номер» (решение Р1 разбора). */
  id: number
  /** АВТОР ссылкой на пир. У поста канала автора нет — сообщение «от самого
   *  пира», и параметра нет вовсе. Отправка от лица канала (send-as) выражается
   *  тем, что автором становится САМ КАНАЛ: прежнего поля `send_as` со снимком
   *  `{peer_id, title, photo_id}` на проводе больше нет. */
  from_id?: Peer
  peer_id: Peer
  reply_to?: MessageReplyHeader
  /** секунды эпохи (в схеме `date:int`), а не ISO-строка */
  date: number
  /** самоуничтожение, секунды */
  ttl_period?: number
  /** Агрегат реакций — тот же конструктор, что на проводе (`messageReactions`),
   *  без плоской проекции.
   *
   *  Платная ⭐-реакция ОТДЕЛЬНЫМ полем не живёт: своего кадра у неё нет, а на
   *  проводе она чип того же вектора `results` (второй конструктор объединения
   *  `Reaction` — `reactionPaid`). Мой вклад звёздами — `top_reactors` с
   *  `pFlags.my`, потому что в `reactionCount` помещается только «моя или нет». */
  reactions?: MessageReactions

  // ── клиентские параметры (`schema_additional_params.json`) ────────────────
  /** знаковый ключ чата — выведен из `peer_id` один раз на границе разбора */
  peerId: PeerId
  /** знаковый ключ автора — выведен из `from_id`; отсутствует у поста канала */
  fromId?: PeerId
  /** ключ, которым ОТПРАВИТЕЛЬ матчит эхо со своим оптимистичным баблом
   *  (клиентский параметр самого оригинала; прежде звался `client_msg_id` и
   *  ехал только в кадре) */
  random_id?: string

  // ── НАШИ параметры вне схемы ──────────────────────────────────────────────
  /** отправка отвергнута (`message_error`) — красная пометка до повтора либо
   *  удаления. У оригинала на этом месте `error: ApiError`, объекта ошибки у
   *  нас нет. */
  failed?: boolean
  /** сообщение из секретного чата (после расшифровки `message` заполнен локально) */
  secret?: boolean
  /** E2E-медиа секретного чата — инжектит расшифровка воркера, не провод */
  secretMedia?: SecretMedia
}

/**
 * message#7600b9d3 … id:int from_id:flags.8?Peer peer_id:Peer
 * fwd_from:flags.2?MessageFwdHeader reply_to:flags.3?MessageReplyHeader
 * date:int message:string media:flags.9?MessageMedia
 * reply_markup:flags.6?ReplyMarkup entities:flags.7?Vector<MessageEntity>
 * views:flags.10?int forwards:flags.10?int edit_date:flags.15?int
 * grouped_id:flags.17?long reactions:flags.20?MessageReactions
 * ttl_period:flags.25?int effect:flags2.2?long factcheck:flags2.3?FactCheck
 * = Message;
 *
 * ОБЫЧНОЕ сообщение. Зеркало `backend/internal/domain/mtmessage.go`.
 */
export interface MessageReal extends MessageCommon {
  _: 'message'
  fwd_from?: MessageFwdHeader
  /** текст. Обязательный по схеме и едет ВСЕГДА, даже пустой: у картинки без
   *  подписи это пустая строка, а не отсутствие ключа. */
  message: string
  /** Вложение ОДНИМ конструктором объединения `MessageMedia` — и это все виды
   *  вложения, а не только файл: гео, визитка, опрос, чек-лист, розыгрыш,
   *  карточка ссылки и платное медиа тоже здесь. Тип документа выводит клиент
   *  (`saveDocument`), заслонка — `pFlags.spoiler`. Плоского `media_id` рядом
   *  БОЛЬШЕ НЕТ: адрес файла спрашивают у вложения
   *  (`getMediaFromMessage(m)?.id`). */
  media?: MessageMedia
  reply_markup?: ReplyMarkup
  entities?: MessageEntity[]
  views?: number
  forwards?: number
  /** тред под сообщением: комментарии поста канала либо ответы в группе */
  replies?: MessageReplies
  /** время правки, секунды эпохи. У живой геолокации этим же полем едет время
   *  последнего обновления координат — два смысла на одну колонку, названный
   *  остаток шага витрин бэкенда. */
  edit_date?: number
  /** ключ альбома. ЧИСЛО (в схеме `long`), а не строка: прежний клиентский
   *  генератор выдавал `g<base36-время><random>`. */
  grouped_id?: number
  /** НАШ параметр вне схемы: в схеме `effect` это id документа-эффекта, у нас —
   *  одно из шести КЛИЕНТСКИХ пресет-имён, рисуемых на canvas. */
  effect_name?: EmojiEffectKind
  /** «проверка фактов» на посте канала */
  factcheck?: FactCheck

  // ── НАШИ параметры вне схемы ──────────────────────────────────────────────
  /** отложенная отправка: срок и его sentinel «когда появится онлайн» */
  send_at?: number
  when_online?: boolean
  /** E2E-шифртекст секретного чата (base64 `iv||ciphertext`) */
  enc_body?: string
  /** абсолютный дедлайн самоуничтожения (ISO), проставляется после прочтения */
  destruct_at?: string
  /** object-URL локального файла — мгновенное превью исходящего медиа, пока
   *  идёт аплоад. blob минтит ВОРКЕР, поэтому URL валиден во всех вкладках. */
  localUrl?: string
  /** расшифровка голосового/кружка (Telegram transcribeAudio) — КЛИЕНТСКИЙ кэш:
   *  с провода поле ушло, у схемы его на сообщении нет */
  transcription?: string
}

/**
 * messageService#7a800e0a … id:int from_id:flags.8?Peer peer_id:Peer
 * reply_to:flags.3?MessageReplyHeader date:int action:MessageAction … = Message;
 *
 * СЛУЖЕБНОЕ сообщение — пилюля посреди ленты. ТЕКСТА У НЕГО НЕТ ВОВСЕ: есть
 * `action`, и это главное расхождение подсистемы — прежде действие ехало
 * JSON-строкой внутри поля `text`, а «служебное ли» подделывалось значением
 * `type === 'service'`.
 */
export interface MessageService extends MessageCommon {
  _: 'messageService'
  action: MessageAction
}

/** messageEmpty#90a6ca84 flags:# id:int peer_id:flags.0?Peer = Message;
 *
 *  ДЫРА В ИСТОРИИ: номер известен, сообщения по нему нет — ни даты, ни автора,
 *  ни текста у конструктора нет вовсе. Производитель на бэкенде появился вместе
 *  с тем, что ссылки на другие сообщения перестали быть снимками
 *  (`GET /chats/{peerID}/messages?ids=`): на ссылку в снесённое сообщение
 *  сервер обязан отвечать ДЫРОЙ, а не молчанием.
 *
 *  Наш прежний `deleted: boolean` — НЕ он: у нас удалённое просто не попадало в
 *  выборку, и поле уезжало пустым в каждом ответе. */
export interface MessageEmpty {
  _: 'messageEmpty'
  id: number
  peer_id?: Peer
  peerId: PeerId
}

/** Объединение `Message` схемы целиком — то, что может приехать с провода. */
export type Message = MessageEmpty | MessageReal | MessageService

/** Порт tweb `MyMessage`: то, что может лежать в окне — сообщение либо пилюля.
 *  Дыра в окно не кладётся: у неё нет ни даты, ни автора, рисовать нечего. */
export type MyMessage = MessageReal | MessageService

/**
 * Поля точечного патча сообщения — параметры ОБОИХ конструкторов без
 * дискриминатора. Не `Partial<MyMessage>`: это объединение двух частичных
 * типов, у которого нельзя прочитать даже общее поле, не сузив ветку, — а патч
 * по построению меняет содержимое, а НЕ вид сообщения (`_` в него не попадает
 * вовсе, поэтому пилюля не может стать сообщением сквозь `patch`).
 */
export type MessageFields = Partial<Omit<MessageReal, '_'> & Omit<MessageService, '_'>>

/** Пилюля посреди ленты, а не сообщение. Ветвление по `_` — как везде. */
export function isServiceMessage(m: MyMessage): m is MessageService {
  return m._ === 'messageService'
}

/** Текст сообщения; у пилюли текста нет вовсе — она рисуется из `action`. */
export function getMessageText(m: MyMessage): string {
  return m._ === 'message' ? m.message : ''
}

/** Номер отвечаемого сообщения (клиентское пространство); `undefined` — ответа нет. */
export function getReplyToMsgId(m: MyMessage): number | undefined {
  return m.reply_to?.reply_to_msg_id
}

/** Корень треда — `reply_to.reply_to_top_id`, отдельного поля в схеме нет. */
export function getThreadRootId(m: MyMessage): number | undefined {
  return m.reply_to?.reply_to_top_id
}

/**
 * Срез чата, от которого зависит ответ `isOurMessage`. В tweb это МЕТОД САМОГО
 * ЧАТА (`Chat.isOurMessage`, chat.ts:1374), поэтому вид чата он читает у `this`,
 * а свою личность — у глобального `rootScope.myId`. У нас ни того, ни другого
 * внутри `core/models.ts` взять нельзя и не нужно:
 *
 *  • вид чата знает тот, кто чат открыл (`ChatContext` императивной ленты,
 *    `Chat.tsx` у реактивной), а тянуть сюда `core/peerCache.ts` — значит
 *    завести в ВОРКЕРЕ (модуль грузится и там) второе, пустое зеркало карточек;
 *  • свою личность так же передаёт вызывающий — ровно как уже делает соседний
 *    `messageToConvMsg(m, meId)`; `lib/rootScope.ts` — главнопоточная шина.
 */
export interface OurMessageChat {
  /** порт `rootScope.myId` (rootScope.ts:253); `null` — личность ещё не известна */
  myId: number | null
  /** порт `chat.isMegagroup` (chat.ts:141). Любая наша группа — это `channel`
   *  с `pFlags.megagroup` (см. `core/peers/peer.ts:325`), то есть «открыт
   *  групповой чат» и есть этот признак. */
  isMegagroup?: boolean
}

/**
 * Рисовать бабл СПРАВА. Порт `Chat.isOurMessage` (tweb chat.ts:1374-1390)
 * ДОСЛОВНО. Это НЕ то же самое, что `pFlags.out`: `out` отвечает «я ли
 * отправил», а сторона бабла — вопрос витрины (комментарий оригинала на месте
 * вызова, bubbles.ts:6615: «can't use 'message.pFlags.out' here because this
 * check will be used to define side of message»).
 *
 * Три ветки оригинала и что они значат у нас:
 *
 *  1. **Мегагруппа — сырой `pFlags.out`.** Сообщение от лица канала (send-as)
 *     остаётся `out` у своего автора (бэкенд объявляет это прямо —
 *     `MessageContext.Out`, `backend/internal/domain/messagewire.go`) и рисуется
 *     ИСХОДЯЩИМ, с именем канала над баблом. Прежняя формулировка «send-as
 *     рисуется входящим, как автофорвард поста» смешивала два разных случая:
 *     автофорвард поста канала в группу обсуждения приходит БЕЗ `out` (это не
 *     моё сообщение) и потому входящий сам собой, а send-as — моё.
 *  2. **Я автор и это не пост канала.** `fromId` у нас отсутствует у поста «от
 *     самого пира», а у tweb в этом случае равен `peerId` (appMessagesManager
 *     .ts:5090) — отсюда `?? m.peerId`, иначе сравнение с `myId` спрашивало бы
 *     про другой объект. `!pFlags.post` отсекает пост вещательного канала: он
 *     `out` у выложившего его админа, но рисуется входящим у всех.
 *  3. **`fwd_from.pFlags.saved_out`** (chat.ts:1383) — окно «Сохранённых
 *     диалогов», где своя пересылка помечается исходящей самим сервером. НЕ
 *     ПОРТИРОВАНА, и не потому что забыли: параметра нет ни на проводе
 *     (`backend/internal/domain/mtfwd.go` перечисляет `pFlags.saved_out` среди
 *     непроизводимых — «ни колонки, ни механики»), ни в нашем
 *     `MessageFwdHeader` ниже. Ветка без предмета — это `if (false)`.
 */
export function isOurMessage(m: MyMessage, chat: OurMessageChat): boolean {
  if (chat.isMegagroup) {
    return !!m.pFlags.out
  }

  if ((m.fromId ?? m.peerId) === chat.myId && !m.pFlags.post) {
    return true
  }

  return false
}

/**
 * Сторона бабла. Порт `Chat.isOutMessage` (tweb chat.ts:1392-1396):
 *
 *     isOut = isOurMessage(message) && (!fwdFrom || peerId !== myId || threadId)
 *
 * Именно ЭТОТ предикат, а не `isOurMessage`, решает `is-out`/`is-in`
 * (bubbles.ts:7613 `const isOut = context.isOut = this.chat.isOutMessage(message)`
 * → :9669 `bubble.classList.add(isOut ? 'is-out' : 'is-in')`), а с ним —
 * показ имени автора (:9331) и тики (:9714 `our && (peerId !== myId || isOut)`,
 * что в «Избранном» вырождается ровно в `isOut`).
 *
 * Второй множитель — САМОПЕРЕСЫЛКА В «ИЗБРАННОЕ»: пересылка в чат с самим собой
 * исходящей не считается и рисуется СЛЕВА, от лица оригинального автора. Вне
 * «Избранного» множитель тождественно истинен, поэтому там предикат совпадает
 * с `isOurMessage`.
 *
 * Терм `|| this.threadId` НЕ портирован — предмета нет, и это перепроверено:
 * тред у нас бывает только у форум-топика и у комментариев канала, а
 * «Избранное» (единственный чат, где `peerId === myId`) ни тем, ни другим не
 * бывает. Окна сохранённого диалога (tweb `ChatType.Saved`, где `threadId` —
 * это `savedPeerId`) у нас нет вовсе: строка списка «Избранного» открывает
 * ОРИГИНАЛЬНЫЙ чат пира (`SharedMedia.tsx::SavedDialogRow` → `onOpenPeer`), а
 * не под-окно «Избранного».
 *
 * `this.peerId` оригинала здесь — `message.peerId`: окно одно, и все его
 * сообщения принадлежат ему же.
 */
export function isOutMessage(m: MyMessage, chat: OurMessageChat): boolean {
  const fwdFrom = m._ === 'message' ? m.fwd_from : undefined
  return isOurMessage(m, chat) && (!fwdFrom || m.peerId !== chat.myId)
}

/**
 * messageFwdHeader#4e4df4bb flags:# … from_id:flags.0?Peer
 * from_name:flags.5?string date:int channel_post:flags.2?int
 * saved_from_peer:flags.4?Peer saved_from_msg_id:flags.4?int = MessageFwdHeader;
 *
 * `from_id` — АВТОР оригинала (`peerUser` у пересылки от человека,
 * `peerChannel` у поста канала); `from_name` — скрытая атрибуция (правило
 * приватности `forwards`), и тогда `from_id` отсутствует.
 *
 * `saved_from_peer`/`saved_from_msg_id` («перейти к оригиналу») заполняются
 * ТОЛЬКО когда источник — группа или канал: у приватного источника публичного
 * ключа не существует. Автор при этом не теряется — он в `from_id`.
 */
export interface MessageFwdHeader {
  _: 'messageFwdHeader'
  from_id?: Peer
  from_name?: string
  date: number
  channel_post?: number
  saved_from_peer?: Peer
  saved_from_msg_id?: number
}

/**
 * textWithEntities#751f3146 — строка вместе со своей разметкой ОДНИМ объектом.
 * Объявлена в `core/media/messageMedia.ts` (первыми её спрашивают конструкторы
 * опроса и чек-листа), здесь только ре-экспорт для «проверки фактов».
 */
export type { TextWithEntities }

/**
 * factCheck#b89bfccf flags:# need_check:flags.0?true country:flags.1?string
 * text:flags.1?TextWithEntities hash:long = FactCheck;
 *
 * «Проверка фактов» на посте канала. `hash` (обязательный) не производится:
 * хэш-кэширования запросов у нас нет вовсе.
 */
export interface FactCheck {
  _: 'factCheck'
  /** код страны ISO-3166 alpha-2; делит бит с `text` — у оригинала они парой */
  country?: string
  text?: TextWithEntities
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
/**
 * payments.giveawayInfo#4367daa0 flags:# participating:flags.0?true … start_date:int …
 * payments.giveawayInfoResults#e175e66f flags:# winner:flags.0?true … start_date:int
 * stars_prize:flags.4?long finish_date:int winners_count:int … = payments.GiveawayInfo;
 *
 * ЛИЧНОЕ состояние зрителя: «участвую ли», «выиграл ли». В сообщении его нет и
 * быть не может — тело кадра одно на всех получателей, а ответ на этот вопрос у
 * каждого свой (та же ловушка, что уже поймана у `pFlags.out`). Приходит
 * отдельным ответом `GET /giveaways/{id}`, как `payments.getGiveawayInfo` у
 * оригинала (tweb `popupGiveaway`).
 *
 * `participants` — НАШ параметр вне схемы (`schema_additional_params.json`):
 * оригинал числа участников не показывает вовсе (участие там = подписка на
 * канал), у нас оно своё и живёт в попапе.
 */
export type GiveawayState =
  | {
      _: 'payments.giveawayInfo'
      pFlags?: Partial<{ participating: true; preparing_results: true }>
      start_date: number
      participants: number
    }
  | {
      _: 'payments.giveawayInfoResults'
      pFlags?: Partial<{ winner: true; refunded: true }>
      start_date: number
      stars_prize?: number
      finish_date: number
      winners_count: number
      participants: number
    }

// Состояние бустов канала (backend BoostStatus).
/**
 * premium.boostsStatus#4959427a … level:int current_level_boosts:int boosts:int
 * next_level_boosts:flags.0?int … = premium.BoostsStatus;
 *
 * Статус бустов канала — КОНСТРУКТОР схемы. «Бустнул ли я» здесь `pFlags.my_boost`
 * и приезжает только в ответе ручки: в общем кадре канала пер-зрительского нет,
 * тело одно на всех подписчиков.
 *
 * Число СВОБОДНЫХ слотов зрителя лежит СНАРУЖИ конструктора (поле ответа
 * `slots`): в схеме на этом месте `my_boost_slots` — вектор идентификаторов
 * занятых слотов, то есть другой предмет под похожим именем.
 */
export interface BoostsStatus {
  _: 'premium.boostsStatus'
  pFlags?: { my_boost?: true }
  level: number
  boosts: number
  current_level_boosts: number
  /** ПОСЛЕДНИЙ УРОВЕНЬ — отсутствие параметра, а не ноль: порога дальше нет
   *  вовсе. Операции над статусом — `core/boosts/boostsStatus.ts`. */
  next_level_boosts?: number
}

// Предложенный в канал пост (backend suggested_posts): статус pending|approved|
// rejected; publishAt/createdAt/decidedAt — unix-миллисекунды (0 — нет значения).
export type SuggestedPostStatus = 'pending' | 'approved' | 'rejected'

export interface RawSuggestedPost {
  id: number
  /** знаковый ключ канала предложки (предложка только в каналах) */
  peer_id: PeerId
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
  peerId: PeerId
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
    peerId: r.peer_id,
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

/**
 * Облачный черновик НА ПРОВОДЕ — объединение `DraftMessage` схемы.
 *
 * Второй конструктор здесь главный: «черновика нет» это `draftMessageEmpty`, а
 * не `null` под тем же ключом. Прежде отсутствие выражалось ЗНАЧЕНИЕМ, и каждый
 * читатель заводил свою ветку `if (draft)`; выбор конструктора делает это
 * ветвление тем же, что у любого другого объединения.
 *
 * Текст лежит в `message` — том же имени, что у самого сообщения (у нас он
 * звался `text`, то есть был вторым именем одного поля), а дата — `date` в
 * секундах эпохи, как у сообщения, а не ISO-строкой своей ручки.
 */
export interface InputReplyToMessage { _: 'inputReplyToMessage'; reply_to_msg_id: number }
/** draftMessage#60fe3294 … message:string entities:flags.3?Vector<MessageEntity> date:int */
export interface DraftMessageReal {
  _: 'draftMessage'
  message: string
  entities?: MessageEntity[]
  reply_to?: InputReplyToMessage
  date: number
}
/** draftMessageEmpty#1b0c841a — «черновик снят». */
export interface DraftMessageEmpty { _: 'draftMessageEmpty' }
export type DraftMessage = DraftMessageReal | DraftMessageEmpty

/** Кадр черновика — он же элемент витрины `/drafts`: у оригинала
 *  `messages.getAllDrafts` отвечает контейнером `Updates`, то есть теми же
 *  кадрами. */
export interface RawDraft {
  _: 'updateDraftMessage'
  peer: Peer
  draft: DraftMessage
}

// Валидные виды эффектов сообщения (бэк уже санитизирует по whitelist; здесь —
// страховка типобезопасности при маппинге проводного значения в union-тип).
const EFFECT_KINDS = new Set<EmojiEffectKind>(['fireworks', 'confetti', 'hearts', 'thumbs', 'poop', 'cake'])
export function mapEffect(e?: string | null): EmojiEffectKind | undefined {
  return e && EFFECT_KINDS.has(e as EmojiEffectKind) ? (e as EmojiEffectKind) : undefined
}

// ── Форма ПРОВОДА ───────────────────────────────────────────────────────────
//
// Отличается от модели ровно тремя вещами, и каждая — названная:
//
//  1. **Пространство номеров.** На проводе `id`, `reply_to_msg_id` и
//     `reply_to_top_id` серверные; в модели — клиентские
//     (`core/history/messageId.ts`).
//  2. **Ссылки на пиров.** Знаковые ключи `peerId`/`fromId` выводит клиент.
// Всё остальное совпало — поэтому маппер и усох до этих двух пунктов.

/** reactionEmoji#1b2286b8 emoticon:string | reactionPaid#523da4eb = Reaction; */
export type Reaction =
  | { _: 'reactionEmoji'; emoticon: string }
  | { _: 'reactionPaid' }

/** reactionCount#a3d1cb80 flags:# chosen_order:flags.0?int reaction:Reaction
 *  count:int = ReactionCount;
 *
 *  `chosen_order` — ПОРЯДКОВЫЙ НОМЕР среди моих реакций, а не булево «моя»:
 *  «не поставил» выражается отсутствием параметра, поэтому ноль это значение. */
export interface ReactionCount {
  _: 'reactionCount'
  chosen_order?: number
  reaction: Reaction
  count: number
}

/** messagePeerReaction#8c79b63c … peer_id:Peer date:int reaction:Reaction; */
export interface MessagePeerReaction {
  _: 'messagePeerReaction'
  peer_id: Peer
  date: number
  reaction: Reaction
}

/** messageReactor#4ba3a95a flags:# … my:flags.1?true anonymous:flags.2?true
 *  peer_id:flags.3?Peer count:int = MessageReactor; */
export interface MessageReactor {
  _: 'messageReactor'
  pFlags?: Partial<{ my: true; anonymous: true }>
  peer_id?: Peer
  count: number
}

/** messageReactions#0a339f0b flags:# … results:Vector<ReactionCount>
 *  recent_reactions:flags.1?Vector<MessagePeerReaction>
 *  top_reactors:flags.4?Vector<MessageReactor> = MessageReactions; */
export interface MessageReactions {
  _: 'messageReactions'
  results: ReactionCount[]
  recent_reactions?: MessagePeerReaction[]
  top_reactors?: MessageReactor[]
}

/**
 * КЛИЕНТСКИЕ параметры сообщения: их ставит ГРАНИЦА разбора, на проводе их нет.
 * `peerId`/`fromId` — знаковые ключи (объявлены клиентскими у самого
 * оригинала, `schema/schema_additional_params.json`); остальные три наши.
 */
type MessageClientKeys = 'peerId' | 'fromId' | 'failed' | 'localUrl' | 'transcription'

/**
 * Проводное сообщение — ТОТ ЖЕ тип, что модель, минус клиентские параметры и с
 * двумя послаблениями границы: `pFlags` может не приехать вовсе, а
 * `effect_name` на проводе просто строка (в пресет-имя его сужает `mapEffect`).
 *
 * Прежде здесь стояла ВТОРАЯ, рукописная декларация тех же полей — и она уже
 * разошлась с моделью: в ней не было ни `localUrl`, ни `transcription`, ни
 * `failed`. Ровно это фаза 3 и называет: умирает не функция-маппер, а ПАРА
 * независимо поддерживаемых деклараций одного объекта. Теперь расходиться
 * нечему — декларация одна, вторая выведена из неё.
 */
export type RawMessageReal =
  Omit<MessageReal, MessageClientKeys | 'pFlags' | 'effect_name'>
  & { pFlags?: MessagePFlags; effect_name?: string }

export type RawMessageService =
  Omit<MessageService, MessageClientKeys | 'pFlags'>
  & { pFlags?: MessagePFlags }

export type RawMessageEmpty = Omit<MessageEmpty, 'peerId'>

export type RawMessage = RawMessageEmpty | RawMessageReal | RawMessageService

/**
 * Проводное сообщение БЕЗ дыры. Историю, поиск, закреплённые и тред сервер
 * отдаёт только настоящими сообщениями: `messageEmpty` производит ровно одна
 * ручка — `GET /chats/{peerID}/messages?ids=` (разрешение ссылок). Тип
 * запрещает положить дыру в окно, вместо того чтобы молча её отфильтровать.
 */
export type RawMyMessage = RawMessageReal | RawMessageService

/** Ссылка на отвечаемое: единственное, что меняется, — пространство номеров. */
function mapReplyHeader(h: MessageReplyHeader | undefined): MessageReplyHeader | undefined {
  if (!h) return undefined
  const out: MessageReplyHeader = { ...h }
  if (h.reply_to_msg_id !== undefined) out.reply_to_msg_id = generateMessageId(h.reply_to_msg_id)
  if (h.reply_to_top_id !== undefined) out.reply_to_top_id = generateMessageId(h.reply_to_top_id)
  return out
}

/**
 * Проводное сообщение → модель. Разбирать почти нечего: формы совпали, и
 * маппер остался ровно тем, чем должен, — ГРАНИЦЕЙ. Он переводит номера в
 * клиентское пространство и выводит знаковые ключи пиров.
 *
 * `meId` нужен ровно одному: уточнению служебного действия до синтетического
 * конструктора («Вы присоединились» против «X присоединился»).
 */
/** Тот же маппер для путей, где дыры не бывает (см. `RawMyMessage`). */
export function mapMyMessage(r: RawMyMessage, meId: PeerId | null = null): MyMessage {
  return mapMessage(r, meId) as MyMessage
}

export function mapMessage(r: RawMessage, meId: PeerId | null = null): Message {
  const peerId = getPeerId(r.peer_id)
  if (r._ === 'messageEmpty') return { _: 'messageEmpty', id: generateMessageId(r.id), peer_id: r.peer_id, peerId }

  const fromId = r.from_id ? getPeerId(r.from_id) : undefined
  const common = {
    pFlags: r.pFlags ?? {},
    id: generateMessageId(r.id),
    from_id: r.from_id,
    peer_id: r.peer_id,
    reply_to: mapReplyHeader(r.reply_to),
    date: r.date,
    ttl_period: r.ttl_period,
    peerId,
    fromId,
    random_id: r.random_id,
    secret: r.secret,
    secretMedia: r.secretMedia,
    // Агрегат реакций едет КАК ЕСТЬ: форма провода и форма модели совпали.
    reactions: r.reactions,
  }

  if (r._ === 'messageService') {
    // Синтетические конструкторы уточняет КЛИЕНТ — сервер производит только
    // настоящие (порт appMessagesManager.ts:5215-5238).
    return { ...common, _: 'messageService', action: refineMessageAction(r.action, fromId, meId) }
  }

  return {
    ...common,
    _: 'message',
    fwd_from: r.fwd_from,
    message: r.message,
    // Вложение нормализуется здесь один раз: `saveMessageMedia` выводит
    // `doc.type`/`w`/`h`/`duration`/`file_name` из атрибутов и mime — порт
    // `appDocsManager.saveDoc`.
    media: saveMessageMedia(r.media),
    reply_markup: r.reply_markup,
    entities: r.entities,
    views: r.views,
    forwards: r.forwards,
    // Тред кладётся вербатим: номеров сообщений внутри него нет (`max_id`/
    // `read_max_id` мы не производим), поэтому переводить нечего.
    replies: r.replies,
    edit_date: r.edit_date,
    grouped_id: r.grouped_id,
    effect_name: mapEffect(r.effect_name),
    factcheck: r.factcheck,
    send_at: r.send_at,
    when_online: r.when_online,
    enc_body: r.enc_body,
    destruct_at: r.destruct_at,
  }
}

