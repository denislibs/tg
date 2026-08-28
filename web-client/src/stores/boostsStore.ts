import { create } from 'zustand'
import type { BoostsStatus } from '../core/models'
import { mergeBoosts, type ChannelBoosts } from '../core/boosts/boostsStatus'

// Бусты каналов по peerId. setStatus — ответ ручки (там и «бустнул ли я», и
// свободные слоты). applyStatus — живой кадр boost_update: тело одно на всех
// подписчиков, поэтому пер-зрительскую часть он не несёт и она сохраняется из
// прежнего состояния (см. mergeBoosts).
interface BoostsState {
  byChat: Record<number, ChannelBoosts>
  setStatus: (peerId: number, boosts: ChannelBoosts) => void
  applyStatus: (peerId: number, status: BoostsStatus) => void
}

export const useBoostsStore = create<BoostsState>((set) => ({
  byChat: {},
  setStatus: (peerId, boosts) =>
    set((s) => ({ byChat: { ...s.byChat, [peerId]: boosts } })),
  applyStatus: (peerId, status) =>
    set((s) => ({ byChat: { ...s.byChat, [peerId]: mergeBoosts(s.byChat[peerId], status) } })),
}))
