import { create } from 'zustand'
import type { Managers } from '../client/bootstrap'

// Баланс звёзд текущего пользователя. Единый источник — стор; обновляется
// начальной загрузкой (loadStars) и live-фреймом balance_update (realtimeBridge).
interface StarsState {
  balance: number
  loaded: boolean
  setBalance: (n: number) => void
}

export const useStarsStore = create<StarsState>((set) => ({
  balance: 0,
  loaded: false,
  setBalance: (n) => set({ balance: n, loaded: true }),
}))

// Первичная загрузка баланса (при старте приложения).
export async function loadStars(managers: Managers): Promise<void> {
  try {
    const balance = await managers.stars.balance()
    useStarsStore.getState().setBalance(balance)
  } catch {
    /* stars могут быть недоступны — фича мягко отключается */
  }
}
