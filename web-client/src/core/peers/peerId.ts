// Ключ пира — знаковое число: пользователь ≥ 0, чат < 0.
//
// Порт `utils/peers/isUser.ts`, `utils/peers/isAnyChat.ts`,
// `helpers/peerIdPolyfill.ts:20-37` и `utils/peers/getPeerId.ts:5-28` из
// оригинала. Тип `PeerId` объявлен глобально (`src/global.d.ts:35`, портирован
// дословно) и до этого шага не использовался ни разу — здесь он становится
// живым.
//
// ── Почему ключ один, а пространств у нас было три ──────────────────────────
// Было: `users.id`, `chats.id` (включая приватные) и формально объявленный
// `PeerId`. Стало — как в оригинале: приватного чата КАК СУЩНОСТИ не
// существует, ключ разговора с человеком это id самого человека. Строка в
// `chats` для приватного диалога осталась внутренней деталью сервера и наружу
// не выходит никогда (`backend/internal/usecase/chat/peeraddr.go`).
//
// ── Асимметрия приватного диалога ───────────────────────────────────────────
// Из «ключ приватного диалога = id собеседника» следует, что у ОДНОГО разговора
// два разных ключа: у A это id B, у B это id A. Диалог принадлежит
// пользователю. Симметричное соответствие («один разговор — один ключ») — самая
// естественная ошибка здесь, и она перепутала бы диалоги: обе стороны получили
// бы ключ, указывающий на них же самих.
//
// Отсюда правило для всего клиента: ключ приватного диалога НЕ ВЫЧИСЛЯЕТСЯ на
// клиенте никогда. Он приходит с провода уже посчитанным глазами зрителя
// (`chatAddress.forViewer` на бэкенде), и функции ниже умеют только
// раскладывать знак — «чей это диалог» они не знают и знать не должны. Пин —
// `peerId.test.ts`.

/** Ключа нет (порт `NULL_PEER_ID`, `appManagers/constants.ts:9`). */
export const NULL_PEER_ID: PeerId = 0
/** Служебные сообщения Telegram (порт `SERVICE_PEER_ID`, `constants.ts:14`). */
export const SERVICE_PEER_ID: PeerId = 777000
/** Автор пересылки скрыл себя (порт `HIDDEN_PEER_ID`, `constants.ts:13`). */
export const HIDDEN_PEER_ID: PeerId = 2666000

/** Порт `utils/peers/isUser.ts` — пир это пользователь. */
export function isUser(peerId: PeerId): boolean {
  return +peerId >= 0
}

/** Порт `utils/peers/isAnyChat.ts` — пир это чат (группа/канал), любой. */
export function isAnyChat(peerId: PeerId): boolean {
  return +peerId < 0
}

// `UserId`/`ChatId` в схеме — `long`, и кодогенератор печатает их как
// `string | number` (`global.d.ts:31-32`, портировано дословно). На нашем
// проводе это всегда число, поэтому возвращаемый тип здесь `number`: иначе
// `string | number` протёк бы в арифметику знака, где `-'42'` и `Math.abs('42')`
// работают по-разному от места к месту.

/** Порт `Number.prototype.toChatId` (`peerIdPolyfill.ts:30-32`) — внутренний
 *  id чата из знакового ключа. */
export function toChatId(peerId: PeerId): number {
  return Math.abs(+peerId)
}

/** Порт `Number.prototype.toUserId` (`peerIdPolyfill.ts:25-27`). */
export function toUserId(peerId: PeerId): number {
  return +peerId
}

/** Порт `Number.prototype.toPeerId` (`peerIdPolyfill.ts:35-37`): знаковый ключ
 *  из «голого» id. `isChat` не задан — число уже является ключом. */
export function toPeerId(id: number, isChat?: boolean): PeerId {
  return isChat === undefined ? +id : isChat ? -Math.abs(+id) : +id
}

/** Порт `String.prototype.isPeerId` (`peerIdPolyfill.ts:20-22`) — строка из URL
 *  или атрибута узла является ключом пира. */
export function isPeerId(value: string): boolean {
  return /^-?\d+$/.test(value)
}

/** Разбор ключа из строки (маршрут, `data-peer-id`). Не ключ — `NULL_PEER_ID`. */
export function parsePeerId(value: string | null | undefined): PeerId {
  return value && isPeerId(value) ? +value : NULL_PEER_ID
}

/** Конструкторы `Peer` схемы: `peerUser` / `peerChat` / `peerChannel`. */
export type Peer =
  | { _: 'peerUser'; user_id: number }
  | { _: 'peerChat'; chat_id: number }
  | { _: 'peerChannel'; channel_id: number }

/**
 * Порт `utils/peers/getPeerId.ts:5-28` — знаковый ключ из конструктора `Peer`
 * (или из уже готового ключа / его строкового вида). Ветвление по `_`, как в
 * оригинале; неизвестный вход — `NULL_PEER_ID`, а не исключение (оригинал так
 * же молча отдаёт `NULL_PEER_ID`, :23).
 */
export function getPeerId(peer: Peer | PeerId | string | null | undefined): PeerId {
  if (peer === null || peer === undefined) return NULL_PEER_ID
  if (typeof peer === 'number') return peer
  if (typeof peer === 'string') return parsePeerId(peer)
  switch (peer._) {
    case 'peerUser':
      return toPeerId(peer.user_id, false)
    case 'peerChat':
      return toPeerId(peer.chat_id, true)
    case 'peerChannel':
      return toPeerId(peer.channel_id, true)
    default:
      return NULL_PEER_ID
  }
}

/**
 * Обратное направление — порт `appPeersManager.getOutputPeer`
 * (`appPeersManager.ts:59-70`). Расхождение одно, и оно следствие решения №2
 * разбора: базовый `chat` бэкенд не производит вовсе (любая наша группа —
 * `channel` + `pFlags.megagroup`), поэтому ветка `peerChat` недостижима и
 * различать конструкторы по кэшу чатов не на чем.
 */
export function getOutputPeer(peerId: PeerId): Peer {
  if (isUser(peerId)) return { _: 'peerUser', user_id: toUserId(peerId) }
  return { _: 'peerChannel', channel_id: toChatId(peerId) }
}
