// src/core/managers/statsManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newStatsManager } from './statsManager'
import type { RestClient } from '../net/restClient'

describe('statsManager (порт appStatisticsManager)', () => {
  const make = (body: unknown) => {
    const get = vi.fn(async () => body)
    const mgr = newStatsManager({ rest: { get } as unknown as Pick<RestClient, 'get'> })
    return { get, mgr }
  }

  it('getBroadcastStats и getMegagroupStats — одна ручка /channels/{id}/stats, конструктор как есть', async () => {
    const body = { _: 'stats.broadcastStats', recent_posts_interactions: [] }
    const { get, mgr } = make(body)
    await expect(mgr.getBroadcastStats({ peerId: -42 })).resolves.toEqual({ stats: body })
    await expect(mgr.getMegagroupStats({ peerId: -42 })).resolves.toEqual({ stats: body })
    expect(get).toHaveBeenNthCalledWith(1, '/channels/-42/stats')
    expect(get).toHaveBeenNthCalledWith(2, '/channels/-42/stats')
  })

  it('getMessageStats — /chats/{id}/messages/{mid}/stats', async () => {
    const body = { _: 'stats.messageStats' }
    const { get, mgr } = make(body)
    await expect(mgr.getMessageStats({ peerId: -42, mid: 7 })).resolves.toEqual({ stats: body })
    expect(get).toHaveBeenCalledWith('/chats/-42/messages/7/stats')
  })
})
