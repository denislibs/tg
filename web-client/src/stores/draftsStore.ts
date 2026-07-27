// Облачные черновики: нормализованное хранилище по chatId. Наполняется
// loadDrafts при старте, обновляется оптимистично из composer-хука и по
// rt:draft_update (синк с других устройств/вкладок).
import { create } from 'zustand'
import type { Draft } from '../core/models'
import { saveDrafts as savePersistedDrafts, loadDrafts as loadPersistedDrafts } from '../core/store/persist'

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
  const st = useDraftsStore.getState()
  // offline-first: поднять персистнутые черновики (текст композера по чатам не
  // теряется офлайн), сеть реконсайлит поверх. Пре-гидрация только при пустом сторе.
  if (!Object.keys(st.byChat).length) {
    const cached = await loadPersistedDrafts()
    if (cached.length) st.setAll(cached)
  }
  try {
    st.setAll(await managers.drafts.list())
  } catch {
    /* оффлайн — остаёмся на персистнутых черновиках */
  }
}

// Подписка на стор: дебаунсом персистит карту черновиков (загрузка + оптимистичные
// правки из композера + rt:draft_update), чтобы офлайн текст не терялся. Вызывать один раз.
export function startDraftsPersist(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = useDraftsStore.getState().byChat
  useDraftsStore.subscribe((s) => {
    if (s.byChat === last) return
    last = s.byChat
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void savePersistedDrafts(Object.values(useDraftsStore.getState().byChat))
    }, 800)
  })
}
