// Плеер и смена активной сессии: сброс КОЛЛЕКЦИИ медиа-элементов.
//
// Контроллер (порт tweb appMediaPlaybackController) держит по элементу на
// сообщение, и у каждого в `src` лежит URL прошлой сессии: токен-стрим
// (core/mediaUrl) или blob расшифрованного секретного голоса. Логаут/переезд
// обязан снять их тем же кадром, что и остальные зеркала, — иначе следующий
// аккаунт получает живые элементы чужой сессии (и играющий трек в придачу).
//
// Что ломается без строки resetPlayback() в APPLY[RT.loggingOut]: плашка плеера
// продолжает играть голосовое прошлого пользователя, а `getMedia` отдаёт его
// элемент новому окну ленты.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { mediaPlayback } from '../../core/audio/mediaPlaybackController'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

vi.mock('../bootstrap', () => ({ startClient: () => ({ managers: { media: { tokenInfo: vi.fn() } } }) }))

describe('storeProjection — rt:logging_out сносит коллекцию медиа-элементов плеера', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  it('кадр ухода сессии → элемент сообщения снят с учёта', () => {
    const track = { mediaId: 777, title: 't', subtitle: 's', type: 'voice' as const }
    // autoload: false — сеть в этом тесте не нужна, проверяется учёт элемента
    mediaPlayback.addMedia({ track, autoload: false })
    expect(mediaPlayback.getMedia(777)).toBeDefined()

    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null })

    expect(mediaPlayback.getMedia(777)).toBeUndefined()
  })
})
