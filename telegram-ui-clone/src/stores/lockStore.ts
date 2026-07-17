// Состояние блокировки приложения код-паролем (tweb PasscodeLockScreenController):
// locked показывает полноэкранный PasscodeLockScreen; попытки и таймаут —
// как в tweb (5 попыток, затем 60 секунд ожидания).
import { create } from 'zustand'

interface LockState {
  locked: boolean
  attempts: number
  retryAt: number // ms-таймштамп, до которого ввод заблокирован (0 — нет)
  lock: () => void
  unlock: () => void
  failedAttempt: (max: number, timeoutMs: number) => void
}

export const useLockStore = create<LockState>((set, get) => ({
  locked: false,
  attempts: 0,
  retryAt: 0,
  lock: () => set({ locked: true, attempts: 0, retryAt: 0 }),
  unlock: () => set({ locked: false, attempts: 0, retryAt: 0 }),
  failedAttempt: (max, timeoutMs) => {
    const n = get().attempts + 1
    if (n >= max) set({ attempts: 0, retryAt: Date.now() + timeoutMs })
    else set({ attempts: n })
  },
}))
