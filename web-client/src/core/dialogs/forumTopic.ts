// src/core/dialogs/forumTopic.ts
//
// Тема форума — конструктор схемы `forumTopic` (tweb `layer.d.ts`,
// `ForumTopic.forumTopic`) в клиентском пространстве номеров, ровно как его
// держит хранилище тем оригинала (`lib/storages/dialogs.ts::forumTopics`).
//
// Одно число у темы — её номер: номер служебки `messageActionTopicCreate` в
// чате, у General — 1 (`GENERAL_TOPIC_ID`). Им адресуются строка списка
// (`data-thread-id`), тред (`threadId`), ручки (`getServerMessageId`) и
// кадры (`topic_id`/`top_msg_id`). Прежних двух адресов (внутренний ключ
// строки и номер корня) больше нет, как нет и флага `is_general`: General — это
// `id === GENERAL_TOPIC_ID` (tweb `constants.ts:26`).
import type { DraftMessage, MyMessage } from '../models'
import type { MessageService } from '../models'
import { GENERAL_TOPIC_ID, generateMessageId } from '../history/messageId'
import { getPeerId, type Peer } from '../peers/peerId'
import { PINNED_BASE } from './dialogIndex'
import { isPeerMuted, type PeerNotifySettings } from './notifySettings'

/**
 * `forumTopic` на проводе (tweb `layer.d.ts`, `ForumTopic.forumTopic`).
 *
 * Наш параметр один — `icon_emoji_emoticon` (объявлен в
 * `schema/schema_additional_params.json`): у схемы значок — номер документа
 * кастомного эмодзи (`icon_emoji_id`), кастом-эмодзи у нас нет.
 * `unread_poll_votes_count` не производится: голосов опроса как непрочитанного
 * у нас нет (О-73).
 */
export interface ForumTopicWire {
  _: 'forumTopic'
  pFlags?: Partial<{ my: true; closed: true; pinned: true; short: true; hidden: true; title_missing: true }>
  id: number
  date: number
  peer?: Peer
  title: string
  icon_color: number
  icon_emoji_emoticon?: string
  from_id: Peer
  top_message: number
  read_inbox_max_id: number
  read_outbox_max_id?: number
  unread_count: number
  unread_mentions_count: number
  unread_reactions_count?: number
  notify_settings: PeerNotifySettings
  draft?: DraftMessage
}

/**
 * Тема в хранилище — tweb `ForumTopic` (`appMessagesManager.ts`: конструктор +
 * `peerId` + индекс). Все номера — клиентские (`processTopics`, `saveDialog`,
 * `dialogs.ts:2219`, `:1564-1566`, `:1634-1636`).
 *
 * Расхождения:
 *  • индекс один — `index` (у оригинала `index_0` по ключу папки): у темы
 *    папка одна, сам форум;
 *  • `lastMessage` — разрешённое сообщение `top_message`: строка списка на
 *    главном потоке рисуется из значения, хранилища сообщений там нет (тот же
 *    приём, что у `Dialog.lastMessage`).
 */
export interface ForumTopic {
  _: 'forumTopic'
  peerId: PeerId
  pFlags: Partial<{ my: true; closed: true; pinned: true; short: true; hidden: true; title_missing: true }>
  id: number
  date: number
  title: string
  icon_color: number
  icon_emoji?: string
  fromId: PeerId
  top_message: number
  read_inbox_max_id: number
  read_outbox_max_id: number
  unread_count: number
  unread_mentions_count: number
  unread_reactions_count: number
  notify_settings: PeerNotifySettings
  draft?: DraftMessage
  index: number
  lastMessage?: MyMessage
}

/** tweb `utils/dialogs/isDialog.ts:13-15` */
export function isForumTopic(dialog: { _?: string } | undefined): dialog is ForumTopic {
  return dialog?._ === 'forumTopic'
}

/** tweb `constants.ts:26` — General по номеру. */
export function isGeneralTopic(topic: Pick<ForumTopic, 'id'>): boolean {
  return topic.id === GENERAL_TOPIC_ID
}

/**
 * Провод → тема хранилища: перевод номеров на границе (`processTopics`
 * `dialogs.ts:2219` для `id`, `saveDialog` `:1601-1636` для `top_message` и
 * горизонтов). Индекс ставит хранилище (`generateIndexForDialog`).
 */
export function toForumTopic(wire: ForumTopicWire, peerId: PeerId): ForumTopic {
  const out: ForumTopic = {
    _: 'forumTopic',
    peerId,
    pFlags: { ...wire.pFlags },
    id: generateMessageId(wire.id),
    date: wire.date,
    title: wire.title,
    icon_color: wire.icon_color,
    fromId: getPeerId(wire.from_id),
    top_message: wire.top_message ? generateMessageId(wire.top_message) : 0,
    read_inbox_max_id: wire.read_inbox_max_id ? generateMessageId(wire.read_inbox_max_id) : 0,
    read_outbox_max_id: wire.read_outbox_max_id ? generateMessageId(wire.read_outbox_max_id) : 0,
    unread_count: wire.unread_count ?? 0,
    unread_mentions_count: wire.unread_mentions_count ?? 0,
    unread_reactions_count: wire.unread_reactions_count ?? 0,
    notify_settings: wire.notify_settings ?? { _: 'peerNotifySettings' },
    index: 0,
  }
  if (wire.icon_emoji_emoticon) out.icon_emoji = wire.icon_emoji_emoticon
  if (wire.draft) out.draft = wire.draft
  return out
}

/**
 * Тема из служебки создания — порт `createBotforumTopicFromAction`
 * (`utils/dialogs/createBotforumTopicFromAction.ts:8-32`), которым tweb строит
 * тему сам, не дожидаясь `getForumTopicsByID` (`appMessagesManager.ts:10307-10319`).
 * Значения — буквально оригинала, включая `unread_count: 1` и `from_id` =
 * пир форума.
 */
export function createForumTopicFromAction(message: MessageService): ForumTopic | undefined {
  const action = message.action
  if (action._ !== 'messageActionTopicCreate') return undefined
  return {
    _: 'forumTopic',
    peerId: message.peerId,
    pFlags: {},
    id: message.id,
    date: message.date,
    title: action.title,
    icon_color: action.icon_color,
    ...(action.icon_emoji_emoticon ? { icon_emoji: action.icon_emoji_emoticon } : {}),
    fromId: message.peerId,
    top_message: message.id,
    read_inbox_max_id: 0,
    read_outbox_max_id: 0,
    unread_count: 1,
    unread_mentions_count: 0,
    unread_reactions_count: 0,
    notify_settings: { _: 'peerNotifySettings' },
    index: 0,
  }
}

/**
 * Индекс темы — `generateIndexForDialog` (`dialogs.ts:997-1020`) для темы:
 * закреплённая — `generateDialogPinnedDate` по порядку закрепа форума
 * (`pinnedOrders[peerId]`), иначе дата активности (`getDialogActivityDate`
 * `:1022-1047`: последнее сообщение либо более свежий черновик). Скрытой темы
 * впереди нет — `CAN_HIDE_TOPIC` выключен (`:1001`).
 *
 * Дата темы без сообщения — `date` самой темы: у оригинала там
 * `topDate ||= tsNow(true)` (`:1011`), недетерминированное время; то же
 * отступление, что у `dialogIndex` (`core/dialogs/dialogIndex.ts`).
 */
export function topicIndex(topic: ForumTopic, pinnedOrder: readonly number[]): number {
  if (topic.pFlags.pinned) {
    const idx = pinnedOrder.indexOf(topic.id)
    const pinnedIndex = idx === -1 ? 0 : idx
    const len = idx === -1 ? pinnedOrder.length + 1 : pinnedOrder.length
    return (PINNED_BASE + ((len - 1 - pinnedIndex) & 0xffff)) * 0x10000
  }
  let date = topic.lastMessage?.date ?? 0
  const draft = topic.draft?._ === 'draftMessage' ? topic.draft.date : 0
  if (draft > date) date = draft
  if (!date) date = topic.date
  return date * 0x10000 + (topic.id & 0xffff)
}

/**
 * Заглушена ли тема — `isPeerLocalMuted({peerId, threadId})`
 * (`appNotificationsManager.ts:396-410`): своя настройка темы, если она задана
 * (`silent`/`mute_until`), иначе — как форум (`forumMuted`, его считает
 * вызывающий: мьют диалога и типа чатов).
 */
export function isForumTopicMuted(topic: Pick<ForumTopic, 'notify_settings'>, forumMuted: () => boolean, now = Math.floor(Date.now() / 1000)): boolean {
  const s = topic.notify_settings
  if (s && (s.silent !== undefined || s.mute_until !== undefined)) return isPeerMuted(s, now)
  return forumMuted()
}

/**
 * Операции хранилища тем для вкладок — события tweb, которыми хранилище
 * говорит со списком тем (`components/autonomousDialogList/forumTopics.ts`):
 *  • `update` — `dialogs_multiupdate` с `topics` (`dialogs.ts:1360-1438`);
 *  • `unread` — `dialog_unread` темы;
 *  • `notify` — `dialog_notify_settings` темы (`appMessagesManager.ts:11769`);
 *  • `drop` — `dialog_drop` темы;
 *  • `forumUnread` — `dialog_unread` САМОГО ФОРУМА после изменения его тем
 *    (`processChangedUnreadOrUnmuted`, `dialogs.ts:968-985`): строка форума в
 *    списке чатов пересчитывает бейдж (О-71);
 *  • `edit` — `peer_title_edit`/`avatar_update` с `threadId`
 *    (`processTopicUpdate`, `dialogs.ts:1781-1797`);
 *  • `flush` — форум выключили (`chat_toggle_forum`, `dialogs.ts:186-192`).
 */
export type ForumTopicOp =
  | { op: 'update'; peerId: PeerId; topics: ForumTopic[] }
  | { op: 'unread'; topic: ForumTopic }
  | { op: 'notify'; topic: ForumTopic }
  | { op: 'drop'; peerId: PeerId; id: number }
  | { op: 'forumUnread'; peerId: PeerId }
  | { op: 'edit'; peerId: PeerId; id: number; title: boolean; icon: boolean }
  | { op: 'flush'; peerId: PeerId }
