// Единая точка холодного старта (аналог tweb index.ts): регистрируем SW, поднимаем
// воркер, СРАЗУ запускаем критические RPC (me + список диалогов), готовим всё, что
// нужно до первого кадра — offline-first кэш чатов и активный словарь — и отдаём
// managers для рендера. Всё, что можно, делается параллельно и до React.
import { startClient, type Managers } from './bootstrap'
import { installBridgeHandoff } from './dnpBridgeHandoff'
import { initPwaInstall } from '../core/pwa'
import { getInitial, loadLang } from '../i18n'
import { setBootData } from './bootData'
import { loadStateOnce, resetStateCache, stateWasResetToDefaults } from '../core/state/loadState'
import { initialState, STATE_VERSION } from '../core/state/state'
import { setAppState, setAppStateSilent, setStateWriter } from '../stores/appState'
import { migrateRecentSearchFromLocalStorage } from '../core/state/migrateRecentSearch'
import { persistScope } from '../core/store/persist'
import { idbGet } from '../core/store/idbKv'
import { useSettingsStore } from '../settings'
import { useLockStore } from '../stores/lockStore'
import { preventCrossTabDynamicImportDeadlock } from '../core/preventDeadlock'
import { useChatsStore } from '../stores/chatsStore'
import type { DialogOp } from '../core/dialogs/dialogOps'
import type { User } from '../core/managers/authManager'
import type { Dialog } from '../core/models'

const TOKEN_KEY = 'session_token' // тот же ключ, что у TokenStore/dialogsPersist

/**
 * Task 2 (перенос владения диалогами): пробел зеркала на холодном старте.
 * Владелец (воркерный dialogsManager) сам поднимает кэш прошлой сессии и
 * отвечает reset'ом на fillMirror() — тут только решение, звать ли RPC (под
 * passcode-локом RPC не летят вовсе, см. #0 в bootstrap()).
 *
 * Вынесена отдельно от bootstrap() ради теста (boot.dialogs.test.ts):
 * bootstrap() — реальная точка входа (как core/worker.ts), конструирует
 * настоящий SharedWorker/Worker через startClient(), и managers.dialogs —
 * RPC-прокси к нему; без настоящего воркера на другом конце вызов зависнет.
 */
export function fillDialogsMirror(managers: Pick<Managers, 'dialogs'>, locked: boolean): Promise<DialogOp | null> {
  return locked ? Promise.resolve(null) : managers.dialogs.fillMirror()
}

/**
 * Применить ответ владельца к витрине ДО первого рендера (подписка на
 * rt:dialog_op ещё не поднята — startRealtime() стартует позже, из
 * useAppBootstrap.ts; кадры, случившиеся раньше её подписки, никто не
 * буферизует, см. web-client/CLAUDE.md «Владение фактами»). Сеть догоняет
 * отдельно (refresh) и публикует reset поверх, когда ответит — не ждём его
 * здесь, чтобы не блокировать рендер сетью.
 */
export async function applyDialogsMirror(op: DialogOp | null, managers: Pick<Managers, 'dialogs'>, locked: boolean): Promise<void> {
  if (op) useChatsStore.getState().applyDialogOps([op])
  if (!locked) void managers.dialogs.refresh()
}

export async function bootstrap(): Promise<{ managers: Managers }> {
  // В самом начале boot (как tweb index.ts): ждём один кадр анимации, чтобы
  // отложить последующие dynamic import и не словить кросс-табовый deadlock
  // загрузки модулей в Chrome (см. preventDeadlock.ts). До решения о passcode-локе
  // и до любого ленивого import.
  await preventCrossTabDynamicImportDeadlock()

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* push unavailable */ })
  }
  // Ловим beforeinstallprompt для пункта «Установить приложение» (PWA).
  initPwaInstall()

  const { managers, ep } = startClient()
  // DNP-ON: раздаём мост SW↔SharedWorker (self-gated; инертно при DNP-off).
  installBridgeHandoff(ep)

  // #0 — решение о passcode-локе ДО любых RPC/коннекта. passcodeEnabled лежит в
  // localStorage (tg-settings, читается синхронно на создании стора), поэтому лок
  // ставится до первого кадра. Под локом НЕ префетчим me/dialogs и не гидрируем —
  // WS/RPC поднимет useAppBootstrap/useAuthGate уже после разблокировки.
  const locked = useSettingsStore.getState().passcodeEnabled
  if (locked) useLockStore.getState().lock()

  // #1 — критические запросы стартуют до рендера: к моменту mount ответ уже летит.
  // me переиспользуется в useAuthGate (через bootData) — без второго round-trip
  // me(). Диалоги (Task 2, перенос владения в воркер): владелец сам поднимает
  // кэш прошлой сессии и отвечает reset'ом на fillMirror() — старый двухходовый
  // префетч (managers.chats.listDialogs() + отдельная hydrateDialogsFromPersist()
  // с диска) больше не нужен, воркер делает и то, и другое за одним RPC. Под
  // локом — пустышка (см. bootData.locked): RPC не летят вовсе.
  const me: Promise<User | null> = locked ? Promise.resolve(null) : managers.auth.me()
  const dialogsOp: Promise<DialogOp | null> = fillDialogsMirror(managers, locked)

  // #2 — offline-first State + словарь языка + наличие токена: всё до первого
  // кадра, чтобы сразу показать последний известный UI без мигания и решить
  // authed локально (по токену), а не по сети. persistScope до чтения State
  // стирает данные предыдущего аккаунта (мультиаккаунт), чтобы стор не поднял
  // чужой конфиг.
  //
  // State (папки/черновики/прочий конфиг) читается ОДНИМ батчем за одну транзакцию —
  // как в tweb, где `await apiManagerProxy.loadAllStates()` стоит до построения UI
  // (index.ts:455). Диалоги — свой стор: в tweb они тоже вне State.
  // resetStateCache перед чтением: persistScope мог стереть данные прошлого
  // аккаунта, и мемоизированный промис прошлого входа отдал бы чужой State.
  const token = await idbGet<string>(TOKEN_KEY)
  await persistScope(token ?? null)
  setStateWriter(managers.persist)
  resetStateCache()
  const [state] = await Promise.all([
    locked ? Promise.resolve(initialState()) : loadStateOnce(),
    loadLang(getInitial()),
  ])
  // Гидрация — SILENT: прочитанное с диска не должно поехать обратно на диск.
  setAppStateSilent(state)
  // Схема была чужой версии (или базы не было) — фиксируем текущую, чтобы
  // следующий старт прошёл версионный гейт (tweb пушит STATE_INIT при смене версии).
  // Спрашиваем именно ридер: в `state` версия уже подставлена из дефолтов, и по
  // ней «сошлось» неотличимо от «сбросили» — без этого ключ не писался бы никогда,
  // а State сбрасывался бы к дефолтам на КАЖДОМ старте.
  if (!locked && stateWasResetToDefaults()) setAppState('version', STATE_VERSION)
  if (!locked) migrateRecentSearchFromLocalStorage()

  // Ответ владельца применяем к витрине ДО первого рендера (см. докблок
  // applyDialogsMirror); dialogsOp был запущен ещё в #1, пока шли IDB/State —
  // здесь просто дожидаемся уже летящего промиса, а не начинаем round-trip заново.
  const op = await dialogsOp
  await applyDialogsMirror(op, managers, locked)
  // bootData.dialogs/hydratedFromCache — тот же снимок, что уже применили к
  // витрине (op), для остальных потребителей префетча (useAppBootstrap →
  // loadChats(managers, prefetch), см. bootData.ts): не второй вывод факта, а
  // переиспользование уже посчитанного значения, чтобы не дублировать round-trip.
  // fillMirror() всегда отвечает reset'ом (dialogsManager.ts) — узкий тип
  // DialogOp здесь просто отражает форму канала целиком (общую с patch/upsert/…).
  const items = op?.op === 'reset' ? op.items : []
  const dialogs: Promise<Dialog[]> = Promise.resolve(items.map((i) => i.dialog))
  const hydratedFromCache = items.length > 0
  setBootData({ me, dialogs, hydratedFromCache, hasToken: !!token, locked })

  return { managers }
}
