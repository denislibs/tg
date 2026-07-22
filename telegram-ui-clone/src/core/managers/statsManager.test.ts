// src/core/managers/statsManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newStatsManager } from './statsManager'
import type { RestClient } from '../net/restClient'

describe('StatsManager.getChannelStats', () => {
  it('GETs /channels/{id}/stats and maps snake_case to camelCase', async () => {
    const get = vi.fn(async () => ({
      summary: { members: 100, total_views: 5000, posts_count: 50, avg_reach: 100, notifications_on: 80 },
      members_growth: [{ date: '2026-01-01', value: 10 }],
      views_by_day: [{ date: '2026-01-02', value: 200 }],
      posts_by_day: [{ date: '2026-01-03', value: 3 }],
      top_posts: [{ msg_id: 7, seq: 5, text: 'hello', views: 999, date: '2026-01-04' }],
    }))
    const rest = { get } as unknown as Pick<RestClient, 'get'>
    const mgr = newStatsManager({ rest })

    const s = await mgr.getChannelStats(42)

    expect(get).toHaveBeenCalledWith('/channels/42/stats')
    expect(s.summary).toEqual({
      members: 100, totalViews: 5000, postsCount: 50, avgReach: 100, notificationsOn: 80,
    })
    expect(s.membersGrowth).toEqual([{ date: '2026-01-01', value: 10 }])
    expect(s.topPosts).toEqual([{ msgId: 7, seq: 5, text: 'hello', views: 999, date: '2026-01-04' }])
  })

  it('tolerates missing series arrays', async () => {
    const get = vi.fn(async () => ({
      summary: { members: 0, total_views: 0, posts_count: 0, avg_reach: 0, notifications_on: 0 },
    }))
    const rest = { get } as unknown as Pick<RestClient, 'get'>
    const mgr = newStatsManager({ rest })

    const s = await mgr.getChannelStats(1)
    expect(s.membersGrowth).toEqual([])
    expect(s.viewsByDay).toEqual([])
    expect(s.postsByDay).toEqual([])
    expect(s.topPosts).toEqual([])
  })
})
