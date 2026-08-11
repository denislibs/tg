// Stage 1C.2 (Task 3): core/mediaUrl.ts — ЗЕРКАЛО медиа-токена. Владелец
// (core/managers/mediaManager.ts) публикует снимок при получении и при каждом
// плановом обновлении; здесь проверяем, что зеркало его применяет, будит
// подписчиков, отдаёт URL синхронно — и НЕ заводит собственного расписания.
//
// Модульное состояние зеркала (token/expiresAt/version) живёт в модуле, поэтому
// каждый кейс поднимает свежий реестр модулей (vi.resetModules) и импортирует
// и зеркало, и React-хелперы ПОСЛЕ сброса — иначе половина тестов работала бы с
// двумя разными копиями React (статический импорт + пересозданный модуль).
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

const { tokenInfo } = vi.hoisted(() => ({ tokenInfo: vi.fn() }))
vi.mock('../client/bootstrap', () => ({ startClient: () => ({ managers: { media: { tokenInfo } } }) }))

const TOK = (token: string, ms = 900_000) => ({ token, expiresAt: Date.now() + ms })

let m: typeof import('./mediaUrl')
let rtl: typeof import('@testing-library/react')

beforeEach(async () => {
  vi.resetModules()
  tokenInfo.mockReset()
  tokenInfo.mockResolvedValue(TOK('worker-tok'))
  m = await import('./mediaUrl')
  rtl = await import('@testing-library/react')
})

afterEach(() => { vi.useRealTimers() })

describe('mediaUrl — зеркало токена владельца', () => {
  // Гонка старта: вкладка отрисовала медиа-бабл раньше, чем приехал токен.
  // Окна с «тихо пустым» токеном быть не должно: hasMediaToken() честно
  // говорит «нет», компоненты рисуют подложку, а сама сборка URL запрашивает
  // токен у владельца и по приходу будит подписчиков.
  it('до первого токена: hasMediaToken() === false, сборка URL запрашивает его и будит подписчиков', async () => {
    expect(m.hasMediaToken()).toBe(false)

    const { result } = rtl.renderHook(() => m.useMediaTokenVersion())
    const v0 = result.current
    m.mediaContentUrl(7) // рендер медиа-бабла: URL нужен синхронно, токена ещё нет
    expect(tokenInfo).toHaveBeenCalled()

    await rtl.act(async () => { await m.primeMediaToken() })

    expect(m.hasMediaToken()).toBe(true)
    expect(m.mediaContentUrl(7)).toBe('/api/media/7/content?token=worker-tok')
    expect(result.current).not.toBe(v0) // подписчики разбужены → баблы пересоберут src
  })

  // Найдено мутацией по каждой строке диффа: снятие запроса из подписки
  // проходило ЗЕЛЁНЫМ на полном прогоне (198 файлов), хотя строка нагруженная.
  // Почти все потребители токена (ChatFeed, MessageContent, AlbumGrid,
  // RealMediaBubble, DatePickerPopup, GifsTab) устроены одинаково: подписались,
  // спросили hasMediaToken() и при «нет» вернули подложку — mediaContentUrl они
  // при этом НЕ зовут. Значит запрос из mediaContentUrl их не спасает, и
  // единственный, кто в этом состоянии идёт к владельцу, — сама подписка.
  it('подписка сама запрашивает токен — гейтящиеся на hasMediaToken() компоненты URL не собирают', () => {
    rtl.renderHook(() => m.useMediaTokenVersion())
    expect(tokenInfo).toHaveBeenCalledTimes(1)
  })

  // Тот же путь как самолечение: снимок протух (плановое обновление владельца
  // не доехало), компоненты показывают подложку — и подписка нового кадра
  // запрашивает токен заново, а не ждёт вечно.
  it('после истечения токена новая подписка снова идёт к владельцу', () => {
    m.applyMediaToken({ token: 'dead', expiresAt: Date.now() - 1 })
    rtl.renderHook(() => m.useMediaTokenVersion())
    expect(tokenInfo).toHaveBeenCalledTimes(1)
  })

  // Плановое обновление владельца доезжает событием rt:media_token (проектор
  // зовёт applyMediaToken). Что ломается без пробуждения подписчиков: баблы
  // остаются с URL старого токена до следующего рендера по другой причине —
  // то есть 401 и застрявший плейсхолдер.
  it('воркер обновил токен → зеркало отдаёт новый URL и будит подписчиков', async () => {
    await m.primeMediaToken()
    const { result } = rtl.renderHook(() => m.useMediaTokenVersion())
    const v0 = result.current

    rtl.act(() => { m.applyMediaToken(TOK('fresh-tok')) })

    expect(m.mediaContentUrl(7)).toBe('/api/media/7/content?token=fresh-tok')
    expect(result.current).not.toBe(v0)
  })

  // На холодном старте один и тот же снимок приезжает дважды: ответом
  // tokenInfo() и бродкастом того же запроса владельца. Второй раз будить
  // подписчиков нечем — это лишняя перерисовка каждого медиа-бабла в ленте.
  it('повторное применение того же снимка подписчиков не будит', async () => {
    const snap = TOK('same-tok')
    m.applyMediaToken(snap)
    const { result } = rtl.renderHook(() => m.useMediaTokenVersion())
    const v0 = result.current

    rtl.act(() => { m.applyMediaToken({ ...snap }) })

    expect(result.current).toBe(v0)
  })

  // Своего расписания у зеркала нет: ни таймера обновления, ни фонового
  // перезапроса. Единственный владелец расписания — воркер.
  it('не заводит своего таймера: время идёт, к владельцу никто не ходит', async () => {
    await m.primeMediaToken()
    tokenInfo.mockClear()
    vi.useFakeTimers()

    await vi.advanceTimersByTimeAsync(60 * 60_000) // час без единого рендера

    expect(tokenInfo).not.toHaveBeenCalled()
  })

  // Вторая вкладка подключается к живому воркеру: у того токен уже есть.
  // SuperMessagePort кадры не буферизует, поэтому стартовый бродкаст до неё не
  // доехал — токен она получает ответом RPC, а не ждёт следующего обновления.
  it('поздняя вкладка получает текущий токен запросом, а не ждёт следующего обновления', async () => {
    tokenInfo.mockResolvedValue(TOK('already-in-worker'))

    await m.primeMediaToken()

    expect(m.hasMediaToken()).toBe(true)
    expect(m.mediaContentUrl(1)).toContain('already-in-worker')
  })

  // primeMediaToken — способ ЗАПРОСИТЬ, а не расписание: при живом токене
  // лишнего похода к владельцу нет, а force (onError медиа-элемента, 401)
  // всё-таки идёт.
  it('при живом токене не ходит к владельцу; force — идёт', async () => {
    await m.primeMediaToken()
    expect(tokenInfo).toHaveBeenCalledTimes(1)

    await m.primeMediaToken()
    expect(tokenInfo).toHaveBeenCalledTimes(1)

    await m.primeMediaToken(true)
    expect(tokenInfo).toHaveBeenCalledTimes(2)
  })

  // Протухший снимок зеркало годным не считает — иначе URL собрался бы с
  // мёртвым токеном (401 и застрявший плейсхолдер) вместо перезапроса.
  it('истёкший снимок не годен, и сборка URL запрашивает токен заново', () => {
    m.applyMediaToken({ token: 'dead', expiresAt: Date.now() - 1 })

    expect(m.hasMediaToken()).toBe(false)
    m.mediaContentUrl(3)
    expect(tokenInfo).toHaveBeenCalled()
  })

  // Параллельные баблы на одном кадре не должны порождать N запросов к воркеру.
  it('параллельные запросы склеиваются в один поход к владельцу', async () => {
    await Promise.all([m.primeMediaToken(), m.primeMediaToken(), m.primeMediaToken()])
    expect(tokenInfo).toHaveBeenCalledTimes(1)
  })
})
