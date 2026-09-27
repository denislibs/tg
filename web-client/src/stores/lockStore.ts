// Состояние блокировки приложения код-паролем (tweb
// PasscodeLockScreenController.isLocked): экраном владеет
// `components/passcodeLock/passcodeLockScreenController.solid.tsx`, он же
// переключает `locked`. Попытки ввода считает сам экран, срок следующей попытки —
// `settings.passcodeCanAttemptAgainOn` (как у tweb `settings.passcode.canAttemptAgainOn`).
import { create } from 'zustand'

interface LockState {
  locked: boolean
  lock: () => void
  unlock: () => void
}

export const useLockStore = create<LockState>((set) => ({
  locked: false,
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}))
