// Состояние группового звонка (видеочата): один активный на клиент.
// activeByChat — участники идущих звонков по чатам (баннер «Видеочат» у всех
// членов, live через group_call_update). Медиапотоки живут в groupCallEngine
// (не в сторе — MediaStream не сериализуем и не нужен для рендера списка),
// стор держит только версию для перерисовки.
import { create } from 'zustand'

export interface GroupCallParticipant {
  userId: number
  muted: boolean
  videoOn: boolean
}

interface GroupCallState {
  /** чат активного звонка, в котором сидим мы (null — не в звонке) */
  chatId: number | null
  connecting: boolean
  micOn: boolean
  camOn: boolean
  participants: Record<number, GroupCallParticipant>
  /** версия медиапотоков: engine инкрементит при ontrack → ре-рендер тайлов */
  streamsVersion: number
  /** участники идущих звонков по всем чатам (для баннера Join) */
  activeByChat: Record<number, number[]>

  setJoined: (chatId: number) => void
  setConnecting: (v: boolean) => void
  setMedia: (micOn: boolean, camOn: boolean) => void
  upsertParticipant: (p: GroupCallParticipant) => void
  removeParticipant: (userId: number) => void
  bumpStreams: () => void
  setActive: (chatId: number, userIds: number[]) => void
  reset: () => void
}

export const useGroupCallStore = create<GroupCallState>((set) => ({
  chatId: null,
  connecting: false,
  micOn: true,
  camOn: false,
  participants: {},
  streamsVersion: 0,
  activeByChat: {},

  setJoined: (chatId) => set({ chatId, connecting: false }),
  setConnecting: (v) => set({ connecting: v }),
  setMedia: (micOn, camOn) => set({ micOn, camOn }),
  upsertParticipant: (p) =>
    set((s) => ({ participants: { ...s.participants, [p.userId]: { ...s.participants[p.userId], ...p } } })),
  removeParticipant: (userId) =>
    set((s) => {
      const next = { ...s.participants }
      delete next[userId]
      return { participants: next }
    }),
  bumpStreams: () => set((s) => ({ streamsVersion: s.streamsVersion + 1 })),
  setActive: (chatId, userIds) =>
    set((s) => ({ activeByChat: { ...s.activeByChat, [chatId]: userIds } })),
  reset: () => set({ chatId: null, connecting: false, micOn: true, camOn: false, participants: {}, streamsVersion: 0 }),
}))
