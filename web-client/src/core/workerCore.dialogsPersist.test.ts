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
//  - `dialogs.cancelPersist()` в onLoggingOut отменяет ОТЛОЖЕННУЮ запись,
//    чтобы запоздавшая правка не воскресила диалоги прошлого аккаунта на
//    диске поверх persistClearAll() («Осторожно» в задаче).
//
// fake-indexeddb — ПЕРВОЙ строкой (см. workerCore.test.ts: newCursor()/
// newConnectionManager() читают IndexedDB синхронно внутри createWorkerCore()).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { saveDialogs, loadDialogs, loadMe } from './store/persist'
import type { Dialog } from './models'

const dialog = (chatId: number): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
} as Dialog)

beforeEach(() => { indexedDB = new IDBFactory() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('createWorkerCore(): персист диалогов пишет владелец, не main (Task 5)', () => {
  it('applyMute() публикует операцию и с дебаунсом реально пишет свежий список через saveDialogs', async () => {
    await saveDialogs([dialog(1)])
    // ТОЛЬКО setTimeout/clearTimeout: fake-indexeddb едет на setImmediate
    // (гейт RestClient на tokens.ready) — заморозив и его, тест повис бы.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const core = createWorkerCore()
    await core.registry.dialogs.fillMirror() // hydrate: читает [dialog(1)] с диска

    core.registry.dialogs.applyMute(1, true)

    // Раньше 1с (PERSIST_DEBOUNCE_MS в dialogsManager.ts) — запись ещё не ушла.
    await vi.advanceTimersByTimeAsync(500)
    expect((await loadDialogs())[0]?.muted).toBe(false)

    await vi.advanceTimersByTimeAsync(600)
    expect((await loadDialogs())[0]?.muted).toBe(true) // saveCache реально вызван
  })

  it('logout() отменяет отложенную запись — диалоги прошлого аккаунта не воскресают на диске после persistClearAll()', async () => {
    await saveDialogs([dialog(1)])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const core = createWorkerCore()
    await core.registry.dialogs.fillMirror()
    core.registry.dialogs.applyMute(1, true) // планирует запись через 1с

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

  it('setMe() пишет свежего `me` write-through (честный новый дом после удаления dialogsPersist.ts)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/sign_in')) {
        return new Response(JSON.stringify({
          token: 'TOK', user: { id: 42, phone: '+7', display_name: 'Д' },
        }), { status: 200 })
      }
      throw new Error('unexpected fetch ' + String(url))
    }))

    const core = createWorkerCore()
    await core.registry.auth.signIn('+7', '12345', 'web', 'browser')

    expect((await loadMe())?.id).toBe(42)
  })
})
