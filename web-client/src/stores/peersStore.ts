// Нормализованный реактивный стор пиров (id → карточка: имя/username/аватар) —
// единственный источник для имён/аватаров по всему приложению. Раньше каждый
// вызов usePeers держал свою копию в useState (дубль сущности по id); теперь
// пиры живут в сторе один раз, а realtime user_update патчит их — и все места,
// где нарисован пир, перерисовываются вместе.
//
// Stage 1C.2 (Task 2): стор — ЗЕРКАЛО, а не владелец. Что именно изменилось в
// карточке, решает воркерный peersManager (единственный владелец) и публикует
// операцией rt:peer_op; единственный писатель этого стора — проектор
// (client/realtime/storeProjection.ts), который эти операции переигрывает.
// upsert/patch остаются публичным API, но зовутся только оттуда — держит
// stores/noDuplicatePeers.test.ts.
import { create } from 'zustand'
import type { Peer } from '../core/managers/peersManager'

interface PeersState {
  byId: Record<number, Peer>
  /** Влить карточки (операция upsert: ответ на объявленный пробел зеркала либо
   * замена уже лежавшей карточки). Пишет только изменившиеся — ref окна пира
   * стабилен, если данные те же (мемоизированные потребители не перерисуются). */
  upsert: (peers: Peer[]) => void
  /** Точечный патч известного пира (операция patch: имя/username из user_update).
   * Неизвестных не заводит — их всё равно никто не рисует. */
  patch: (id: number, fields: Partial<Peer>) => void
}

export const usePeersStore = create<PeersState>((set) => ({
  byId: {},
  upsert: (peers) =>
    set((s) => {
      let next: Record<number, Peer> | null = null
      for (const p of peers) {
        const cur = s.byId[p.id]
        if (cur && cur.username === p.username && cur.displayName === p.displayName && cur.avatarUrl === p.avatarUrl) continue
        if (!next) next = { ...s.byId }
        next[p.id] = cur ? { ...cur, ...p } : p
      }
      return next ? { byId: next } : {}
    }),
  patch: (id, fields) =>
    set((s) => {
      const cur = s.byId[id]
      if (!cur) return {}
      return { byId: { ...s.byId, [id]: { ...cur, ...fields } } }
    }),
}))
