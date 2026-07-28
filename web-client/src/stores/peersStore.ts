// Нормализованный реактивный стор пиров (id → карточка: имя/username/аватар) —
// единственный источник для имён/аватаров по всему приложению. Раньше каждый
// вызов usePeers держал свою копию в useState (дубль сущности по id); теперь
// пиры живут в сторе один раз, а realtime user_update патчит их — и все места,
// где нарисован пир, перерисовываются вместе.
import { create } from 'zustand'
import type { Peer } from '../core/managers/peersManager'

interface PeersState {
  byId: Record<number, Peer>
  /** Влить карточки (из фетча /users). Пишет только изменившиеся — ref окна пира
   * стабилен, если данные те же (мемоизированные потребители не перерисуются). */
  upsert: (peers: Peer[]) => void
  /** Точечный патч известного пира (realtime user_update: имя/username). Неизвестных
   * не заводит — их всё равно никто не рисует. */
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
