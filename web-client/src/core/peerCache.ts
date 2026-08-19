// src/core/peerCache.ts
//
// НЕреактивное зеркало карточек пиров на главном потоке. Владелец факта —
// воркерный `core/managers/peersManager.ts` (он решает, ЧТО изменилось, и
// публикует это операцией `rt:peer_op`); здесь только применение объявленного,
// синхронное чтение на рендере и подписка на движение зеркала.
//
// Ключ — знаковый `PeerId` (пользователь ≥ 0, чат < 0), значение — конструктор
// схемы (`user` / `channel` / …), то есть ровно то, что приехало с провода.
// Прежняя плоская карточка `{id, username, displayName, avatarUrl,
// avatarPreview}` исчезла: `displayName` на проводе больше нет вовсе (имя
// собирает клиент — `core/peers/getPeerTitle.ts`), а пять полей аватарки
// схлопнулись в `photo: UserProfilePhoto` с готовым `photo_id`.
//
// ПОЧЕМУ НЕ ZUSTAND (и почему стора `stores/peersStore.ts` больше нет).
// Карточку пира читает не только React: императивная лента (`components/chat/
// bubbles.ts`, порт tweb `ChatBubbles`) рисует имя автора обычным узлом бабла
// (`.peer-title[data-peer-id]`, порт `components/peerTitle.ts`) и обязана взять
// имя СИНХРОННО на построении узла, а zustand ей запрещён (см. этап переноса
// ленты и докблок `chat/bubbles.ts`). Заводить под ленту ВТОРОЕ зеркало того же
// факта нельзя — это ровно то «дублирование realtime-данных», от которого
// защищает web-client/CLAUDE.md. Поэтому зеркало ровно одно и лежит в обычном
// модуле: лента читает `cachedPeer` напрямую, React — через
// `core/hooks/usePeers` (`useSyncExternalStore` поверх `subscribePeerMirror`).
// Один в один как у медиа — `core/mediaCache.ts` (владелец `mediaManager`,
// зеркало-модуль, React-адаптер `useMediaUrl`); в tweb ту же роль играют
// `apiManagerProxy.mirrors`, из которых `PeerTitle` берёт пира синхронно.
//
// Единственный писатель — проектор (`client/realtime/storeProjection.ts`),
// пин — `core/noDuplicatePeers.test.ts`. Пробел зеркала объявляет тот, кто его
// переживает: React — `usePeers` (`peers.fillMirror`), лента — `peerTitle.ts`
// (тот же `fillMirror`); владелец отвечает на объявленный пробел ВСЕГДА,
// включая попадание в свой кэш (SuperMessagePort событий не буферизует).
import { getPeerTitle, type PeerTitleOptions } from './peers/getPeerTitle'
import { peerKey, type Chat, type User } from './peers/peer'
import type { PeerOp } from './managers/peersManager'
import { isAnyGroup, isBroadcast, isChannel, isForum, isInChat, isMegagroup } from './peers/predicates'
import { hasRights, type ChatRights } from './peers/rights'

const peerMirror = new Map<PeerId, User | Chat>()

// Версия-счётчик: снимок зеркала — коллекция, а не значение per-ключ (в отличие
// от `cachedMediaUrl`), и сравнивать её в `useSyncExternalStore` по Object.is
// нечем. Потребитель пересобирает свою выборку, когда версия сдвинулась.
let version = 0
const subs = new Set<() => void>()

export function subscribePeerMirror(cb: () => void): () => void {
  subs.add(cb)
  return () => { subs.delete(cb) }
}

export function peerMirrorVersion(): number {
  return version
}

/** Синхронное чтение на рендере: undefined — факт ещё не объявлен (объяви
 *  пробел владельцу через `managers.peers.fillMirror`).
 *
 *  Порт `appPeersManager.getPeer` (`appPeersManager.ts:87-91`): один вход на
 *  оба вида пира, ветвление по знаку ключа уже сделано при записи. */
export function cachedPeer(peerId: PeerId): User | Chat | undefined {
  return peerMirror.get(peerId)
}

/** Порт `appUsersManager.getUser` — карточка пользователя или undefined. */
export function cachedUser(peerId: PeerId): User | undefined {
  const peer = peerMirror.get(peerId)
  return peer && (peer._ === 'user' || peer._ === 'userEmpty') ? peer : undefined
}

/** Порт `appChatsManager.getChat` — карточка чата или undefined. */
export function cachedChat(peerId: PeerId): Chat | undefined {
  const peer = peerMirror.get(peerId)
  return peer && peer._ !== 'user' && peer._ !== 'userEmpty' ? peer : undefined
}

/**
 * Имя пира синхронно — то, ради чего зеркало и существует: `display_name` с
 * провода убран, и узел `.peer-title` собирает имя сам (порт
 * `components/wrappers/getPeerTitle.ts`, у нас `core/peers/getPeerTitle.ts`).
 * Карточки ещё нет — вернётся фолбэк оригинала («Удалённый аккаунт» у
 * пользователя, пусто у чата), а не пустая строка молча.
 */
export function peerTitle(peerId: PeerId, options: PeerTitleOptions & { limitSymbols?: number } = {}): string {
  return getPeerTitle({ ...options, peerId, peer: peerMirror.get(peerId) })
}

// ── Вид чата по ключу пира ──────────────────────────────────────────────────
// Порт `appPeersManager.isChannel/isMegagroup/isForum/isBroadcast/isAnyGroup`
// (`appPeersManager.ts:105-140`): там они ровно так же делегируют предикату над
// объектом чата, добытым из хранилища. Сами предикаты — чистые, лежат в
// `core/peers/predicates.ts`; здесь только разрешение ключа в карточку.
//
// ЭТО и есть замена 84 инлайновым сравнениям `type === '…'`: вопрос задаётся
// один раз и одинаково.

export const isChannelPeer = (peerId: PeerId): boolean => isChannel(cachedChat(peerId))
export const isMegagroupPeer = (peerId: PeerId): boolean => isMegagroup(cachedChat(peerId))
export const isForumPeer = (peerId: PeerId): boolean => isForum(cachedChat(peerId))
export const isBroadcastPeer = (peerId: PeerId): boolean => isBroadcast(cachedChat(peerId))
export const isAnyGroupPeer = (peerId: PeerId): boolean => isAnyGroup(peerId, cachedChat(peerId))
export const isInChatPeer = (peerId: PeerId): boolean => isInChat(cachedChat(peerId))

/** Порт `appChatsManager.hasRights(id, action)` — тот же вопрос по ключу пира.
 *  Карточки чата ещё нет — «нельзя»: ровно так же отвечает оригинал
 *  (`if(!chat) return false`), и это третье состояние отличает тот, кто ждёт
 *  карточку (см. `permissionsKnown` в `useChatInfoCard`). */
export const hasRightsPeer = (peerId: PeerId, action: ChatRights): boolean =>
  hasRights(cachedChat(peerId), action)

/** Применить операции, посчитанные владельцем. Единственный вызывающий —
 *  проектор (`APPLY[RT.peerOp]`). Не изменившая ничего пачка подписчиков не
 *  будит (идемпотентный реплей / повторный ответ на пробел не даёт ре-рендера).
 *
 *  Операция ровно одна — `upsert` с КАРТОЧКОЙ ЦЕЛИКОМ. Прежнего точечного
 *  `patch` больше нет: кадр `user_update` несёт конструктор `user` целиком
 *  (абсолютный снимок), а не выборку изменившихся полей, — сливать нечего. */
export function applyPeerOps(ops: readonly PeerOp[]): void {
  let changed = false
  for (const op of ops) {
    for (const peer of op.peers) {
      const key = peerKey(peer)
      const cur = peerMirror.get(key)
      if (cur && samePeer(cur, peer)) continue
      peerMirror.set(key, peer)
      changed = true
    }
  }

  if (!changed) return
  ++version
  subs.forEach((f) => f())
}

// Карточка — абсолютный снимок, поэтому сравниваем её целиком. Порядок ключей
// в JSON фиксирован обеими сторонами (Go marshal идёт по объявлению полей),
// значит строковое сравнение здесь дешевле и точнее ручного списка полей,
// который приходилось расширять при каждом новом поле пира.
const samePeer = (a: User | Chat, b: User | Chat) => JSON.stringify(a) === JSON.stringify(b)

/** Кадр rt:logging_out: карточки прошлой сессии обязаны исчезнуть — зеркало
 *  отдаёт их синхронно на рендере, а `photo` гасится правилом приватности
 *  per-viewer (та же причина, что у `core/mediaCache.ts::resetMediaUrlMirror` и
 *  `core/history/messagesMirror.ts::resetMessagesMirror`). */
export function resetPeerMirror(): void {
  if (!peerMirror.size) return
  peerMirror.clear()
  ++version
  subs.forEach((f) => f())
}
