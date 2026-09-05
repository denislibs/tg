import { describe, it, expect, vi } from 'vitest'
import { newProfileManager } from './profileManager'
import { HttpError, type RestClient } from '../net/restClient'
import { mapPeerProfile, type PeerProfile } from './authManager'
import { getPeerPhotoId } from '../peers/peer'
import { getUserTitle } from '../peers/getPeerTitle'

// Проводная форма профиля после шага C: пара конструкторов `users.userFull`
// плюс наше поле `can_message` рядом. Трёх витрин пользователя больше нет.
// Ответ профиля — конструктор `users.userFull` В КОРНЕ; `can_message` лежит
// внутри него (наш клиентский параметр конструктора, не обёртка снаружи).
const RAW = {
  _: 'users.userFull' as const,
  full_user: { _: 'userFull' as const, id: 1, about: 'hi', birthday: { _: 'birthday' as const, day: 15, month: 3, year: 2000 } },
  chats: [],
  users: [{
    _: 'user' as const, pFlags: { self: true as const }, id: 1, phone: '+79990000001',
    username: 'denis_m', first_name: 'Denis', last_name: 'M',
    photo: { _: 'userProfilePhoto' as const, photo_id: 42 },
  }],
  can_message: true,
}

describe('ProfileManager.update', () => {
  it('PATCHes /me with only the provided fields and maps the result', async () => {
    const patch = vi.fn(async () => RAW)
    const rest = { patch } as unknown as RestClient
    const mgr = newProfileManager({ rest })

    const u = await mgr.update({ firstName: 'Denis', bio: 'hi', birthday: null })
    expect(patch).toHaveBeenCalledWith('/me', { first_name: 'Denis', bio: 'hi', birthday: null })
    // Имя больше не поле, а сборка из first_name/last_name на клиенте;
    // аватарка — один `photo_id` вместо пяти полей; видимость номера —
    // правило приватности, а не поле профиля.
    expect(getUserTitle(u.user)).toBe('Denis M')
    expect(getPeerPhotoId(u.user.photo)).toBe(42)
    expect(u.fullUser.birthday).toEqual({ _: 'birthday', day: 15, month: 3, year: 2000 })
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
    await expect(mgr.update({ firstName: 'Denis' })).resolves.toMatchObject({ user: { id: 1 } })
  })
})

describe('ProfileManager.setUsername', () => {
  it('returns the mapped user on success', async () => {
    const put = vi.fn(async () => RAW)
    const mgr = newProfileManager({ rest: { put } as unknown as RestClient })
    const res = await mgr.setUsername('denis_m')
    expect('user' in res && res.user.user.username).toBe('denis_m')
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
  // photos.photo: адрес ОДИН — id самого файла; ключа строки таблицы нет.
  const RAW_PHOTO = { _: 'photos.photo', photo: { _: 'photo', id: 9, sizes: [] } }

  // Stage 1C.2 (Task 1): сервер отдаёт только фото, не всего пользователя —
  // addPhoto обязан смерджить его с кэшем воркера (getMe) и опубликовать
  // ПОЛНЫЙ снимок, тем же способом, что раньше делала витрина
  // (`{ ...me, avatarUrl: photo.url }`, EditProfile.tsx).
  it('мерджит photo поверх getMe() и зовёт onMeChanged полным профилем', async () => {
    const post = vi.fn(async () => RAW_PHOTO)
    const onMeChanged = vi.fn()
    const cached = mapRaw()
    const mgr = newProfileManager({
      rest: { post } as unknown as RestClient,
      onMeChanged,
      getMe: () => cached,
    })

    const photo = await mgr.addPhoto(9)
    expect(photo.mediaId).toBe(9)
    // В кэш кладётся КОНСТРУКТОР, а не строка `/media/9/content`: прежний url
    // и был тем вторым видом одного числа, из которого его потом выпарсивали.
    expect(onMeChanged).toHaveBeenCalledWith({
      ...cached,
      user: { ...cached.user, photo: { _: 'userProfilePhoto', photo_id: 9 } },
    })
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

  function mapRaw(): PeerProfile {
    return mapPeerProfile(RAW)
  }
})

describe('ProfileManager.deletePhoto', () => {
  // backlog profile-photo-delete-id-mismatch: ручка адресует по id МЕДИА, а не
  // по строковому id галереи — deletePhoto обязан слать в урле ровно то число,
  // что ему передали (то же, что ProfilePhoto.id/mediaId из listPhotos).
  it('шлёт DELETE /me/photos/{mediaId}', async () => {
    const del = vi.fn(async () => undefined)
    const mgr = newProfileManager({ rest: { del } as unknown as RestClient })

    await mgr.deletePhoto(502)
    expect(del).toHaveBeenCalledWith('/me/photos/502')
  })
})
