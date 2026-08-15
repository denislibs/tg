import { describe, expect, it, vi } from 'vitest'
import { newReactionsManager } from './reactionsManager'

describe('reactionsManager', () => {
  it('маппит snake_case бэка в camelCase фронта', async () => {
    const rest = {
      get: vi.fn().mockResolvedValue({
        reactions: [{ emoji: '❤', title: 'Red Heart', position: 1, premium: false,
                      inactive: false, center_media_id: 7, around_media_id: 8 }],
      }),
    }
    const m = newReactionsManager({ rest: rest as never })
    const list = await m.list()
    expect(list[0]).toMatchObject({ emoji: '❤', centerMediaId: 7, aroundMediaId: 8 })
  })

  it('пустой ответ отдаёт пустым массивом, а не падает', async () => {
    const rest = { get: vi.fn().mockResolvedValue({}) }
    const m = newReactionsManager({ rest: rest as never })
    expect(await m.list()).toEqual([])
  })
})
