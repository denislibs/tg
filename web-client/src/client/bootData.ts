// Данные, поднятые в main.tsx ещё до первого рендера React: критические RPC
// (me + список диалогов) стартуют параллельно с загрузкой бандла/словаря, а
// флаг гидрации из кэша сообщает useAuthGate, что список чатов уже отрисован.
// Хуки читают отсюда; заполняется через setBootData из main.tsx (в тестах
// остаётся null — компоненты работают на своих mock-managers).
import type { User } from '../core/managers/authManager'
import type { Dialog } from '../core/models'

export interface BootData {
  me: Promise<User | null>
  dialogs: Promise<Dialog[]>
  hydratedFromCache: boolean
  // Есть ли локальный session_token (IDB). По нему useAuthGate решает authed до
  // ответа сети (как tweb — auth из локального состояния), без промежуточного null.
  hasToken: boolean
  // Стартовали под passcode-локом: под ним НЕ префетчим me/dialogs и не гидрируем
  // (RPC/WS не поднимаем до разблокировки). me/dialogs здесь — пустышки; настоящую
  // загрузку useAppBootstrap/useAuthGate делают после unlock (runWhenUnlocked).
  locked: boolean
}

export let bootData: BootData | null = null

// Префетч действителен только для той активной сессии, при которой страница
// загрузилась. Пока сессия не менялась, флаг true.
let prefetchValid = true

export function setBootData(d: BootData): void {
  bootData = d
  prefetchValid = true
}

/**
 * Префетч старта страницы (me + список диалогов) — или `null`, если брать его
 * нельзя.
 *
 * Единственный способ до него добраться: `bootData.me`/`bootData.dialogs`
 * напрямую читать нельзя, потому что эти промисы **одноразовые по смыслу, но
 * не по коду**. Они разрешены значениями аккаунта, под которым страница
 * ЗАГРУЗИЛАСЬ, и живут до перезагрузки, а `Shell` монтируется заново на каждое
 * `authed: false → true` (`App.tsx` рендерит его условно) — вместе с ним заново
 * отрабатывает `useAppBootstrap`. Второй раз тот же префетч уже врёт: активная
 * сессия к этому моменту другая, и `loadChats` записал бы в стор личность и
 * чаты ПРОШЛОГО аккаунта, затерев только что приехавший `rt:me` нового.
 * Детерминированной коррекции у этого нет.
 *
 * Достижимо двумя путями (оба пинятся, см. useAuthGate.test.tsx): кросс-табовым
 * — «добавить аккаунт» в соседней вкладке увёл эту на экран входа, затем там же
 * вошли под другим аккаунтом; и локальным, существовавшим и до появления
 * кадров, — логаут без остающихся аккаунтов (он намеренно обходится без
 * перезагрузки) и вход в той же жизни страницы.
 *
 * `locked` — отдельная причина отказа: под пасскодом префетч не делался вовсе,
 * там пустышки (см. BootData.locked).
 */
export function bootPrefetch(): { me: Promise<User | null>; dialogs: Promise<Dialog[]> } | null {
  if (!bootData || bootData.locked || !prefetchValid) return null
  return { me: bootData.me, dialogs: bootData.dialogs }
}

/**
 * Активная сессия сменилась — префетч прошлой жизни страницы больше не
 * действителен. Зовут обработчики переходов (`useAuthGate`): и уход
 * (`rt:logging_out`), и вход (`rt:logged_in`) одинаково означают, что токен под
 * страницей уже не тот, при котором префетч поднимали.
 */
export function invalidateBootPrefetch(): void {
  prefetchValid = false
}
