// Фабрика строки списка чатов ДЛЯ ТЕСТОВ.
//
// Заведена вместе с переводом `/chats` на контейнер: `dialog` стал настоящим
// конструктором схемы, у которого шесть ОБЯЗАТЕЛЬНЫХ параметров (`peer`,
// `top_message`, оба горизонта чтения, три счётчика, `notify_settings`).
// Расписывать их в каждом из двух десятков тестов значит переписывать все
// двадцать при каждом следующем шаге программы TL — и, что хуже, позволять им
// разойтись с формой провода поодиночке.
//
// Форму задаёт ОДНО место, и она же механически сверяется со схемой
// (`core/dialogs/dialog.schema.test.ts`).
import { WIRE_FOLDER_ARCHIVE, type Dialog } from '../models'
import { EMPTY_NOTIFY_SETTINGS, MUTE_UNTIL_FOREVER, type PeerNotifySettings } from './notifySettings'
import { toPeerId, type Peer } from '../peers/peerId'
import { makeMessage } from '../messages/testMessage'

/** Ссылка на пир из знакового ключа — обратная `getPeerId`. Знак и есть ответ
 *  на вопрос «пользователь или чат» (`core/peers/peerId.ts`). */
export function peerOf(peerId: PeerId): Peer {
  return peerId >= 0
    ? { _: 'peerUser', user_id: peerId }
    : { _: 'peerChannel', channel_id: Math.abs(peerId) }
}

export interface DialogFixture {
  peerId: PeerId
  topMessage?: number
  readInboxMaxId?: number
  readOutboxMaxId?: number
  unread?: number
  unreadMentions?: number
  unreadReactions?: number
  pinned?: boolean
  archived?: boolean
  /** unix-секунды; `true` — «навсегда» (тот же далёкий срок, что у бэкенда) */
  muteUntil?: number | true
  notifySettings?: PeerNotifySettings
  ttlPeriod?: number
  secret?: boolean
  lastMessage?: Dialog['lastMessage']
}

export function makeDialog(f: DialogFixture): Dialog {
  const notify: PeerNotifySettings = f.notifySettings ?? (f.muteUntil === undefined
    ? EMPTY_NOTIFY_SETTINGS
    : { _: 'peerNotifySettings', mute_until: f.muteUntil === true ? MUTE_UNTIL_FOREVER : f.muteUntil })
  return {
    _: 'dialog',
    peerId: toPeerId(f.peerId),
    peer: peerOf(f.peerId),
    top_message: f.topMessage ?? f.lastMessage?.id ?? 0,
    read_inbox_max_id: f.readInboxMaxId ?? 0,
    read_outbox_max_id: f.readOutboxMaxId ?? 0,
    unread_count: f.unread ?? 0,
    unread_mentions_count: f.unreadMentions ?? 0,
    unread_reactions_count: f.unreadReactions ?? 0,
    notify_settings: notify,
    // «Выключено» у булева флага схемы — ОТСУТСТВИЕ ключа, а не `false`.
    ...(f.pinned ? { pFlags: { pinned: true as const } } : {}),
    ...(f.archived ? { folder_id: WIRE_FOLDER_ARCHIVE as 1 } : {}),
    ...(f.ttlPeriod ? { ttl_period: f.ttlPeriod } : {}),
    ...(f.secret ? { secret: true } : {}),
    ...(f.lastMessage ? { lastMessage: f.lastMessage } : {}),
  }
}

/** Последнее сообщение для превью — та же фабрика, что у самих сообщений
 *  (`core/messages/testMessage.ts`): второй формы сообщения в тестах быть не
 *  должно ровно по той же причине, по какой её больше нет на проводе. */
export const makeLastMessage = makeMessage
