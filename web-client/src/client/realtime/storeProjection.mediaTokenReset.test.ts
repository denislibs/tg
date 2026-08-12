// Медиа-токен и смена активной сессии: сброс ЗЕРКАЛА (вкладка).
//
// Владелец (воркер) выбрасывает токен прошлой сессии сам, но у каждой вкладки
// есть его модульное зеркало (core/mediaUrl.ts) — оно отдаёт токен СИНХРОННО на
// рендере и владельца не спрашивает, пока снимок годен. Значит переход обязан
// доехать и до него: кадр rt:logging_out — то самое объявление намерения,
// которое уже слушает useAuthGate; здесь проектор применяет его к зеркалу,
// ровно как rt:media_token (см. storeProjection.mediaToken.test.ts).
//
// Что ломается без строки APPLY[RT.loggingOut]: вкладка, оставшаяся жить после
// перехода (логаут без остающихся аккаунтов — reload'а в этой ветке нет, Shell
// снимается через authed=false), продолжает синхронно отдавать токен прошлого
// пользователя — до пятнадцати минут.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { hasMediaToken, mediaContentUrl } from '../../core/mediaUrl'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

// Зеркало без годного снимка идёт к владельцу (startClient) — воркер в этом
// тесте не поднимаем, запрос только фиксируем.
const { tokenInfo } = vi.hoisted(() => ({ tokenInfo: vi.fn(async () => ({ token: 'next', expiresAt: Date.now() + 900_000 })) }))
vi.mock('../bootstrap', () => ({ startClient: () => ({ managers: { media: { tokenInfo } } }) }))

const TOK = (token: string) => ({ token, expiresAt: Date.now() + 900_000 })

describe('storeProjection — rt:logging_out сбрасывает зеркало медиа-токена', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  it('кадр ухода сессии → зеркало больше не отдаёт прежний токен', () => {
    rootScope.dispatchEventSingle(RT.mediaToken, TOK('account-a'))
    expect(hasMediaToken()).toBe(true)

    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null })

    expect(hasMediaToken()).toBe(false)
    expect(mediaContentUrl(5)).not.toContain('account-a')
  })

  // Переезд на другой аккаунт (migrateTo !== null) — та же смена активного
  // токена: вкладка перезагрузится, но не мгновенно, и до перезагрузки успевает
  // отрисовать медиа-баблы.
  it('переезд на другой аккаунт сбрасывает зеркало так же, как логаут', () => {
    rootScope.dispatchEventSingle(RT.mediaToken, TOK('account-a'))
    expect(hasMediaToken()).toBe(true)

    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: 7 })

    expect(hasMediaToken()).toBe(false)
  })
})
