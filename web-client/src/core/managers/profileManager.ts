import { HttpError, type RestClient } from '../net/restClient'
import { mapPeerProfile, type PeerProfile, type RawPeerProfile } from './authManager'
import type { Birthday } from '../peers/peer'

// A partial profile edit. `undefined` leaves a field unchanged; for birthday,
// `null` explicitly clears it.
export interface ProfileUpdate {
  firstName?: string
  lastName?: string
  bio?: string
  birthday?: Birthday | null
  // `phoneVisibility` отсюда убран: видимость номера — ПРАВИЛО ПРИВАТНОСТИ
  // (`privacyManager`, ключ `phone_number`), а не поле профиля. Прежде это были
  // два независимых механизма на один вопрос, и они не синхронизировались;
  // колонка на бэкенде удалена миграцией (решение №5 разбора).
}

export interface ProfileDeps {
  rest: RestClient
  /** Stage 1C.2 (Task 1): `me` — воркер единственный владелец; зовём на каждую
   * успешную мутацию профиля, воркер публикует свежего пользователя всем
   * вкладкам (rt:me). Опционально: юнит-тесты менеджера конструируют его без
   * воркера (см. profileManager.test.ts). */
  onMeChanged?: (u: PeerProfile) => void
  /** Текущий кэш `me` воркера. Нужен addPhoto: сервер возвращает только фото
   * (id/url), не всего пользователя, — broadcast обязан нести полный снимок,
   * поэтому merge делаем здесь тем же способом, что раньше делала витрина
   * (`{ ...me, avatarUrl: photo.url }`, см. EditProfile.tsx). */
  getMe?: () => PeerProfile | null
}

// SetUsernameResult is a discriminated outcome so the 409/400 cases survive the
// SharedWorker RPC boundary (where HttpError identity would be lost).
export type SetUsernameResult =
  | { user: PeerProfile }
  | { taken: true }
  | { invalid: true }

export function newProfileManager({ rest, onMeChanged, getMe }: ProfileDeps) {
  return {
    async update(u: ProfileUpdate): Promise<PeerProfile> {
      const body: Record<string, unknown> = {}
      if (u.firstName !== undefined) body.first_name = u.firstName
      if (u.lastName !== undefined) body.last_name = u.lastName
      if (u.bio !== undefined) body.bio = u.bio
      if (u.birthday !== undefined) body.birthday = u.birthday // object or null
      const mapped = mapPeerProfile(await rest.patch<RawPeerProfile>('/me', body))
      onMeChanged?.(mapped) // rt:me всем вкладкам (Stage 1C.2, Task 1)
      return mapped
    },

    /**
     * Свободно ли имя. Ответ — конструктор `Bool`, как у
     * `account.checkUsername` оригинала.
     *
     * Негодная форма имени приезжает ОТКАЗОМ (400 `USERNAME_INVALID`), а не
     * успешным «занято»: прежняя пара `{available, reason}` была отказом,
     * одетым в успех. Форму имени экран и так проверяет сам, до запроса, — так
     * что отказ здесь означает только гонку с чужим правилом.
     */
    async checkUsername(username: string): Promise<boolean> {
      try {
        const res = await rest.get<{ _: string }>('/username/available', { u: username })
        return res._ === 'boolTrue'
      } catch (e) {
        if (e instanceof HttpError && e.status === 400) return false
        throw e
      }
    },

    async setUsername(username: string): Promise<SetUsernameResult> {
      try {
        const mapped = mapPeerProfile(await rest.put<RawPeerProfile>('/me/username', { username }))
        onMeChanged?.(mapped) // rt:me всем вкладкам (Stage 1C.2, Task 1)
        return { user: mapped }
      } catch (e) {
        if (e instanceof HttpError && e.status === 409) return { taken: true }
        if (e instanceof HttpError && e.status === 400) return { invalid: true }
        throw e
      }
    },

    // setEmojiStatus sets (or clears with '') the current user's emoji status.
    async setEmojiStatus(emoji: string): Promise<PeerProfile> {
      const mapped = mapPeerProfile(await rest.put<RawPeerProfile>('/me/emoji_status', { emoji }))
      onMeChanged?.(mapped) // rt:me всем вкладкам (Stage 1C.2, Task 1)
      return mapped
    },

    // addPhoto adds a photo to the current user's gallery and promotes it to the
    // current avatar (Telegram: every new avatar is also a gallery photo).
    async addPhoto(mediaId: number, videoMediaId?: number): Promise<ProfilePhoto> {
      const body: Record<string, unknown> = { media_id: mediaId }
      if (videoMediaId) body.video_media_id = videoMediaId
      const photo = mapProfilePhoto((await rest.post<PhotosPhoto>('/me/photos', body)).photo)
      // Сервер возвращает только фото (id медиа), не всего пользователя —
      // merge поверх кэша воркера. Пишем в `user.photo` КОНСТРУКТОР, а не URL:
      // прежняя строка `/media/N/content` была тем самым вторым видом одного
      // числа, из которого его потом выпарсивали регуляркой. Без getMe() (или
      // до первого auth.me() на старте) кэш ещё пуст — молча пропускаем,
      // ближайший rt:me догонит.
      const cur = getMe?.()
      if (cur) {
        onMeChanged?.({ ...cur, user: { ...cur.user, photo: { _: 'userProfilePhoto', photo_id: photo.mediaId } } })
      }
      return photo
    },

    // listPhotos returns a user's profile-photo gallery, newest first.
    async listPhotos(userId: number): Promise<ProfilePhoto[]> {
      const res = await rest.get<PhotosPhotos>(`/users/${userId}/photos`)
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
  /** id медиа снимка — тот же номер, что в `user.photo.photo_id`. Прежний
   *  `url` был строкой, собранной из этого же числа. */
  mediaId: number
  videoMediaId?: number
  createdAt: string
}

/**
 * Фотогалерея — конструкторы `photos.photo` / `photos.photos`.
 *
 * Адрес у `photo` ОДИН — id самого файла; наш ключ строки таблицы наружу
 * больше не выходит, как и ключи остальных строк. Ступени превью здесь не
 * приезжают: галерея показывает те же файлы, что уже были в карточке пира.
 */
interface PhotoWire { _: 'photo'; id: number; sizes: unknown[] }
interface PhotosPhoto { _: 'photos.photo'; photo: PhotoWire }
interface PhotosPhotos { _: 'photos.photos'; photos: PhotoWire[] }

function mapProfilePhoto(p: PhotoWire): ProfilePhoto {
  return { id: p.id, mediaId: p.id, videoMediaId: undefined, createdAt: '' }
}

export type ProfileManager = ReturnType<typeof newProfileManager>
