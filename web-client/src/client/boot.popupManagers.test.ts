// Пин строки проводки в `bootstrap()`: менеджеры по умолчанию оболочки попапов
// (`components/popups/indexTsx.solid.tsx`, расхождение 2; у tweb —
// `appDialogsManager.ts:980`). Без присвоения любой `showXxxPopup`, не передавший
// `managers` пропом, получил бы `undefined` вместо RPC-прокси (web-client/CLAUDE.md,
// «Делегирующий вызов — тоже строка проводки»). Окружение — то же фейковое, что у
// `boot.maskedAnchor.test.ts`.
import { describe, expect, it, vi } from 'vitest'

const managers = {
  auth: { me: vi.fn(async () => null) },
  persist: { stateKey: vi.fn(async () => {}), scopeToSession: vi.fn(async () => false) },
  dialogs: { fillMirror: vi.fn(async () => ({ op: 'reset' as const, items: [] })), refresh: vi.fn(async () => null) },
}

vi.mock('./bootstrap', () => ({
  startClient: () => ({
    managers,
    ep: {},
    // канал код-пароля: кода нет — старт не ждёт разблокировки
    smp: { on: vi.fn(), invoke: vi.fn(async () => ({ isUsingPasscode: false, isLocked: false })) },
  }),
}))
vi.mock('./dnpBridgeHandoff', () => ({ installBridgeHandoff: vi.fn() }))
vi.mock('../core/pwa', () => ({ initPwaInstall: vi.fn() }))
vi.mock('../core/preventDeadlock', () => ({ preventCrossTabDynamicImportDeadlock: vi.fn(async () => {}) }))
vi.mock('../core/state/migrateRecentSearch', () => ({ migrateRecentSearchFromLocalStorage: vi.fn() }))
vi.mock('../core/state/loadState', async () => {
  const { initialState } = await import('../core/state/state')
  return {
    loadStateOnce: vi.fn(async () => initialState()),
    resetStateCache: vi.fn(),
    stateWasResetToDefaults: () => false,
  }
})

import { bootstrap } from './boot'
import PopupElement from '@components/popups/indexTsx.solid'

describe('boot: менеджеры оболочки попапов', () => {
  it('bootstrap() отдаёт PopupElement.MANAGERS менеджеры клиента', async () => {
    expect(PopupElement.MANAGERS).toBeUndefined()
    await bootstrap()
    expect(PopupElement.MANAGERS).toBe(managers)
  })
})
