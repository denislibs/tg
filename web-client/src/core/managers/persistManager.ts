// Единый writer офлайн-стора (msgr-store) — в воркере. Диалоги/me/папки/черновики
// правит main-thread-стор (их «свежий вид» проецирует storeProjection), но ФИЗИЧЕСКИ
// в IndexedDB их пишет воркер: один SharedWorker = один writer на все вкладки, без
// конкуренции нескольких main-thread-соединений за readwrite-транзакции одной БД
// (и без риска, что clear одной вкладки и put другой лягут вперемешку). Юзеров/
// сообщения воркер писал и раньше (peersManager/messagesManager) — теперь он пишет
// ВСЁ. Секьюрити-гарды (locked/sanitizeDialog/E2E-фильтр) живут в persist.ts и
// срабатывают здесь же, в воркере. main остаётся только READER: loadX на холодном
// старте (данные прошлой сессии уже закоммичены) — конкуренции чтений нет.
import { saveDialogs, saveMe, saveFolders, saveDrafts, saveStateKey, persistClearAll } from '../store/persist'
import type { Dialog, Draft } from '../models'
import type { User } from './authManager'
import type { Folder } from './foldersManager'
import type { AppState } from '../state/state'

export function newPersistManager() {
  return {
    // Диалоги и me персистятся вместе (их гонит один дебаунс dialogsPersist) — один
    // RPC вместо двух. saveDialogs и saveMe пишут разные сторы (dialogs/meta).
    dialogs: (dialogs: Dialog[], me: User | null): Promise<void> =>
      Promise.all([saveDialogs(dialogs), saveMe(me)]).then(() => {}),
    folders: (folders: Folder[]): Promise<void> => saveFolders(folders),
    drafts: (drafts: Draft[]): Promise<void> => saveDrafts(drafts),
    // Один ключ State (порт tweb appStateManager.setByKey). Пишется write-through
    // из stores/appState на каждое изменение — блоб маленький, дебаунс не нужен.
    // Через RPC-границу идут сериализуемые значения, поэтому ключ здесь строка;
    // типизацию держит вызывающая сторона (setAppState<K extends keyof AppState>).
    stateKey: (key: string, value: unknown): Promise<void> =>
      saveStateKey(key as keyof AppState, value as AppState[keyof AppState]),
    // Полный сброс (logout / истёкшая сессия / включение passcode). Идёт тем же
    // writer'ом — clear сериализуется после любых накопленных воркером записей.
    clearAll: (): Promise<void> => persistClearAll(),
  }
}
