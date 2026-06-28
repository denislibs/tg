import { create } from 'zustand'

// Tracks which incoming voice messages have been listened to (the "unlistened"
// bold dot). Persisted locally — cross-device sync would need a backend flag.
const KEY = 'tg-voice-played'

function load(): Record<number, true> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

interface PlayedState {
  played: Record<number, true>
  mark: (msgId: number) => void
}

export const useVoicePlayed = create<PlayedState>((set, get) => ({
  played: load(),
  mark: (msgId) => {
    if (get().played[msgId]) return
    const next = { ...get().played, [msgId]: true as const }
    set({ played: next })
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* ignore quota */
    }
  },
}))
