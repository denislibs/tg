// Баланс звёзд текущего пользователя. Живёт в State (`starsBalance`) — как и
// прочие конфиг-подобные значения tweb, читается одним батчем на старте
// (client/boot.ts), поэтому баланс есть уже в первом кадре. Обновляется
// начальной загрузкой (loadStars), live-фреймом balance_update (storeProjection)
// и операциями, которые возвращают новый баланс (пополнение/подарки/реакции).
import { useAppStateKey, useAppStateStore, setAppState } from './appState'

/** Реактивное чтение баланса — единственный способ получить его в UI. */
export function useStarsBalance(): number {
  return useAppStateKey('starsBalance') ?? 0
}

/** Запись нового баланса (ответ операции или live-фрейм balance_update). */
export function setStarsBalance(n: number): void {
  setAppState('starsBalance', n)
}

/**
 * Первичная загрузка баланса (при старте приложения).
 *
 * Cache-first (порт намерения tweb `getDialogFilters`, filters.ts:475-484):
 * баланс уже известен — в сеть не идём. Изменения приходят событием
 * balance_update, которое логируется с плотным pts и попадает в /difference
 * (backend wave2_updates_test.go:243-245), то есть пропуски после оффлайна
 * догоняются догоном апдейт-лога.
 *
 * Отличие от списков (папки/черновики): у баланса `0` — ЗАКОННОЕ значение, и
 * «пусто» от «не загружено» без явного null не отличить. Поэтому проверка
 * именно на `!== null`, а не на falsy: иначе нулевой баланс запрашивался бы
 * на каждом старте.
 */
export async function loadStars(managers: { stars: { balance(): Promise<number> } }): Promise<void> {
  if (useAppStateStore.getState().starsBalance !== null) return
  try {
    setAppState('starsBalance', await managers.stars.balance())
  } catch {
    /* stars могут быть недоступны — фича мягко отключается */
  }
}
