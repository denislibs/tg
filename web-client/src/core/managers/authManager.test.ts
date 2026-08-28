// fake-indexeddb — нужна только для switchAccount()/deleteAccount() ниже: они
// реально ищут аккаунт через ../auth/accounts (listAccounts/tokenOf/
// removeAccount), а те тихо деградируют до пустого списка без реального IDB
// (см. accounts.ts). Остальные тесты файла (сигнатура AuthDeps не меняется)
// работали и без полифилла — деградация давала им пустой список аккаунтов,
// тот же результат, что и свежая IDBFactory ниже.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { newAuthManager, type AuthDeps } from './authManager'
import { HttpError } from '../net/restClient'
import { upsertAccount } from '../auth/accounts'

beforeEach(() => { indexedDB = new IDBFactory() })

function deps(overrides: Partial<{ token: string | null; qrConfirmed: boolean }> = {}) {
  let token: string | null = overrides.token ?? null
  const qrConfirmed = overrides.qrConfirmed ?? false
  const calls: Array<[string, unknown]> = []
  const store = {
    get: () => token,
    set: async (t: string) => { token = t },
    clear: async () => { token = null },
    ready: async () => {},
  }
  const rest = {
    post: async (path: string, body: unknown) => {
      calls.push([path, body])
      if (path === '/auth/request_code') return { ok: true }
      // Исход шага входа — КОНСТРУКТОР объединения auth.Authorization, а
      // карточка внутри него КРАТКАЯ: полной формы вход не отдаёт.
      if (path === '/auth/sign_in') return { _: 'auth.authorization', token: 'TOK', user: briefWire(1, '+700') }
      if (path === '/auth/logout') return { ok: true }
      // Выпуск кода — auth.loginToken; `token` это БАЙТЫ, на JSON-проводе
      // base64 (0x01 0x02 → 'AQI=' → адрес маршрута '0102').
      if (path === '/auth/qr/new') return { _: 'auth.loginToken', expires: 1787334148, token: 'AQI=' }
      if (path === '/auth/qr/confirm') return { ok: true }
      throw new Error('unexpected ' + path)
    },
    get: async (path: string) => {
      if (path === '/me') {
        if (!token) throw Object.assign(new Error('missing token'), { status: 401 })
        return profileWire(1, '+700')
      }
      if (path === '/auth/qr/0102') {
        return qrConfirmed
          // Подтверждённый код несёт ТОТ ЖЕ исход входа, что и обычный шаг, —
          // вложенным конструктором, а не соседними ключами.
          ? { _: 'auth.loginTokenSuccess', authorization: { _: 'auth.authorization', token: 'sess999', user: { _: 'user', id: 7, phone: '+7' } } }
          : { _: 'auth.loginToken', expires: 1787334148, token: 'AQI=' }
      }
      // Протухший (или чужой) код — ОТКАЗ, а не третий конструктор.
      if (path === '/auth/qr/dead') throw new HttpError(404, 'AUTH_TOKEN_EXPIRED')
      throw new Error('unexpected ' + path)
    },
  }
  return { d: { rest, store } as unknown as AuthDeps, calls, token: () => token }
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

  // deleteAccount(): тот же инвариант — с остающимся аккаунтом это тоже смена
  // активного токена, не логаут.
  it('deleteAccount() с остающимся аккаунтом зовёт onMeChanged свежим пользователем НОВОГО токена', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const onMeChanged = vi.fn()
    const { d, token } = deps({ token: 'TOK_A' })
    const auth = newAuthManager({ ...d, onMeChanged })

    const r = await auth.deleteAccount()

    expect(r).toEqual({ switched: true })
    expect(token()).toBe('TOK_B')
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).not.toHaveBeenCalledWith(null)
  })

  it('deleteAccount() без остающихся аккаунтов зовёт onMeChanged(null) — настоящий логаут', async () => {
    const onMeChanged = vi.fn()
    const { d } = deps() // без аккаунтов в реестре
    const auth = newAuthManager({ ...d, onMeChanged })

    const r = await auth.deleteAccount()

    expect(r).toEqual({ switched: false })
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(null)
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

  // Второй путь через persist() (не toOutcome) — qrStatus(confirmed): доказывает,
  // что фикс на самой persist(), а не на одном конкретном вызывающем методе.
  it('qrStatus(confirmed) тоже зовёт onMeChanged (тот же persist(), другой вызывающий)', async () => {
    const onMeChanged = vi.fn()
    const { d } = deps({ qrConfirmed: true })
    const auth = newAuthManager({ ...d, onMeChanged })
    await auth.qrStatus('0102')
    expect(onMeChanged).toHaveBeenCalledTimes(1)
    expect(onMeChanged).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 7 }) }))
  })

  it('onMeChanged опционален — signIn() без него не падает', async () => {
    const { d } = deps()
    const auth = newAuthManager(d)
    await expect(auth.signIn('+7 700', '12345', 'web', 'browser')).resolves.toMatchObject({ user: { user: { id: 1 } } })
  })

  // Адрес кода: base64 конструктора → шестнадцатеричная запись маршрута.
  // Ссылки для сканера в ответе больше нет — её строит экран входа сам.
  it('qrNew отдаёт адрес кода шестнадцатеричной записью', async () => {
    const { d } = deps()
    const auth = newAuthManager(d)
    await expect(auth.qrNew('web')).resolves.toBe('0102')
  })

  it('qrStatus stores the session token when confirmed', async () => {
    const { d, token } = deps({ qrConfirmed: true })
    const auth = newAuthManager(d)
    const r = await auth.qrStatus('0102')
    expect(r.status).toBe('confirmed')
    expect(r.user?.user.id).toBe(7)
    expect(token()).toBe('sess999')
  })

  it('qrStatus pending does not store a token', async () => {
    const { d, token } = deps({ qrConfirmed: false })
    const auth = newAuthManager(d)
    const r = await auth.qrStatus('0102')
    expect(r.status).toBe('pending')
    expect(token()).toBeNull()
  })

  // Протухший код — отказ 404, а наружу тот же дискриминированный результат:
  // HttpError не переживает границу worker-RPC.
  it('qrStatus: отказ AUTH_TOKEN_EXPIRED становится статусом expired', async () => {
    const { d, token } = deps()
    const r = await newAuthManager(d).qrStatus('dead')
    expect(r.status).toBe('expired')
    expect(token()).toBeNull()
  })

  it('qrConfirm posts the token', async () => {
    const { d, calls } = deps()
    const auth = newAuthManager(d)
    await auth.qrConfirm('tok123')
    expect(calls).toContainEqual(['/auth/qr/confirm', { token: 'tok123' }])
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

  // POST /auth/account/reset: 401/409 — дискриминированный результат, не throw
  // (HttpError не переживает границу worker-RPC).
  it('resetAccount маппит статусы сервера в результат', async () => {
    const make = (post: (path: string, body: unknown) => Promise<unknown>) =>
      newAuthManager({
        rest: { post } as unknown as AuthDeps['rest'],
        store: { get: () => null, set: async () => {}, clear: async () => {}, ready: async () => {} },
      })
    const fail = (status: number, message: string) => () =>
      Promise.reject(new HttpError(status, message))

    const calls: Array<[string, unknown]> = []
    const ok = make(async (path, body) => {
      calls.push([path, body])
      return { ok: true }
    })
    await expect(ok.resetAccount('PWTOK')).resolves.toEqual({ ok: true })
    expect(calls).toEqual([['/auth/account/reset', { password_token: 'PWTOK' }]])

    await expect(make(fail(401, 'password_token_expired')).resetAccount('x'))
      .resolves.toEqual({ error: 'password_token_expired' })
    await expect(make(fail(409, 'recovery_available')).resetAccount('x'))
      .resolves.toEqual({ error: 'recovery_available' })
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

  it('deleteAccount() с остающимся аккаунтом — переезд; без остающихся — логаут', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const migrated = vi.fn()
    const { d } = deps({ token: 'TOK_A' })
    await newAuthManager({ ...d, onLoggingOut: migrated }).deleteAccount()
    expect(migrated).toHaveBeenCalledWith({ migrateTo: 2 })

    const loggedOut = vi.fn()
    const { d: d2 } = deps({ token: 'TOK_B' })
    await newAuthManager({ ...d2, onLoggingOut: loggedOut }).deleteAccount()
    expect(loggedOut).toHaveBeenCalledWith({ migrateTo: null })
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
  it('qrStatus(confirmed) объявляет вход тем же кадром (другой вызывающий, та же persist)', async () => {
    const onLoggedIn = vi.fn()
    const { d } = deps({ qrConfirmed: true })
    await newAuthManager({ ...d, onLoggedIn }).qrStatus('0102')
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

  // Тот же перевывод и те же два его свойства — у logout()/deleteAccount() с
  // остающимся аккаунтом: это тоже смена активного токена. Без rederive обе
  // ветки реджектили бы ответ RPC на 5xx и подставляли бы в кэш профиль с
  // диска (= личность СТАРОГО аккаунта).
  it('logout()/deleteAccount() с остающимся аккаунтом: 5xx на /me не реджектит и обнуляет `me`', async () => {
    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    await upsertAccount({ token: 'TOK_B', id: 2, name: 'B', photoId: 0, phone: '+701' })
    const onLogout = vi.fn()
    const { d } = failingDeps(new HttpError(503, 'unavailable'), 'TOK_A')
    await expect(newAuthManager({ ...d, onMeChanged: onLogout }).logout()).resolves.toEqual({ switched: true })
    expect(onLogout).toHaveBeenCalledWith(null)

    await upsertAccount({ token: 'TOK_A', id: 1, name: 'A', photoId: 0, phone: '+700' })
    const onDelete = vi.fn()
    const { d: d2 } = failingDeps(new HttpError(503, 'unavailable'), 'TOK_A')
    await expect(newAuthManager({ ...d2, onMeChanged: onDelete }).deleteAccount()).resolves.toEqual({ switched: true })
    expect(onDelete).toHaveBeenCalledWith(null)
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
