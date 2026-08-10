// Порт tweb `src/stores/appState.ts`. Там это Solid-стор:
//
//   const [appState, _setAppState] = createRoot(() => createStore<State>({}));
//   const setAppState = (...args) => { _setAppState(...args);
//     return rootScope.managers.appStateManager.setByKey(key, unwrap(appState[key])); };
//   const setAppStateSilent = (key, value) => _setAppState(key, reconcile(value));
//
// У нас та же пара ролей на Zustand:
//   setAppState       — пользовательское изменение: память + персист (write-through);
//   setAppStateSilent — гидрация с диска: только память, без обратной записи
//                       (иначе прочитанное тут же поехало бы обратно в IDB).
//
// Роль solid-овского `reconcile` (сохранить ссылки на неизменившиеся куски) у нас
// закрывает точечный setState по ключу: zustand мержит патч в новый корневой
// объект, а соседние поля переносятся той же ссылкой — селекторы по ним не
// перерисовываются.
import { create } from 'zustand'
import { initialState, type AppState } from '../core/state/state'

/** Писатель персиста — фасад воркера (persistManager). Ставит boot.ts. */
export interface StateWriter { stateKey(key: string, value: unknown): Promise<void> }

let writer: StateWriter | null = null

export function setStateWriter(w: StateWriter | null): void {
  writer = w
}

// initialState() — глубокая копия дефолтов: при `{ ...STATE_INIT }` вложенные
// folders/hiddenPinnedMessages были бы теми же объектами, что и в константе,
// и мутация в обход setAppState отравила бы дефолты на весь сеанс.
export const useAppStateStore = create<AppState>(() => initialState())

/** Изменение пользователем: в память и на диск (tweb setAppState). */
export function setAppState<K extends keyof AppState>(key: K, value: AppState[K]): void {
  useAppStateStore.setState({ [key]: value } as Pick<AppState, K>)
  // Персист физически пишет воркер (один writer на все вкладки); ошибку записи
  // глотаем — состояние в памяти уже актуально, следующая запись перекроет.
  void writer?.stateKey(key, value).catch(() => {})
}

/** Гидрация с диска: только память (tweb setAppStateSilent). */
export function setAppStateSilent(patch: Partial<AppState>): void {
  useAppStateStore.setState(patch)
}

/**
 * Забыть State текущего аккаунта. Зовётся на логауте БЕЗ перезагрузки страницы
 * (`useAuthGate.logout`, ветка без мультиаккаунта): `boot.ts` второй раз не
 * отработает, значит и `setAppStateSilent` больше не вызовется, и в памяти
 * остался бы конфиг прошлого аккаунта.
 *
 * Раньше это частично маскировалось тем, что `loadFolders`/`loadDrafts` всё
 * равно ходили в сеть и затирали результат. После перехода на cache-first
 * непустая память ОТМЕНЯЕТ запрос — и следующий аккаунт увидел бы чужие папки,
 * черновики и баланс, а write-through записал бы их под его скоуп.
 *
 * `true` вторым аргументом — замена состояния целиком, а не слияние: иначе
 * ключи, которых нет в дефолтах, пережили бы сброс.
 */
export function resetAppState(): void {
  useAppStateStore.setState(initialState(), true)
}

/** Реактивное чтение одного ключа — аналог `appState.folders` в tweb. */
export function useAppStateKey<K extends keyof AppState>(key: K): AppState[K] {
  return useAppStateStore((s) => s[key])
}
