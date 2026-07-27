import { create } from 'zustand'

// Флаг «доступна новая сборка»: выставляет versionCheck при расхождении public/version
// с вкомпиленным __APP_VERSION_FULL__; App показывает кнопку «Обновить приложение».
interface UpdateState {
  available: boolean
  markAvailable: () => void
}

export const useUpdateStore = create<UpdateState>((set) => ({
  available: false,
  markAvailable: () => set({ available: true }),
}))
