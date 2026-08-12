// Fix (ревью Task 6, Important #2): пин на строку `const dialogsReady =
// prefetch ? Promise.resolve() : managers.dialogs.refresh()` в
// useAppBootstrap.ts. До этого теста мутация «удали строку, зови только
// loadPresence» проходила ВЕСЬ прогон (247 файлов/1706 тестов) зелёным —
// строка нарушала построчную норму (web-client/CLAUDE.md «Тесты»):
// поведение реально ломается (тёплый релогин без reload остаётся без списка
// диалогов до случайного стороннего рефетча), но ни один тест этого не ловил.
//
// Сценарий: `Shell` монтируется заново на каждое `authed: false → true`
// (`App.tsx` рендерит его условно), вместе с ним заново отрабатывает этот
// хук. На холодном старте `bootPrefetch()` действителен (см. `bootData.ts`) —
// диалоги уже применены к зеркалу `client/boot.ts::applyDialogsMirror` ДО
// первого рендера, повторный `refresh()` здесь плодил бы второй `/chats` на
// каждое монтирование Shell. На тёплом входе БЕЗ перезагрузки страницы (тот
// же класс сценариев, что пинит `useAuthGate.test.tsx` в describe «префетч
// старта не переживает смену сессии») `bootPrefetch()` уже инвалидирован
// (`invalidateBootPrefetch`, зовут оба обработчика перехода сессии в
// `useAuthGate.ts`) — тогда это единственное место, которое подтягивает
// диалоги новой сессии.
//
// Остальные загрузчики (`loadStories`/`loadFolders`/…), realtime и push —
// замоканы no-op'ами: этот тест целится РОВНО в gate по диалогам, не в весь
// эффект `useAppBootstrap` целиком (у него нет и не заводится отдельный
// тестовый периметр — см. web-client/CLAUDE.md, раздел «Тесты», статус по
// файлам: остальные части эффекта продолжают жить без отдельного покрытия).
import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAppBootstrap } from './useAppBootstrap'
import { ManagersProvider } from './useManagers'
import { setBootData, invalidateBootPrefetch } from '../../client/bootData'
import { useLockStore } from '../../stores/lockStore'
import type { Managers } from '../../client/bootstrap'

vi.mock('../../stores/storiesStore', () => ({ loadStories: vi.fn(async () => {}) }))
vi.mock('../../stores/notifyStore', () => ({ loadNotifySettings: vi.fn(async () => {}) }))
vi.mock('../../stores/foldersStore', () => ({ loadFolders: vi.fn(async () => {}) }))
vi.mock('../../stores/privacyStore', () => ({ loadPrivacy: vi.fn(async () => {}) }))
vi.mock('../../stores/draftsStore', () => ({ loadDrafts: vi.fn(async () => {}) }))
vi.mock('../../stores/starsStore', () => ({ loadStars: vi.fn(async () => {}) }))
vi.mock('../mediaUrl', () => ({ primeMediaToken: vi.fn(async () => {}) }))
vi.mock('../mediaCache', () => ({ syncCacheSettingsToSW: vi.fn() }))
vi.mock('../../client/realtimeBridge', () => ({ startRealtime: vi.fn() }))
vi.mock('../../client/pushSetup', () => ({ setupPush: vi.fn(async () => {}) }))
vi.mock('../../client/appBadge', () => ({ initAppBadge: vi.fn() }))

function wrapper(managers: Managers) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers}>{children}</ManagersProvider>
  )
}

function fakeManagers(refresh: ReturnType<typeof vi.fn>): Managers {
  return {
    auth: { me: vi.fn(async () => null) },
    dialogs: { refresh },
    presence: { get: vi.fn(async () => []) },
  } as unknown as Managers
}

beforeEach(() => {
  useLockStore.setState({ locked: false, attempts: 0, retryAt: 0 })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useAppBootstrap: тёплый релогин без reload — gate на managers.dialogs.refresh()', () => {
  it('bootPrefetch инвалидирован (тёплый вход без reload) — refresh() зовётся', () => {
    setBootData({ me: Promise.resolve(null), hydratedFromCache: false, hasToken: true, locked: false })
    invalidateBootPrefetch() // ровно то, что делают useAuthGate.ts::onLoggingOut/onLoggedIn

    const refresh = vi.fn(async () => {})
    renderHook(() => useAppBootstrap(), { wrapper: wrapper(fakeManagers(refresh)) })

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('bootPrefetch действителен (холодный старт) — refresh() НЕ зовётся (диалоги уже применены boot.ts::applyDialogsMirror)', () => {
    setBootData({ me: Promise.resolve(null), hydratedFromCache: true, hasToken: true, locked: false })

    const refresh = vi.fn(async () => {})
    renderHook(() => useAppBootstrap(), { wrapper: wrapper(fakeManagers(refresh)) })

    expect(refresh).not.toHaveBeenCalled()
  })
})
