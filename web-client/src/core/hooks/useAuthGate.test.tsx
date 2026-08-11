// src/core/hooks/useAuthGate.test.tsx
//
// Переход активной сессии (Stage 1C.2, Task 1). Раунд 4 сменил КАНАЛ, которым
// вкладка узнаёт о переходе: раньше она выводила намерение из значения `me`
// (rt:me + базовая строка «первое событие — не реакция»), теперь слушает
// объявленное владельцем намерение rt:logging_out (порт tweb `logging_out`).
// Сценарии сохранены те же, добавился первый — он и был дырой:
//  - rt:me НЕ управляет сессией вовсе (это канал значения): ни базовой
//    строки, ни гонки «успела ли вкладка увидеть своё boot-подтверждение» —
//    именно из-за них кросс-табовый логаут срабатывал через раз (Critical 1
//    в task-1-findings-round4.md);
//  - migrateTo === null — настоящий логаут: общие сбросы
//    (resetAccountStateInMemory + clearDialogsPersist) + authed=false, БЕЗ
//    reload;
//  - migrateTo !== null — активный токен переехал на другой аккаунт: reload
//    (полноценный подъём под новым токеном не рассчитан на повторный прогон
//    без него), authed не трогаем — сессия жива, просто другая.
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
import { bootPrefetch, setBootData } from '../../client/bootData'

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

describe('useAuthGate: переход активной сессии (rt:logging_out)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useAppStateStore.setState({ folders: [] })
    useChatsStore.setState({ dialogs: [] })
  })

  // Ключевой пин раунда 4: канал ЗНАЧЕНИЯ сессией не управляет. Любая
  // последовательность rt:me (своё boot-подтверждение, обновлённое поле
  // профиля, чужая личность, null «данных нет») не должна ни перезагружать
  // вкладку, ни ронять authed — иначе возвращается вся эвристика раундов 2-3
  // вместе с её гонкой.
  it('rt:me не управляет сессией: ни authed, ни reload — что бы ни пришло', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

    act(() => { result.current.login() })
    act(() => { rootScope.dispatchEventSingle(RT.me, ME) })                          // boot-подтверждение
    act(() => { rootScope.dispatchEventSingle(RT.me, { ...ME, avatarUrl: '/n.jpg' }) }) // поле профиля
    act(() => { rootScope.dispatchEventSingle(RT.me, OTHER) })                        // чужая личность
    act(() => { rootScope.dispatchEventSingle(RT.me, null) })                         // «данных нет»

    expect(result.current.authed).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  // Critical 1: вкладка, которая НЕ видела ни одного rt:me (стартовый /me не
  // удался — офлайн/5xx, либо её подписка ещё не была зарегистрирована к
  // моменту ответа boot-префетча), обязана отработать чужой логаут. Раньше
  // первое событие уходило в базовую строку и логаут глотался.
  it('логаут доходит до вкладки, не видевшей ни одного rt:me', () => {
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

    act(() => { result.current.login() })
    act(() => { rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null }) })

    expect(result.current.authed).toBe(false)
  })

  // Что ломается без реакции на null: соседняя вкладка остаётся authed=true
  // с meId уже null — свои сообщения перестают быть «своими», send-as и «мои»
  // реакции ломаются.
  it('migrateTo: null (настоящий логаут) — authed=false, общие сбросы, БЕЗ reload', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    setAppState('folders', [folder])
    useChatsStore.setState({ dialogs: [{ chatId: 1, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false }] })
    const clearAll = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers(clearAll)) })

    act(() => { result.current.login() })
    act(() => { rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null }) })

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
  it('migrateTo: id — переезд на другой аккаунт: reload, authed не трогает', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

    act(() => { result.current.login() })
    act(() => { rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: OTHER.id }) })

    expect(reload).toHaveBeenCalledTimes(1)
    expect(result.current.authed).toBe(true) // не сброшен — сессия жива, просто другая
  })

  // Раунд 4: logout() — ТОЛЬКО команда воркеру. Локального дубля реакции здесь
  // быть не может даже «ради отзывчивости»: authManager публикует намерение
  // внутри себя, до того как ответ RPC поедет обратно тем же портом, поэтому
  // обработчик отрабатывает строго раньше, чем резолвится этот промис. Пин
  // держит оба факта разом — RPC реально зовётся, и до прихода кадра вкладка
  // сама ничего не решает.
  it('logout() — только команда: RPC зовётся, authed падает от кадра, а не отсюда', async () => {
    const logoutRpc = vi.fn().mockResolvedValue({ switched: false })
    const managers = {
      auth: { me: () => new Promise<null>(() => {}), logout: logoutRpc },
      persist: { clearAll: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Managers
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(managers) })

    act(() => { result.current.login() })
    await act(async () => { result.current.logout(); await Promise.resolve() })

    expect(logoutRpc).toHaveBeenCalledTimes(1)
    expect(result.current.authed).toBe(true) // реакции ещё не было — кадр не приходил

    act(() => { rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null }) })
    expect(result.current.authed).toBe(false)
  })

  // Critical раунда 4-бис: вход — такой же переход, как логаут, и должен
  // доходить до вкладки, которая его не инициировала. Без кадра вкладка,
  // стоящая на экране входа, оставалась бы там навсегда при живой сессии.
  it('rt:logged_in вкладке на экране входа — поднимает Shell без reload', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

    // Экран входа: логаут увёл сюда обе вкладки («добавить аккаунт»).
    act(() => { rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null }) })
    expect(result.current.authed).toBe(false)

    act(() => { rootScope.dispatchEventSingle(RT.loggedIn, { userId: OTHER.id }) })

    expect(result.current.authed).toBe(true)
    expect(reload).not.toHaveBeenCalled() // boot был без токена — как у вошедшей вкладки
  })

  // Вторая половина того же Critical: вкладка, уже работавшая под аккаунтом,
  // при чужом входе получает НОВЫЙ активный токен под собой. Без реакции она
  // осталась бы в интерфейсе прежнего аккаунта, отправляя запросы с чужим
  // токеном, а её `me` тем временем перезаписал бы rt:me чужой личностью.
  it('rt:logged_in вкладке с живой сессией — reload (под ней сменился активный токен)', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

    act(() => { result.current.login() }) // вкладка в Shell
    act(() => { rootScope.dispatchEventSingle(RT.loggedIn, { userId: OTHER.id }) })

    expect(reload).toHaveBeenCalledTimes(1)
  })

  // Отказ команды логаута (сбой IndexedDB при работе с реестром аккаунтов):
  // без .catch реакции нет вовсе — вкладка остаётся в интерфейсе уже вышедшего
  // аккаунта, плюс unhandled rejection. Исход неизвестен, поэтому reload:
  // состояние выведется с диска заново.
  it('logout() при отказе команды — reload (исход неизвестен)', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const managers = {
      auth: { me: () => new Promise<null>(() => {}), logout: vi.fn().mockRejectedValue(new Error('idb')) },
      persist: { clearAll: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Managers
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(managers) })

    act(() => { result.current.login() })
    await act(async () => { result.current.logout(); await Promise.resolve() })

    expect(reload).toHaveBeenCalledTimes(1)
  })

  // Critical: обе достижимые последовательности порчи `me`/чатов префетчем
  // ПРОШЛОГО аккаунта. Общий корень — префетч старта одноразовый по смыслу, но
  // живёт до перезагрузки, а Shell монтируется заново на каждое
  // authed: false → true (App.tsx), вместе с ним useAppBootstrap. Пинится
  // наблюдаемо: после перехода bootPrefetch() обязан отдавать null, иначе
  // повторный loadChats запишет личность и чаты прошлого аккаунта поверх
  // только что приехавшего rt:me нового.
  describe('префетч старта не переживает смену сессии', () => {
    const prefetch = { me: Promise.resolve(null), dialogs: Promise.resolve([]) }
    const boot = () => setBootData({ ...prefetch, hydratedFromCache: false, hasToken: true, locked: false })

    it('кросс-табовый: «добавить аккаунт» в соседней вкладке, затем вход там же', () => {
      boot()
      const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

      // соседняя вкладка нажала «Добавить аккаунт» — эта уходит на экран входа
      act(() => { rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null }) })
      expect(bootPrefetch()).toBeNull()

      // там же вошли под другим аккаунтом — Shell поднимется БЕЗ перезагрузки
      act(() => { rootScope.dispatchEventSingle(RT.loggedIn, { userId: OTHER.id }) })
      expect(result.current.authed).toBe(true)
      expect(bootPrefetch()).toBeNull() // useAppBootstrap пойдёт в сеть, а не в префетч A
    })

    // Тот же дефект существовал и до появления кадров: логаут без остающихся
    // аккаунтов намеренно обходится без перезагрузки, поэтому вход в той же
    // жизни страницы переигрывал useAppBootstrap с тем же протухшим префетчем.
    it('локальный: логаут без остающихся аккаунтов, затем вход в той же жизни страницы', () => {
      boot()
      renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

      act(() => { rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null }) })
      act(() => { rootScope.dispatchEventSingle(RT.loggedIn, { userId: ME.id }) })

      expect(bootPrefetch()).toBeNull()
    })

    // Третий вход в тот же дефект, где кадра ухода эта вкладка не видела
    // вовсе: её открыли, когда сессии уже не было (boot без токена), и вошли в
    // другой вкладке. Префетч тут разрешён пустышками «нет сессии» — повторный
    // loadChats записал бы me=null и пустой список поверх приехавшего rt:me.
    it('вкладка, открытая уже на экране входа: вход в соседней (кадра ухода не было)', () => {
      setBootData({ ...prefetch, hydratedFromCache: false, hasToken: false, locked: false })
      const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })
      expect(result.current.authed).toBe(false) // boot без токена

      act(() => { rootScope.dispatchEventSingle(RT.loggedIn, { userId: ME.id }) })

      expect(result.current.authed).toBe(true)
      expect(bootPrefetch()).toBeNull()
    })
  })

  // Important: успешный логаут без остающихся аккаунтов обязан обойтись БЕЗ
  // перезагрузки — Shell снимается через authed=false. Именно поэтому logout()
  // не переведён на общую точку commandThenReload (она перезагружает при любом
  // исходе); без этого пина подмена тела на неё проходила зелёной.
  it('успешный логаут без остающихся аккаунтов не перезагружает вкладку', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const managers = {
      auth: { me: () => new Promise<null>(() => {}), logout: vi.fn().mockResolvedValue({ switched: false }) },
      persist: { clearAll: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Managers
    const { result } = renderHook(() => useAuthGate(), { wrapper: withManagers(managers) })

    act(() => { result.current.login() })
    await act(async () => { result.current.logout(); await Promise.resolve() })
    act(() => { rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null }) })

    expect(result.current.authed).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  // Фикс минорного пункта ревью: старая версия этого теста («размонтирование
  // снимает подписку») пиновала не то — setAuthed на размонтированном хуке
  // не бросает в React 19, поэтому not.toThrow() проходил и с утечкой
  // подписки (мутация проверена: cleanup без removeEventListener — тесты
  // остаются зелёными). Пинит саму проводку — вызов removeEventListener с
  // ТЕМ ЖЕ обработчиком, что был передан в addEventListener.
  it('размонтирование реально снимает подписку — removeEventListener(RT.loggingOut, тот же handler)', () => {
    const addSpy = vi.spyOn(rootScope, 'addEventListener')
    const removeSpy = vi.spyOn(rootScope, 'removeEventListener')
    const { unmount } = renderHook(() => useAuthGate(), { wrapper: withManagers(testManagers()) })

    const call = addSpy.mock.calls.find(([event]) => event === RT.loggingOut)
    expect(call).toBeDefined()
    const handler = call![1]

    unmount()

    expect(removeSpy).toHaveBeenCalledWith(RT.loggingOut, handler)
  })
})
