// Счёт истории окна (`historyStorage.count` оригинала) едет с воркера
// ЗНАЧЕНИЕМ `rt:history_count`; проектор — единственный писатель зеркала
// (`messagesMirror.ts::mirrorHistoryCount`), читатель — шапка чата
// (`components/chat/topbar.ts`). Логаут стирает его вместе с окнами.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { mirrorHistoryCount, resetMessagesMirror, winKey } from '../../core/history/messagesMirror'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

describe('storeProjection — RT.historyCount', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))
  beforeEach(() => resetMessagesMirror())

  it('значение владельца ложится в зеркало', () => {
    const key = winKey(7)
    expect(mirrorHistoryCount(key)).toBeUndefined()

    rootScope.dispatchEventSingle(RT.historyCount, { key, count: 83 })
    expect(mirrorHistoryCount(key)).toBe(83)

    rootScope.dispatchEventSingle(RT.historyCount, { key, count: 84 })
    expect(mirrorHistoryCount(key)).toBe(84)
  })

  it('сброс зеркала (логаут) стирает счёт', () => {
    rootScope.dispatchEventSingle(RT.historyCount, { key: winKey(7), count: 5 })
    resetMessagesMirror()
    expect(mirrorHistoryCount(winKey(7))).toBeUndefined()
  })
})
