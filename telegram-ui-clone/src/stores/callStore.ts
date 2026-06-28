// src/stores/callStore.ts
// Global call state + actions (the "logic"). A call belongs to a chat and may be
// voice or video. Lives in a store (not ConversationView) so any surface can start
// or end a call, and the call survives navigating between chats.
import { create } from 'zustand'
import type { Chat } from '../data'

export interface ActiveCall {
  chat: Chat
  video: boolean
}

interface CallState {
  call: ActiveCall | null
  startCall: (chat: Chat, video: boolean) => void
  endCall: () => void
}

export const useCallStore = create<CallState>((set) => ({
  call: null,
  startCall: (chat, video) => set({ call: { chat, video } }),
  endCall: () => set({ call: null }),
}))
