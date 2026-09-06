// Проводка фоновой предзагрузки ассетов реакций — порт подписки оригинала на
// `user_auth` (tweb `src/lib/appManagers/appReactionsManager.ts:88-115`:
// `setTimeout(..., 7.5e3)`). У нас точка «пользователь авторизован» — вход в
// Shell, то есть этот эффект.
//
// Пины: предзагрузка НЕ стартует вместе с остальной загрузкой (иначе она
// конкурировала бы за сеть и CPU ровно там, где решается время до первого
// экрана), стартует по истечении задержки, и снимается вместе с эффектом.
// Что она делает дальше — своя тема, пины на неё живут в
// `components/chat/reactionsMenu.warmUp.test.ts`.
//
// Периметр мокается тот же, что в `useAppBootstrap.dialogsGate.test.tsx`:
// целимся ровно в эту проводку, не в весь эффект.
import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAppBootstrap } from './useAppBootstrap'
import { ManagersProvider } from './useManagers'
import { setBootData } from '../../client/bootData'
import { preloadReactionAssets } from '../../components/chat/reactions'
import { useLockStore } from '../../stores/lockStore'
import type { Managers } from '../../client/bootstrap'

vi.mock('../../components/chat/reactions', () => ({ preloadReactionAssets: vi.fn(async () => {}) }))
vi.mock('../../stores/chatsStore', () => ({
  loadChats: vi.fn(async () => {}),
  loadPresence: vi.fn(async () => {}),
  startPresenceDegradation: vi.fn(() => () => {}),
}))
vi.mock('../../stores/storiesStore', () => ({ loadStories: vi.fn(async () => {}) }))
vi.mock('../../stores/notifyStore', () => ({ loadNotifySettings: vi.fn(async () => {}) }))
vi.mock('../../stores/foldersStore', () => ({ loadFolders: vi.fn(async () => {}) }))
vi.mock('../../stores/privacyStore', () => ({ loadPrivacy: vi.fn(async () => {}) }))
vi.mock('../../stores/starsStore', () => ({ loadStars: vi.fn(async () => {}) }))
vi.mock('../mediaUrl', () => ({ primeMediaToken: vi.fn(async () => {}) }))
vi.mock('../mediaCache', () => ({ syncCacheSettingsToSW: vi.fn() }))
vi.mock('../../client/realtimeBridge', () => ({ startRealtime: vi.fn() }))
vi.mock('../../client/pushSetup', () => ({ setupPush: vi.fn(async () => {}) }))
vi.mock('../../client/appBadge', () => ({ initAppBadge: vi.fn() }))

const managers = {
  auth: { me: vi.fn(async () => null) },
  dialogs: { refresh: vi.fn(async () => {}) },
  presence: { get: vi.fn(async () => []) },
} as unknown as Managers

function wrapper({ children }: { children: ReactNode }) {
  return <ManagersProvider managers={managers}>{children}</ManagersProvider>
}

beforeEach(() => {
  useLockStore.setState({ locked: false, attempts: 0, retryAt: 0 })
  setBootData({ me: Promise.resolve(null), dialogsReady: Promise.resolve(), hasToken: true, locked: false })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useAppBootstrap: предзагрузка ассетов реакций (tweb appReactionsManager.ts:88-115)', () => {
  it('не стартует вместе с первичной загрузкой', () => {
    renderHook(() => useAppBootstrap(), { wrapper })

    vi.advanceTimersByTime(7000)
    expect(preloadReactionAssets).not.toHaveBeenCalled()
  })

  it('стартует спустя задержку оригинала (7.5 с) — с менеджерами приложения', () => {
    renderHook(() => useAppBootstrap(), { wrapper })

    vi.advanceTimersByTime(7500)
    expect(preloadReactionAssets).toHaveBeenCalledWith(managers)
  })

  it('снятый Shell её не запускает (выход, лок, смена аккаунта)', () => {
    const { unmount } = renderHook(() => useAppBootstrap(), { wrapper })

    unmount()
    vi.advanceTimersByTime(60000)
    expect(preloadReactionAssets).not.toHaveBeenCalled()
  })
})
