import { HttpError, type RestClient } from '../net/restClient'

export interface Birthday { day: number; month: number; year?: number }

export type PhoneVisibility = 'nobody' | 'contacts' | 'everybody'

export interface User {
  id: number
  phone: string
  username: string | null
  firstName: string
  lastName: string
  displayName: string
  bio: string
  birthday: Birthday | null
  avatarUrl: string
  phoneVisibility: PhoneVisibility
}

// The backend wire shape (snake_case). username/birthday are null when unset.
export interface RawUser {
  id: number
  phone: string
  username: string | null
  first_name?: string
  last_name?: string
  display_name: string
  bio?: string
  birthday?: Birthday | null
  avatar_url?: string
  phone_visibility?: string
}

// mapUser normalizes the backend wire shape into the camelCase client model.
export function mapUser(r: RawUser): User {
  return {
    id: r.id,
    phone: r.phone,
    username: r.username ?? null,
    firstName: r.first_name ?? '',
    lastName: r.last_name ?? '',
    displayName: r.display_name ?? '',
    bio: r.bio ?? '',
    birthday: r.birthday ?? null,
    avatarUrl: r.avatar_url ?? '',
    phoneVisibility: (r.phone_visibility as PhoneVisibility) || 'contacts',
  }
}

interface TokenStoreLike {
  get(): string | null
  set(token: string): Promise<void>
  clear(): Promise<void>
  ready(): Promise<void>
}

export interface AuthDeps {
  rest: RestClient
  store: TokenStoreLike
}

export function newAuthManager({ rest, store }: AuthDeps) {
  return {
    async requestCode(phone: string): Promise<void> {
      await rest.post('/auth/request_code', { phone })
    },

    async signIn(phone: string, code: string, device: string, platform: string): Promise<{ user: User }> {
      const res = await rest.post<{ token: string; user: RawUser }>('/auth/sign_in', { phone, code, device, platform })
      await store.set(res.token)
      return { user: mapUser(res.user) }
    },

    async qrNew(platform: string): Promise<{ token: string; url: string; expiresAt: string }> {
      const r = await rest.post<{ token: string; url: string; expires_at: string }>('/auth/qr/new', { platform })
      return { token: r.token, url: r.url, expiresAt: r.expires_at }
    },

    async qrStatus(token: string): Promise<{ status: 'pending' | 'confirmed' | 'expired'; user?: User }> {
      const r = await rest.get<{ status: 'pending' | 'confirmed' | 'expired'; session_token?: string; user?: RawUser }>(`/auth/qr/${token}`)
      if (r.status === 'confirmed' && r.session_token) {
        await store.set(r.session_token)
      }
      return { status: r.status, user: r.user ? mapUser(r.user) : undefined }
    },

    async qrConfirm(token: string): Promise<void> {
      await rest.post('/auth/qr/confirm', { token })
    },

    async me(): Promise<User | null> {
      await store.ready()
      if (!store.get()) return null
      try {
        return mapUser(await rest.get<RawUser>('/me'))
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          await store.clear()
          return null
        }
        throw e
      }
    },

    async logout(): Promise<void> {
      if (store.get()) {
        try { await rest.post('/auth/logout', {}) } catch { /* ignore */ }
      }
      await store.clear()
    },
  }
}
