// Состояние активных трансляций геопозиции (по чату) — для кнопки «Остановить» и
// отметки в бабле. Чистое хранилище: императивный lifecycle (watchPosition, таймеры,
// updateGeoLive) живёт в core/liveShareEngine, он же дёргает эти сеттеры.
import { create } from 'zustand'

interface ActiveShare {
  msgId: number
  until: number // unix ms — когда трансляция закончится
}

interface LiveShareState {
  active: Record<number, ActiveShare>
  setActive: (chatId: number, share: ActiveShare) => void
  clearActive: (chatId: number) => void
}

export const useLiveShareStore = create<LiveShareState>((set) => ({
  active: {},
  setActive: (chatId, share) => set((s) => ({ active: { ...s.active, [chatId]: share } })),
  clearActive: (chatId) =>
    set((s) => {
      const next = { ...s.active }
      delete next[chatId]
      return { active: next }
    }),
}))
