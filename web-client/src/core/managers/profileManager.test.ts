import { describe, it, expect, vi } from 'vitest'
import { newProfileManager } from './profileManager'
import { HttpError, type RestClient } from '../net/restClient'

const RAW = {
  id: 1,
  phone: '+79990000001',
  username: 'denis_m',
  first_name: 'Denis',
  last_name: 'M',
  display_name: 'Denis M',
  bio: 'hi',
  birthday: { day: 15, month: 3, year: 2000 },
  avatar_url: '/media/42/content',
  phone_visibility: 'nobody',
}

describe('ProfileManager.update', () => {
  it('PATCHes /me with only the provided fields and maps the result', async () => {
    const patch = vi.fn(async () => RAW)
    const rest = { patch } as unknown as RestClient
    const mgr = newProfileManager({ rest })

    const u = await mgr.update({ firstName: 'Denis', bio: 'hi', birthday: null })
    expect(patch).toHaveBeenCalledWith('/me', { first_name: 'Denis', bio: 'hi', birthday: null })
    expect(u.displayName).toBe('Denis M')
    expect(u.phoneVisibility).toBe('nobody')
    expect(u.avatarUrl).toBe('/media/42/content')
    expect(u.birthday).toEqual({ day: 15, month: 3, year: 2000 })
  })
})

describe('ProfileManager.setUsername', () => {
  it('returns the mapped user on success', async () => {
    const put = vi.fn(async () => RAW)
    const mgr = newProfileManager({ rest: { put } as unknown as RestClient })
    const res = await mgr.setUsername('denis_m')
    expect('user' in res && res.user.username).toBe('denis_m')
  })

  it('maps a 409 to { taken: true }', async () => {
    const put = vi.fn(async () => {
      throw new HttpError(409, 'username_taken')
    })
    const mgr = newProfileManager({ rest: { put } as unknown as RestClient })
    expect(await mgr.setUsername('taken')).toEqual({ taken: true })
  })

  it('maps a 400 to { invalid: true }', async () => {
    const put = vi.fn(async () => {
      throw new HttpError(400, 'username_format')
    })
    const mgr = newProfileManager({ rest: { put } as unknown as RestClient })
    expect(await mgr.setUsername('ab')).toEqual({ invalid: true })
  })
})

describe('ProfileManager.setAvatar', () => {
  it('PUTs /me/avatar with the media id', async () => {
    const put = vi.fn(async () => RAW)
    const mgr = newProfileManager({ rest: { put } as unknown as RestClient })
    const u = await mgr.setAvatar(42)
    expect(put).toHaveBeenCalledWith('/me/avatar', { media_id: 42 })
    expect(u.avatarUrl).toBe('/media/42/content')
  })
})
