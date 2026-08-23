// Task 6 (пины владения, приоритетная находка ревью Task 5): владелец списка
// диалогов (dialogsManager) живёт в SharedWorker, который переживает
// `location.reload()` отдельной вкладки, пока жива хотя бы одна другая —
// значит `items`/`hydrated` реально могут пережить логаут и вход ДРУГОГО
// аккаунта. Раньше на переходе сессии (onLoggingOut/onLoggedIn) гасился только
// таймер отложенной записи (`dialogs.cancelPersist()`, Task 5) — сам кэш
// оставался нетронутым, и следующий `fillMirror()` под новым пользователем
// отдал бы готовый список ПРОШЛОГО. `dialogs.resetForLogout()` (см.
// dialogsManager.ts) закрывает это — здесь проверяем ПРОВОДКУ (реальный вызов
// из onLoggingOut/onLoggedIn в workerCore.ts), а не сам метод (тот покрыт
// dialogsManager.test.ts, describe «сброс кэша владельца при логауте»).
//
// Прогон настоящий: createWorkerCore() — тот же authManager/dialogsManager, та
// же проводка onLoggingOut/onLoggedIn, что в проде (по образцу
// workerCore.mediaTokenReset.test.ts / workerCore.dialogsPersist.test.ts).
//
// fake-indexeddb — ПЕРВОЙ строкой: newCursor()/newConnectionManager() читают
// IndexedDB прямо в конструкторе, RestClient гейтит запросы на tokens.ready().
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { saveDialogs, loadDialogs } from './store/persist'
import type { Dialog } from './models'
import { makeDialog } from './dialogs/testDialog'

const dialog = (peerId: number): Dialog => makeDialog({ peerId })

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.endsWith('/auth/logout')) return new Response('{}', { status: 200 })
    if (u.endsWith('/auth/sign_in')) {
      return new Response(JSON.stringify({
        token: 'session-b',
        user: { _: 'users.userFull', full_user: { _: 'userFull', id: 5 }, chats: [], users: [{ _: 'user', pFlags: { self: true }, id: 5, phone: '+79990000005' }], can_message: true },
      }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): dialogs.resetForLogout() проводка (Task 6)', () => {
  it('logout() (rt:logging_out) опустошает кэш владельца', async () => {
    await saveDialogs([dialog(1)])
    const core = createWorkerCore()
    await core.registry.dialogs.fillMirror()
    expect(core.registry.dialogs.getSnapshot()).toHaveLength(1)

    await core.registry.auth.logout() // без активной сессии — резолвится локально, зовёт onLoggingOut

    expect(core.registry.dialogs.getSnapshot()).toEqual([])
  })

  it('logout() не воскрешает прошлые диалоги: следующий fillMirror честно перечитывает диск нового аккаунта, не отдаёт застрявший кэш', async () => {
    await saveDialogs([dialog(1)])
    const core = createWorkerCore()
    await core.registry.dialogs.fillMirror()

    await core.registry.auth.logout()

    // «Новый пользователь» — на диске (под новым persistScope в проде) теперь
    // другие диалоги. Если бы resetForLogout не сбросил `hydrated`/`items`,
    // hydrate() увидел бы hydrated=true и вернул пустой снимок без обращения к
    // диску вовсе — этот тест ловит именно такую половинчатую реализацию.
    await saveDialogs([dialog(2)])
    const op = await core.registry.dialogs.fillMirror()

    expect(core.registry.dialogs.getSnapshot().map((i: { dialog: Dialog }) => i.dialog.peerId)).toEqual([2])
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.peerId)).toEqual([2])
  })

  it('вход под новым аккаунтом (rt:logged_in) тоже опустошает кэш владельца', async () => {
    await saveDialogs([dialog(1)])
    const core = createWorkerCore()
    await core.registry.dialogs.fillMirror()
    expect(core.registry.dialogs.getSnapshot()).toHaveLength(1)

    await core.registry.auth.signIn('+79990000005', '12345', 'dev', 'web')

    expect(core.registry.dialogs.getSnapshot()).toEqual([])
  })

  it('диск остаётся физически очищенным после logout — cancelPersist() и resetForLogout() не мешают друг другу', async () => {
    await saveDialogs([dialog(1)])
    const core = createWorkerCore()
    await core.registry.dialogs.fillMirror()

    await core.registry.auth.logout()
    await core.registry.persist.clearAll()

    expect(await loadDialogs()).toEqual([])
  })
})
