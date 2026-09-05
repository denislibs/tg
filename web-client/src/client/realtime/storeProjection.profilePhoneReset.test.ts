// Телефон чужого пира (privacy.profile()) и смена активной сессии: сброс ЗЕРКАЛА (вкладка).
//
// core/profilePhoneCache.ts — модульное зеркало Task 2 профиля на Solid:
// useUserProfile (React) читает cachedProfilePhone СИНХРОННО на рендере, не
// перепроверяя, что снимок относится к текущей сессии. Значит переход обязан
// доехать и сюда — ровно как у соседних зеркал (peerCache/mediaUrl/mediaToken/
// mediaPlaybackController), см. storeProjection.peers.test.ts /
// storeProjection.mediaTokenReset.test.ts.
//
// Что ломается без строки resetProfilePhoneMirror() в APPLY[RT.loggingOut]:
// вкладка, оставшаяся жить после логаута (или после переезда на другой
// аккаунт), продолжает синхронно отдавать телефон, посчитанный приватностью
// для ПРОШЛОГО зрителя, — утечка приватных данных между аккаунтами в одной
// вкладке.
import { beforeAll, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { cachedProfilePhone, saveProfilePhone } from '../../core/profilePhoneCache'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

describe('storeProjection — rt:logging_out сбрасывает зеркало телефона профиля', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  it('кадр ухода сессии → зеркало больше не отдаёт телефон прошлого зрителя', () => {
    saveProfilePhone(7, '+79991234567')
    expect(cachedProfilePhone(7)).toBe('+79991234567')

    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null })

    expect(cachedProfilePhone(7)).toBeUndefined()
  })

  // Переезд на другой аккаунт (migrateTo !== null) — та же смена активного
  // зрителя: вкладка перезагрузится, но не мгновенно, и до перезагрузки успеет
  // отрисовать профиль нового аккаунта поверх ещё не сброшенного зеркала.
  it('переезд на другой аккаунт сбрасывает зеркало так же, как логаут', () => {
    saveProfilePhone(9, '+70001112233')
    expect(cachedProfilePhone(9)).toBe('+70001112233')

    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: 7 })

    expect(cachedProfilePhone(9)).toBeUndefined()
  })
})
