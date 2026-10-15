// Менеджер сессий: провод — конструкторы схемы, плоской проекции больше нет.
//
// Первая часть пинит решения шага 7 плана волны 2, которые иначе не краснеют нигде: `list()`
// отдаёт `authorization` КАК ЕСТЬ (возвращение `mapSession` сразу покрасит
// первый), а `terminate`/`terminateOthers` разворачивают ответный `Bool` в
// исход — именно по нему вкладка решает, снимать ли строку.
//
// Вторая часть («новый вход», М1-3) — порт сценариев tweb
// `tests/appAccountManagerAuthorizations.test.ts` (812502980), которые относятся к нашему
// предмету. Не перенесён тест «app config arrives before state» (:195-212): appConfig у
// нас нет, срок — константа (расхождение 2 шапки менеджера).
import { afterEach, describe, it, expect, vi } from 'vitest'
import type { Authorization } from '@layer'
import {
  DEFAULT_AUTHORIZATION_AUTOCONFIRM_PERIOD,
  FRESH_AUTHORIZATION_PERIOD,
  applyUnconfirmedAuthorizationUpdate,
  filterExpiredUnconfirmedAuthorizations,
  newSessionsManager,
  type UnconfirmedAuthorization,
} from './sessionsManager'
import type { NewAuthorizationEvt } from '../realtime/events'
import type { AppState } from '../state/state'
import type { RestClient } from '../net/restClient'

const authorization = {
  _: 'authorization',
  pFlags: { current: true },
  hash: 7,
  device_model: 'Chrome',
  platform: 'browser',
  date_created: 1_700_000_000,
  date_active: 1_700_000_100,
  ip: '1.2.3.4',
  country: 'Germany',
}

function restOnly(rest: Partial<Record<'get' | 'del' | 'post', unknown>>) {
  return {
    rest: rest as unknown as RestClient,
    state: { getState: async () => ({}), pushToState: vi.fn() },
    broadcast: vi.fn(),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SessionsManager', () => {
  it('list отдаёт конструкторы authorization без перекладывания в плоскую форму', async() => {
    const get = vi.fn(async () => ({
      _: 'account.authorizations',
      authorization_ttl_days: 0,
      authorizations: [authorization],
    }))

    const list = await newSessionsManager(restOnly({ get })).list()

    expect(list).toEqual([authorization])
    expect(get).toHaveBeenCalledWith('/sessions')
  })

  it('пустой ответ — пустой список, а не падение', async() => {
    const get = vi.fn(async () => ({ _: 'account.authorizations', authorization_ttl_days: 0 }))

    await expect(newSessionsManager(restOnly({ get })).list()).resolves.toEqual([])
  })

  it('terminate адресует сессию её hash и отдаёт исход из конструктора Bool', async() => {
    const del = vi.fn(async () => ({ _: 'boolTrue' }))
    const mgr = newSessionsManager(restOnly({ del }))

    await expect(mgr.terminate(7)).resolves.toBe(true)
    expect(del).toHaveBeenCalledWith('/sessions/7')

    del.mockResolvedValueOnce({ _: 'boolFalse' })
    await expect(mgr.terminate(7)).resolves.toBe(false)
  })

  it('terminateOthers бьёт в /sessions/others и отдаёт исход', async() => {
    const del = vi.fn(async () => ({ _: 'boolTrue' }))
    const mgr = newSessionsManager(restOnly({ del }))

    await expect(mgr.terminateOthers()).resolves.toBe(true)
    expect(del).toHaveBeenCalledWith('/sessions/others')

    del.mockResolvedValueOnce({ _: 'boolFalse' })
    await expect(mgr.terminateOthers()).resolves.toBe(false)
  })
})

// ── «Новый вход» ─────────────────────────────────────────────────────────────

const NOW = 1_000_000
const PERIOD = DEFAULT_AUTHORIZATION_AUTOCONFIRM_PERIOD

function makeUpdate(
  hash: string | number,
  unconfirmed: boolean,
  overrides: Partial<NewAuthorizationEvt> = {},
): NewAuthorizationEvt {
  return {
    _: 'updateNewAuthorization',
    // на нашем проводе `pFlags` без флагов опущен (расхождение 6 шапки менеджера)
    ...(unconfirmed ? { pFlags: { unconfirmed: true as const } } : {}),
    hash,
    date: NOW,
    device: 'Safari on iPhone',
    location: 'Dubai, UAE',
    ...overrides,
  }
}

function makeAuthorization(hash: string | number, unconfirmed: boolean, date = NOW, current = false) {
  return {
    _: 'authorization',
    pFlags: {
      ...(unconfirmed ? { unconfirmed: true } : {}),
      ...(current ? { current: true } : {}),
    },
    hash,
    device_model: 'MacBook Pro',
    platform: 'macOS',
    system_version: '15.0',
    api_id: 1,
    app_name: 'Telegram Web',
    app_version: '1.0',
    date_created: date,
    date_active: date,
    ip: '127.0.0.1',
    country: 'Dubai, UAE',
    region: '',
  } as unknown as Authorization.authorization
}

const sessionsList = (authorizations: Authorization.authorization[]) => ({
  _: 'account.authorizations',
  authorization_ttl_days: 0,
  authorizations,
})

function makeManager(options: {
  saved?: UnconfirmedAuthorization[]
  currentAuthorizationDate?: number
  get?: ReturnType<typeof vi.fn>
  post?: ReturnType<typeof vi.fn>
  del?: ReturnType<typeof vi.fn>
  /** Чтение State отдаётся вручную: кадры, пришедшие до него, ждут. */
  deferState?: boolean
} = {}) {
  vi.useFakeTimers()
  vi.setSystemTime(NOW * 1000)

  const get = options.get ?? vi.fn()
  const post = options.post ?? vi.fn()
  const del = options.del ?? vi.fn()
  const pushToState = vi.fn()
  const broadcast = vi.fn()
  const loaded: Partial<AppState> = {
    unconfirmedAuthorizations: options.saved ?? [],
    currentAuthorizationDate: options.currentAuthorizationDate ?? 0,
  }
  let resolveState!: () => void
  const getState = vi.fn(() => options.deferState ?
    new Promise<Partial<AppState>>((resolve) => { resolveState = () => resolve(loaded) }) :
    Promise.resolve(loaded))

  const manager = newSessionsManager({
    rest: { get, post, del } as unknown as RestClient,
    state: { getState, pushToState },
    broadcast,
  })
  return { manager, get, post, del, pushToState, broadcast, getState, resolveState: () => resolveState() }
}

const ids = (list: UnconfirmedAuthorization[]) => list.map(({ hash }) => hash)

describe('unconfirmed authorizations', () => {
  it('upserts an unconfirmed update and removes it when the flag is cleared', () => {
    const initial = applyUnconfirmedAuthorizationUpdate([], makeUpdate(1, true))
    const replaced = applyUnconfirmedAuthorizationUpdate(initial, makeUpdate('1', true, {
      device: 'Telegram Desktop',
    }))

    expect(replaced).toEqual([{
      hash: '1',
      date: NOW,
      device: 'Telegram Desktop',
      location: 'Dubai, UAE',
    }])
    expect(applyUnconfirmedAuthorizationUpdate(replaced, makeUpdate(1, false))).toEqual([])
  })

  it('filters cached entries after the autoconfirm period', () => {
    const list: UnconfirmedAuthorization[] = [
      { hash: 1, date: NOW - PERIOD + 1, device: 'First', location: 'Dubai' },
      { hash: 2, date: NOW - PERIOD, device: 'Second', location: 'Berlin' },
    ]

    expect(filterExpiredUnconfirmedAuthorizations(list, PERIOD, NOW)).toEqual([list[0]])
  })

  it('restores, persists and expires cached entries', async() => {
    const active: UnconfirmedAuthorization = { hash: 1, date: NOW - PERIOD + 5, device: 'Safari', location: 'Dubai' }
    const expired: UnconfirmedAuthorization = { hash: 2, date: NOW - PERIOD - 1, device: 'Chrome', location: 'Berlin' }
    const { manager, pushToState, broadcast } = makeManager({ saved: [active, expired] })

    expect(await manager.getUnconfirmedAuthorizations()).toEqual([active])
    expect(pushToState).toHaveBeenCalledWith('unconfirmedAuthorizations', [active])
    expect(broadcast).toHaveBeenLastCalledWith('unconfirmed_authorizations_update', [active])

    await vi.advanceTimersByTimeAsync(5_000)

    expect(await manager.getUnconfirmedAuthorizations()).toEqual([])
    expect(broadcast).toHaveBeenLastCalledWith('unconfirmed_authorizations_update', [])
  })

  it('applies updates received before persisted state finishes loading', async() => {
    const saved: UnconfirmedAuthorization = { hash: 1, date: NOW - 5, device: 'Safari', location: 'Dubai' }
    const { manager, resolveState } = makeManager({ saved: [saved], deferState: true })

    // первое обращение запускает чтение State; кадр ждёт его
    const pending = manager.getUnconfirmedAuthorizations()
    manager.processNewAuthorizationUpdate(makeUpdate(2, true))
    resolveState()
    await pending

    expect(ids(await manager.getUnconfirmedAuthorizations())).toEqual([2, 1])
  })

  it('persists updateNewAuthorization changes and broadcasts them', async() => {
    const { manager, pushToState, broadcast } = makeManager()

    manager.processNewAuthorizationUpdate(makeUpdate(10, true))
    await vi.advanceTimersByTimeAsync(0)

    const expected = [{ hash: 10, date: NOW, device: 'Safari on iPhone', location: 'Dubai, UAE' }]
    expect(await manager.getUnconfirmedAuthorizations()).toEqual(expected)
    expect(pushToState).toHaveBeenLastCalledWith('unconfirmedAuthorizations', expected)
    expect(broadcast).toHaveBeenLastCalledWith('unconfirmed_authorizations_update', expected)

    manager.processNewAuthorizationUpdate(makeUpdate(10, false))
    await vi.advanceTimersByTimeAsync(0)
    expect(await manager.getUnconfirmedAuthorizations()).toEqual([])
    expect(broadcast).toHaveBeenLastCalledWith('unconfirmed_authorizations_update', [])
  })

  it('reconciles persisted reviews with account.getAuthorizations', async() => {
    const get = vi.fn().mockResolvedValue(sessionsList([
      makeAuthorization(10, false),
      makeAuthorization(20, true, NOW - 1),
    ]))
    const { manager } = makeManager({ get })

    await manager.getAuthorizations()

    expect(await manager.getUnconfirmedAuthorizations()).toEqual([{
      hash: 20,
      date: NOW - 1,
      device: 'MacBook Pro, macOS',
      location: 'Dubai, UAE',
    }])
  })

  it('deduplicates parallel authorizations requests', async() => {
    let resolveRequest!: (value: unknown) => void
    const get = vi.fn().mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))
    const { manager } = makeManager({ get })

    const first = manager.getAuthorizations()
    const second = manager.getAuthorizations()
    await vi.advanceTimersByTimeAsync(0)
    expect(get).toHaveBeenCalledTimes(1)
    resolveRequest(sessionsList([makeAuthorization(20, true)]))
    await Promise.all([first, second])

    expect(ids(await manager.getUnconfirmedAuthorizations())).toEqual([20])
  })

  it('allows retrying authorizations after a failed request', async() => {
    const get = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(sessionsList([makeAuthorization(20, true)]))
    const { manager } = makeManager({ get })

    await expect(manager.getAuthorizations()).rejects.toThrow('network')
    await manager.getAuthorizations()

    expect(get).toHaveBeenCalledTimes(2)
    expect(ids(await manager.getUnconfirmedAuthorizations())).toEqual([20])
  })

  it('replays a new authorization update over an in-flight sessions response', async() => {
    let resolveRequest!: (value: unknown) => void
    const get = vi.fn().mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))
    const { manager } = makeManager({ get })
    await manager.getUnconfirmedAuthorizations() // State загружен — кадр применяется сразу

    const request = manager.getAuthorizations()
    manager.processNewAuthorizationUpdate(makeUpdate(20, true))
    await vi.advanceTimersByTimeAsync(0)
    resolveRequest(sessionsList([makeAuthorization(10, true, NOW - 1)]))
    await request

    expect(ids(await manager.getUnconfirmedAuthorizations())).toEqual([20, 10])
  })

  it('replays a confirmation update over an in-flight sessions response', async() => {
    let resolveRequest!: (value: unknown) => void
    const get = vi.fn().mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))
    const { manager } = makeManager({ get })
    await manager.getUnconfirmedAuthorizations()

    const request = manager.getAuthorizations()
    manager.processNewAuthorizationUpdate(makeUpdate(10, false))
    await vi.advanceTimersByTimeAsync(0)
    resolveRequest(sessionsList([makeAuthorization(10, true)]))
    await request

    expect(await manager.getUnconfirmedAuthorizations()).toEqual([])
  })

  it('keeps a bulk sessions reset over an in-flight sessions response', async() => {
    let resolveRequest!: (value: unknown) => void
    const get = vi.fn().mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))
    const del = vi.fn().mockResolvedValue({ _: 'boolTrue' })
    const { manager } = makeManager({ get, del })
    await manager.getUnconfirmedAuthorizations()

    const request = manager.getAuthorizations()
    await manager.terminateOthers()
    resolveRequest(sessionsList([makeAuthorization(10, true)]))
    await request

    expect(del).toHaveBeenCalledWith('/sessions/others')
    expect(await manager.getUnconfirmedAuthorizations()).toEqual([])
  })

  it('never asks about the session it is running on', async() => {
    const get = vi.fn().mockResolvedValue(sessionsList([
      // the server flags a brand new session as unconfirmed for the others
      makeAuthorization(0, true, NOW - 2 * FRESH_AUTHORIZATION_PERIOD, true),
      makeAuthorization(20, true, NOW - 1),
    ]))
    const { manager } = makeManager({ get })

    await manager.getAuthorizations()

    expect(ids(await manager.getUnconfirmedAuthorizations())).toEqual([20])
  })

  it('holds a prompt back while this session is too fresh to review it', async() => {
    const get = vi.fn().mockResolvedValue(sessionsList([makeAuthorization(0, true, NOW, true)]))
    const { manager, broadcast, pushToState } = makeManager({ get })

    // the session's own age comes from the server list, never from anywhere else
    await manager.getAuthorizations()
    expect(pushToState).toHaveBeenCalledWith('currentAuthorizationDate', NOW)

    manager.processNewAuthorizationUpdate(makeUpdate(30, true))
    await vi.advanceTimersByTimeAsync(0)

    const prompt = { hash: 30, date: NOW, device: 'Safari on iPhone', location: 'Dubai, UAE' }
    expect(await manager.getUnconfirmedAuthorizations()).toEqual([])
    expect(broadcast).not.toHaveBeenCalledWith('unconfirmed_authorizations_update', [prompt])
    expect(pushToState).toHaveBeenCalledWith('unconfirmedAuthorizations', [prompt])

    await vi.advanceTimersByTimeAsync(FRESH_AUTHORIZATION_PERIOD * 1000)

    expect(await manager.getUnconfirmedAuthorizations()).toEqual([prompt])
    expect(broadcast).toHaveBeenLastCalledWith('unconfirmed_authorizations_update', [prompt])
  })

  it('keeps a restored prompt hidden until the fresh window passes', async() => {
    const saved: UnconfirmedAuthorization = { hash: 1, date: NOW - 5, device: 'Safari', location: 'Dubai' }
    const { manager, broadcast } = makeManager({ saved: [saved], currentAuthorizationDate: NOW - 60 })

    expect(await manager.getUnconfirmedAuthorizations()).toEqual([])

    await vi.advanceTimersByTimeAsync(FRESH_AUTHORIZATION_PERIOD * 1000)

    expect(await manager.getUnconfirmedAuthorizations()).toEqual([saved])
    expect(broadcast).toHaveBeenLastCalledWith('unconfirmed_authorizations_update', [saved])
  })

  it('confirms or resets through the sessions routes before removing the review', async() => {
    const post = vi.fn().mockResolvedValue({ _: 'boolTrue' })
    const del = vi.fn().mockResolvedValue({ _: 'boolTrue' })
    const { manager } = makeManager({ post, del })
    manager.processNewAuthorizationUpdate(makeUpdate(10, true))
    manager.processNewAuthorizationUpdate(makeUpdate(20, true))
    await vi.advanceTimersByTimeAsync(0)

    await expect(manager.confirmUnconfirmedAuthorization(20)).resolves.toBe(true)
    expect(post).toHaveBeenCalledWith('/sessions/20/settings', { confirmed: true })
    expect(ids(await manager.getUnconfirmedAuthorizations())).toEqual([10])

    await expect(manager.terminate(10)).resolves.toBe(true)
    expect(del).toHaveBeenCalledWith('/sessions/10')
    expect(await manager.getUnconfirmedAuthorizations()).toEqual([])
  })

  it('leaves the review alone when the server refuses', async() => {
    const post = vi.fn().mockRejectedValue(Object.assign(new Error('406'), { type: 'FRESH_CHANGE_AUTHORIZATION_FORBIDDEN' }))
    const del = vi.fn().mockResolvedValue({ _: 'boolFalse' })
    const { manager } = makeManager({ post, del })
    manager.processNewAuthorizationUpdate(makeUpdate(10, true))
    await vi.advanceTimersByTimeAsync(0)

    await expect(manager.confirmUnconfirmedAuthorization(10)).rejects.toThrow('406')
    await expect(manager.terminate(10)).resolves.toBe(false)
    expect(ids(await manager.getUnconfirmedAuthorizations())).toEqual([10])
  })

  it('changeAuthorizationSettings without confirmed keeps the review', async() => {
    const post = vi.fn().mockResolvedValue({ _: 'boolTrue' })
    const { manager } = makeManager({ post })
    manager.processNewAuthorizationUpdate(makeUpdate(10, true))
    await vi.advanceTimersByTimeAsync(0)

    await expect(manager.changeAuthorizationSettings(10, {})).resolves.toBe(true)
    expect(ids(await manager.getUnconfirmedAuthorizations())).toEqual([10])
  })
})

// Смена аккаунта в том же браузере: воркер общий, память менеджера и ключи State прежнего
// аккаунта не должны дожить до следующего (Боб не видит плашки Алисы).
describe('reset на смене аккаунта', () => {
  it('обнуляет список, ключи State и объявляет пустой список вкладкам', async() => {
    const { manager, pushToState, broadcast } = makeManager({
      saved: [{ hash: 1, date: NOW - 5, device: 'Safari', location: 'Dubai' }],
      currentAuthorizationDate: NOW - 5 * FRESH_AUTHORIZATION_PERIOD,
    })
    expect(ids(await manager.getUnconfirmedAuthorizations())).toEqual([1])

    manager.reset()

    expect(pushToState).toHaveBeenCalledWith('unconfirmedAuthorizations', [])
    expect(pushToState).toHaveBeenCalledWith('currentAuthorizationDate', 0)
    expect(broadcast).toHaveBeenLastCalledWith('unconfirmed_authorizations_update', [])
    // прежний список не всплывает: после сброса память — истина, диск не перечитывается
    expect(await manager.getUnconfirmedAuthorizations()).toEqual([])
  })

  it('запоздавший ответ списка прошлого аккаунта не применяется', async() => {
    let resolveRequest!: (value: unknown) => void
    const get = vi.fn().mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))
    const { manager, broadcast } = makeManager({ get })
    await manager.getUnconfirmedAuthorizations()

    const request = manager.getAuthorizations()
    await vi.advanceTimersByTimeAsync(0)
    manager.reset()
    resolveRequest(sessionsList([makeAuthorization(20, true, NOW - 1)]))
    await request

    expect(await manager.getUnconfirmedAuthorizations()).toEqual([])
    expect(broadcast).not.toHaveBeenCalledWith('unconfirmed_authorizations_update', [expect.objectContaining({ hash: 20 })])
  })

  it('кадр, полученный до смены аккаунта, после неё не применяется (кадр после reset() поколением не отсекается — его гасит сокет)', async() => {
    const { manager, resolveState } = makeManager({ deferState: true })
    const pending = manager.getUnconfirmedAuthorizations()
    manager.processNewAuthorizationUpdate(makeUpdate(2, true)) // кадр сокета «Алисы»
    manager.reset() // вошёл «Боб»
    resolveState()
    await pending.catch(() => {})
    await vi.advanceTimersByTimeAsync(0)

    expect(await manager.getUnconfirmedAuthorizations()).toEqual([])
  })

  it('таймер срока прошлого аккаунта погашен', async() => {
    const { manager, broadcast } = makeManager({
      saved: [{ hash: 1, date: NOW - PERIOD + 5, device: 'Safari', location: 'Dubai' }],
    })
    await manager.getUnconfirmedAuthorizations()
    manager.reset()
    broadcast.mockClear()

    await vi.advanceTimersByTimeAsync(10_000)

    expect(broadcast).not.toHaveBeenCalled()
  })
})
