import { create } from 'zustand'
import type { BoostStatus } from '../core/models'

// Состояние бустов каналов по peerId. setStatus — полный ответ на свой
// запрос/буст (с boostedByMe/slots). applyStatus — live-кадр boost_update
// (несёт только счётчик/уровень; своё boostedByMe/slots сохраняем локально).
interface BoostsState {
  byChat: Record<number, BoostStatus>
  setStatus: (peerId: number, status: BoostStatus) => void
  applyStatus: (peerId: number, status: BoostStatus) => void
}

export const useBoostsStore = create<BoostsState>((set) => ({
  byChat: {},
  setStatus: (peerId, status) =>
    set((s) => ({ byChat: { ...s.byChat, [peerId]: status } })),
  applyStatus: (peerId, status) =>
    set((s) => {
      const prev = s.byChat[peerId]
      const merged: BoostStatus = prev
        ? { ...status, boostedByMe: prev.boostedByMe, slots: prev.slots }
        : status
      return { byChat: { ...s.byChat, [peerId]: merged } }
    }),
}))
