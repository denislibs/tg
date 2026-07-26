// src/stores/pinsStore.ts
// Pinned messages per chat, single-sourced in a store. realtimeBridge is the only
// place that reacts to the rt:pin_message socket frame (it refetches and writes
// here); usePinnedBar just reads. Keeps the "only realtimeBridge subscribes to the
// socket" invariant — no view-layer listener.
import { create } from 'zustand'
import type { Message } from '../core/models'

interface PinsState {
  byChat: Record<number, Message[]>
  setPins: (chatId: number, pins: Message[]) => void
}

export const usePinsStore = create<PinsState>((set) => ({
  byChat: {},
  setPins: (chatId, pins) => set((s) => ({ byChat: { ...s.byChat, [chatId]: pins } })),
}))
