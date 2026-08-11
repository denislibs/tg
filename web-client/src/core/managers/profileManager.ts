import { HttpError, type RestClient } from '../net/restClient'
import { mapUser, type Birthday, type PhoneVisibility, type RawUser, type User } from './authManager'

// A partial profile edit. `undefined` leaves a field unchanged; for birthday,
// `null` explicitly clears it.
export interface ProfileUpdate {
  firstName?: string
  lastName?: string
  bio?: string
  birthday?: Birthday | null
  phoneVisibility?: PhoneVisibility
}

export interface ProfileDeps {
  rest: RestClient
  /** Stage 1C.2 (Task 1): `me` — воркер единственный владелец; зовём на каждую
   * успешную мутацию профиля, воркер публикует свежего пользователя всем
   * вкладкам (rt:me). Опционально: юнит-тесты менеджера конструируют его без
   * воркера (см. profileManager.test.ts). */
  onMeChanged?: (u: User) => void
  /** Текущий кэш `me` воркера. Нужен addPhoto: сервер возвращает только фото
   * (id/url), не всего пользователя, — broadcast обязан нести полный снимок,
   * поэтому merge делаем здесь тем же способом, что раньше делала витрина
   * (`{ ...me, avatarUrl: photo.url }`, см. EditProfile.tsx). */
  getMe?: () => User | null
}

// SetUsernameResult is a discriminated outcome so the 409/400 cases survive the
// SharedWorker RPC boundary (where HttpError identity would be lost).
export type SetUsernameResult =
  | { user: User }
  | { taken: true }
  | { invalid: true }

export function newProfileManager({ rest, onMeChanged, getMe }: ProfileDeps) {
  return {
    async update(u: ProfileUpdate): Promise<User> {
      const body: Record<string, unknown> = {}
      if (u.firstName !== undefined) body.first_name = u.firstName
      if (u.lastName !== undefined) body.last_name = u.lastName
      if (u.bio !== undefined) body.bio = u.bio
      if (u.phoneVisibility !== undefined) body.phone_visibility = u.phoneVisibility
      if (u.birthday !== undefined) body.birthday = u.birthday // object or null
      const mapped = mapUser(await rest.patch<RawUser>('/me', body))
      onMeChanged?.(mapped) // rt:me всем вкладкам (Stage 1C.2, Task 1)
      return mapped
    },

    async checkUsername(username: string): Promise<{ available: boolean; reason?: string }> {
      return rest.get<{ available: boolean; reason?: string }>('/username/available', { u: username })
    },

    async setUsername(username: string): Promise<SetUsernameResult> {
      try {
        const u = await rest.put<RawUser>('/me/username', { username })
        const mapped = mapUser(u)
        onMeChanged?.(mapped) // rt:me всем вкладкам (Stage 1C.2, Task 1)
        return { user: mapped }
      } catch (e) {
        if (e instanceof HttpError && e.status === 409) return { taken: true }
        if (e instanceof HttpError && e.status === 400) return { invalid: true }
        throw e
      }
    },

    async setAvatar(mediaId: number): Promise<User> {
      // Не зовём onMeChanged: метод не вызывается ниоткуда в витрине (мёртвый
      // путь — аватар всегда идёт через addPhoto, см. EditProfile.tsx). Оставлен
      // как есть (вне периметра задачи), но и владением не притворяется.
      return mapUser(await rest.put<RawUser>('/me/avatar', { media_id: mediaId }))
    },

    // setEmojiStatus sets (or clears with '') the current user's emoji status.
    async setEmojiStatus(emoji: string): Promise<User> {
      const mapped = mapUser(await rest.put<RawUser>('/me/emoji_status', { emoji }))
      onMeChanged?.(mapped) // rt:me всем вкладкам (Stage 1C.2, Task 1)
      return mapped
    },

    // activatePremium flips the Telegram Premium flag on (fake purchase — clone).
    // Не зовём onMeChanged, тем же обоснованием, что setAvatar выше: метод
    // мёртвый (не вызывается из витрины нигде — реальная покупка идёт через
    // premiumManager.checkout, см. PremiumCheckout.tsx). Не удалил в рамках
    // этой задачи (вне периметра «дублей me»), но и владением не притворяется.
    async activatePremium(): Promise<User> {
      return mapUser(await rest.post<RawUser>('/me/premium', {}))
    },

    // addPhoto adds a photo to the current user's gallery and promotes it to the
    // current avatar (Telegram: every new avatar is also a gallery photo).
    async addPhoto(mediaId: number, videoMediaId?: number): Promise<ProfilePhoto> {
      const body: Record<string, unknown> = { media_id: mediaId }
      if (videoMediaId) body.video_media_id = videoMediaId
      const photo = mapProfilePhoto(await rest.post<RawProfilePhoto>('/me/photos', body))
      // Сервер возвращает только фото (id/url), не всего пользователя — merge
      // поверх кэша воркера тем же способом, что раньше делала витрина
      // (`{ ...me, avatarUrl: photo.url }`, EditProfile.tsx). Без getMe() (или
      // до первого auth.me() на старте) кэш ещё пуст — молча пропускаем,
      // ближайший rt:me с сервера/следующего действия догонит.
      const cur = getMe?.()
      if (cur) onMeChanged?.({ ...cur, avatarUrl: photo.url }) // rt:me всем вкладкам (Stage 1C.2, Task 1)
      return photo
    },

    // listPhotos returns a user's profile-photo gallery, newest first.
    async listPhotos(userId: number): Promise<ProfilePhoto[]> {
      const res = await rest.get<{ photos: RawProfilePhoto[] }>(`/users/${userId}/photos`)
      return (res.photos ?? []).map(mapProfilePhoto)
    },

    async deletePhoto(photoId: number): Promise<void> {
      await rest.del(`/me/photos/${photoId}`)
    },
  }
}

// A single profile-photo gallery entry (Telegram getUserPhotos).
export interface ProfilePhoto {
  id: number
  url: string
  videoUrl?: string
  createdAt: string
}

interface RawProfilePhoto {
  id: number
  url: string
  video_url: string | null
  created_at: string
}

function mapProfilePhoto(p: RawProfilePhoto): ProfilePhoto {
  return { id: p.id, url: p.url, videoUrl: p.video_url ?? undefined, createdAt: p.created_at }
}

export type ProfileManager = ReturnType<typeof newProfileManager>
