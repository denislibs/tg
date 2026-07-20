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
}

// SetUsernameResult is a discriminated outcome so the 409/400 cases survive the
// SharedWorker RPC boundary (where HttpError identity would be lost).
export type SetUsernameResult =
  | { user: User }
  | { taken: true }
  | { invalid: true }

export function newProfileManager({ rest }: ProfileDeps) {
  return {
    async update(u: ProfileUpdate): Promise<User> {
      const body: Record<string, unknown> = {}
      if (u.firstName !== undefined) body.first_name = u.firstName
      if (u.lastName !== undefined) body.last_name = u.lastName
      if (u.bio !== undefined) body.bio = u.bio
      if (u.phoneVisibility !== undefined) body.phone_visibility = u.phoneVisibility
      if (u.birthday !== undefined) body.birthday = u.birthday // object or null
      return mapUser(await rest.patch<RawUser>('/me', body))
    },

    async checkUsername(username: string): Promise<{ available: boolean; reason?: string }> {
      return rest.get<{ available: boolean; reason?: string }>('/username/available', { u: username })
    },

    async setUsername(username: string): Promise<SetUsernameResult> {
      try {
        const u = await rest.put<RawUser>('/me/username', { username })
        return { user: mapUser(u) }
      } catch (e) {
        if (e instanceof HttpError && e.status === 409) return { taken: true }
        if (e instanceof HttpError && e.status === 400) return { invalid: true }
        throw e
      }
    },

    async setAvatar(mediaId: number): Promise<User> {
      return mapUser(await rest.put<RawUser>('/me/avatar', { media_id: mediaId }))
    },

    // addPhoto adds a photo to the current user's gallery and promotes it to the
    // current avatar (Telegram: every new avatar is also a gallery photo).
    async addPhoto(mediaId: number, videoMediaId?: number): Promise<ProfilePhoto> {
      const body: Record<string, unknown> = { media_id: mediaId }
      if (videoMediaId) body.video_media_id = videoMediaId
      return mapProfilePhoto(await rest.post<RawProfilePhoto>('/me/photos', body))
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
