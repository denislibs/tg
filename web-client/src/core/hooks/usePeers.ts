import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useManagers } from './useManagers'
import type { Chat, User } from '../peers/peer'
import { cachedPeer, peerMirrorVersion, subscribePeerMirror } from '../peerCache'

// Stable cache key for a set of ids: sorted, deduped, comma-joined.
// Used as the effect dependency so reorderings/duplicates don't refetch.
export function peersKey(ids: PeerId[]): string {
  return Array.from(new Set(ids))
    .sort((a, b) => a - b)
    .join(',')
}

// Resolve a set of user ids to a name map. Reads the shared peer mirror (SSOT
// витрины), fetching only the ids not yet cached. Realtime user_update patches
// the mirror, so every usePeers consumer of a changed peer re-renders automatically.
//
// Stage 1C.2 (Task 2): хук объявляет ПРОБЕЛ зеркала (каких id нет в зеркале) —
// он единственный, кто этот пробел видит СО СТОРОНЫ REACT. Что за карточка и
// какой операцией её внести, решает владелец (peersManager), применяет проектор
// по rt:peer_op. Прежний `.then(upsert)` был вторым писателем и вторым походом
// в /users в паре с до-фетчем из storeProjection.
//
// Зеркало — `core/peerCache.ts`, обычный модуль, а не zustand: ту же карточку
// читает синхронно императивная лента (`components/chat/peerTitle.ts`), которой
// стор запрещён; второе зеркало того же факта завести нельзя. Отсюда
// `useSyncExternalStore` вместо селектора стора — ровно как `useMediaUrl` над
// `core/mediaCache.ts`.
//
// ЧИТАЕШЬ ЗЕРКАЛО ПИРОВ ИЗ НОВОГО МЕСТА — сначала прочти это. Наполнить его
// может только объявленный пробел (`peers.fillMirror`) либо объявление
// изменившегося факта. Обычные чтения карточек (`peers.getUsers` — двенадцать
// вызовов: инфо группы, права, закреплённые, звонки, тосты) в зеркало НЕ пишут:
// они рисуют по возвращённому массиву, а веером слали бы всем вкладкам карточки,
// которых ни одно зеркало не просило. Раньше слали — и это попутно наполняло
// зеркало, маскируя забытое объявление. Теперь не маскирует: пир, прочитанный
// из зеркала по id, который не проходил через объявление пробела, будет молча
// пустым. Либо бери его этим хуком, либо объяви пробел сам.
export function usePeers(ids: PeerId[]): Map<PeerId, User | Chat> {
  const managers = useManagers()
  const key = peersKey(ids)
  const version = useSyncExternalStore(subscribePeerMirror, peerMirrorVersion)

  useEffect(() => {
    if (ids.length === 0) return
    const missing = ids.filter((id) => !cachedPeer(id))
    if (missing.length) void managers.peers.fillMirror(missing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Subset map for the requested ids (recomputed when the mirror or ids change).
  return useMemo(() => {
    const m = new Map<PeerId, User | Chat>()
    for (const id of ids) {
      const p = cachedPeer(id)
      if (p) m.set(id, p)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version])
}
