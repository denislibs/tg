// Пин ПРОВОДКИ в workerCore.ts для М1-3 («новый вход»):
//  - кадр журнала `new_authorization` (updateNewAuthorization) применяет владелец
//    запросов «это вы?» (`sessions`) и объявляет вкладкам `unconfirmed_authorizations_update`
//    (tweb `apiUpdatesManager` → `processNewAuthorizationUpdate`); сырой rt-кадр не идёт;
//  - переход сессии (`onLoggingOut`/`onLoggedIn`) обнуляет память и ключи State — Боб в том же
//    браузере не видит плашки Алисы;
//  - вход (`onLoggedIn`) сверяет запросы со списком сессий (tweb `user_auth`).
//
// fake-indexeddb — ПЕРВОЙ строкой (см. workerCore.dialogsReset.test.ts).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => { capturedConnDeps = deps; return actual.newConnectionManager(deps) },
  }
})

import { createWorkerCore } from './workerCore'
import { loadStateAll } from './store/persist'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  return { core, tab: new SuperMessagePort(epTab) }
}

const settle = async () => {
  for (let i = 0; i < 10; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const prompt = (hash: number) => ({
  _: 'updateNewAuthorization', pFlags: { unconfirmed: true }, hash, date: 1_800_000_000,
  device: 'Firefox, web', location: 'Москва',
})

let sessionsRequests = 0
let sessionsFail = false

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
  sessionsRequests = 0
  sessionsFail = false
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.endsWith('/auth/logout')) return new Response('{}', { status: 200 })
    if (u.endsWith('/auth/sign_in')) {
      return new Response(JSON.stringify({
        _: 'auth.authorization',
        token: 'session-b',
        user: { _: 'user', pFlags: { self: true }, id: 5, phone: '+79990000005' },
      }), { status: 200 })
    }
    if (u.endsWith('/sessions')) {
      ++sessionsRequests
      if (sessionsFail) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({
        _: 'account.authorizations', authorization_ttl_days: 0,
        authorizations: [
          { _: 'authorization', pFlags: { current: true }, hash: 0, device_model: 'Chrome', platform: 'web', date_created: 1, date_active: 1, ip: '', country: '' },
          { _: 'authorization', pFlags: { unconfirmed: true }, hash: 31, device_model: 'Firefox', platform: 'web', date_created: Math.floor(Date.now() / 1000) - 60, date_active: 1, ip: '', country: 'Москва' },
        ],
      }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): updateNewAuthorization', () => {
  it('кадр с unconfirmed доходит вкладкам событием unconfirmed_authorizations_update, сырой кадр — нет', async () => {
    const { tab } = boot()
    const got: unknown[] = []
    const raw: unknown[] = []
    tab.on('unconfirmed_authorizations_update', (p) => got.push(p))
    tab.on('rt:new_authorization', (p) => raw.push(p))

    capturedConnDeps!.onFrame('new_authorization', { ...prompt(11), date: Math.floor(Date.now() / 1000) })
    await settle()

    expect(got).toHaveLength(1)
    expect(got[0]).toEqual([expect.objectContaining({ hash: 11, device: 'Firefox, web', location: 'Москва' })])
    expect(raw).toEqual([])
  })

  it('кадр «убрать» (без pFlags) снимает запрос', async () => {
    const { tab } = boot()
    const got: unknown[][] = []
    tab.on('unconfirmed_authorizations_update', (p) => got.push(p as unknown[]))

    capturedConnDeps!.onFrame('new_authorization', { ...prompt(11), date: Math.floor(Date.now() / 1000) })
    await settle()
    capturedConnDeps!.onFrame('new_authorization', { _: 'updateNewAuthorization', hash: 11 })
    await settle()

    expect(got.map((l) => l.length)).toEqual([1, 0])
  })
})

describe('createWorkerCore(): переход сессии и запросы «это вы?»', () => {
  it('logout() опустошает список, ключи State и объявляет пустой список вкладкам', async () => {
    const { core, tab } = boot()
    const got: unknown[][] = []
    tab.on('unconfirmed_authorizations_update', (p) => got.push(p as unknown[]))
    capturedConnDeps!.onFrame('new_authorization', { ...prompt(11), date: Math.floor(Date.now() / 1000) })
    await settle()
    expect(await core.registry.sessions.getUnconfirmedAuthorizations()).toHaveLength(1)

    await core.registry.auth.logout() // без активной сессии — резолвится локально, зовёт onLoggingOut
    await settle()

    expect(await core.registry.sessions.getUnconfirmedAuthorizations()).toEqual([])
    expect(got[got.length - 1]).toEqual([])
    const state = await loadStateAll()
    expect(state.unconfirmedAuthorizations).toEqual([])
    expect(state.currentAuthorizationDate).toBe(0)
  })

  it('вход (rt:logged_in) сбрасывает запросы прошлого аккаунта, даже если список сессий не пришёл', async () => {
    sessionsFail = true
    const { core, tab } = boot()
    const got: unknown[][] = []
    tab.on('unconfirmed_authorizations_update', (p) => got.push(p as unknown[]))
    capturedConnDeps!.onFrame('new_authorization', { ...prompt(11), date: Math.floor(Date.now() / 1000) })
    await settle()
    expect(await core.registry.sessions.getUnconfirmedAuthorizations()).toHaveLength(1)

    await core.registry.auth.signIn('+79990000005', '12345', 'dev', 'web') // «Боб»
    await settle()

    expect(await core.registry.sessions.getUnconfirmedAuthorizations()).toEqual([])
    expect(got[got.length - 1]).toEqual([])
  })

  it('вход (rt:logged_in) сверяет запросы со списком сессий', async () => {
    const { core, tab } = boot()
    const got: unknown[][] = []
    tab.on('unconfirmed_authorizations_update', (p) => got.push(p as unknown[]))
    // «Алиса»: запрос в памяти воркера
    capturedConnDeps!.onFrame('new_authorization', { ...prompt(11), date: Math.floor(Date.now() / 1000) })
    await settle()

    await core.registry.auth.signIn('+79990000005', '12345', 'dev', 'web') // «Боб»
    await settle()

    expect(sessionsRequests).toBeGreaterThanOrEqual(1)
    // Боб видит только свои запросы (hash 31 из списка сессий); запрос Алисы (11) не доживает
    expect(await core.registry.sessions.getUnconfirmedAuthorizations()).toEqual([
      expect.objectContaining({ hash: 31 }),
    ])
  })
})
