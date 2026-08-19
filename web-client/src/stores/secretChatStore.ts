// secretChatStore.ts — состояние E2E-handshake секретного чата по peerId
// (нормализовано). Ключи чата живут в IndexedDB (core/secret/keyStore), здесь —
// только наблюдаемый статус и emoji-fingerprint для UI.
import { create } from 'zustand'

export type SecretStatus = 'requested' | 'awaiting' | 'established' | 'rejected'

interface SecretEntry {
  status: SecretStatus
  fingerprint?: string[]
}

interface SecretChatState {
  byChat: Record<number, SecretEntry>
  setStatus: (peerId: number, status: SecretStatus) => void
  setFingerprint: (peerId: number, fingerprint: string[]) => void
}

export const useSecretChatStore = create<SecretChatState>((set) => ({
  byChat: {},
  setStatus: (peerId, status) =>
    set((s) => ({ byChat: { ...s.byChat, [peerId]: { ...s.byChat[peerId], status } } })),
  setFingerprint: (peerId, fingerprint) =>
    set((s) => ({ byChat: { ...s.byChat, [peerId]: { ...s.byChat[peerId], fingerprint } } })),
}))
