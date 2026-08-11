// src/core/hooks/useAuthGate.test.tsx
//
// Фикс повторного ревью (Stage 1C.2, Task 1): rt:me теперь публикуется не
// только на логаут, но и на смену/удаление активного аккаунта
// (authManager.ts: logout/switchAccount/deleteAccount) — эта вкладка могла
// НЕ быть инициатором. useAuthGate реагирует по-разному в зависимости от
// того, ЧТО пришло (см. докблок onMe в useAuthGate.ts):
//  - первое rt:me этой вкладке — только база, не реакция (иначе КАЖДЫЙ
//    холодный старт получал бы «reload» на собственном же boot-подтверждении);
//  - id не изменился — просто обновилось поле профиля, ничего не делаем
//    (storeProjection уже применил мердж);
//  - id сменился на null — настоящий логаут: общие сбросы
//    (resetAccountStateInMemory + clearDialogsPersist) + authed=false, БЕЗ
//    reload;
//  - id сменился на ДРУГОЙ (не null) — активный токен переключился на
//    другой аккаунт: reload (полноценный подъём под новым токеном не
//    рассчитан на повторный прогон без него).
//
// Тем же приёмом, что useChatScroll.test.tsx: рендерим настоящий хук через
// ManagersProvider, шлём событие через rootScope.dispatchEventSingle — как
// это делает реальный насос realtimeBridge.ts.
import type { ReactNode } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useAuthGate } from './useAuthGate'
import { ManagersProvider } from './useManagers'
import type { Managers } from '../../client/bootstrap'
import rootScope from '@lib/rootScope'
import { RT } from '../realtime/events'
import type { User } from '../managers/authManager'
import { useAppStateStore, setAppState } from '../../stores/appState'
import { useChatsStore } from '../../stores/chatsStore'

const ME: User = {
  id: 1, phone: '+7', username: null, firstName: 'Д', lastName: '', displayName: 'Д',
  bio: '', birthday: null, avatarUrl: '', phoneVisibility: 'contacts', premium: false, emojiStatus: '',
}
const OTHER: User = { ...ME, id: 2, displayName: 'Другой' }

// auth.me() зависает нарочно: эффект useAuthGate дёргает его при монтировании
// (confirm()), а этот файл управляет authed вручную через login()/rt:me — не
// хотим, чтобы фоновый confirm() резолвился и переписал состояние теста.
function testManagers(clearAll = vi.fn().mockResolvedValue(undefined)): Managers {
  return {
    auth: { me: () => new Promise<null>(() => {}) },
    persist: { clearAll },
  } as unknown as Managers
}

function withManagers(managers: Managers) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers}>{children}</ManagersProvider>
  )
}

const folder = {
  id: 7, title: 'чужая папка', pos: 0, contacts: false, nonContacts: false, groups: true,
  broadcasts: false, excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

describe('useAuthGate: кросс-табовый переход между аккаунтами (rt:me)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useAppStateStore.setState({ folders: [] })
    useChatsStore.setState({ dialogs: [] })
  })

  it('первое rt:me этой вкладке — только база: authed не трогает, reload не зовёт', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

    act(() => { result.current.login() })
    act(() => { rootScope.dispatchEventSingle(RT.me, ME) }) // первое — база

    expect(result.current.authed).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('тот же id вторым rt:me (поле профиля обновилось) — authed не трогает, reload не зовёт', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

    act(() => { result.current.login() })
    act(() => { rootScope.dispatchEventSingle(RT.me, ME) }) // база
    act(() => { rootScope.dispatchEventSingle(RT.me, { ...ME, avatarUrl: '/new.jpg' }) }) // тот же id

    expect(result.current.authed).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  // Что ломается без реакции на null: соседняя вкладка остаётся authed=true
  // с meId уже null — свои сообщения перестают быть «своими», send-as и «мои»
  // реакции ломаются.
  it('id сменился на null (настоящий логаут) — authed=false, общие сбросы, БЕЗ reload', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    setAppState('folders', [folder])
    useChatsStore.setState({ dialogs: [{ chatId: 1, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false }] })
    const clearAll = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers(clearAll)) })

    act(() => { result.current.login() })
    act(() => { rootScope.dispatchEventSingle(RT.me, ME) }) // база
    act(() => { rootScope.dispatchEventSingle(RT.me, null) }) // реальный логаут

    expect(result.current.authed).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    // resetAccountStateInMemory (фикс п.3): appState и диалоги прошлого
    // аккаунта не должны дожить до входа под следующим.
    expect(useAppStateStore.getState().folders).toEqual([])
    expect(useChatsStore.getState().dialogs).toEqual([])
    await act(async () => { await Promise.resolve() }) // clearDialogsPersist — микротаска
    expect(clearAll).toHaveBeenCalled()
  })

  // Что ломается без reload: соседняя вкладка осталась бы authed=true (или
  // ушла бы на AuthFlow, если бы обработчик наивно ставил authed=false для
  // ЛЮБОГО не-своего id) при живой сессии другого аккаунта — вернуть можно
  // было бы только ручной перезагрузкой.
  it('id сменился на ДРУГОЙ (не null) — переключение на другой аккаунт: reload, authed не трогает', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

    act(() => { result.current.login() })
    act(() => { rootScope.dispatchEventSingle(RT.me, ME) }) // база — аккаунт 1
    act(() => { rootScope.dispatchEventSingle(RT.me, OTHER) }) // переключились на аккаунт 2

    expect(reload).toHaveBeenCalledTimes(1)
    expect(result.current.authed).toBe(true) // не сброшен — сессия жива, просто другая
  })

  // Фикс минорного пункта ревью: старая версия этого теста («размонтирование
  // снимает подписку») пиновала не то — setAuthed на размонтированном хуке
  // не бросает в React 19, поэтому not.toThrow() проходил и с утечкой
  // подписки (мутация проверена: cleanup без removeEventListener — тесты
  // остаются зелёными). Пинит саму проводку — вызов removeEventListener с
  // ТЕМ ЖЕ обработчиком, что был передан в addEventListener.
  it('размонтирование реально снимает подписку — removeEventListener(RT.me, тот же handler)', () => {
    const addSpy = vi.spyOn(rootScope, 'addEventListener')
    const removeSpy = vi.spyOn(rootScope, 'removeEventListener')
    const { unmount } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

    const meCall = addSpy.mock.calls.find(([event]) => event === RT.me)
    expect(meCall).toBeDefined()
    const handler = meCall![1]

    unmount()

    expect(removeSpy).toHaveBeenCalledWith(RT.me, handler)
  })
})
