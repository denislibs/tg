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
  }
}

export type ProfileManager = ReturnType<typeof newProfileManager>
