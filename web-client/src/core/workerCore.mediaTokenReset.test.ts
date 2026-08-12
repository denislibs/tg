// Медиа-токен и смена активной сессии: сброс у ВЛАДЕЛЬЦА (воркер).
//
// Токен подписан на конкретного пользователя и живёт до 15 минут
// (backend/internal/adapter/delivery/http/mediatoken.go: signMediaToken(userID),
// mediaTokenTTL). Пережив переход сессии, он остаётся валидным ключом к медиа
// ПРОШЛОГО аккаунта — поэтому владелец обязан выбросить его ровно в тот момент,
// когда объявляет намерение перехода (rt:logging_out / rt:logged_in), а не ждать
// истечения.
//
// Прогон настоящий: createWorkerCore() — тот же mediaManager, тот же authManager,
// та же проводка onLoggingOut/onLoggedIn, что в проде.
//
// fake-indexeddb — ПЕРВОЙ строкой: newCursor()/newConnectionManager() читают
// IndexedDB прямо в конструкторе, RestClient гейтит запросы на tokens.ready(),
// реестр аккаунтов (auth) тоже живёт в IDB.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'

let tokenFetches = 0

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  tokenFetches = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/media/token')) {
      tokenFetches++
      return new Response(JSON.stringify({
        token: `wtok${tokenFetches}`,
        expires_at: new Date(Date.now() + 900_000).toISOString(),
      }), { status: 200 })
    }
    if (u.endsWith('/auth/logout')) return new Response('{}', { status: 200 })
    if (u.endsWith('/auth/sign_in')) {
      return new Response(JSON.stringify({
        token: 'session-b',
        user: { id: 5, phone: '+79990000005', username: null, display_name: 'B' },
      }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u + ' ' + String(init?.method ?? 'GET'))
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('медиа-токен: владелец сбрасывает его на смене активной сессии', () => {
  // Уход сессии (logout без остающихся аккаунтов → rt:logging_out {migrateTo:null}).
  // Что ломается без сброса: следующий потребитель — любая вкладка, включая ту,
  // что уже под ДРУГИМ аккаунтом, — получает от владельца токен прошлого
  // пользователя и строит им URL к его медиа.
  it('после ухода сессии владелец не отдаёт прежний токен, а идёт за новым', async () => {
    const core = createWorkerCore()
    const before = await core.registry.media.tokenInfo()
    expect(tokenFetches).toBe(1)

    await core.registry.auth.logout()

    const after = await core.registry.media.tokenInfo()
    expect(after.token).not.toBe(before.token)
    expect(tokenFetches).toBe(2)
  })

  // Тот же инвариант на входе (rt:logged_in): активный токен появился/сменился —
  // медиа-токен, добытый до него, принадлежит прошлой сессии.
  it('после входа под новым аккаунтом токен запрашивается заново, а не переиспользуется', async () => {
    const core = createWorkerCore()
    const before = await core.registry.media.tokenInfo()

    await core.registry.auth.signIn('+79990000005', '12345', 'dev', 'web')

    const after = await core.registry.media.tokenInfo()
    expect(after.token).not.toBe(before.token)
    expect(tokenFetches).toBe(2)
  })
})
