// Stage 1C.2 (Task 3): rt:media_token — публикация владельца (воркер,
// core/managers/mediaManager.ts). Проектор — единственный, кто применяет её на
// витрине (см. core/noDuplicateMediaToken.test.ts). Что ломается без строки
// APPLY[RT.mediaToken]: событие доезжает до rootScope и умирает там — зеркало
// узнаёт токен только тем запросом, который вкладка сделает сама, а плановое
// обновление владельца до неё не доходит вовсе (истёкший токен → 401 и
// застрявший плейсхолдер). Гейт-паттерн — как в storeProjection.me.test.ts.
import { beforeAll, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { applyMediaToken, hasMediaToken, mediaContentUrl } from '../../core/mediaUrl'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

describe('storeProjection — rt:media_token применяется к зеркалу core/mediaUrl', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  it('снимок от воркера → зеркало отдаёт URL с этим токеном', () => {
    rootScope.dispatchEventSingle(RT.mediaToken, { token: 'from-worker', expiresAt: Date.now() + 900_000 })

    expect(hasMediaToken()).toBe(true)
    expect(mediaContentUrl(5)).toBe('/api/media/5/content?token=from-worker')
  })

  it('следующее плановое обновление владельца перезаписывает предыдущее', () => {
    rootScope.dispatchEventSingle(RT.mediaToken, { token: 'first', expiresAt: Date.now() + 900_000 })
    rootScope.dispatchEventSingle(RT.mediaToken, { token: 'second', expiresAt: Date.now() + 900_000 })

    expect(mediaContentUrl(5)).toContain('token=second')
  })

  // Зеркало обязано пережить логаут-подобный случай «токен больше не годен»:
  // применяется ровно присланное, без домысливания.
  it('истёкший снимок применяется как есть — зеркало перестаёт считать токен годным', () => {
    applyMediaToken({ token: 'live', expiresAt: Date.now() + 900_000 })
    rootScope.dispatchEventSingle(RT.mediaToken, { token: 'stale', expiresAt: Date.now() - 1 })

    expect(hasMediaToken()).toBe(false)
  })
})
