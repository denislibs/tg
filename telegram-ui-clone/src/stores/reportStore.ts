// src/stores/reportStore.ts
// Цель текущей жалобы (tweb reportMessages / reportPeer): чат целиком или
// конкретное сообщение. Открывается из контекстного меню сообщения и из ⋮-меню
// чата; попап ReportPopup (смонтирован глобально в App) читает эту цель, поэтому
// оба места-триггера не тянут пропсы через ConversationView.
import { create } from 'zustand'

export interface ReportTarget {
  chatId: number
  /** id сообщения; не задан — жалоба на чат целиком */
  msgId?: number
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
