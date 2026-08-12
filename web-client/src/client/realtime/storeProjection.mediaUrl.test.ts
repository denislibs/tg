// Task 6 (медиа-суперпорт, стадия C): стык владельца URL медиа с зеркалом витрины.
//
// Владелец — воркерный mediaManager (downloadMediaURL: кэш-контекст → корзина →
// байты → objectURL), он объявляет созданный URL кадром rt:media_url; зеркало —
// core/mediaCache.ts (cachedMediaUrl), единственная точка применения — проектор.
// Стенд склеивает настоящий менеджер с настоящим проектором тем же каналом, что
// и прод (onMediaUrl → [в проде: broadcast → веер портов → realtimeBridge] →
// dispatchEventSingle → storeProjection), по образцу storeProjection.peers.test.ts:
// предмет — что владелец и витрина НЕ расходятся, а это свойство пары.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { cachedMediaUrl } from '../../core/mediaCache'
import { newMediaManager } from '../../core/managers/mediaManager'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

function stand() {
  const rest = { getBlob: vi.fn(async () => new Blob(['bytes'])) } as never
  // onMediaUrl — та самая проводка, которую в проде задаёт workerCore
  // (broadcast(RT.mediaUrl, e)); здесь вместо веера портов сразу локальный
  // ре-эмит, как это делает realtimeBridge на вкладке.
  const mgr = newMediaManager({ rest, onMediaUrl: (e) => rootScope.dispatchEventSingle(RT.mediaUrl, e) })
  return { mgr }
}

describe('storeProjection — URL медиа: воркер владеет, витрина зеркалит', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  it('downloadMediaURL владельца → зеркало витрины держит ТОТ ЖЕ URL', async () => {
    const { mgr } = stand()

    const url = await mgr.downloadMediaURL(7)

    expect(cachedMediaUrl(7)).toBe(url)
    // thumb — отдельная запись факта: полное медиа её не наполняет
    expect(cachedMediaUrl(7, true)).toBeUndefined()

    const thumbUrl = await mgr.downloadMediaURL(7, { thumb: true })
    expect(cachedMediaUrl(7, true)).toBe(thumbUrl)
  })

  // Уход активной сессии: воркер уже отозвал blob:-URL (resetDownloads), зеркало
  // обязано перестать их отдавать — иначе <img> витрины держит мёртвый URL
  // (а до отзыва — медиа прошлого аккаунта).
  it('кадр rt:logging_out сбрасывает зеркало', async () => {
    const { mgr } = stand()
    await mgr.downloadMediaURL(8)
    expect(cachedMediaUrl(8)).toBeDefined()

    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null })

    expect(cachedMediaUrl(8)).toBeUndefined()
  })
})
