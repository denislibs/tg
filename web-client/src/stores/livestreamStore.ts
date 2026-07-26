// Состояние RTMP-трансляций (Telegram livestream). activeByChat — какие чаты
// сейчас вещают (плашка LIVE + баннер «смотреть» у всех участников, live через
// кадр livestream_update). watchingChatId — трансляция, которую мы сейчас
// смотрим (открыт LivestreamScreen). Число зрителей берётся из groupCallStore
// (зритель регистрируется как участник группового звонка) — здесь не дублируем.
import { create } from 'zustand'

interface LivestreamState {
  /** чаты с активной трансляцией */
  activeByChat: Record<number, boolean>
  /** чат трансляции, которую мы сейчас смотрим (null — не смотрим) */
  watchingChatId: number | null

  setActive: (chatId: number, active: boolean) => void
  setWatching: (chatId: number | null) => void
}

export const useLivestreamStore = create<LivestreamState>((set) => ({
  activeByChat: {},
  watchingChatId: null,

  setActive: (chatId, active) =>
    set((s) => ({ activeByChat: { ...s.activeByChat, [chatId]: active } })),
  setWatching: (chatId) => set({ watchingChatId: chatId }),
}))
