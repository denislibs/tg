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

// Итог первого шага входа: либо сессия, либо запрос облачного пароля.
export type SignInOutcome =
  | { user: User; passwordNeeded?: undefined }
  | { passwordNeeded: true; passwordToken: string; hint: string; user?: undefined }

export interface PasswordState {
  enabled: boolean
  hint: string
  email: string // маскированный (de•••@gmail.com)
}

// Ключ доступа в списке настроек.
export interface PasskeyInfo {
  id: number
  name: string
  createdAt: string
  lastUsedAt: string | null
}

interface RawPasskey {
  id: number
  name: string
  created_at: string
  last_used_at: string | null
}

const mapPasskey = (r: RawPasskey): PasskeyInfo => ({
  id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at,
})

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

    // При включённом облачном пароле сервер вместо сессии выдаёт одноразовый
    // password_token — вход завершается шагом checkPassword (Telegram
    // SESSION_PASSWORD_NEEDED).
    async signIn(phone: string, code: string, device: string, platform: string): Promise<SignInOutcome> {
      const res = await rest.post<{
        token?: string
        user?: RawUser
        password_needed?: boolean
        password_token?: string
        hint?: string
      }>('/auth/sign_in', { phone, code, device, platform })
      if (res.password_needed && res.password_token) {
        return { passwordNeeded: true, passwordToken: res.password_token, hint: res.hint ?? '' }
      }
      await store.set(res.token!)
      return { user: mapUser(res.user!) }
    },

    async checkPassword(passwordToken: string, password: string, device: string, platform: string): Promise<{ user: User }> {
      const res = await rest.post<{ token: string; user: RawUser }>('/auth/check_password', {
        password_token: passwordToken, password, device, platform,
      })
      await store.set(res.token)
      return { user: mapUser(res.user) }
    },

    // Облачный пароль (экран Two-Step Verification).
    async passwordState(): Promise<PasswordState> {
      return rest.get<PasswordState>('/me/password')
    },
    async setPassword(args: { currentPassword?: string; newPassword: string; hint: string; email: string }): Promise<void> {
      await rest.post('/me/password', {
        current_password: args.currentPassword ?? '',
        new_password: args.newPassword,
        hint: args.hint,
        email: args.email,
      })
    },
    async removePassword(currentPassword: string): Promise<void> {
      await rest.del('/me/password', { current_password: currentPassword })
    },
    async verifyPassword(password: string): Promise<void> {
      await rest.post('/me/password/verify', { password })
    },

    // Ключи доступа (WebAuthn). REST-часть живёт здесь (воркер);
    // navigator.credentials вызывается в UI-потоке (core/webauthnBrowser.ts).
    async passkeysList(): Promise<PasskeyInfo[]> {
      const r = await rest.get<{ passkeys: RawPasskey[] }>('/me/passkeys')
      return (r.passkeys ?? []).map(mapPasskey)
    },
    async passkeyRegisterBegin(): Promise<{ session: string; options: unknown }> {
      return rest.post('/me/passkeys/begin', {})
    },
    async passkeyRegisterFinish(session: string, attestation: unknown): Promise<PasskeyInfo> {
      return mapPasskey(await rest.post<RawPasskey>(`/me/passkeys/finish?session=${encodeURIComponent(session)}`, attestation))
    },
    async passkeyDelete(id: number): Promise<void> {
      await rest.del(`/me/passkeys/${id}`)
    },
    async passkeyLoginBegin(): Promise<{ session: string; options: unknown }> {
      return rest.post('/auth/passkey/begin', {})
    },
    async passkeyLoginFinish(session: string, assertion: unknown, device: string, platform: string): Promise<{ user: User }> {
      const res = await rest.post<{ token: string; user: RawUser }>(
        `/auth/passkey/finish?session=${encodeURIComponent(session)}&device=${encodeURIComponent(device)}&platform=${encodeURIComponent(platform)}`,
        assertion,
      )
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
