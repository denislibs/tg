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

const TOKEN_KEY = 'session_token' // тот же ключ, что у TokenStore

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
 * отдельно (refresh) — её НЕ ждём здесь, чтобы не блокировать рендер сетью.
 *
 * `applyDialogOps` здесь — allow-listed исключение из «пишет только проектор»
 * (см. stores/noDuplicateDialogs.test.ts, как и у `core/hooks/useAuthGate.ts`):
 * это тот же метод и тот же единственный вход зеркала, что и у storeProjection,
 * просто вызванный отсюда до того, как подписка на rt:dialog_op вообще
 * поднята — не второй вывод факта.
 *
 * Fix (финальное ревью, Important #2/#3): ответ догона применяется ЗДЕСЬ ЖЕ,
 * из результата RPC, а не только бродкастом — до подъёма насоса (startRealtime()
 * из эффекта useAppBootstrap) кадр `rt:dialog_op` доставить некому, и на быстрой
 * сети reset уходил в никуда. Возвращаем промис этого догона: он уезжает в
 * `bootData` и на нём висит сид презенса (`loadPresence`), которому нужен
 * честный сигнал «сетевой список приехал» — на пустом кэше зеркало в момент
 * монтирования Shell ещё пусто. Промис намеренно НЕ отклоняется (401/5xx у
 * `refresh()` пробрасываются): остаёмся на кэше, презенс сеется тем, что есть,
 * unhandled rejection не плодим (Minor #3).
 *
 * Первичная сетевая загрузка — `refresh()`, и она страничная: на пустом кэше
 * владелец просит одну страницу (`dialogsManager.ts::doRefresh`). Дальше список
 * догружает сам сайдбар через `getDialogs` + `helpers/sequentialCursorFetcher`,
 * опираясь на размер набора своей выборки (`countFor`).
 */
export function applyDialogsMirror(op: DialogOp | null, managers: Pick<Managers, 'dialogs'>, locked: boolean): Promise<void> {
  if (op) useChatsStore.getState().applyDialogOps([op])
  if (locked) return Promise.resolve()
  return managers.dialogs.refresh().then(
    (netOp) => { if (netOp) useChatsStore.getState().applyDialogOps([netOp]) },
    () => { /* офлайн/401 — витрина остаётся на кэше владельца */ },
  )
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
  // me(). Под локом — пустышка (см. bootData.locked): RPC не летят вовсе.
  const me: Promise<User | null> = locked ? Promise.resolve(null) : managers.auth.me()

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
  // Диалоги (Task 2, перенос владения в воркер): владелец сам поднимает кэш
  // прошлой сессии и отвечает reset'ом на fillMirror() — старый двухходовый
  // префетч (managers.chats.listDialogs() + отдельная hydrateDialogsFromPersist()
  // с диска) больше не нужен, воркер делает и то, и другое за одним RPC.
  //
  // Fix (финальное ревью, Important #1): RPC стартует СТРОГО ПОСЛЕ
  // `await persistScope(token)` — по той же причине, по которой после него стоит
  // чтение State. Воркерный `hydrate()` scope-гейта не имеет (воркерный
  // persistScope зовётся один раз за жизнь воркера, `workerCore.ts::start`, и на
  // переключении аккаунта не переигрывается), поэтому запущенный раньше
  // `fillMirror()` гонялся бы с транзакцией очистки: выиграв гонку, он поднял бы
  // список ПРОШЛОГО аккаунта, boot применил бы его к зеркалу до первого рендера,
  // а дебаунс владельца уехал бы этим списком обратно на диск — уже под скоупом
  // нового. Параллельность при этом сохранена: RPC летит одновременно с чтением
  // State и словаря (оба ниже, в Promise.all).
  const dialogsOp: Promise<DialogOp | null> = fillDialogsMirror(managers, locked)
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
  // applyDialogsMirror); dialogsOp был запущен выше, ещё до чтения State —
  // здесь просто дожидаемся уже летящего промиса, а не начинаем round-trip заново.
  const op = await dialogsOp
  // Fix (ревью Task 6, Important #1): `bootData` больше не несёт `dialogs` —
  // диалоги уже применены к зеркалу СТРОКОЙ НИЖЕ (applyDialogsMirror), второго
  // потребителя этого снимка (старый `useAppBootstrap → loadChats(managers,
  // prefetch).dialogs`) нет с самой правки Task 6 (диалоговая половина
  // `loadChats` снесена — см. `stores/chatsStore.ts`).
  //
  // Fix (финальное ревью, Minor #1 + Important #3): вместо мёртвого
  // `hydratedFromCache` (его никто не читал: ChatList решает по `loaded`)
  // в bootData уезжает промис СЕТЕВОГО догона — на нём висит сид презенса в
  // `useAppBootstrap`, см. докблок `applyDialogsMirror`. Сам догон НЕ ждём:
  // рендер не должен упираться в сеть.
  const dialogsReady = applyDialogsMirror(op, managers, locked)
  setBootData({ me, dialogsReady, hasToken: !!token, locked })

  return { managers }
}
