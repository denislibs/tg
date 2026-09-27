// S10: старт под код-паролем ждёт разблокировки ДО любых RPC с токеном — порт
// tweb `index.ts:453` (`PasscodeLockScreenController.waitForUnlock` стоит до
// `loadAllStates`). Отдельный файл: контроллер экрана — модульный синглтон,
// одна разблокировка на жизнь страницы, как у оригинала.
//
// Окружение — то же фейковое, что у `boot.order.test.ts` (настоящая bootstrap()).
import { describe, expect, it, vi } from 'vitest'

const calls: string[] = []

const dialogs = {
  fillMirror: vi.fn(async () => { calls.push('dialogs.fillMirror'); return { op: 'reset' as const, items: [] } }),
  // Сетевой догон холодного старта — ПОЛНЫЙ refresh(), а не страница
  // (см. докблок applyDialogsMirror в boot.ts).
  refresh: vi.fn(async () => { calls.push('dialogs.refresh'); return null }),
}

// Скоуп по токену делает воркер (`persist.scopeToSession`, S10): вкладка токен
// не читает. Ответ — «сессия есть».
const scopeToSession = vi.fn(async () => { calls.push('scopeToSession'); return true })
const me = vi.fn(async () => { calls.push('auth.me'); return null })
// Канал код-пароля (`client/passcodeClient.ts` → smp.invoke('passcode', …)).
const passcodeInvoke = vi.fn(async (_type: string, _task: { method: string }): Promise<unknown> => undefined)
const passcodeListeners: ((e: unknown) => void)[] = []
const smp = {
  on: vi.fn((_event: string, cb: (e: unknown) => void) => { passcodeListeners.push(cb) }),
  invoke: passcodeInvoke,
}

vi.mock('./bootstrap', () => ({
  startClient: () => ({
    managers: { auth: { me }, persist: { stateKey: vi.fn(async () => {}), scopeToSession }, dialogs },
    ep: {},
    smp,
  }),
}))
// Экран блокировки в этом шве — заглушка: предмет теста — что старт ЖДЁТ, а не разметка.
vi.mock('../components/PasscodeLockScreen', () => ({ default: () => null }))
vi.mock('./dnpBridgeHandoff', () => ({ installBridgeHandoff: vi.fn() }))
vi.mock('../core/pwa', () => ({ initPwaInstall: vi.fn() }))
vi.mock('../core/preventDeadlock', () => ({ preventCrossTabDynamicImportDeadlock: vi.fn(async () => {}) }))
vi.mock('../core/state/migrateRecentSearch', () => ({ migrateRecentSearchFromLocalStorage: vi.fn() }))
vi.mock('../core/state/loadState', async () => {
  const { initialState } = await import('../core/state/state')
  return {
    loadStateOnce: vi.fn(async () => { calls.push('loadStateOnce'); return initialState() }),
    resetStateCache: vi.fn(),
    stateWasResetToDefaults: () => false,
  }
})

import { bootstrap } from './boot'
import { useNavigationStore } from '../stores/navigationStore'

// ── Старт под код-паролем (S10, порт tweb index.ts:453 `waitForUnlock`) ───────
// Под замком токен лежит только в зашифрованном слое воркера; вкладка не должна
// ни спрашивать сессию, ни звать сетевые RPC, пока код не введён. Разблокировка
// приходит событием воркера (`toggleLock(false)` — код ввели в соседней вкладке).
describe('boot: под код-паролем старт ждёт разблокировки', () => {
  it('до разблокировки — ни me(), ни scopeToSession(), ни fillMirror(); после — обычный старт', async () => {
    passcodeInvoke.mockImplementation(async (_type, task) =>
      (task.method === 'isLocked' ? { isUsingPasscode: true, isLocked: true } : undefined))
    location.hash = '#-42'
    const booted = bootstrap()
    await vi.waitFor(() => { expect(document.querySelector('.passcode-lock-screen')).not.toBeNull() })

    expect(passcodeInvoke).toHaveBeenCalledWith('passcode', { method: 'isLocked' })
    expect(me).not.toHaveBeenCalled()
    expect(scopeToSession).not.toHaveBeenCalled()
    expect(dialogs.fillMirror).not.toHaveBeenCalled()
    expect(useNavigationStore.getState().selectedId).toBeNull()

    // соседняя вкладка ввела код — воркер рассылает toggleLock(false)
    passcodeListeners[passcodeListeners.length - 1]({ method: 'toggleLock', payload: false })
    await booted

    expect(document.querySelector('.passcode-lock-screen')).toBeNull()
    expect(me).toHaveBeenCalledTimes(1)
    expect(calls.indexOf('dialogs.fillMirror')).toBeGreaterThan(calls.indexOf('scopeToSession'))
  })
})
