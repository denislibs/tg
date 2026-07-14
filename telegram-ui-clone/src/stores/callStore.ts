// src/stores/callStore.ts
// Глобальное состояние 1:1 звонка. Стейт-машина — по tweb CALL_STATE
// (REQUESTING/PENDING → CONNECTING → CONNECTED → CLOSED): фазы outgoing/incoming
// (ringing) → connecting → active → ended. Пишет сюда только callEngine
// (core/calls/callEngine.ts); UI (CallScreen) читает и зовёт методы движка.
import { create } from 'zustand'

export type CallPhase = 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended'
export type CallEndReason = 'hangup' | 'declined' | 'busy' | 'missed' | 'failed'

export interface CallPeer {
  id: number
  name: string
  avatar: string // gradient background
  avatarText?: string
  avatarUrl?: string
}

export interface ActiveCall {
  callId: string
  peer: CallPeer
  outgoing: boolean
  video: boolean // видеозвонок (камера включена при старте)
  phase: CallPhase
  muted: boolean
  camOn: boolean
  screenOn: boolean
  remoteMuted: boolean
  remoteCamOn: boolean
  /** Date.now()-время перехода в active — для таймера длительности */
  connectedAt: number | null
  endReason?: CallEndReason
  /** live-потоки WebRTC (object refs; ставит движок) */
  localStream: MediaStream | null
  remoteStream: MediaStream | null
}

interface CallState {
  call: ActiveCall | null
  set: (call: ActiveCall | null) => void
  patch: (p: Partial<ActiveCall>) => void
}

export const useCallStore = create<CallState>((set) => ({
  call: null,
  set: (call) => set({ call }),
  patch: (p) => set((s) => (s.call ? { call: { ...s.call, ...p } } : {})),
}))
