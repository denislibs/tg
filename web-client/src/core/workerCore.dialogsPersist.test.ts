// Task 5 (персист диалогов переезжает к владельцу): проводка вокруг реального
// createWorkerCore() — dialogsManager получает НАСТОЯЩИЙ writer (`saveDialogs`
// из core/store/persist.ts), подставленный строкой `saveCache: (list) =>
// saveDialogs(list)` в workerCore.ts, а не собирает снапшот на main
// (`stores/dialogsPersist.ts` — удалён вместе с этой задачей). Дебаунс сам по
// себе проверен на уровне dialogsManager.test.ts («после операции список
// пишется на диск с дебаунсом»); здесь — что ИМЕННО ЭТА подстановка реально
// вызывается и реально пишет в IndexedDB, а также два соседних пина:
//  - `me` пишется через `workerCore.ts::setMe` (write-through, честный новый
//    дом записи после удаления dialogsPersist.ts — см. докблок там же);
//  - логаут не воскрешает диалоги прошлого аккаунта на диске — ДВА разных
//    сценария, ДВА разных механизма (ревью Task 5, Important):
//     1. таймер ещё НЕ выстрелил — `dialogs.cancelPersist()` в onLoggingOut
//        гасит его, писать вообще нечему (тест «logout() отменяет ОЖИДАЮЩУЮ
//        запись» ниже);
//     2. таймер УЖЕ выстрелил, `saveDialogs()` в полёте (после `await
//        locked()`, уже внутри `enqueue()`) — `cancelPersist()` тут ни при
//        чём (отменять уже нечего), от гонки защищает порядок IndexedDB-
//        транзакций в core/store/persist.ts: `persistClearAll()` физически
//        достижим из воркера только через два кросс-контекстных RPC-раунда
//        (медленнее пары микротасков внутри воркера), а `enqueue()` исполняет
//        readwrite-транзакции одного стора в порядке ИХ СОЗДАНИЯ, а не
//        завершения — клир не может обогнать уже запущенную запись (тест
//        «таймер уже выстрелил» ниже; подробный разбор — докблок
//        `dialogsManager.cancelPersist()`).
//
// fake-indexeddb — ПЕРВОЙ строкой (см. workerCore.test.ts: newCursor()/
// newConnectionManager() читают IndexedDB синхронно внутри createWorkerCore()).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { saveDialogs, loadDialogs, loadMe } from './store/persist'
import type { Dialog } from './models'
import { makeDialog } from './dialogs/testDialog'
import { MUTE_UNTIL_FOREVER, type PeerNotifySettings } from './dialogs/notifySettings'

/** «Навсегда» — далёкий срок; «снять» — отсутствие переопределения. */
const MUTED: PeerNotifySettings = { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER }
const UNMUTED: PeerNotifySettings = { _: 'peerNotifySettings' }

const dialog = (peerId: number): Dialog => makeDialog({ peerId })

beforeEach(() => { indexedDB = new IDBFactory() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('createWorkerCore(): персист диалогов пишет владелец, не main (Task 5)', () => {
  it('applyNotifySettings() публикует операцию и с дебаунсом реально пишет свежий список через saveDialogs', async () => {
    await saveDialogs([dialog(1)])
    // ТОЛЬКО setTimeout/clearTimeout: fake-indexeddb едет на setImmediate
    // (гейт RestClient на tokens.ready) — заморозив и его, тест повис бы.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const core = createWorkerCore()
    await core.registry.dialogs.fillMirror() // hydrate: читает [dialog(1)] с диска

    core.registry.dialogs.applyNotifySettings(1, MUTED)

    // Раньше 1с (PERSIST_DEBOUNCE_MS в dialogsManager.ts) — запись ещё не ушла.
    await vi.advanceTimersByTimeAsync(500)
    expect((await loadDialogs())[0]?.notify_settings).toEqual(UNMUTED)

    await vi.advanceTimersByTimeAsync(600)
    expect((await loadDialogs())[0]?.notify_settings).toEqual(MUTED) // saveCache реально вызван
  })

  // Сценарий 1: таймер ЕЩЁ НЕ выстрелил — cancelPersist() гасит его, писать
  // вообще нечему (нет гонки с persistClearAll() — отменённый таймер никогда
  // не вызовет saveDialogs()).
  it('logout() ДО срабатывания таймера — cancelPersist() гасит ОЖИДАЮЩУЮ запись, диск остаётся очищенным', async () => {
    await saveDialogs([dialog(1)])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const core = createWorkerCore()
    await core.registry.dialogs.fillMirror()
    core.registry.dialogs.applyNotifySettings(1, MUTED) // планирует запись через 1с — таймер ещё не сработал

    // Без активной сессии logout() не ходит в REST (см. workerCore.test.ts,
    // «authManager.onLoggingOut → broadcast») — резолвится локально, зовёт
    // onLoggingOut → dialogs.cancelPersist() синхронно, ДО ответа промиса.
    await core.registry.auth.logout()
    // Тот же порядок, что и в проде: main реагирует на rt:logging_out вызовом
    // managers.persist.clearAll() (useAuthGate.ts) — здесь эмулируем напрямую.
    await core.registry.persist.clearAll()

    await vi.advanceTimersByTimeAsync(5000) // отменённый таймер не должен выстрелить

    expect(await loadDialogs()).toEqual([])
  })

  // Сценарий 2 (ревью Task 5, Important — был непокрыт): таймер УЖЕ выстрелил,
  // saveDialogs() в полёте (enqueue() уже вызван, транзакция ещё не
  // закоммичена), и ТОЛЬКО ПОТОМ приходит логаут. cancelPersist() здесь
  // буквально нечего отменять (saveTimer уже null — таймер сам обнулил его
  // при срабатывании), поэтому он структурно не может быть причиной
  // правильного исхода в этом тесте — спасает порядок IndexedDB-транзакций в
  // core/store/persist.ts (см. докблок файла выше и
  // `dialogsManager.cancelPersist()`).
  it('таймер уже выстрелил (запись в полёте) — логаут всё равно даёт очищенный диск, а не воскрешённые данные прошлого аккаунта', async () => {
    await saveDialogs([dialog(1)]) // греет lockedCache — locked() внутри saveDialogs дальше идёт без реального IDB-round-trip
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const core = createWorkerCore()
    await core.registry.dialogs.fillMirror()
    core.registry.dialogs.applyNotifySettings(1, MUTED) // планирует запись через 1с

    // СИНХРОННЫЙ advance (не Async!): таймер срабатывает прямо здесь, callback
    // синхронно обнуляет saveTimer и запускает `saveDialogs(items)` — та
    // синхронно доходит до `await locked()` и приостанавливается. cancelPersist()
    // вызванный ПОСЛЕ этой строки уже ничего не отменяет — саму отмену здесь не
    // тестируем (её тестирует сценарий 1 выше).
    vi.advanceTimersByTime(1000)
    // Даём РЕАЛЬНЫМ микротаскам шанс продвинуть уже стартовавший saveDialogs()
    // дальше `await locked()`, до его собственного `enqueue()` — но мы этот
    // прогресс НЕ ЖДЁМ явно (никакого `await` на промис самой записи): логаут
    // ниже зовётся, не синхронизируясь с завершением write, — то и есть
    // «запись в полёте», в чёрном ящике теста. Порядок ниже (сперва logout(),
    // потом clearAll()) сам по себе даёт как минимум столько же микротасков.
    for (let i = 0; i < 20; i++) await Promise.resolve()

    vi.useRealTimers() // дальше ничего таймерного не требуется — auth.logout()/persist.clearAll() идут по реальным IDB-промисам
    await core.registry.auth.logout() // без активной сессии — резолвится локально, cancelPersist() здесь no-op (saveTimer уже null)
    // persist.clearAll() enqueue'ит clear СТРОГО ПОСЛЕ вызова выше — а значит и
    // после уже стартовавшего enqueue() записи. IndexedDB исполняет readwrite-
    // транзакции одного стора в порядке СОЗДАНИЯ, а не завершения (см. докблок
    // dialogsManager.cancelPersist()), поэтому клир гарантированно ляжет ПОСЛЕ
    // нашей записи, а не перед ней, независимо от того, какая из двух
    // транзакций к этому моменту успела физически закоммититься.
    await core.registry.persist.clearAll()

    expect(await loadDialogs()).toEqual([]) // клир победил — диалог прошлого аккаунта не воскрес
  })

  it('setMe() пишет свежего `me` write-through (честный новый дом после удаления dialogsPersist.ts)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/sign_in')) {
        return new Response(JSON.stringify({
          token: 'TOK', user: { _: 'users.userFull', full_user: { _: 'userFull', id: 42 }, chats: [], users: [{ _: 'user', pFlags: { self: true }, id: 42, phone: '+7' }], can_message: true },
        }), { status: 200 })
      }
      throw new Error('unexpected fetch ' + String(url))
    }))

    const core = createWorkerCore()
    await core.registry.auth.signIn('+7', '12345', 'web', 'browser')

    expect((await loadMe())?.user.id).toBe(42)
  })
})
