// Вид чата — предикаты вместо инлайновых сравнений.
//
// Порт `appChatsManager.isChannel/isMegagroup/isForum/isBroadcast/isInChat`
// (`appChatsManager.ts:298-343`) и `appPeersManager.isAnyGroup`
// (`appPeersManager.ts:117-119`).
//
// ── Зачем ───────────────────────────────────────────────────────────────────
// Было: `ChatKind = 'private'|'group'|'channel'|'saved'|'secret'` и 84
// инлайновых сравнения `type === '…'` в 25 файлах, ни одного предиката. Из
// строки нельзя вывести «супергруппа это канал или группа» — вопрос задавали
// заново в каждом файле и отвечали по-разному. В схеме вид чата это ВЫБОР
// КОНСТРУКТОРА (`chat` против `channel`) плюс `pFlags.broadcast`/`megagroup`/
// `forum`, а сравнения собраны в пять функций. Здесь — те же пять.
//
// Предикаты ЧИСТЫЕ и принимают сам объект чата: хранилище у нас на главном
// потоке своё (`core/peerCache.ts`), в воркере своё (`core/managers/
// peersManager.ts`), и завязывать предикат на одно из них значило бы, что
// второму придётся писать свой — ровно то раздвоение, которое эта работа
// убирает. Варианты «по ключу пира» лежат рядом с хранилищем: `cachedChat`
// в `core/peerCache.ts`.

import type { Chat } from './peer'
import { isUser } from './peerId'

/**
 * Порт `appChatsManager.isChannel` (`:298-301`) — чат является каналом или
 * супергруппой. Именно ЭТОТ предикат отвечает за «есть ли pts у чата», за
 * канальный журнал и за подписку на канальный топик; «broadcast» — другой
 * вопрос, см. `isBroadcast`.
 */
export function isChannel(chat: Chat | undefined): boolean {
  return !!chat && (chat._ === 'channel' || chat._ === 'channelForbidden')
}

/** Порт `appChatsManager.isMegagroup` (`:303-310`) — супергруппа. */
export function isMegagroup(chat: Chat | undefined): boolean {
  return !!(chat && (chat._ === 'channel' || chat._ === 'channelForbidden') && chat.pFlags?.megagroup)
}

/** Порт `appChatsManager.isForum` (`:312-315`) — в группе включены темы. */
export function isForum(chat: Chat | undefined): boolean {
  return !!(chat && chat._ === 'channel' && chat.pFlags?.forum)
}

/** Порт `appChatsManager.isBroadcast` (`:317-319`) — вещательный канал:
 *  канал, который НЕ супергруппа. */
export function isBroadcast(chat: Chat | undefined): boolean {
  return isChannel(chat) && !isMegagroup(chat)
}

/**
 * Порт `appPeersManager.isAnyGroup` (`:117-119`) — «любая группа»: пир это чат
 * и он не вещательный канал. Единственный предикат, которому нужен И ключ, И
 * объект: у оригинала он живёт этажом выше (`appPeersManager`), потому что
 * вопрос про ПИРА, а не про чат.
 */
export function isAnyGroup(peerId: PeerId, chat: Chat | undefined): boolean {
  return !isUser(peerId) && !isBroadcast(chat)
}

/**
 * Порт `appChatsManager.isInChat` (`:331-344`) — зритель состоит в чате
 * (иначе композер не показывают, а рисуют «Вернуться»/«Подписаться»).
 * Ветвление ровно по конструкторам оригинала.
 */
export function isInChat(chat: Chat | undefined): boolean {
  if (!chat) return false
  if (chat._ === 'chatEmpty' || chat._ === 'chatForbidden' || chat._ === 'channelForbidden') return false
  return !chat.pFlags?.left && !(chat._ === 'chat' && chat.pFlags?.deactivated)
}

/**
 * Порт `appChatsManager.isPublic` (`:367-370`) — у чата есть публичное имя.
 * В оригинале это `getPeerActiveUsernames(chat)[0]`; коллекции `usernames`
 * (несколько имён с флагом активности) у нас нет — предмета нет, есть одно
 * поле `username`. Прежнее булево `is_public` витрины исчезло: публичность и
 * ЕСТЬ наличие имени, второго источника у неё больше нет.
 */
export function isPublic(chat: Chat | undefined): boolean {
  return !!(chat && chat._ === 'channel' && chat.username)
}

/** Заголовок чата (`title`) — у `chatEmpty` его нет по схеме. */
export function getChatTitle(chat: Chat | undefined): string {
  return chat && chat._ !== 'chatEmpty' ? chat.title : ''
}

/** Фото чата: у `chatEmpty`/`*Forbidden` его в схеме нет вовсе. */
export function getChatPhoto(chat: Chat | undefined) {
  return chat && (chat._ === 'chat' || chat._ === 'channel') ? chat.photo : undefined
}
