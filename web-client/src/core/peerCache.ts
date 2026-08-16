// src/core/peerCache.ts
//
// НЕреактивное зеркало карточек пиров на главном потоке. Владелец факта —
// воркерный `core/managers/peersManager.ts` (он решает, ЧТО изменилось, и
// публикует это операцией `rt:peer_op`); здесь только применение объявленного,
// синхронное чтение на рендере и подписка на движение зеркала.
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
import type { Peer, PeerOp } from './managers/peersManager'

const peerMirror = new Map<number, Peer>()

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
 *  пробел владельцу через `managers.peers.fillMirror`). */
export function cachedPeer(id: number): Peer | undefined {
  return peerMirror.get(id)
}

// id совпадают по построению (сравниваем разные версии одной карточки) — тот же
// предикат, что у владельца (`peersManager::same`).
const same = (a: Peer, b: Peer) =>
  a.username === b.username && a.displayName === b.displayName &&
  a.avatarUrl === b.avatarUrl && a.avatarPreview === b.avatarPreview

/** Применить операции, посчитанные владельцем. Единственный вызывающий —
 *  проектор (`APPLY[RT.peerOp]`). Не изменившая ничего пачка подписчиков не
 *  будит (идемпотентный реплей / повторный ответ на пробел не даёт ре-рендера). */
export function applyPeerOps(ops: readonly PeerOp[]): void {
  let changed = false
  for (const op of ops) {
    if (op.op === 'upsert') {
      for (const p of op.peers) {
        const cur = peerMirror.get(p.id)
        if (cur && same(cur, p)) continue
        peerMirror.set(p.id, cur ? { ...cur, ...p } : p)
        changed = true
      }
      continue
    }
    // patch — точечные поля известной карточки (имя/username из user_update).
    // Неизвестных не заводит: их всё равно никто не рисует (правило владельца —
    // «карточку, которой в кэше ещё не было, не публикуем»).
    const cur = peerMirror.get(op.id)
    if (!cur) continue
    const next = { ...cur, ...op.fields }
    if (same(cur, next)) continue
    peerMirror.set(op.id, next)
    changed = true
  }

  if (!changed) return
  ++version
  subs.forEach((f) => f())
}

/** Кадр rt:logging_out: карточки прошлой сессии обязаны исчезнуть — зеркало
 *  отдаёт их синхронно на рендере, а `avatarUrl` приватен per-viewer (та же
 *  причина, что у `core/mediaCache.ts::resetMediaUrlMirror` и
 *  `core/history/messagesMirror.ts::resetMessagesMirror`). */
export function resetPeerMirror(): void {
  if (!peerMirror.size) return
  peerMirror.clear()
  ++version
  subs.forEach((f) => f())
}
