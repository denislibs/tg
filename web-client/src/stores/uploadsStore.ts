// Прогресс отгрузки медиа по clientMsgId (0..1). Наполняется из
// media:upload_progress (воркер), очищается по завершении аплоада —
// кольцо-прелоадер на оптимистичном бабле живёт, пока есть запись.
import { create } from 'zustand'

interface UploadsState {
  byId: Record<string, number>
  setProgress: (id: string, fraction: number) => void
  clear: (id: string) => void
}

export const useUploadsStore = create<UploadsState>((set) => ({
  byId: {},
  setProgress: (id, fraction) => set((s) => ({ byId: { ...s.byId, [id]: fraction } })),
  clear: (id) =>
    set((s) => {
      if (!(id in s.byId)) return s
      const next = { ...s.byId }
      delete next[id]
      return { byId: next }
    }),
}))
