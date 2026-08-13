// Fix (повторное ревью финальной волны, находка A): под passcode-локом
// `bootstrap()` пропускает `fillMirror()` целиком — `boot.ts::fillDialogsMirror`
// не зовёт RPC вовсе, пока `locked===true` (см. `client/boot.ts`). Единственный
// канал наполнения зеркала после разблокировки — этот хук. До правки он звал
// голый `managers.dialogs.refresh()`, а тот публикует операцию, только если
// ответ сети РАЗОШЁЛСЯ с памятью владельца (Important #4,
// `dialogsManager.setAll`/`sameItems`). На аккаунте с НУЛЁМ диалогов владелец
// после гидратации тоже пуст (persist под включённым passcode всегда отдаёт
// `[], core/store/persist.ts::locked`), поэтому пустой ответ сети совпадает —
// `refresh()` возвращает `null`, `applyDialogOps` не зовётся ни разу,
// `chatsStore.loaded` остаётся `false` НАВСЕГДА (скелетон висит вечно, см.
// `ChatList.tsx:56-63`). Для непустых аккаунтов дыра маскировалась: кэш
// владельца пуст, сеть — нет, они «расходятся» и `refresh()` публикует reset
// случайно-правильно.
//
// Правка: под `bootWasLocked()` хук зовёт `fillDialogsMirror` +
// `applyDialogsMirror` (те же функции, что и холодный старт в `boot.ts`) —
// `fillMirror()` объявляет `reset` БЕЗУСЛОВНО (см. докблок в
// `dialogsManager.ts`), поэтому зеркало гидрируется даже при полном
// совпадении пустых списков.
import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAppBootstrap } from './useAppBootstrap'
import { ManagersProvider } from './useManagers'
import { setBootData, invalidateBootPrefetch } from '../../client/bootData'
import { useChatsStore } from '../../stores/chatsStore'
import { useLockStore } from '../../stores/lockStore'
import type { Managers } from '../../client/bootstrap'
import type { DialogOp } from '../dialogs/dialogOps'

// Как и в useAppBootstrap.dialogsGate.test.tsx: остальные загрузчики/realtime/push
// замоканы no-op'ами — этот тест целится РОВНО в гейт по диалогам под локом,
// chatsStore НЕ мокается (нужен настоящий applyDialogOps/loaded).
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

function fakeManagers(fillMirror: ReturnType<typeof vi.fn>, refresh: ReturnType<typeof vi.fn>): Managers {
  return {
    auth: { me: vi.fn(async () => null) },
    // Сетевой догон `applyDialogsMirror` — ПОЛНЫЙ `refresh()`, а не страница
    // (см. докблок в `client/boot.ts`). `getDialogs` фейк всё равно держит:
    // мутация «вернуть постраничный догон» должна дойти до ассерта, а не упасть
    // на отсутствующем методе.
    dialogs: { fillMirror, refresh, getDialogs: vi.fn(async () => ({ dialogs: [], count: 0, isEnd: false })) },
    presence: { get: vi.fn(async () => []) },
  } as unknown as Managers
}

beforeEach(() => {
  useLockStore.setState({ locked: false, attempts: 0, retryAt: 0 }) // уже разблокировано — run() исполняется сразу
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useAppBootstrap: зеркало диалогов после разблокировки под passcode', () => {
  it('пустой аккаунт: fillMirror() гидрирует зеркало (loaded=true), хотя refresh() не даёт новой операции', async () => {
    setBootData({ me: Promise.resolve(null), dialogsReady: Promise.resolve(), hasToken: true, locked: true })

    const emptyOp: DialogOp = { op: 'reset', items: [] }
    const fillMirror = vi.fn(async () => emptyOp)
    // Сеть совпала с (тоже пустой) памятью владельца — ИМЕННО этот случай
    // раньше оставлял зеркало без единой применённой операции.
    const refresh = vi.fn(async () => null)
    const managers = fakeManagers(fillMirror, refresh)

    renderHook(() => useAppBootstrap(), { wrapper: wrapper(managers) })

    for (let i = 0; i < 20; i++) await Promise.resolve()

    expect(fillMirror).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(managers.dialogs.getDialogs).not.toHaveBeenCalled()
    expect(useChatsStore.getState().loaded).toBe(true)
    expect(useChatsStore.getState().dialogs).toEqual([])
  })

  it('непустой аккаунт: fillMirror() гидрирует кэшем, дальше сетевой догон применяется поверх', async () => {
    setBootData({ me: Promise.resolve(null), dialogsReady: Promise.resolve(), hasToken: true, locked: true })

    const dialog = { chatId: 1, type: 'private', title: 't1', unread: 0, unreadMentions: 0, unreadReactions: 0, lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false } as unknown as import('../models').Dialog
    const cacheOp: DialogOp = { op: 'reset', items: [] } // под passcode кэш владельца всегда пуст
    const netOp: DialogOp = { op: 'reset', items: [{ dialog, index: 10 }] }
    const fillMirror = vi.fn(async () => cacheOp)
    const refresh = vi.fn(async () => netOp)

    renderHook(() => useAppBootstrap(), { wrapper: wrapper(fakeManagers(fillMirror, refresh)) })

    for (let i = 0; i < 20; i++) await Promise.resolve()

    expect(useChatsStore.getState().loaded).toBe(true)
    expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([1])
  })

  it('boot НЕ был под локом (тёплый релогин) — fillMirror() не зовётся, поведение прежнее', async () => {
    setBootData({ me: Promise.resolve(null), dialogsReady: Promise.resolve(), hasToken: true, locked: false })
    invalidateBootPrefetch() // тот же приём, что useAppBootstrap.dialogsGate.test.tsx: префетч не действителен

    const fillMirror = vi.fn(async () => ({ op: 'reset', items: [] }) as DialogOp)
    const refresh = vi.fn(async () => null)

    renderHook(() => useAppBootstrap(), { wrapper: wrapper(fakeManagers(fillMirror, refresh)) })

    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(fillMirror).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
