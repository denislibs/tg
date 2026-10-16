// fake-indexeddb — нужна только для switchAccount()/logout() ниже: они
// реально ищут аккаунт через ../auth/accounts (listAccounts/tokenOf/
// removeAccount), а те тихо деградируют до пустого списка без реального IDB
// (см. accounts.ts). Остальные тесты файла (сигнатура AuthDeps не меняется)
// работали и без полифилла — деградация давала им пустой список аккаунтов,
// тот же результат, что и свежая IDBFactory ниже.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { newAuthManager, type AuthDeps } from './authManager'
import { HttpError, RestClient } from '../net/restClient'
import { upsertAccount } from '../auth/accounts'

beforeEach(() => { indexedDB = new IDBFactory() })

// Исходы `auth.exportLoginToken` (QR-вход). `token` — БАЙТЫ, на JSON-проводе
// base64 (0x01 0x02 → 'AQI=' → hex '0102').
const EXPORT_PENDING = { _: 'auth.loginToken', expires: 1787334148, token: 'AQI=' }
const EXPORT_SUCCESS = { _: 'auth.loginTokenSuccess', authorization: { _: 'auth.authorization', token: 'sess999', user: { _: 'user', id: 7, phone: '+7' } } }
const EXPORT_PASSWORD = { _: 'auth.loginTokenSuccess', authorization: { _: 'auth.passwordNeeded', password_token: 'pwtok', hint: 'подсказка' } }

function deps(overrides: Partial<{ token: string | null; exportResponse: unknown }> = {}) {
  let token: string | null = overrides.token ?? null
  const exportResponse = overrides.exportResponse ?? EXPORT_PENDING
  const calls: Array<[string, unknown]> = []
  const callOpts: Array<unknown> = []
  const store = {
    get: () => token,
    set: async (t: string) => { token = t },
    clear: async () => { token = null },
    ready: async () => {},
  }
  const rest = {
    post: async (path: string, body: unknown, opts?: unknown) => {
      calls.push([path, body])
      callOpts.push(opts)
      if (path === '/auth/request_code') return { ok: true }
      // Исход шага входа — КОНСТРУКТОР объединения auth.Authorization, а
      // карточка внутри него КРАТКАЯ: полной формы вход не отдаёт.
      if (path === '/auth/sign_in') return { _: 'auth.authorization', token: 'TOK', user: briefWire(1, '+700') }
      if (path === '/auth/logout') return { ok: true }
      if (path === '/auth/export_login_token') return exportResponse
      if (path === '/auth/accept_login_token') return { _: 'authorization', hash: 5 }
      throw new Error('unexpected ' + path)
    },
    get: async (path: string) => {
      if (path === '/me') {
        if (!token) throw Object.assign(new Error('missing token'), { status: 401 })
        return profileWire(1, '+700')
      }
      throw new Error('unexpected ' + path)
    },
  }
  return { d: { rest, store } as unknown as AuthDeps, calls, callOpts, token: () => token }
}

// Проводная форма профиля после шага C: пара конструкторов `users.userFull`
// плюс наше поле `can_message` РЯДОМ с конструктором (схемного места у него
// нет). Трёх разных витрин пользователя больше нет — `/me`, `/users/{id}` и
// шаги входа отдают один и тот же объект.
// Краткая карточка `user` — то, что едет исходом входа. Полная форма там не
// приезжает вовсе: её приносит первый же `/me`.
function briefWire(id: number, phone: string) {
  return { _: 'user', pFlags: { self: true }, id, phone }
}

function profileWire(id: number, phone: string) {
  return {
    _: 'users.userFull',
    full_user: { _: 'userFull', id },
    chats: [],
    users: [{ _: 'user', pFlags: { self: true }, id, phone }],
    can_message: true,
  }
}

describe('AuthManager', () => {
  it('signIn stores the token and me() then returns the user', async () => {
    const { d, token } = deps()
    const auth = newAuthManager(d)
    await auth.requestCode('+7 700')
    const r = await auth.signIn('+7 700', '12345', 'web', 'browser')
    expect(r.user?.user.id).toBe(1)
    expect(token()).toBe('TOK')
    await expect(auth.me()).resolves.toMatchObject({ user: { id: 1 } })
  })

  it('me() returns null when unauthenticated (401)', async () => {
    const { d } = deps()
    const auth = newAuthManager(d)
    await expect(auth.me()).resolves.toBeNull()
  })

  // Фикс повторного ревью, п.6: раньше me() (прогрев/loadChats) НЕ обновляла
  // кэш воркера вовсе — только явные RPC-мутации/вход. Профиль, изменённый в
  // обход этого воркера (другая сессия того же аккаунта), не долетал бы до
  // кэша: следующая мутация профиля смерджила бы поверх устаревшего снимка и
  // разослала бы его всем вкладкам, затерев уже показанное свежее значение.
  it('me() зовёт onMeChanged со свежим пользователем при успехе', async () => {
    const onMeChanged = vi.fn()
    const { d } = deps({ token: 'TOK' })
    const auth = newAuthManager({ ...d, onMeChanged })
    const u = await auth.me()
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(u)
  })

  it('me() без токена НЕ зовёт onMeChanged (не новая информация с сервера)', async () => {
    const onMeChanged = vi.fn()
    const { d } = deps()
    const auth = newAuthManager({ ...d, onMeChanged })
    await auth.me()
    expect(onMeChanged).not.toHaveBeenCalled()
  })

  it('logout clears the token; me() then null', async () => {
    const { d, token } = deps({ token: 'TOK' })
    const auth = newAuthManager(d)
    await auth.logout()
    expect(token()).toBeNull()
    await expect(auth.me()).resolves.toBeNull()
  })

  // Stage 1C.2 (Task 1): `me` — воркер единственный владелец; logout() обязан
  // публиковать null всем вкладкам (rt:me), а не оставлять только вкладку-
  // инициатора чистить свой стор локально (useAuthGate.ts) — иначе сиблинг-
  // вкладки/окна той же сессии остались бы с профилем разлогиненного юзера.
  it('logout зовёт onMeChanged(null), даже без активной сессии', async () => {
    const onMeChanged = vi.fn()
    const { d } = deps() // без токена — store.get() пуст, /auth/logout не идёт
    const auth = newAuthManager({ ...d, onMeChanged })
    await auth.logout()
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(null)
  })

  it('onMeChanged опционален — logout() без него не падает', async () => {
    const { d } = deps({ token: 'TOK' })
    const auth = newAuthManager(d)
    await expect(auth.logout()).resolves.toEqual({ switched: false })
  })

  // Фикс повторного ревью, п.1/п.2: logout() с остающимся аккаунтом — это
  // смена активного токена, не логаут. Раньше эта ветка звала
  // onMeChanged(null) — ложный сигнал «никто не вошёл» всем вкладкам, хотя
  // сессия B жива. Теперь — fetchMe() под НОВЫМ токеном, тот же результат,
  // что видит и сама эта вкладка после reload.
  it('logout() с остающимся аккаунтом зовёт onMeChanged свежим пользователем НОВОГО токена, не null', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const onMeChanged = vi.fn()
    const { d, token } = deps({ token: 'TOK_A' })
    const auth = newAuthManager({ ...d, onMeChanged })

    const r = await auth.logout()

    expect(r).toEqual({ switched: true })
    expect(token()).toBe('TOK_B') // переключились на оставшийся аккаунт
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).not.toHaveBeenCalledWith(null)
  })

  // Фикс повторного ревью, п.1: switchAccount() менял только токен — кэш
  // воркера оставался с личностью СТАРОГО аккаунта до следующей мутации
  // профиля, которая смерджила бы и разослала бы её всем вкладкам вместо
  // личности того, на кого реально переключились.
  it('switchAccount() перевыводит `me` под новым токеном', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const onMeChanged = vi.fn()
    const { d, token } = deps({ token: 'TOK_A' })
    const auth = newAuthManager({ ...d, onMeChanged })

    const ok = await auth.switchAccount(2)

    expect(ok).toBe(true)
    expect(token()).toBe('TOK_B')
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).not.toHaveBeenCalledWith(null)
  })

  it('switchAccount() с неизвестным id — false, onMeChanged не зовётся', async () => {
    const onMeChanged = vi.fn()
    const { d } = deps({ token: 'TOK_A' })
    const auth = newAuthManager({ ...d, onMeChanged })
    await expect(auth.switchAccount(999)).resolves.toBe(false)
    expect(onMeChanged).not.toHaveBeenCalled()
  })

  // addAccount(): активный токен снимается (готовим экран входа для нового
  // аккаунта) — тем же инвариантом кэш воркера обязан узнать, что активного
  // пользователя больше нет.
  it('addAccount() зовёт onMeChanged(null) — активный токен снят', async () => {
    const onMeChanged = vi.fn()
    const { d } = deps({ token: 'TOK' })
    const auth = newAuthManager({ ...d, onMeChanged })
    await auth.addAccount()
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(null)
  })

  // Фикс ревью п.2 (Stage 1C.2, Task 1): вход заводит сессию через persist() —
  // без onMeChanged там воркер узнавал о новом пользователе ТОЛЬКО на старте
  // (once), а вход после старта (обычный случай — App.tsx не перезагружает
  // страницу после login(), см. useAuthGate.ts) не публиковал `me` вовсе.
  it('signIn зовёт onMeChanged со свежим пользователем (persist — общая точка входа)', async () => {
    const onMeChanged = vi.fn()
    const { d } = deps()
    const auth = newAuthManager({ ...d, onMeChanged })
    const r = await auth.signIn('+7 700', '12345', 'web', 'browser')
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(r.user)
  })

  // Второй путь через persist() (не toOutcome) — exportLoginToken(success): доказывает,
  // что фикс на самой persist(), а не на одном конкретном вызывающем методе.
  it('exportLoginToken(success) тоже зовёт onMeChanged (тот же persist(), другой вызывающий)', async () => {
    const onMeChanged = vi.fn()
    const { d } = deps({ exportResponse: EXPORT_SUCCESS })
    const auth = newAuthManager({ ...d, onMeChanged })
    await auth.exportLoginToken('k'.repeat(64))
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 7 }) }))
  })

  it('onMeChanged опционален — signIn() без него не падает', async () => {
    const { d } = deps()
    const auth = newAuthManager(d)
    await expect(auth.signIn('+7 700', '12345', 'web', 'browser')).resolves.toMatchObject({ user: { user: { id: 1 } } })
  })

  // Вход по ключу доступа (tweb passkeyLoginButton.tsx:38-41, :63-77).
  describe('вход по ключу доступа', () => {
    const FINISH_URL = '/auth/passkey/finish?session=s1&device=web&platform=browser'

    function passkeyDeps(finishResponse: unknown) {
      const { d, token } = deps()
      const onMeChanged = vi.fn()
      const posts: string[] = []
      const rest = {
        ...(d as unknown as { rest: object }).rest,
        post: async (path: string) => {
          posts.push(path)
          if (path === '/auth/passkey/begin') return { _: 'auth.passkeyLoginOptions', session: 's1', options: { _: 'dataJSON', data: '{"publicKey":{}}' } }
          if (path === FINISH_URL) return finishResponse
          throw new Error('unexpected ' + path)
        },
      }
      return { d: { ...d, rest } as unknown as AuthDeps, token, onMeChanged, posts }
    }

    it('begin отдаёт auth.passkeyLoginOptions как есть: session и dataJSON', async () => {
      const { d } = passkeyDeps(null)
      await expect(newAuthManager(d).passkeyLoginBegin()).resolves.toEqual({
        _: 'auth.passkeyLoginOptions', session: 's1', options: { _: 'dataJSON', data: '{"publicKey":{}}' },
      })
    })

    it('finish при облачном пароле: шаг пароля, сессия НЕ сохраняется', async () => {
      const { d, token, onMeChanged } = passkeyDeps({ _: 'auth.passwordNeeded', password_token: 't', hint: 'h' })
      const r = await newAuthManager({ ...d, onMeChanged }).passkeyLoginFinish('s1', {}, 'web', 'browser')
      expect(r).toEqual({ passwordNeeded: true, passwordToken: 't', hint: 'h' })
      expect(token()).toBeNull()
      expect(onMeChanged).not.toHaveBeenCalled()
    })

    it('finish без облачного пароля: сессия сохранена, исход — user', async () => {
      const { d, token } = passkeyDeps({ _: 'auth.authorization', token: 'PK', user: briefWire(1, '+700') })
      const r = await newAuthManager(d).passkeyLoginFinish('s1', {}, 'web', 'browser')
      expect(r).toMatchObject({ user: { user: { id: 1 } } })
      expect(token()).toBe('PK')
    })
  })

  // auth.exportLoginToken: ключ входа едет заголовком, except_ids — аккаунты этого
  // устройства (tweb SignQRCard.tsx:136-142, AccountController.getUserIds).
  it('exportLoginToken шлёт except_ids из реестра аккаунтов и ключ входа заголовком', async () => {
    await upsertAccount({ id: 11, token: 't11', name: 'A', photoId: 0, phone: '+1' })
    await upsertAccount({ id: 12, token: 't12', name: 'B', photoId: 0, phone: '+2' })
    const { d, calls, callOpts } = deps()
    await newAuthManager(d).exportLoginToken('k'.repeat(64))
    expect(calls[0]).toEqual(['/auth/export_login_token', { except_ids: [11, 12], platform: 'web' }])
    expect(callOpts[0]).toEqual({ headers: { 'X-Login-Key': 'k'.repeat(64) } })
  })

  // Адрес кода: base64 конструктора → шестнадцатеричная запись (та же, что в
  // адресе QR `/qr/<hex>` и в acceptLoginToken). Сессии нет — токен не пишется.
  it('exportLoginToken: auth.loginToken -> pending с hex-кодом, токен не сохраняется', async () => {
    const { d, token } = deps()
    await expect(newAuthManager(d).exportLoginToken('k'.repeat(64))).resolves.toEqual({
      status: 'pending', token: '0102', expires: 1787334148,
    })
    expect(token()).toBeNull()
  })

  it('exportLoginToken: loginTokenSuccess{authorization} сохраняет сессию', async () => {
    const { d, token } = deps({ exportResponse: EXPORT_SUCCESS })
    const r = await newAuthManager(d).exportLoginToken('k'.repeat(64))
    expect(r.status).toBe('success')
    expect(r.status === 'success' && r.user.user.id).toBe(7)
    expect(token()).toBe('sess999')
  })

  // Облачный пароль: сессии нет, токен не пишется, ни onMeChanged, ни onLoggedIn.
  it('exportLoginToken: loginTokenSuccess{passwordNeeded} -> шаг пароля без сессии', async () => {
    const onMeChanged = vi.fn()
    const onLoggedIn = vi.fn()
    const { d, token } = deps({ exportResponse: EXPORT_PASSWORD })
    const r = await newAuthManager({ ...d, onMeChanged, onLoggedIn }).exportLoginToken('k'.repeat(64))
    expect(r).toEqual({ status: 'password', passwordToken: 'pwtok', hint: 'подсказка' })
    expect(token()).toBeNull()
    expect(onMeChanged).not.toHaveBeenCalled()
    expect(onLoggedIn).not.toHaveBeenCalled()
  })

  // Класс ошибки решает, умирает ли цикл карточки. У tweb сеть и разрыв
  // переотправляет сам invokeApi, а `AUTH_TOKEN_EXPIRED` цикл переживает
  // (SignQRCard.tsx:179-181); остальные отказы API останавливают его (:182-185).
  it('exportLoginToken: сбой сети и 5xx -> retry, а не отказ', async () => {
    const make = (err: unknown) => newAuthManager({
      rest: { post: () => Promise.reject(err) } as unknown as AuthDeps['rest'],
      store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
    })
    for (const err of [new TypeError('Failed to fetch'), new HttpError(502, 'x'), new HttpError(503, 'x'), new HttpError(408, 'x')]) {
      await expect(make(err).exportLoginToken('k'.repeat(64))).resolves.toEqual({ status: 'retry' })
    }
  })

  it('exportLoginToken: 404 AUTH_TOKEN_EXPIRED -> expired (цикл продолжается)', async () => {
    const auth = newAuthManager({
      rest: { post: () => Promise.reject(new HttpError(404, 'AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_EXPIRED')) } as unknown as AuthDeps['rest'],
      store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
    })
    await expect(auth.exportLoginToken('k'.repeat(64))).resolves.toEqual({ status: 'expired' })
  })

  it('exportLoginToken: постоянные отказы (503 qr login unavailable, 420 дольше минуты) пробрасываются', async () => {
    const make = (err: unknown) => newAuthManager({
      rest: { post: () => Promise.reject(err) } as unknown as AuthDeps['rest'],
      store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
    })
    await expect(make(new HttpError(503, 'qr login unavailable', 'qr login unavailable')).exportLoginToken('k'.repeat(64))).rejects.toMatchObject({ status: 503 })
    await expect(make(new HttpError(420, 'FLOOD_WAIT_90', 'FLOOD_WAIT_90')).exportLoginToken('k'.repeat(64))).rejects.toMatchObject({ status: 420 })
  })

  it('exportLoginToken: прочие отказы API (400 LOGIN_KEY_INVALID) пробрасываются', async () => {
    const auth = newAuthManager({
      rest: { post: () => Promise.reject(new HttpError(400, 'LOGIN_KEY_INVALID', 'LOGIN_KEY_INVALID')) } as unknown as AuthDeps['rest'],
      store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
    })
    await expect(auth.exportLoginToken('k'.repeat(64))).rejects.toMatchObject({ status: 400 })
  })

  it('acceptLoginToken шлёт hex-код', async () => {
    const { d, calls } = deps()
    await newAuthManager(d).acceptLoginToken('tok123')
    expect(calls).toContainEqual(['/auth/accept_login_token', { token: 'tok123' }])
  })

  it('старых qrNew/qrStatus/qrConfirm в менеджере нет', () => {
    const { d } = deps()
    const auth = newAuthManager(d) as unknown as Record<string, unknown>
    expect(auth.qrNew).toBeUndefined()
    expect(auth.qrStatus).toBeUndefined()
    expect(auth.qrConfirm).toBeUndefined()
  })

  // GET /auth/nearest_country: пустой ответ и любая ошибка — штатный исход,
  // наружу уходит '' и экран входа остаётся на своём фолбэке.
  it('nearestCountry: код страны, пустая строка и ошибка — всё без исключения', async () => {
    const make = (get: (path: string) => Promise<unknown>) =>
      newAuthManager({
        rest: { get } as unknown as AuthDeps['rest'],
        store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
      })
    await expect(make(async () => ({ country_code: 'DE' })).nearestCountry()).resolves.toBe('DE')
    await expect(make(async () => ({ country_code: '' })).nearestCountry()).resolves.toBe('')
    await expect(make(async () => ({})).nearestCountry()).resolves.toBe('')
    await expect(
      make(() => Promise.reject(new Error('offline'))).nearestCountry(),
    ).resolves.toBe('')
  })

  // POST /auth/web_token/cancel: fire-and-forget (tweb appAccountManager.ts:363-375) —
  // ошибка сети не выходит наружу необработанным отклонением, а пишется в лог.
  it('cancelWebToken шлёт токен на сервер и гасит отказ', async () => {
    const calls: Array<[string, unknown]> = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const make = (post: (path: string, body: unknown) => Promise<unknown>) =>
      newAuthManager({
        rest: { post } as unknown as AuthDeps['rest'],
        store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
      })
    make(async (path, body) => {
      calls.push([path, body])
      return { _: 'boolTrue' }
    }).cancelWebToken('tok')
    expect(calls).toEqual([['/auth/web_token/cancel', { web_auth_token: 'tok' }]])

    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    make(() => Promise.reject(new Error('offline'))).cancelWebToken('tok')
    await new Promise((r) => setTimeout(r, 0))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith('web token cancellation error:', expect.any(Error))
    err.mockRestore()
  })

  // Ф7-И2 (Step 3а): имя отказа доезжает до карточки ПОЛЕМ результата —
  // `{error: err.type}`; пустое имя (чужое тело: 502/504 nginx) и не-HttpError —
  // 'UNKNOWN'. Одно правило у requestCode, signUp и passkeyLoginFinish.
  describe('Ф7-И2: имя отказа в результате', () => {
    const make = (post: () => Promise<unknown>) => newAuthManager({
      rest: { post } as unknown as AuthDeps['rest'],
      store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
    })
    const reject = (e: unknown) => () => Promise.reject(e)
    const named = (status: number, type: string) => reject(new HttpError(status, type, type))

    it('requestCode: успех — {ok: true}; отказ — {error: имя}', async () => {
      await expect(make(async () => ({ _: 'boolTrue' })).requestCode('+7999')).resolves.toEqual({ ok: true })
      await expect(make(named(400, 'PHONE_NUMBER_INVALID')).requestCode('abc')).resolves.toEqual({ error: 'PHONE_NUMBER_INVALID' })
      await expect(make(named(420, 'FLOOD_WAIT_61')).requestCode('+7')).resolves.toEqual({ error: 'FLOOD_WAIT_61' })
      await expect(make(reject(new HttpError(502, 'HTTP 502'))).requestCode('+7')).resolves.toEqual({ error: 'UNKNOWN' })
      await expect(make(reject(new Error('offline'))).requestCode('+7')).resolves.toEqual({ error: 'UNKNOWN' })
    })

    it('signUp: имя отказа как есть (tweb SignUpCard.tsx:121-127 — err.type в кнопку)', async () => {
      for (const type of ['FIRSTNAME_INVALID', 'LASTNAME_INVALID', 'PHONE_NUMBER_OCCUPIED', 'signup_token_expired', 'FLOOD_WAIT_61']) {
        await expect(make(named(type === 'signup_token_expired' ? 401 : 400, type)).signUp('t', 'A', '', 'd', 'p'))
          .resolves.toEqual({ error: type })
      }
      await expect(make(reject(new HttpError(504, 'HTTP 504'))).signUp('t', 'A', '', 'd', 'p')).resolves.toEqual({ error: 'UNKNOWN' })
      await expect(make(reject(new Error('offline'))).signUp('t', 'A', '', 'd', 'p')).resolves.toEqual({ error: 'UNKNOWN' })
    })

    it('passkeyLoginFinish: PASSKEY_CREDENTIAL_NOT_FOUND и прочее — {error}, сессия не сохраняется', async () => {
      const { d, token } = deps()
      const fail = (e: unknown) => newAuthManager({ ...d, rest: { post: () => Promise.reject(e) } } as unknown as AuthDeps)
      await expect(fail(new HttpError(400, 'PASSKEY_CREDENTIAL_NOT_FOUND', 'PASSKEY_CREDENTIAL_NOT_FOUND')).passkeyLoginFinish('s1', {}, 'web', 'browser'))
        .resolves.toEqual({ error: 'PASSKEY_CREDENTIAL_NOT_FOUND' })
      await expect(fail(new HttpError(401, 'passkey login failed', 'passkey login failed')).passkeyLoginFinish('s1', {}, 'web', 'browser'))
        .resolves.toEqual({ error: 'passkey login failed' })
      await expect(fail(new Error('offline')).passkeyLoginFinish('s1', {}, 'web', 'browser'))
        .resolves.toEqual({ error: 'UNKNOWN' })
      expect(token()).toBeNull()
    })

    it('confirmPasswordRecovery: CODE_INVALID — invalid_code, прочее (EMAIL_HASH_EXPIRED) — failed', async () => {
      await expect(make(named(400, 'CODE_INVALID')).confirmPasswordRecovery('t', '1', 'd', 'p')).resolves.toEqual({ error: 'invalid_code' })
      await expect(make(named(400, 'EMAIL_HASH_EXPIRED')).confirmPasswordRecovery('t', '1', 'd', 'p')).resolves.toEqual({ error: 'failed' })
      // Статус больше не различает отказы: прежний 401 без имени — тоже failed.
      await expect(make(reject(new HttpError(401, 'HTTP 401'))).confirmPasswordRecovery('t', '1', 'd', 'p')).resolves.toEqual({ error: 'failed' })
      await expect(make(reject(new HttpError(503, 'password recovery unavailable', 'password recovery unavailable'))).confirmPasswordRecovery('t', '1', 'd', 'p'))
        .resolves.toEqual({ error: 'failed' })
    })

    it('requestPasswordRecovery: ветвление по имени, не по статусу', async () => {
      await expect(make(named(400, 'PASSWORD_RECOVERY_NA')).requestPasswordRecovery('t')).resolves.toEqual({ error: 'password_recovery_na' })
      await expect(make(named(401, 'password_token_expired')).requestPasswordRecovery('t')).resolves.toEqual({ error: 'password_token_expired' })
      // Чужой 401 без нашего имени — не «сессия истекла».
      await expect(make(reject(new HttpError(401, 'HTTP 401'))).requestPasswordRecovery('t')).resolves.toEqual({ error: 'failed' })
      await expect(make(named(503, 'password recovery unavailable')).requestPasswordRecovery('t')).resolves.toEqual({ error: 'failed' })
    })
  })

  it('requestPasswordRecovery: FLOOD_WAIT_5 пережидает restClient — менеджер получает успех', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ _: 'error', code: 420, text: 'FLOOD_WAIT_5' }), { status: 420 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ _: 'auth.passwordRecovery', email_pattern: 'a***@b.com' }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const rest = new RestClient('/api', () => null)
      const auth = newAuthManager({
        rest,
        store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
      } as unknown as AuthDeps)
      const p = auth.requestPasswordRecovery('PWTOK')
      await vi.advanceTimersByTimeAsync(4_900)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(200)
      await expect(p).resolves.toEqual({ emailPattern: 'a***@b.com' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('resetAccount маппит статусы сервера в результат', async () => {
    const make = (post: (path: string, body: unknown) => Promise<unknown>) =>
      newAuthManager({
        rest: { post } as unknown as AuthDeps['rest'],
        store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
      })
    const fail = (status: number, message: string) => () =>
      Promise.reject(new HttpError(status, message, message))

    const calls: Array<[string, unknown]> = []
    const ok = make(async (path, body) => {
      calls.push([path, body])
      return { ok: true }
    })
    await expect(ok.resetAccount('PWTOK')).resolves.toEqual({ ok: true })
    // `reason` — как tweb `deleteAccount('Forgot password')` (PasswordCard.tsx:89).
    expect(calls).toEqual([['/auth/account/reset', { password_token: 'PWTOK', reason: 'Forgot password' }]])

    await expect(make(fail(401, 'password_token_expired')).resetAccount('x'))
      .resolves.toEqual({ error: 'password_token_expired' })
    await expect(make(fail(409, 'recovery_available')).resetAccount('x'))
      .resolves.toEqual({ error: 'recovery_available' })
    // Ф7-И2: tweb PasswordCard.tsx:88-100 смотрит только type.
    await expect(make(fail(400, '2FA_RECENT_CONFIRM')).resetAccount('x'))
      .resolves.toEqual({ error: 'recent_confirm' })
    await expect(make(fail(400, '2FA_CONFIRM_WAIT_3600')).resetAccount('x'))
      .resolves.toEqual({ error: 'confirm_wait', wait: 3600 })
    await expect(make(fail(500, 'boom')).resetAccount('x'))
      .resolves.toEqual({ error: 'failed' })
  })
})

// Stage 1C.2 (Task 1, раунд 4): НАМЕРЕНИЕ перехода активной сессии —
// отдельный канал (rt:logging_out, порт tweb `logging_out`), а не догадка
// витрины по снимку `me`. Из одного значения намерение не выводится: null
// одинаков у логаута, у «ещё не знаем» и у офлайн-старта, а не-null id
// одинаков у подтверждения своего же аккаунта и у чужого переезда — на этом
// и разъезжались раунды 2-3 (Critical 1 / Important 3-4 в
// task-1-findings-round4.md). Владелец активного токена здесь один и знает
// намерение точно — он его и объявляет.
describe('AuthManager: rt:logging_out — намерение перехода активной сессии', () => {
  it('switchAccount() объявляет переезд на выбранный аккаунт (migrateTo = его id)', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const onLoggingOut = vi.fn()
    const { d } = deps({ token: 'TOK_A' })
    const auth = newAuthManager({ ...d, onLoggingOut })

    await auth.switchAccount(2)

    expect(onLoggingOut).toHaveBeenCalledTimes(1)
    expect(onLoggingOut).toHaveBeenCalledWith({ migrateTo: 2 })
  })

  it('switchAccount() с неизвестным id ничего не объявляет — перехода не было', async () => {
    const onLoggingOut = vi.fn()
    const { d } = deps({ token: 'TOK_A' })
    const auth = newAuthManager({ ...d, onLoggingOut })
    await expect(auth.switchAccount(999)).resolves.toBe(false)
    expect(onLoggingOut).not.toHaveBeenCalled()
  })

  // Ровно то, что витрина по `me` отличить не могла: и здесь, и в тесте ниже
  // приходит не-null пользователь, но в одном случае это переезд (нужен
  // подъём под новым токеном), а в другом — логаут (нужен экран входа).
  it('logout() с остающимся аккаунтом — переезд (migrateTo = id оставшегося), не логаут', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const onLoggingOut = vi.fn()
    const { d } = deps({ token: 'TOK_A' })
    const auth = newAuthManager({ ...d, onLoggingOut })

    await auth.logout()

    expect(onLoggingOut).toHaveBeenCalledTimes(1)
    expect(onLoggingOut).toHaveBeenCalledWith({ migrateTo: 2 })
  })

  it('logout() без остающихся аккаунтов — настоящий логаут (migrateTo: null)', async () => {
    const onLoggingOut = vi.fn()
    const { d } = deps({ token: 'TOK' })
    const auth = newAuthManager({ ...d, onLoggingOut })
    await auth.logout()
    expect(onLoggingOut).toHaveBeenCalledTimes(1)
    expect(onLoggingOut).toHaveBeenCalledWith({ migrateTo: null })
  })

  // Расхождение с tweb названо в комментарии у самой строки (Minor 10): там
  // «добавить аккаунт» открывает свободный слот и соседей не трогает, у нас
  // общий активный токен снимается глобально — промолчать нельзя.
  it('addAccount() объявляет логаут соседним вкладкам (активный токен снят глобально)', async () => {
    const onLoggingOut = vi.fn()
    const { d } = deps({ token: 'TOK' })
    const auth = newAuthManager({ ...d, onLoggingOut })
    await auth.addAccount()
    expect(onLoggingOut).toHaveBeenCalledTimes(1)
    expect(onLoggingOut).toHaveBeenCalledWith({ migrateTo: null })
  })

  // Вход — восьмой (и до раунда 4 единственный необъявленный) переход активного
  // токена. Без кадра соседняя вкладка навсегда оставалась бы на экране входа
  // при живой сессии, а вкладка под другим аккаунтом молча продолжала бы слать
  // запросы с НОВЫМ токеном под старым интерфейсом.
  it('signIn объявляет вход (userId вошедшего) — persist(), общая точка всех путей', async () => {
    const onLoggedIn = vi.fn()
    const { d } = deps()
    const auth = newAuthManager({ ...d, onLoggedIn })

    const r = await auth.signIn('+7 700', '12345', 'web', 'browser')

    expect(onLoggedIn).toHaveBeenCalledTimes(1)
    expect(onLoggedIn).toHaveBeenCalledWith({ userId: r.user!.user.id })
  })

  // Второй путь через ту же persist() — доказывает, что кадр висит на общей
  // точке, а не на одном методе (тот же приём, что у onMeChanged выше).
  it('exportLoginToken(success) объявляет вход тем же кадром (другой вызывающий, та же persist)', async () => {
    const onLoggedIn = vi.fn()
    const { d } = deps({ exportResponse: EXPORT_SUCCESS })
    await newAuthManager({ ...d, onLoggedIn }).exportLoginToken('k'.repeat(64))
    expect(onLoggedIn).toHaveBeenCalledWith({ userId: 7 })
  })

  it('вход НЕ объявляется как логаут: onLoggingOut при signIn молчит', async () => {
    const onLoggingOut = vi.fn()
    const { d } = deps()
    await newAuthManager({ ...d, onLoggingOut }).signIn('+7 700', '12345', 'web', 'browser')
    expect(onLoggingOut).not.toHaveBeenCalled()
  })

  it('onLoggedIn опционален — вход без него не падает', async () => {
    const { d } = deps()
    await expect(newAuthManager(d).signIn('+7 700', '12345', 'web', 'browser'))
      .resolves.toMatchObject({ user: { user: { id: 1 } } })
  })

  it('onLoggingOut опционален — переход без него не падает', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const { d } = deps({ token: 'TOK_A' })
    await expect(newAuthManager(d).switchAccount(2)).resolves.toBe(true)
  })
})

// Отозванная сессия (401 на /me) и провал перевывода `me` при смене токена.
// Отдельный describe: `deps()` выше мокает /me ошибкой БЕЗ HttpError
// (`Object.assign(new Error, {status:401})`), поэтому ветка `e instanceof
// HttpError` из того файла недостижима в принципе — именно поэтому строка
// onMeChanged(null) в ней и осталась непокрытой (Important 5 раунда 4).
describe('AuthManager: /me отвечает ошибкой', () => {
  function failingDeps(err: unknown, token: string | null = 'TOK') {
    let tok = token
    const store = {
      get: () => tok,
      set: async (t: string) => { tok = t },
      clear: async () => { tok = null },
      ready: async () => {},
    }
    const rest = {
      get: async (path: string) => { if (path === '/me') throw err; throw new Error('unexpected ' + path) },
      post: async () => ({ ok: true }),
      del: async () => ({ ok: true }),
    }
    return { d: { rest, store } as unknown as AuthDeps, token: () => tok }
  }

  it('401: токен снят, `me` обнулён, соседние вкладки узнают о логауте (migrateTo: null)', async () => {
    const onMeChanged = vi.fn()
    const onLoggingOut = vi.fn()
    const { d, token } = failingDeps(new HttpError(401, 'unauthorized'))
    const auth = newAuthManager({ ...d, onMeChanged, onLoggingOut })

    await expect(auth.me()).resolves.toBeNull()

    expect(token()).toBeNull()
    expect(onMeChanged).toHaveBeenCalledWith(null)
    expect(onLoggingOut).toHaveBeenCalledWith({ migrateTo: null })
  })

  // Important 2 раунда 4: до этого фикса 5xx на /me из switchAccount реджектил
  // ответ RPC (ошибка переживает границу воркера), а вызывающие .catch не
  // ставили — вкладка молча оставалась под интерфейсом СТАРОГО аккаунта, хотя
  // активный токен уже новый.
  it('5xx при смене токена: switchAccount не реджектится и обнуляет `me` (чужой личности в кэше быть не должно)', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const onMeChanged = vi.fn()
    const { d, token } = failingDeps(new HttpError(503, 'unavailable'), 'TOK_A')
    const auth = newAuthManager({ ...d, onMeChanged })

    await expect(auth.switchAccount(2)).resolves.toBe(true)

    expect(token()).toBe('TOK_B')
    expect(onMeChanged).toHaveBeenCalledWith(null)
  })

  // Тот же перевывод и те же два его свойства — у logout() с остающимся
  // аккаунтом: это тоже смена активного токена. Без rederive ветка реджектила
  // бы ответ RPC на 5xx и подставляла бы в кэш профиль с диска (= личность
  // СТАРОГО аккаунта).
  it('logout() с остающимся аккаунтом: 5xx на /me не реджектит и обнуляет `me`', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const onLogout = vi.fn()
    const { d } = failingDeps(new HttpError(503, 'unavailable'), 'TOK_A')
    await expect(newAuthManager({ ...d, onMeChanged: onLogout }).logout()).resolves.toEqual({ switched: true })
    expect(onLogout).toHaveBeenCalledWith(null)
  })

  // Тот же путь при сетевом сбое: публичный me() отдал бы кэш с диска, но при
  // СМЕНЕ токена на диске лежит профиль старого аккаунта (Minor 6 раунда 4).
  it('сетевой сбой при смене токена: switchAccount не реджектится, кэш с диска НЕ подставляется', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const onMeChanged = vi.fn()
    const { d } = failingDeps(new TypeError('Failed to fetch'), 'TOK_A')
    const auth = newAuthManager({ ...d, onMeChanged })

    await expect(auth.switchAccount(2)).resolves.toBe(true)

    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(null)
  })
})
