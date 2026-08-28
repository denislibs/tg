// Состояние RTMP-трансляций (Telegram livestream). activeByChat — какие чаты
// сейчас вещают (плашка LIVE + баннер «смотреть» у всех участников, live через
// кадр livestream_update). watchingPeerId — трансляция, которую мы сейчас
// смотрим (открыт LivestreamScreen). Число зрителей берётся из groupCallStore
// (зритель регистрируется как участник группового звонка) — здесь не дублируем.
import { create } from 'zustand'

interface LivestreamState {
  /** чаты с активной трансляцией */
  activeByChat: Record<number, boolean>
  /** чат трансляции, которую мы сейчас смотрим (null — не смотрим) */
  watchingPeerId: number | null

  setActive: (peerId: number, active: boolean) => void
  setWatching: (peerId: number | null) => void
}

export const useLivestreamStore = create<LivestreamState>((set) => ({
  activeByChat: {},
  watchingPeerId: null,

  setActive: (peerId, active) =>
    set((s) => ({ activeByChat: { ...s.activeByChat, [peerId]: active } })),
  setWatching: (peerId) => set({ watchingPeerId: peerId }),
}))
