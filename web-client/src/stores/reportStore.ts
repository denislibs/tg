// src/stores/reportStore.ts
// Цель текущей жалобы (tweb reportMessages / reportPeer): чат целиком или
// выбранные сообщения. Открывается из контекстного меню сообщения и из ⋮-меню
// чата; попап ReportPopup (смонтирован глобально в App) читает эту цель, поэтому
// оба места-триггера не тянут пропсы через Chat.
import { create } from 'zustand'

export interface ReportTarget {
  peerId: number
  /** КЛИЕНТСКИЕ mid выбранных сообщений; пусто — жалоба на чат целиком */
  mids: number[]
}

interface ReportState {
  target: ReportTarget | null
  open: (target: ReportTarget) => void
  close: () => void
}

export const useReportStore = create<ReportState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
