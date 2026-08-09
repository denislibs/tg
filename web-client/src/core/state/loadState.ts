// Порт tweb `src/lib/appManagers/utils/state/loadState.ts:528-531`:
//
//   let promise: ReturnType<typeof loadStateForAllAccounts>;
//   export default function loadStateForAllAccountsOnce() {
//     return promise ??= loadStateForAllAccounts();
//   }
//
// Смысл мемоизации: чтение персиста должно случиться РОВНО ОДИН раз за запуск.
// Кто бы ни спросил State вторым — получает тот же промис, а не второй поход в IDB.
import { loadStateAll } from '../store/persist'
import { STATE_VERSION, initialState, type AppState } from './state'

let promise: Promise<AppState> | null = null
let resetToDefaults = false

/** Единственная точка чтения State. Повторный вызов отдаёт тот же промис. */
export function loadStateOnce(): Promise<AppState> {
  return (promise ??= read())
}

/**
 * Отдало ли последнее чтение чистые дефолты вместо прочитанного (версия схемы не
 * совпала либо базы не было). Нужно вызывающему, чтобы записать текущую версию:
 * по самому возвращённому состоянию это НЕ определить — там `version` уже
 * подставлена из дефолтов, и «сошлось» неотличимо от «сбросили».
 */
export function stateWasResetToDefaults(): boolean {
  return resetToDefaults
}

/** Сбросить кэш — смена аккаунта (persistScope стёр данные) и тесты. */
export function resetStateCache(): void {
  promise = null
  resetToDefaults = false
}

async function read(): Promise<AppState> {
  const stored = await loadStateAll()
  // Версионный гейт (tweb STATE_VERSION/BUILD, loadState.ts:40-41): схема из
  // прошлой сборки может быть несовместима по форме — начинаем с дефолтов, а не
  // склеиваем половинки. Запись новой версии делает гидрация в boot.ts.
  if (stored.version !== STATE_VERSION) {
    resetToDefaults = true
    return initialState()
  }
  resetToDefaults = false
  return { ...initialState(), ...stored }
}
