// secretChatStore.ts — состояние E2E-handshake секретного чата по chatId
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
  setStatus: (chatId: number, status: SecretStatus) => void
  setFingerprint: (chatId: number, fingerprint: string[]) => void
}

export const useSecretChatStore = create<SecretChatState>((set) => ({
  byChat: {},
  setStatus: (chatId, status) =>
    set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...s.byChat[chatId], status } } })),
  setFingerprint: (chatId, fingerprint) =>
    set((s) => ({ byChat: { ...s.byChat, [chatId]: { ...s.byChat[chatId], fingerprint } } })),
}))
