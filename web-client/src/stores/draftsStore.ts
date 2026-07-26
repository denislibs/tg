// Облачные черновики: нормализованное хранилище по chatId. Наполняется
// loadDrafts при старте, обновляется оптимистично из composer-хука и по
// rt:draft_update (синк с других устройств/вкладок).
import { create } from 'zustand'
import type { Draft } from '../core/models'

interface DraftsState {
  byChat: Record<number, Draft>
  setDraft: (d: Draft) => void
  removeDraft: (chatId: number) => void
  setAll: (list: Draft[]) => void
  clearAll: () => void
}

export const useDraftsStore = create<DraftsState>((set) => ({
  byChat: {},
  setDraft: (d) => set((s) => ({ byChat: { ...s.byChat, [d.chatId]: d } })),
  removeDraft: (chatId) =>
    set((s) => {
      if (!(chatId in s.byChat)) return s
      const next = { ...s.byChat }
      delete next[chatId]
      return { byChat: next }
    }),
  setAll: (list) => set({ byChat: Object.fromEntries(list.map((d) => [d.chatId, d])) }),
  clearAll: () => set({ byChat: {} }),
}))

export async function loadDrafts(managers: { drafts: { list(): Promise<Draft[]> } }): Promise<void> {
  try {
    useDraftsStore.getState().setAll(await managers.drafts.list())
  } catch {
    /* черновики не критичны — молча без них */
  }
}
