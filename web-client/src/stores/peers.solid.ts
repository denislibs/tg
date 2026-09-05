/**
 * Порт tweb `src/stores/peers.ts` — реактивное чтение карточки пира для
 * Solid-компонентов (Task 1, волна 3 / этап 2, план
 * `docs/superpowers/plans/2026-09-05-profile-card-solid.md`).
 *
 * ── Источник данных — существующее зеркало, не новый стор ──────────────────
 * У оригинала это Solid `createStore` (`stores/peers.ts:7`), которым файл
 * владеет САМ. У нас карточку пира уже держит `core/peerCache.ts` — обычный
 * модуль с ручной подпиской, владелец факта — воркерный `peersManager`,
 * применяет операции проектор (`client/realtime/storeProjection.ts`). Заводить
 * рядом ЕЩЁ один реактивный стор с той же картой значило бы завести ВТОРОЕ
 * зеркало факта, который прямо запрещён разделом «Владение фактами»
 * `web-client/CLAUDE.md` («второй копии окна/факта быть не должно»). Поэтому
 * здесь нет `createStore` вовсе: `subscribeExternal`
 * (`helpers/solid/subscribeExternal.ts`) заворачивает готовые
 * `subscribePeerMirror`/`peerMirrorVersion` в Solid-сигнал, а геттером
 * значения служит тот же `cachedPeer`, каким читает React (`usePeers`,
 * `core/hooks/usePeers.ts`) и императивная лента (`peerTitle.ts`).
 *
 * ── Пробел зеркала объявляет ЭТОТ модуль ────────────────────────────────────
 * У оригинала стор не запрашивает сеть вовсе — карточка приезжает откуда-то
 * ещё (реалтайм-апдейты и первичная гидратация диалогов держат `state`
 * заполненным заранее). У нас читатель, увидевший пробел, обязан объявить его
 * сам (см. докблок `core/peerCache.ts` и `usePeers.ts`): `usePeers` в React и
 * `PeerTitle` в ленте уже это делают, здесь — третий читатель того же факта,
 * третье место с тем же вызовом `managers.peers.fillMirror`. Приехавшую
 * карточку по-прежнему пишет только проектор (`applyPeerOps`) — читатель её не
 * сохраняет, только просит. Экспортов-писателей `reconcilePeer`/`reconcilePeers`
 * (`stores/peers.ts:21-27`) здесь нет НАМЕРЕННО: у нас один писатель зеркала —
 * проектор, второй писатель (даже с тем же именем и тем же интерфейсом) был бы
 * вторым источником того же факта, который и держит зеркало неделимым.
 *
 * ── `managers` — `startClient().managers`, а не React-контекст ─────────────
 * Этот файл — СТОР (`stores/*`), а не React-компонент. Докблок
 * `core/hooks/useManagers.tsx` разводит это явно: «Non-React code (stores,
 * worker setup, module-level utils) keeps calling startClient() directly — DI
 * is only for the React tree». Прямой аналог того, чем для оригинала является
 * модульный синглтон `rootScope.managers.appPeersManager` — только у нас он не
 * глобальная переменная, а кэширующая фабрика (`client/bootstrap.ts`).
 */
import { createEffect, on, type Accessor } from 'solid-js'
import { startClient } from '../client/bootstrap'
import { subscribeExternal } from '../helpers/solid/subscribeExternal'
import createMemoOrReturn, { type ValueOrGetter } from '../helpers/solid/createMemoOrReturn'
import { cachedPeer, subscribePeerMirror, peerMirrorVersion } from '../core/peerCache'
import type { Chat, User } from '../core/peers/peer'
import { toPeerId } from '../core/peers/peerId'

/**
 * Общая механика трёх экспортов ниже: подписаться на движение зеркала,
 * объявить пробел РОВНО при смене ключа (не при каждом бампе версии зеркала —
 * иначе повторный `fillMirror` летел бы на каждый чужой апдейт), прочитать
 * значение через `toKey`.
 *
 * `createEffect(on(idAccessor, …))` — тот же приём, которым React-хук
 * `usePeers` объявляет пробел в `useEffect([key])`: тело эффекта не читает
 * реактивных зависимостей из зеркала, поэтому он не перезапускается от
 * `version()` — только от смены самого ключа.
 */
function usePeerEntry<T extends ValueOrGetter<any>, R, K = T extends Accessor<infer V> ? V : T>(
  keyOrGetter: T,
  toKey: (raw: K) => PeerId,
): T extends Accessor<any> ? Accessor<R> : R {
  const version = subscribeExternal(subscribePeerMirror, peerMirrorVersion)

  const idAccessor: Accessor<PeerId> =
    typeof keyOrGetter === 'function'
      ? () => toKey((keyOrGetter as Accessor<K>)())
      : () => toKey(keyOrGetter as unknown as K)

  createEffect(
    on(idAccessor, (id) => {
      if (cachedPeer(id) === undefined) void startClient().managers.peers.fillMirror([id])
    }),
  )

  return createMemoOrReturn(keyOrGetter, (raw: K) => {
    version() // трекаем движение зеркала — источник значения ниже
    return cachedPeer(toKey(raw)) as R
  })
}

export function usePeer<T extends ValueOrGetter<PeerId>>(peerId: T) {
  return usePeerEntry<T, User | Chat>(peerId, (id) => id as PeerId)
}

export function useChat<T extends ValueOrGetter<ChatId>>(chatId: T) {
  return usePeerEntry<T, Chat>(chatId, (id) => toPeerId(id as number, true))
}

export function useUser<T extends ValueOrGetter<UserId>>(userId: T) {
  return usePeerEntry<T, User>(userId, (id) => toPeerId(id as number, false))
}
