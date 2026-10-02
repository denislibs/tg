// S10: старт под код-паролем ждёт разблокировки ДО любых RPC с токеном — порт
// tweb `index.ts:453` (`PasscodeLockScreenController.waitForUnlock` стоит до
// `loadAllStates`). Отдельный файл: контроллер экрана — модульный синглтон,
// одна разблокировка на жизнь страницы, как у оригинала.
//
// Окружение — то же фейковое, что у `boot.order.test.ts` (настоящая bootstrap()).
import { describe, expect, it, vi } from 'vitest'
import { installFakeCanvas } from '@/test/fakeCanvas'

// Старт ставит фон страницы (`appChatBackground`, tweb index.ts:458, :567) — он
// рисует холсты по-настоящему, а в happy-dom нет 2D-контекста.
installFakeCanvas()

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
// Экран блокировки в этом шве — заглушка: предмет теста — что старт ЖДЁТ и что
// под замком уже стоит тема, а не разметка экрана (её держит
// `components/passcodeLock/passcodeLockScreen.solid.test.tsx`).
vi.mock('../components/passcodeLock/passcodeLockScreen.solid', () => ({ default: () => null }))
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
import backgroundStyles from '../components/chat/bubbles/chatBackground.module.scss'
import { useSettingsStore } from '../settings'

// ── Старт под код-паролем (S10, порт tweb index.ts:453 `waitForUnlock`) ───────
// Под замком токен лежит только в зашифрованном слое воркера; вкладка не должна
// ни спрашивать сессию, ни звать сетевые RPC, пока код не введён. Разблокировка
// приходит событием воркера (`toggleLock(false)` — код ввели в соседней вкладке).
describe('boot: под код-паролем старт ждёт разблокировки', () => {
  it('до разблокировки — ни me(), ни scopeToSession(), ни fillMirror(); после — обычный старт', async () => {
    passcodeInvoke.mockImplementation(async (_type, task) =>
      (task.method === 'isLocked' ? { isUsingPasscode: true, isLocked: true } : undefined))
    location.hash = '#-42'
    // выбор темы лежит открытым в `tg-settings` — его можно читать до разблокировки
    useSettingsStore.setState({ themeChoice: 'night' })
    const booted = bootstrap()
    await vi.waitFor(() => { expect(document.querySelector('.passcode-lock-screen')).not.toBeNull() })

    // Белый экран со стенда: тему ставил только React (`useThemeToggle`), а он под
    // замком не монтируется. У tweb тема применяется в колбэке «заперто» ДО экрана
    // (`index.ts:454-456` — настройки + `themeController.setThemeListener()`).
    const html = document.documentElement
    expect(html.getAttribute('data-theme')).toBe('night')
    expect(html.classList.contains('night')).toBe(true)
    const themeCss = document.getElementById('theme')?.textContent ?? ''
    expect(themeCss).toMatch(/--background-color:#/)
    expect(themeCss).toMatch(/--surface-color:#/)
    expect(themeCss).toMatch(/--primary-color:#/)

    // П-11 снят: фон страницы стоит ДО экрана блокировки, первым потомком body
    // (tweb index.ts:458-459 — `appChatBackground.attach()` + `setBackground` в
    // колбэке «заперто»).
    const background = document.body.firstElementChild as HTMLElement
    expect(background.getAttribute('aria-hidden')).toBe('true')
    expect(background.firstElementChild!.classList.contains(backgroundStyles.Layer)).toBe(true)
    await vi.waitFor(() => {
      expect(background.querySelector(`.${backgroundStyles.SlotActive} canvas`)).not.toBeNull()
    })

    expect(passcodeInvoke).toHaveBeenCalledWith('passcode', { method: 'isLocked' })
    expect(me).not.toHaveBeenCalled()
    expect(scopeToSession).not.toHaveBeenCalled()
    expect(dialogs.fillMirror).not.toHaveBeenCalled()

    // соседняя вкладка ввела код — воркер рассылает toggleLock(false)
    passcodeListeners[passcodeListeners.length - 1]({ method: 'toggleLock', payload: false })
    await booted

    // tweb `unlock()` (:147-170): экран гаснет классом `--hidden` и уходит из DOM
    // после пауз 120 + 250 + 120 мс — старт при этом уже идёт.
    await vi.waitFor(() => { expect(document.querySelector('.passcode-lock-screen')).toBeNull() }, { timeout: 2000 })
    expect(me).toHaveBeenCalledTimes(1)
    expect(calls.indexOf('dialogs.fillMirror')).toBeGreaterThan(calls.indexOf('scopeToSession'))
  })
})
