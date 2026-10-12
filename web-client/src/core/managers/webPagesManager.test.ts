// Порт tweb `appWebPagesManager.getWebPage` (:273-284) — см. шапку менеджера.
import { describe, expect, it, vi } from 'vitest'
import { newWebPagesManager } from './webPagesManager'
import { HttpError } from '../net/restClient'

const card = (o: Record<string, unknown> = {}) => ({
  _: 'messages.webPage', chats: [], users: [],
  webpage: { _: 'webPage', url: 'https://ex.com/a', display_url: 'ex.com/a', title: 'T', ...o },
})

describe('webPagesManager.getWebPage', () => {
  it('зовёт GET /webpage?url= и отдаёт карточку с pFlags (провод — omitempty)', async () => {
    const get = vi.fn().mockResolvedValue(card())
    const mgr = newWebPagesManager({ rest: { get } as never })
    const wp = await mgr.getWebPage('https://ex.com/a')
    expect(get).toHaveBeenCalledWith('/webpage', { url: 'https://ex.com/a' })
    expect(wp?._).toBe('webPage')
    expect(wp?.pFlags).toEqual({})
  })

  it('has_large_media доезжает; имя сайта, равное заголовку, снимается (tweb :117-121)', async () => {
    const get = vi.fn().mockResolvedValue(card({ site_name: 'T', pFlags: { has_large_media: true } }))
    const wp = await newWebPagesManager({ rest: { get } as never }).getWebPage('u')
    expect(wp?.pFlags.has_large_media).toBe(true)
    expect(wp?.site_name).toBeUndefined()
  })

  it('webPageEmpty → undefined (плашки нет, tweb :76-77, input.ts:3600)', async () => {
    const get = vi.fn().mockResolvedValue({ _: 'messages.webPage', chats: [], users: [], webpage: { _: 'webPageEmpty', url: 'u' } })
    expect(await newWebPagesManager({ rest: { get } as never }).getWebPage('u')).toBeUndefined()
  })

  it('429 → null, без reject (расхождение 3)', async () => {
    const get = vi.fn().mockRejectedValue(new HttpError(429, 'too many requests'))
    await expect(newWebPagesManager({ rest: { get } as never }).getWebPage('u')).resolves.toBeNull()
  })

  it('одинаковый URL в полёте — один запрос; после ответа — новый (без id-кэша)', async () => {
    let resolve!: (v: unknown) => void
    const get = vi.fn().mockImplementationOnce(() => new Promise((r) => { resolve = r })).mockResolvedValue(card())
    const mgr = newWebPagesManager({ rest: { get } as never })
    const a = mgr.getWebPage('u')
    const b = mgr.getWebPage('u')
    expect(get).toHaveBeenCalledTimes(1)
    resolve(card())
    expect(await a).toBe(await b)
    await mgr.getWebPage('u')
    expect(get).toHaveBeenCalledTimes(2)
  })
})
