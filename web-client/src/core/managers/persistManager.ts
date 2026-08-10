// Единый writer офлайн-стора (msgr-store) — в воркере. Диалоги/me/черновики/State
// правит main-thread-стор (их «свежий вид» проецирует storeProjection), но ФИЗИЧЕСКИ
// в IndexedDB их пишет воркер: один SharedWorker = один writer на все вкладки, без
// конкуренции нескольких main-thread-соединений за readwrite-транзакции одной БД
// (и без риска, что clear одной вкладки и put другой лягут вперемешку). Юзеров/
// сообщения воркер писал и раньше (peersManager/messagesManager) — теперь он пишет
// ВСЁ. Секьюрити-гарды (locked/sanitizeDialog/E2E-фильтр) живут в persist.ts и
// срабатывают здесь же, в воркере. main остаётся только READER: loadX на холодном
// старте (данные прошлой сессии уже закоммичены) — конкуренции чтений нет.
import { saveDialogs, saveMe, saveStateKey, persistClearAll } from '../store/persist'
import type { Dialog } from '../models'
import type { User } from './authManager'
import type { AppState } from '../state/state'

/**
 * @param mirrorStateKey рассылка изменённого ключа State во все вкладки. Порт
 *   tweb: воркер после записи шлёт `mirror`-кадр всем портам, каждая вкладка
 *   применяет его через `setAppStateSilent` (apiManagerProxy.ts:235-241).
 *   Без этого правка в одной вкладке доезжала бы до соседних только через
 *   перезагрузку: write-through пишет диск, а чужую ПАМЯТЬ не трогает.
 */
export function newPersistManager(mirrorStateKey?: (key: string, value: unknown) => void) {
  return {
    // Диалоги и me персистятся вместе (их гонит один дебаунс dialogsPersist) — один
    // RPC вместо двух. saveDialogs и saveMe пишут разные сторы (dialogs/meta).
    dialogs: (dialogs: Dialog[], me: User | null): Promise<void> =>
      Promise.all([saveDialogs(dialogs), saveMe(me)]).then(() => {}),
    // Один ключ State (порт tweb appStateManager.setByKey). Пишется write-through
    // из stores/appState на каждое изменение — блоб маленький, дебаунс не нужен.
    // Через RPC-границу идут сериализуемые значения, поэтому ключ здесь строка;
    // типизацию держит вызывающая сторона (setAppState<K extends keyof AppState>).
    stateKey: async (key: string, value: unknown): Promise<void> => {
      await saveStateKey(key as keyof AppState, value as AppState[keyof AppState])
      // Зеркало ПОСЛЕ записи: вкладка, поднявшаяся сразу после кадра, прочитает
      // с диска уже актуальное значение и не разойдётся с остальными.
      mirrorStateKey?.(key, value)
    },
    // Полный сброс (logout / истёкшая сессия / включение passcode). Идёт тем же
    // writer'ом — clear сериализуется после любых накопленных воркером записей.
    clearAll: (): Promise<void> => persistClearAll(),
  }
}
