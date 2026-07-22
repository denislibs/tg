import { create } from 'zustand'
import type { BoostStatus } from '../core/models'

// Состояние бустов каналов по chatId. setStatus — полный ответ на свой
// запрос/буст (с boostedByMe/slots). applyStatus — live-кадр boost_update
// (несёт только счётчик/уровень; своё boostedByMe/slots сохраняем локально).
interface BoostsState {
  byChat: Record<number, BoostStatus>
  setStatus: (chatId: number, status: BoostStatus) => void
  applyStatus: (chatId: number, status: BoostStatus) => void
}

export const useBoostsStore = create<BoostsState>((set) => ({
  byChat: {},
  setStatus: (chatId, status) =>
    set((s) => ({ byChat: { ...s.byChat, [chatId]: status } })),
  applyStatus: (chatId, status) =>
    set((s) => {
      const prev = s.byChat[chatId]
      const merged: BoostStatus = prev
        ? { ...status, boostedByMe: prev.boostedByMe, slots: prev.slots }
        : status
      return { byChat: { ...s.byChat, [chatId]: merged } }
    }),
}))
