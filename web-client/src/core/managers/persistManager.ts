// Единый writer офлайн-стора (msgr-store) — в воркере. Черновики/State правит
// main-thread-стор (их «свежий вид» проецирует storeProjection), но ФИЗИЧЕСКИ в
// IndexedDB их пишет воркер: один SharedWorker = один writer на все вкладки, без
// конкуренции нескольких main-thread-соединений за readwrite-транзакции одной БД
// (и без риска, что clear одной вкладки и put другой лягут вперемешку). Юзеров/
// сообщения воркер писал и раньше (peersManager/messagesManager) — теперь он пишет
// ВСЁ. Секьюрити-гарды (locked/sanitizeDialog/E2E-фильтр) живут в persist.ts и
// срабатывают здесь же, в воркере. main остаётся только READER: loadX на холодном
// старте (данные прошлой сессии уже закоммичены) — конкуренции чтений нет.
//
// Task 5 (персист диалогов переезжает к владельцу): раньше здесь же жил метод
// `dialogs(dialogs, me)` — RPC-фасад, которым main-thread-подписка
// (`stores/dialogsPersist.ts`, удалена) слала дебаунсированный снапшот ОБОИХ
// (`saveDialogs`+`saveMe` одним Promise.all). Оба писателя честно переехали к
// СВОИМ владельцам факта: список — в `dialogsManager.ts` (scheduleSave,
// подставлен как `saveCache` в workerCore.ts), `me` — в `workerCore.ts::setMe`
// (write-through, тот же приём, что и `stateKey` ниже — «блоб маленький,
// дебаунс не нужен»). Второго RPC-пути этих же двух записей больше нет.
import { saveStateKey, persistClearAll, persistScope } from '../store/persist'
import type { AppState } from '../state/state'

/**
 * @param mirrorStateKey рассылка изменённого ключа State во все вкладки. Порт
 *   tweb: воркер после записи шлёт `mirror`-кадр всем портам, каждая вкладка
 *   применяет его через `setAppStateSilent` (apiManagerProxy.ts:235-241).
 *   Без этого правка в одной вкладке доезжала бы до соседних только через
 *   перезагрузку: write-through пишет диск, а чужую ПАМЯТЬ не трогает.
 * @param onStateKey Task 1 (владение диалогами): dialogsManager обязан узнать
 *   про смену ключей, от которых зависит порядок (`pinnedOrders`/`drafts`), —
 *   он сам в стор не ходит, а держит их копией в памяти (см. setStateKey).
 * @param tokens владелец активного токена (`TokenStore` воркера) — для
 *   `scopeToSession`; опционален ради юнит-тестов State.
 */
export function newPersistManager(
  mirrorStateKey?: (key: string, value: unknown) => void,
  onStateKey?: (key: string, value: unknown) => void,
  tokens?: { ready(): Promise<void>, get(): string | null },
) {
  return {
    // S10: скоуп офлайн-стора по активному токену (persistScope) ДО чтения State
    // на холодном старте вкладки. Раньше вкладка читала `session_token` из
    // `msgr/kv` сама и звала persistScope у себя; под код-паролем токен лежит
    // только в зашифрованном слое воркера, и наружу он теперь не выходит вовсе —
    // вкладка получает лишь «сессия есть». Зовётся на КАЖДОМ старте вкладки:
    // воркерный вызов в `start()` один на жизнь воркера, а SharedWorker
    // переживает перезагрузку при переключении аккаунта (см. boot.order.test.ts).
    // До разблокировки не завершится: `tokens.ready()` ждёт ключ.
    scopeToSession: async (): Promise<boolean> => {
      if (!tokens) return false
      await tokens.ready()
      const token = tokens.get()
      await persistScope(token)
      return !!token
    },
    // Один ключ State (порт tweb appStateManager.setByKey). Пишется write-through
    // из stores/appState на каждое изменение — блоб маленький, дебаунс не нужен.
    // Через RPC-границу идут сериализуемые значения, поэтому ключ здесь строка;
    // типизацию держит вызывающая сторона (setAppState<K extends keyof AppState>).
    stateKey: async (key: string, value: unknown): Promise<void> => {
      await saveStateKey(key as keyof AppState, value as AppState[keyof AppState])
      // Зеркало ПОСЛЕ записи: вкладка, поднявшаяся сразу после кадра, прочитает
      // с диска уже актуальное значение и не разойдётся с остальными.
      mirrorStateKey?.(key, value)
      // Порядок диалогов зависит от pinnedOrders/drafts — владелец пересчитывает
      // индексы и публикует reindex (сам он в стор не ходит).
      onStateKey?.(key, value)
    },
    // Полный сброс (logout / истёкшая сессия / включение passcode). Идёт тем же
    // writer'ом — clear сериализуется после любых накопленных воркером записей.
    clearAll: (): Promise<void> => persistClearAll(),
  }
}
