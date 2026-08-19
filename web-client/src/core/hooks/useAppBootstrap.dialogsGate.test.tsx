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
import { loadPresence } from '../../stores/chatsStore'
import { useLockStore } from '../../stores/lockStore'
import type { Managers } from '../../client/bootstrap'

// chatsStore замокан целиком: хук берёт отсюда `loadChats`/`loadPresence`, и
// нам нужен именно СПАЙ на `loadPresence` (Important #3 — момент его вызова),
// а не настоящая загрузка презенса.
vi.mock('../../stores/chatsStore', () => ({
  loadChats: vi.fn(async () => {}),
  loadPresence: vi.fn(async () => {}),
  // Деградация присутствия по `expires` — свой интервал; здесь заглушка, а её
  // собственный пин живёт в stores/chatsStore.test.ts.
  startPresenceDegradation: vi.fn(() => () => {}),
}))
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
    setBootData({ me: Promise.resolve(null), dialogsReady: Promise.resolve(), hasToken: true, locked: false })
    invalidateBootPrefetch() // ровно то, что делают useAuthGate.ts::onLoggingOut/onLoggedIn

    const refresh = vi.fn(async () => {})
    renderHook(() => useAppBootstrap(), { wrapper: wrapper(fakeManagers(refresh)) })

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('bootPrefetch действителен (холодный старт) — refresh() НЕ зовётся (диалоги уже применены boot.ts::applyDialogsMirror)', () => {
    setBootData({ me: Promise.resolve(null), dialogsReady: Promise.resolve(), hasToken: true, locked: false })

    const refresh = vi.fn(async () => {})
    renderHook(() => useAppBootstrap(), { wrapper: wrapper(fakeManagers(refresh)) })

    expect(refresh).not.toHaveBeenCalled()
  })
})

// Fix (финальное ревью, Important #3): `loadPresence` читает цели из ЗЕРКАЛА
// (chatsStore.dialogs) и на пустом списке молча выходит, ничего не запросив.
// Пока гейт выше отдавал на холодном старте `Promise.resolve()`, презенс сеялся
// в момент монтирования Shell — то есть до ответа сети. При пустом кэше (смена
// аккаунта, очищенное хранилище, первая загрузка после входа в соседней вкладке)
// это значит «весь сеанс без онлайн-точек и без „был(а) в сети“»: массового сида
// презенса больше нигде нет. Поэтому на холодном старте ждём ПРОМИС сетевого
// догона, запущенного boot'ом (bootData.dialogsReady).
describe('useAppBootstrap: презенс сеется после сетевого списка, а не до него', () => {
  it('холодный старт — loadPresence ждёт bootData.dialogsReady', async () => {
    let arrive!: () => void
    const dialogsReady = new Promise<void>((res) => { arrive = res })
    setBootData({ me: Promise.resolve(null), dialogsReady, hasToken: true, locked: false })

    renderHook(() => useAppBootstrap(), { wrapper: wrapper(fakeManagers(vi.fn(async () => {}))) })
    // Микротаски прокручены: если бы гейт отдавал Promise.resolve() (прежний
    // код), loadPresence уже отработал бы здесь — на пустом зеркале.
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(loadPresence).not.toHaveBeenCalled()

    arrive() // /chats ответил, reset применён к зеркалу
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(loadPresence).toHaveBeenCalledTimes(1)
  })

  it('тёплый вход без reload — loadPresence ждёт свой же refresh()', async () => {
    setBootData({ me: Promise.resolve(null), dialogsReady: Promise.resolve(), hasToken: true, locked: false })
    invalidateBootPrefetch()
    let arrive!: () => void
    const refresh = vi.fn(() => new Promise<void>((res) => { arrive = res }))

    renderHook(() => useAppBootstrap(), { wrapper: wrapper(fakeManagers(refresh)) })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(loadPresence).not.toHaveBeenCalled()

    arrive()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(loadPresence).toHaveBeenCalledTimes(1)
  })

  // Minor #3: refresh() пробрасывает HttpError (401/5xx), а зовётся `void`-ом.
  // Презенс всё равно обязан посеяться по тому, что уже есть в зеркале, и
  // отклонение не должно стать unhandled rejection.
  it('refresh() упал — презенс всё равно сеется, промис не отклоняется наружу', async () => {
    setBootData({ me: Promise.resolve(null), dialogsReady: Promise.resolve(), hasToken: true, locked: false })
    invalidateBootPrefetch()
    const refresh = vi.fn(async () => { throw new Error('401') })

    renderHook(() => useAppBootstrap(), { wrapper: wrapper(fakeManagers(refresh)) })
    for (let i = 0; i < 5; i++) await Promise.resolve()

    expect(loadPresence).toHaveBeenCalledTimes(1)
  })
})
