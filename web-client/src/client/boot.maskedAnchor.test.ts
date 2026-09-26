// Пин строки проводки в `bootstrap()`: делегированные слушатели замаскированных
// ссылок (`lib/richtext/maskedAnchor.ts`, tweb e96e06c37) ставятся на холодном
// старте — у оригинала это `InternalLinkProcessor.construct`
// (internalLinkProcessor.ts:84-89). Сами слушатели пинит
// `lib/richtext/maskedAnchor.test.ts`; здесь — только ФАКТ ВЫЗОВА
// (web-client/CLAUDE.md, «Делегирующий вызов — тоже строка проводки»).
// Окружение — то же фейковое, что у `boot.order.test.ts`.
import { describe, expect, it, vi } from 'vitest'

vi.mock('./bootstrap', () => ({
  startClient: () => ({
    managers: {
      auth: { me: vi.fn(async () => null) },
      persist: { stateKey: vi.fn(async () => {}) },
      dialogs: { fillMirror: vi.fn(async () => ({ op: 'reset' as const, items: [] })), refresh: vi.fn(async () => null) },
    },
    ep: {},
  }),
}))
vi.mock('./dnpBridgeHandoff', () => ({ installBridgeHandoff: vi.fn() }))
vi.mock('../core/pwa', () => ({ initPwaInstall: vi.fn() }))
vi.mock('../core/preventDeadlock', () => ({ preventCrossTabDynamicImportDeadlock: vi.fn(async () => {}) }))
vi.mock('../core/state/migrateRecentSearch', () => ({ migrateRecentSearchFromLocalStorage: vi.fn() }))
vi.mock('../core/store/idbKv', () => ({ idbGet: vi.fn(async () => undefined) }))
vi.mock('../core/store/persist', () => ({ persistScope: vi.fn(async () => {}) }))
vi.mock('../core/state/loadState', async () => {
  const { initialState } = await import('../core/state/state')
  return {
    loadStateOnce: vi.fn(async () => initialState()),
    resetStateCache: vi.fn(),
    stateWasResetToDefaults: () => false,
  }
})
vi.mock('@lib/richtext/maskedAnchor', () => ({ listenForMaskedAnchorClicks: vi.fn() }))

import { bootstrap } from './boot'
import { listenForMaskedAnchorClicks } from '@lib/richtext/maskedAnchor'

describe('boot: слушатели замаскированных ссылок', () => {
  it('bootstrap() ставит их на холодном старте', async () => {
    await bootstrap()
    expect(listenForMaskedAnchorClicks).toHaveBeenCalledTimes(1)
  })
})
