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

  // Stage 1C.2 (Task 1): `me` — воркер единственный владелец, update() обязан
  // публиковать свежего пользователя (rt:me всем вкладкам) тем же вызовом, что
  // возвращает его звонящей вкладке — иначе профиль на других вкладках/окнах
  // застрял бы на старом значении до следующего рефетча.
  it('зовёт onMeChanged со свежим пользователем', async () => {
    const patch = vi.fn(async () => RAW)
    const onMeChanged = vi.fn()
    const mgr = newProfileManager({ rest: { patch } as unknown as RestClient, onMeChanged })

    const u = await mgr.update({ firstName: 'Denis' })
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(u)
  })

  it('onMeChanged опционален — без него update() не падает', async () => {
    const patch = vi.fn(async () => RAW)
    const mgr = newProfileManager({ rest: { patch } as unknown as RestClient })
    await expect(mgr.update({ firstName: 'Denis' })).resolves.toMatchObject({ id: 1 })
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

  // Stage 1C.2 (Task 1): смена username меняет `me` — тот же контракт, что update().
  it('успех зовёт onMeChanged; 409/400 — нет (пользователь не изменился)', async () => {
    const onMeChanged = vi.fn()
    const okMgr = newProfileManager({ rest: { put: vi.fn(async () => RAW) } as unknown as RestClient, onMeChanged })
    await okMgr.setUsername('denis_m')
    expect(onMeChanged).toHaveBeenCalledTimes(1)

    onMeChanged.mockClear()
    const takenMgr = newProfileManager({
      rest: { put: vi.fn(async () => { throw new HttpError(409, 'x') }) } as unknown as RestClient,
      onMeChanged,
    })
    await takenMgr.setUsername('taken')
    expect(onMeChanged).not.toHaveBeenCalled()
  })
})

describe('ProfileManager.setEmojiStatus', () => {
  // Stage 1C.2 (Task 1): эмоджи-статус тоже часть `me` — тот же контракт, что update().
  it('зовёт onMeChanged со свежим пользователем', async () => {
    const put = vi.fn(async () => RAW)
    const onMeChanged = vi.fn()
    const mgr = newProfileManager({ rest: { put } as unknown as RestClient, onMeChanged })

    const u = await mgr.setEmojiStatus('🔥')
    expect(onMeChanged).toHaveBeenCalledWith(u)
  })
})

describe('ProfileManager.addPhoto', () => {
  const RAW_PHOTO = { id: 9, url: '/media/9/content', video_url: null, created_at: '2026-08-09T00:00:00Z' }

  // Stage 1C.2 (Task 1): сервер отдаёт только фото, не всего пользователя —
  // addPhoto обязан смерджить его с кэшем воркера (getMe) и опубликовать
  // ПОЛНЫЙ снимок, тем же способом, что раньше делала витрина
  // (`{ ...me, avatarUrl: photo.url }`, EditProfile.tsx).
  it('мерджит photo.url поверх getMe() и зовёт onMeChanged полным пользователем', async () => {
    const post = vi.fn(async () => RAW_PHOTO)
    const onMeChanged = vi.fn()
    const cached = { ...mapRaw(), avatarUrl: '/old.jpg' }
    const mgr = newProfileManager({
      rest: { post } as unknown as RestClient,
      onMeChanged,
      getMe: () => cached,
    })

    const photo = await mgr.addPhoto(9)
    expect(photo.url).toBe('/media/9/content')
    expect(onMeChanged).toHaveBeenCalledWith({ ...cached, avatarUrl: '/media/9/content' })
  })

  // getMe() may be absent (unit tests) or return null (worker hasn't resolved
  // `me` yet, e.g. before the first boot auth.me()) — addPhoto must not throw
  // either way, just skip publishing (the next rt:me catches up).
  it('без getMe() или с пустым кэшем — не падает и не зовёт onMeChanged', async () => {
    const post = vi.fn(async () => RAW_PHOTO)
    const onMeChanged = vi.fn()
    const mgr = newProfileManager({ rest: { post } as unknown as RestClient, onMeChanged, getMe: () => null })
    await expect(mgr.addPhoto(9)).resolves.toMatchObject({ id: 9 })
    expect(onMeChanged).not.toHaveBeenCalled()
  })

  function mapRaw() {
    return {
      id: RAW.id, phone: RAW.phone, username: RAW.username, firstName: RAW.first_name, lastName: RAW.last_name,
      displayName: RAW.display_name, bio: RAW.bio, birthday: RAW.birthday, avatarUrl: RAW.avatar_url,
      phoneVisibility: RAW.phone_visibility as 'nobody', premium: false, emojiStatus: '',
    }
  }
})
