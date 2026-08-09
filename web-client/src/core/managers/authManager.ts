import { HttpError, type RestClient } from '../net/restClient'
import { listAccounts, upsertAccount, removeAccount, tokenOf, toPublic, type PublicAccount } from '../auth/accounts'
import { loadMe } from '../store/persist'

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
  /** Telegram Premium subscriber → gold star badge next to the name */
  premium: boolean
  /** unicode emoji shown after the name ('' when unset) */
  emojiStatus: string
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
  premium?: boolean
  emoji_status?: string
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
    premium: !!r.premium,
    emojiStatus: r.emoji_status ?? '',
  }
}

// Итог первого шага входа: сессия, запрос облачного пароля либо шаг регистрации
// (номер подтверждён, аккаунта под ним нет — Telegram auth.authorizationSignUpRequired).
export type SignInOutcome =
  | { user: User; passwordNeeded?: undefined; signUpRequired?: undefined }
  | { passwordNeeded: true; passwordToken: string; hint: string; user?: undefined; signUpRequired?: undefined }
  | { signUpRequired: true; signUpToken: string; user?: undefined; passwordNeeded?: undefined }

// Регистрация: сессия либо код ошибки сервера. Дискриминированный результат, а не
// исключение, — HttpError не переживает границу worker-RPC (как ChangePhoneResult).
export type SignUpResult =
  | { user: User }
  | { error: 'first_name_required' | 'name_too_long' | 'signup_token_expired' | 'phone_number_occupied' | 'too_many_requests' | 'failed' }

// «Забыли пароль»: маска привязанной почты. Паузу повторной отправки держит
// сервер (`resend_after` / 429 `resend_too_soon`) — клиент своего таймера не
// заводит и потому это число не читает.
export type RecoveryRequestResult =
  | { emailPattern: string }
  | { error: 'password_token_expired' | 'password_recovery_na' | 'resend_too_soon' | 'unavailable' | 'failed' }

// Подтверждение кода с почты: сессия либо причина отказа. `recovery_expired` —
// код протух ЛИБО исчерпаны 5 попыток (сервер не различает их намеренно).
export type RecoveryConfirmResult =
  | { user: User }
  | { error: 'invalid_code' | 'recovery_expired' | 'unavailable' | 'failed' }

// Импорт сессии по одноразовому веб-токену (#?tgWebAuthToken=…).
export type SignImportResult =
  | SignInOutcome
  | { error: 'web_auth_token_invalid' | 'unavailable' | 'failed'; user?: undefined; passwordNeeded?: undefined; signUpRequired?: undefined }

// Сброс аккаунта с экрана входа (tweb `appAccountManager.deleteAccount('Forgot password')`
// в ветке PASSWORD_RECOVERY_NA). `recovery_available` — почта всё-таки привязана,
// сбрасывать нельзя: надо идти восстановлением.
export type AccountResetResult =
  | { ok: true }
  | { error: 'password_token_expired' | 'recovery_available' | 'failed' }

export interface PasswordState {
  enabled: boolean
  hint: string
  email: string // маскированный (d****@e******.com)
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

// Проводной ответ шагов входа (бэк: `writeSignInResult`) — одна из трёх веток.
interface SignInWire {
  token?: string
  user?: RawUser
  password_needed?: boolean
  password_token?: string
  hint?: string
  signup_required?: boolean
  signup_token?: string
}

// Discriminated outcomes so the 400/409 cases survive the SharedWorker RPC
// boundary (where HttpError identity would be lost), mirroring SetUsernameResult.
export type ChangePhoneResult =
  | { ok: true }
  | { taken: true }
  | { invalid: true }

export type ConfirmChangePhoneResult =
  | { user: User }
  | { invalidCode: true }
  | { taken: true }
  | { invalid: true }

export function newAuthManager({ rest, store }: AuthDeps) {
  // Активный вход завершён: сохранить токен + занести аккаунт в реестр (мультиаккаунт).
  const persist = async (token: string, u: User) => {
    await store.set(token)
    await upsertAccount({
      token,
      id: u.id,
      name: u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.phone,
      avatarUrl: u.avatarUrl,
      phone: u.phone,
    })
  }
  // Разбор общего ответа шагов входа (`writeSignInResult` на бэке): сессия |
  // облачный пароль | регистрация. Общий для sign_in, sign_up, recover/confirm и
  // sign_import — держим в одном месте, чтобы ветки не разъезжались.
  const toOutcome = async (res: SignInWire): Promise<SignInOutcome> => {
    if (res.password_needed && res.password_token) {
      return { passwordNeeded: true, passwordToken: res.password_token, hint: res.hint ?? '' }
    }
    if (res.signup_required && res.signup_token) {
      return { signUpRequired: true, signUpToken: res.signup_token }
    }
    const u = mapUser(res.user!)
    await persist(res.token!, u)
    return { user: u }
  }
  return {
    // Страна по умолчанию для поля номера. Аналог tweb `help.getNearestDc`
    // (там из ответа берётся `country`). Пустая строка — не определилось; это
    // штатный ответ, а не ошибка, и экран входа просто остаётся на своём фолбэке.
    async nearestCountry(): Promise<string> {
      try {
        const r = await rest.get<{ country_code?: string }>('/auth/nearest_country')
        return r.country_code ?? ''
      } catch {
        return ''
      }
    },

    async requestCode(phone: string): Promise<void> {
      await rest.post('/auth/request_code', { phone })
    },

    // При включённом облачном пароле сервер вместо сессии выдаёт одноразовый
    // password_token — вход завершается шагом checkPassword (Telegram
    // SESSION_PASSWORD_NEEDED). Если номер подтверждён, но аккаунта нет —
    // signup_token и шаг signUp (Telegram auth.authorizationSignUpRequired).
    async signIn(phone: string, code: string, device: string, platform: string): Promise<SignInOutcome> {
      return toOutcome(await rest.post<SignInWire>('/auth/sign_in', { phone, code, device, platform }))
    },

    // Регистрация нового номера. Аватар сюда НЕ передаётся: как и в tweb
    // (`SignUpCard.sendAvatar` в ветке `auth.authorization`), он грузится уже под
    // выданной сессией обычными ручками профиля.
    async signUp(signUpToken: string, firstName: string, lastName: string, device: string, platform: string): Promise<SignUpResult> {
      try {
        const res = await rest.post<SignInWire>('/auth/sign_up', {
          signup_token: signUpToken, first_name: firstName, last_name: lastName, device, platform,
        })
        const u = mapUser(res.user!)
        await persist(res.token!, u)
        return { user: u }
      } catch (e) {
        if (!(e instanceof HttpError)) throw e
        if (e.message === 'first_name_required') return { error: 'first_name_required' }
        if (e.message === 'name_too_long') return { error: 'name_too_long' }
        if (e.status === 401) return { error: 'signup_token_expired' }
        if (e.status === 409) return { error: 'phone_number_occupied' }
        if (e.status === 429) return { error: 'too_many_requests' }
        return { error: 'failed' }
      }
    },

    // «Забыли пароль?»: код улетает на привязанную почту, обратно — её маска
    // (d****@e******.com). Как в tweb, ссылка дёргает эту ручку на КАЖДЫЙ клик:
    // паузу повторной отправки держит сервер, а не клиентский таймер.
    async requestPasswordRecovery(passwordToken: string): Promise<RecoveryRequestResult> {
      try {
        const res = await rest.post<{ email_pattern: string }>(
          '/auth/password/recover', { password_token: passwordToken },
        )
        return { emailPattern: res.email_pattern }
      } catch (e) {
        if (!(e instanceof HttpError)) throw e
        if (e.message === 'resend_too_soon' || e.status === 429) return { error: 'resend_too_soon' }
        if (e.status === 401) return { error: 'password_token_expired' }
        if (e.status === 404) return { error: 'password_recovery_na' }
        if (e.status === 503) return { error: 'unavailable' }
        return { error: 'failed' }
      }
    },

    // Сброс аккаунта, когда почта восстановления не привязана и пароль забыт
    // (tweb: две подтверждающие плашки → `deleteAccount('Forgot password')`).
    // Сессии тут нет — операцию авторизует тот же одноразовый password_token.
    async resetAccount(passwordToken: string): Promise<AccountResetResult> {
      try {
        await rest.post('/auth/account/reset', { password_token: passwordToken })
        return { ok: true }
      } catch (e) {
        if (!(e instanceof HttpError)) throw e
        if (e.status === 401) return { error: 'password_token_expired' }
        if (e.status === 409) return { error: 'recovery_available' }
        return { error: 'failed' }
      }
    },

    // Код с почты снимает облачный пароль и сразу выдаёт сессию.
    async confirmPasswordRecovery(passwordToken: string, code: string, device: string, platform: string): Promise<RecoveryConfirmResult> {
      try {
        const res = await rest.post<SignInWire>('/auth/password/recover/confirm', {
          password_token: passwordToken, code, device, platform,
        })
        const u = mapUser(res.user!)
        await persist(res.token!, u)
        return { user: u }
      } catch (e) {
        if (!(e instanceof HttpError)) throw e
        if (e.message === 'recovery_expired') return { error: 'recovery_expired' }
        if (e.status === 401) return { error: 'invalid_code' }
        if (e.status === 503) return { error: 'unavailable' }
        return { error: 'failed' }
      }
    },

    // Обмен одноразового веб-токена из ссылки #?tgWebAuthToken=… на сессию.
    // Может вернуть ветку облачного пароля — как `auth.importWebTokenAuthorization`
    // с SESSION_PASSWORD_NEEDED в tweb.
    async signImport(webAuthToken: string, device: string, platform: string): Promise<SignImportResult> {
      try {
        return await toOutcome(await rest.post<SignInWire>('/auth/sign_import', {
          web_auth_token: webAuthToken, device, platform,
        }))
      } catch (e) {
        if (!(e instanceof HttpError)) throw e
        if (e.status === 401) return { error: 'web_auth_token_invalid' }
        if (e.status === 503) return { error: 'unavailable' }
        return { error: 'failed' }
      }
    },

    async checkPassword(passwordToken: string, password: string, device: string, platform: string): Promise<{ user: User }> {
      const res = await rest.post<{ token: string; user: RawUser }>('/auth/check_password', {
        password_token: passwordToken, password, device, platform,
      })
      const u = mapUser(res.user)
      await persist(res.token, u)
      return { user: u }
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
      const u = mapUser(res.user)
      await persist(res.token, u)
      return { user: u }
    },

    async qrNew(platform: string): Promise<{ token: string; url: string; expiresAt: string }> {
      const r = await rest.post<{ token: string; url: string; expires_at: string }>('/auth/qr/new', { platform })
      return { token: r.token, url: r.url, expiresAt: r.expires_at }
    },

    async qrStatus(token: string): Promise<{ status: 'pending' | 'confirmed' | 'expired'; user?: User }> {
      const r = await rest.get<{ status: 'pending' | 'confirmed' | 'expired'; session_token?: string; user?: RawUser }>(`/auth/qr/${token}`)
      if (r.status === 'confirmed' && r.session_token && r.user) {
        await persist(r.session_token, mapUser(r.user))
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
        // Сеть недоступна (fetch reject, не HttpError) — отдаём последний известный
        // профиль из офлайн-стора, чтобы UI не терял себя (аватар/имя) без сети.
        if (!(e instanceof HttpError)) {
          const cached = await loadMe()
          if (cached) return cached
        }
        throw e
      }
    },

    // Смена номера, шаг 1: отправить код на новый номер (после проверки, что он
    // не занят). Ошибки маппятся в дискриминированный результат (RPC-граница).
    async changePhone(newPhone: string): Promise<ChangePhoneResult> {
      try {
        await rest.post('/me/change-phone', { new_phone: newPhone })
        return { ok: true }
      } catch (e) {
        if (e instanceof HttpError && e.status === 409) return { taken: true }
        if (e instanceof HttpError && e.status === 400) return { invalid: true }
        throw e
      }
    },

    // Смена номера, шаг 2: подтвердить кодом. При успехе номер обновлён — обновляем
    // и активный аккаунт в реестре (телефон показывается в меню мультиаккаунта).
    async confirmChangePhone(newPhone: string, code: string): Promise<ConfirmChangePhoneResult> {
      try {
        const u = mapUser(await rest.post<RawUser>('/me/change-phone/confirm', { new_phone: newPhone, code }))
        const token = store.get()
        if (token) {
          await upsertAccount({
            token,
            id: u.id,
            name: u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.phone,
            avatarUrl: u.avatarUrl,
            phone: u.phone,
          })
        }
        return { user: u }
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) return { invalidCode: true }
        if (e instanceof HttpError && e.status === 409) return { taken: true }
        if (e instanceof HttpError && e.status === 400) return { invalid: true }
        throw e
      }
    },

    // Удаление аккаунта: сервер анонимизирует профиль и отзывает все сессии.
    // Локально ведём себя как logout — убираем аккаунт из реестра; если остались
    // другие, переключаемся на первый (UI затем перезагружает страницу).
    async deleteAccount(): Promise<{ switched: boolean }> {
      if (store.get()) {
        try { await rest.del('/me') } catch { /* сервер мог уже отозвать сессию */ }
      }
      const active = store.get()
      const all = await listAccounts()
      const activeAcc = all.find((a) => a.token === active)
      const remaining = activeAcc ? await removeAccount(activeAcc.id) : all
      if (remaining.length > 0) {
        await store.set(remaining[0].token)
        return { switched: true }
      }
      await store.clear()
      return { switched: false }
    },

    async logout(): Promise<{ switched: boolean }> {
      if (store.get()) {
        try { await rest.post('/auth/logout', {}) } catch { /* ignore */ }
      }
      // убрать активный аккаунт из реестра (по совпадению токена); если остались
      // другие — переключиться на первый, иначе разлогиниться полностью.
      const active = store.get()
      const all = await listAccounts()
      const activeAcc = all.find((a) => a.token === active)
      const remaining = activeAcc ? await removeAccount(activeAcc.id) : all
      if (remaining.length > 0) {
        await store.set(remaining[0].token)
        return { switched: true }
      }
      await store.clear()
      return { switched: false }
    },

    // ── Мультиаккаунт ──
    async listAccounts(): Promise<PublicAccount[]> {
      return (await listAccounts()).map(toPublic)
    },
    // Сделать аккаунт активным (page затем перезагружает страницу).
    async switchAccount(id: number): Promise<boolean> {
      const tok = await tokenOf(id)
      if (!tok) return false
      await store.set(tok)
      return true
    },
    // «Добавить аккаунт»: текущий остаётся в реестре, активный токен снимается —
    // после reload покажется экран входа; новый вход добавит ещё один аккаунт.
    async addAccount(): Promise<void> {
      await store.clear()
    },
  }
}
