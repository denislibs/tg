import { HttpError, type RestClient } from '../net/restClient'
import type { UserFull, UserReal, UsersUserFull } from '../peers/peer'
import { getPeerPhotoId } from '../peers/peer'
import { getUserTitle } from '../peers/getPeerTitle'
import { listAccounts, upsertAccount, removeAccount, tokenOf, toPublic, type PublicAccount } from '../auth/accounts'
import { loadMe } from '../store/persist'

// ── Профиль пира: пара конструкторов схемы вместо трёх наших витрин ─────────
//
// Было три разные формы пользователя, и граница между ними шла не по схемной
// линии: краткая (`GET /users?ids=`, 5 полей), полная чужая (`GET /users/{id}`,
// 18 полей) и своя (`GET /me`, 13 полей) — причём `bio`/`birthday` попали в
// «свою», а `verified`/`premium`/`emoji_status` в «полную чужую», хотя в схеме
// они в кратком `user`.
//
// Стало две, как в оригинале: `user` + `userFull`. `/me` и `/users/{id}`
// отдают ОДИН И ТОТ ЖЕ конструктор `users.userFull{full_user, chats, users}`,
// то есть ПАРУ, а не третью форму, и вопрос «где живёт verified, а где bio»
// перестал быть нашим — он решён схемой.
//
// `can_message` едет РЯДОМ с конструктором, а не внутри: схемного места у него
// нет (в оригинале «нельзя писать» выражают `contact_require_premium` и
// `settings:PeerSettings`, которых у нас не существует), а подделывать чужой
// конструктор нельзя. Ровно так же устроены `muted`/`creator_id` у карточки
// чата.
//
// Того, чего здесь БОЛЬШЕ НЕТ:
//  • `displayName` — имя собирает клиент из `first_name`/`last_name`
//    (`core/peers/getPeerTitle.ts`), с провода оно убрано целиком;
//  • `avatarUrl`/`avatarPreview` — одно поле `user.photo: UserProfilePhoto` с
//    готовым `photo_id`; регулярка `/media/(\d+)/content` по нашей же строке
//    исчезла вместе с ними;
//  • `phoneVisibility` — это ПРАВИЛО ПРИВАТНОСТИ (`stores/privacyStore.ts`,
//    ключ `phone_number`), а не поле пира: два независимых механизма на один
//    вопрос стали одним (решение №5, колонка на бэкенде удалена);
//  • `premium` — `user.pFlags.premium`, `emojiStatus` —
//    `user.emoji_status_emoticon` (клиентский параметр схемы).
export interface PeerProfile {
  /** Краткая форма — та же, что едет в любом списке и с каждым сообщением. */
  user: UserReal
  /** Полная форма — то, что запрашивают один раз при открытии профиля. */
  fullUser: UserFull
  /** Поле уровня ответа: писать этому пиру можно (правило `messages`). */
  canMessage: boolean
}

/** Профиль из ОДНОГО краткого конструктора: полной формы в ответе нет
 *  (подтверждённый QR). `userFull` заводится пустым — не «нет профиля», а «нет
 *  полной формы»: id известен, остальное подтянет первый `/me`. */
export function briefProfile(user: UserReal): PeerProfile {
  return { user, fullUser: { _: 'userFull', id: user.id }, canMessage: true }
}

/** Проводная форма ответа профиля: конструктор + поля рядом с ним. */
/**
 * Ответ профиля — конструктор `users.userFull` В КОРНЕ, без обёртки.
 *
 * `can_message` лежит ВНУТРИ него: это наш клиентский параметр, объявленный в
 * `schema/schema_additional_params.json` — тем же механизмом, которым у
 * оригинала в `message` живут `mid`/`peerId`. Прежняя безымянная пара
 * `{user_full, can_message}` конструктора не имела, и записать её на проводе TL
 * было нечем.
 */
export type RawPeerProfile = UsersUserFull & { can_message?: boolean }

/**
 * Разбор ответа профиля. Маппера полей здесь нет и быть не может: форма провода
 * и форма модели совпали, разбирать нечего — раскладываем только пару
 * конструкторов (`full_user` + первый элемент `users`).
 */
export function mapPeerProfile(full: RawPeerProfile): PeerProfile {
  return {
    user: full.users?.[0] ?? { _: 'user', id: full.full_user.id },
    fullUser: full.full_user,
    canMessage: !!full.can_message,
  }
}

// Итог первого шага входа: сессия, запрос облачного пароля либо шаг регистрации
// (номер подтверждён, аккаунта под ним нет — Telegram auth.authorizationSignUpRequired).
export type SignInOutcome =
  | { user: PeerProfile; passwordNeeded?: undefined; signUpRequired?: undefined }
  | { passwordNeeded: true; passwordToken: string; hint: string; user?: undefined; signUpRequired?: undefined }
  | { signUpRequired: true; signUpToken: string; user?: undefined; passwordNeeded?: undefined }

// Регистрация: сессия либо код ошибки сервера. Дискриминированный результат, а не
// исключение, — HttpError не переживает границу worker-RPC (как SetUsernameResult).
export type SignUpResult =
  | { user: PeerProfile }
  | { error: 'first_name_required' | 'name_too_long' | 'signup_token_expired' | 'phone_number_occupied' | 'too_many_requests' | 'failed' }

// «Забыли пароль»: маска привязанной почты (`auth.passwordRecovery`). Паузу
// повторной отправки держит СЕРВЕР и выражает отказом `RESEND_TOO_SOON_<N>` —
// клиент своего таймера не заводит, поэтому соседнего числа в ответе больше
// нет: его не читал никто.
export type RecoveryRequestResult =
  | { emailPattern: string }
  | { error: 'password_token_expired' | 'password_recovery_na' | 'resend_too_soon' | 'unavailable' | 'failed' }

// Подтверждение кода с почты: сессия либо причина отказа. `recovery_expired` —
// код протух ЛИБО исчерпаны 5 попыток (сервер не различает их намеренно).
export type RecoveryConfirmResult =
  | { user: PeerProfile }
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
  /** Stage 1C.2 (Task 1): `me` — воркер единственный владелец, зовём после
   * логаута с null (workerCore.ts публикует его вкладкам как rt:me).
   * Опционально: юнит-тесты менеджера конструируют его без воркера. */
  onMeChanged?: (u: PeerProfile | null) => void
  /** Stage 1C.2 (Task 1, раунд 4): НАМЕРЕНИЕ перехода активной сессии — порт
   * tweb `logging_out` (`apiManager.ts:335` → `apiManagerProxy.ts:508`).
   * Владелец активного токена здесь один — этот менеджер, и только он знает,
   * логаут это или переезд на другой аккаунт; витрине выводить это из `me`
   * нечем (одинаковый null у логаута и у «нет данных»), поэтому объявляем
   * явно. `migrateTo` — id аккаунта, ставшего активным; null — активного не
   * осталось. Опционально по той же причине, что onMeChanged. */
  onLoggingOut?: (e: { migrateTo: number | null }) => void
  /** Симметричное намерение входа — порт tweb `account_logged_in`
   * (`apiManagerMethods.ts:78`). Зовём из persist(), единой точки всех семи
   * путей входа: активный токен появился/сменился, и соседние вкладки обязаны
   * узнать об этом так же явно, как об уходе. Опционально по той же причине,
   * что onMeChanged. */
  onLoggedIn?: (e: { userId: number }) => void
}

/**
 * `auth.Authorization` — исход шага входа ОДНИМ объединением: выдана сессия,
 * нужен облачный пароль либо нужна регистрация.
 *
 * Прежде ветку называло НАЛИЧИЕ ключей (`password_needed`, `signup_required`):
 * «выключено» имело значение, а третья ветка не имела имени вовсе.
 *
 * Карточка едет КРАТКИМ конструктором `user`, а не парой `users.userFull`: так
 * у оригинала — полной формы (`bio`, день рождения, ttl) вход не отдаёт вовсе,
 * её приносит первый же `/me`.
 *
 * `token` и `signup_token` — наши параметры, объявленные клиентскими у
 * конструкторов схемы: у оригинала ключ сессии выдаёт транспорт MTProto, а
 * продолжение шага авторизует состояние сессии на сервере — у REST нет ни
 * того, ни другого. `auth.passwordNeeded` — наш конструктор целиком: оригинал
 * выражает этот случай ошибкой `SESSION_PASSWORD_NEEDED` плюс тем же
 * состоянием сессии.
 */
export type AuthAuthorizationWire =
  | { _: 'auth.authorization'; token: string; user: UserReal }
  | { _: 'auth.authorizationSignUpRequired'; signup_token: string }
  | { _: 'auth.passwordNeeded'; password_token: string; hint: string }

/**
 * `auth.LoginToken` — состояние входа по QR-коду: код ждёт подтверждения либо
 * подтверждён и несёт ТОТ ЖЕ исход входа, что обычный шаг (прежде сессия и
 * карточка ехали соседними ключами — второй формой одного предмета).
 *
 * Третьего состояния, «протух», в объединении нет: у оригинала это ОШИБКА
 * (`AUTH_TOKEN_EXPIRED`), а прежде ехало `{status:'expired'}` со статусом 200,
 * то есть «не получилось» витриной успеха.
 */
export type AuthLoginTokenWire =
  | { _: 'auth.loginToken'; expires: number; token: string }
  | { _: 'auth.loginTokenSuccess'; authorization: AuthAuthorizationWire }

/**
 * Адрес выпущенного кода для маршрута `/auth/qr/{token}`.
 *
 * `token` в схеме — БАЙТЫ, на JSON-проводе фазы 0 это base64-строка (та же
 * договорённость, что у `stripped_thumb`), а маршрут берёт ту же величину
 * шестнадцатеричной записью.
 */
const qrToken = (r: AuthLoginTokenWire): string => {
  if (r._ !== 'auth.loginToken') throw new Error(`неожиданный ответ выпуска кода: ${r._}`)
  const bin = atob(r.token)
  let out = ''
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0')
  return out
}

export function newAuthManager({ rest, store, onMeChanged, onLoggingOut, onLoggedIn }: AuthDeps) {
  // Активный вход завершён: сохранить токен + занести аккаунт в реестр (мультиаккаунт).
  // Единая точка для signIn/signUp/checkPassword/confirmPasswordRecovery/
  // signImport/passkeyLoginFinish/qrStatus(confirmed) — все семь путей входа
  // заводят сессию через неё (вызовов persist() шесть: signIn и signImport
  // делят общий toOutcome).
  const persist = async (token: string, u: PeerProfile) => {
    await store.set(token)
    await upsertAccount({
      token,
      id: u.user.id,
      // Имя собирает клиент — `display_name` с провода убран. Фолбэк тот же,
      // что у оригинала: пусто → username → номер.
      name: getUserTitle(u.user) || u.user.username || u.user.phone || '',
      photoId: getPeerPhotoId(u.user.photo),
      phone: u.user.phone ?? '',
    })
    // Фикс ревью п.2 (Stage 1C.2, Task 1): без этой строки воркер узнавал о
    // новом пользователе ТОЛЬКО на старте (tokens.ready → auth.me, один раз за
    // жизнь воркера) — вход после старта (обычный случай: пустой токен на
    // холодном старте, boot-цепочка уже отработала с null) не публиковал `me`
    // вовсе, и `useAuthGate.login()` не перезагружает страницу (App.tsx), так
    // что boot-цепочка не переигрывается. Следствие было тихим: `getMe()` для
    // `profileManager.addPhoto` отдавал null (мердж аватара не рассылался
    // соседним вкладкам), `getMeId()` для `messagesManager` отдавал null (кэш
    // «моих» реакций не работал) — весь остаток сессии после логина.
    onMeChanged?.(u)
    // Вход — такой же переход активного токена, как логаут и переезд, и
    // объявляется так же явно (порт tweb `account_logged_in`). Без этого
    // кадра соседняя вкладка навсегда оставалась бы на экране входа при живой
    // сессии, а вкладка, уже работавшая под другим аккаунтом, молча продолжала
    // бы слать запросы с НОВЫМ токеном под старым интерфейсом (её `me` при
    // этом перезаписал бы rt:me выше — чужой личностью). Порядок важен:
    // сначала значение (`rt:me`), потом намерение — вкладка, поднимающая
    // Shell по этому кадру, застаёт `me` уже применённым проектором.
    onLoggedIn?.({ userId: u.user.id })
  }
  // Общий REST-фетч текущего /me — используется публичным me() (прогрев/
  // loadChats) И внутренними переходами активного токена (switchAccount/
  // deleteAccount/logout со сменой аккаунта), где нужно вывести свежего
  // пользователя НОВОГО активного токена и опубликовать его, а не просто
  // дёрнуть RPC. Инвариант (повторное ревью Stage 1C.2, п.1/п.6): воркерный
  // `me` не может быть протухшим относительно активного токена — ЛЮБОЙ
  // успешный /me (включая обычный прогрев, не только явные мутации/вход)
  // обновляет кэш воркера и рассылает rt:me. Без этого: (а) смена активного
  // токена оставляла бы кэш с личностью СТАРОГО аккаунта, и следующая
  // мутация профиля смерджила бы и разослала чужую личность всем вкладкам
  // (имя/username/телефон/meId — см. task-1-report.md); (б) профиль,
  // изменённый в обход этого воркера (другая сессия того же аккаунта), не
  // долетал бы до кэша — loadChats() кладёт свежее значение только в СВОЙ
  // стор, а следующий addPhoto()/update() смерджил бы поверх устаревшего
  // снимка воркера и разослал бы его всем вкладкам, затерев уже показанное
  // свежее значение.
  //
  // `rederive` — вызов из перехода активного токена (switchAccount/logout/
  // deleteAccount со сменой аккаунта). Отличий два, оба обязательные:
  //  1. Офлайн-фолбэк на диск ЗАПРЕЩЁН. На диске лежит профиль СТАРОГО
  //     аккаунта (persistScope переезжает только при рестарте воркера), и
  //     вернуть его — значит оставить владельца с чужой личностью: следующий
  //     profileManager.addPhoto/update смерджил бы её и разослал всем вкладкам
  //     (Minor 6 раунда 4). Не получили свежий ответ — публикуем null: «не
  //     знаем, кто мы» (addPhoto при пустом getMe() молча пропускает мердж).
  //  2. Наружу не бросаем. Ответ RPC перехода не должен реджектиться: на нём
  //     вызывающая вкладка строит навигацию (MainMenu.switchTo, AuthFlow.
  //     backToAccount, useAuthGate.logout), а ошибка переживает границу
  //     worker-RPC (superMessagePort реджектит ожидающий промис) — до раунда 3
  //     в этих ветках падать было нечему, и .catch там никто не ставил
  //     (Important 2 раунда 4).
  const fetchMe = async (rederive = false): Promise<PeerProfile | null> => {
    await store.ready()
    if (!store.get()) return null
    try {
      const u = mapPeerProfile(await rest.get<RawPeerProfile>('/me'))
      onMeChanged?.(u)
      return u
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        await store.clear()
        onMeChanged?.(null) // сессия невалидна — тот же сигнал, что у явного logout()
        // Сессию отозвали с другого устройства: активного аккаунта не осталось.
        // Тот же переход, что явный logout, — вкладки обязаны узнать о нём, иначе
        // остаются authed=true с мёртвой сессией (порт tweb: AUTH_KEY_UNREGISTERED
        // → apiManager.logOut() → 'logging_out').
        onLoggingOut?.({ migrateTo: null })
        return null
      }
      if (rederive) {
        onMeChanged?.(null) // см. п.1 докблока
        return null
      }
      // Сеть недоступна (fetch reject, не HttpError) — отдаём последний известный
      // профиль из офлайн-стора; НЕ публикуем — это не свежие данные с сервера,
      // а локальный фолбэк (воркерный кэш и так уже держит то же самое или лучше).
      if (!(e instanceof HttpError)) {
        const cached = await loadMe()
        if (cached) return cached
      }
      throw e
    }
  }
  // Шаг закончился ВЫДАННОЙ сессией. Отдельно от toOutcome, потому что у
  // половины путей входа другого исхода не бывает по построению: sign_up,
  // check_password, подтверждение кода с почты и вход по ключу доступа — все
  // они идут ПОСЛЕ того, как ветка уже выбрана.
  const toSession = async (res: AuthAuthorizationWire): Promise<PeerProfile> => {
    if (res._ !== 'auth.authorization') throw new Error(`неожиданный исход входа: ${res._}`)
    const u = briefProfile(res.user)
    await persist(res.token, u)
    return u
  }
  // Разбор общего ответа шагов входа: сессия | облачный пароль | регистрация.
  // Общий для sign_in и sign_import — ветку называет конструктор, а не набор
  // признаков рядом.
  const toOutcome = async (res: AuthAuthorizationWire): Promise<SignInOutcome> => {
    if (res._ === 'auth.passwordNeeded') {
      return { passwordNeeded: true, passwordToken: res.password_token, hint: res.hint ?? '' }
    }
    if (res._ === 'auth.authorizationSignUpRequired') {
      return { signUpRequired: true, signUpToken: res.signup_token }
    }
    return { user: await toSession(res) }
  }
  return {
    // Страна по умолчанию для поля номера. Аналог tweb `help.getNearestDc`
    // (там из ответа берётся `country`). Пустая строка — не определилось; это
    // штатный ответ, а не ошибка, и экран входа просто остаётся на своём фолбэке.
    async nearestCountry(): Promise<string> {
      try {
        const r = await rest.get<{ _: 'help.countryCode'; country_code?: string }>('/auth/nearest_country')
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
      return toOutcome(await rest.post<AuthAuthorizationWire>('/auth/sign_in', { phone, code, device, platform }))
    },

    // Регистрация нового номера. Аватар сюда НЕ передаётся: как и в tweb
    // (`SignUpCard.sendAvatar` в ветке `auth.authorization`), он грузится уже под
    // выданной сессией обычными ручками профиля.
    async signUp(signUpToken: string, firstName: string, lastName: string, device: string, platform: string): Promise<SignUpResult> {
      try {
        return { user: await toSession(await rest.post<AuthAuthorizationWire>('/auth/sign_up', {
          signup_token: signUpToken, first_name: firstName, last_name: lastName, device, platform,
        })) }
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
        const res = await rest.post<{ _: 'auth.passwordRecovery'; email_pattern: string }>(
          '/auth/password/recover', { password_token: passwordToken },
        )
        return { emailPattern: res.email_pattern }
      } catch (e) {
        if (!(e instanceof HttpError)) throw e
        // Код отказа несёт остаток секунд в хвосте (`RESEND_TOO_SOON_<N>`) —
        // форма оригинала, где ожидание едет внутри типа ошибки
        // (`FLOOD_WAIT_<N>`, tweb `password.tsx:40` сравнивает префиксом).
        if (e.message.startsWith('RESEND_TOO_SOON_') || e.status === 429) return { error: 'resend_too_soon' }
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
        return { user: await toSession(await rest.post<AuthAuthorizationWire>('/auth/password/recover/confirm', {
          password_token: passwordToken, code, device, platform,
        })) }
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
        return await toOutcome(await rest.post<AuthAuthorizationWire>('/auth/sign_import', {
          web_auth_token: webAuthToken, device, platform,
        }))
      } catch (e) {
        if (!(e instanceof HttpError)) throw e
        if (e.status === 401) return { error: 'web_auth_token_invalid' }
        if (e.status === 503) return { error: 'unavailable' }
        return { error: 'failed' }
      }
    },

    async checkPassword(passwordToken: string, password: string, device: string, platform: string): Promise<{ user: PeerProfile }> {
      return { user: await toSession(await rest.post<AuthAuthorizationWire>('/auth/check_password', {
        password_token: passwordToken, password, device, platform,
      })) }
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
    async passkeyLoginFinish(session: string, assertion: unknown, device: string, platform: string): Promise<{ user: PeerProfile }> {
      return { user: await toSession(await rest.post<AuthAuthorizationWire>(
        `/auth/passkey/finish?session=${encodeURIComponent(session)}&device=${encodeURIComponent(device)}&platform=${encodeURIComponent(platform)}`,
        assertion,
      )) }
    },

    // Выпуск QR-кода: конструктор `auth.loginToken`. Ссылка для сканера в
    // ответе не едет — её строит экран входа от своего origin (серверную он и
    // раньше игнорировал: за прокси она теряла порт).
    async qrNew(platform: string): Promise<string> {
      return qrToken(await rest.post<AuthLoginTokenWire>('/auth/qr/new', { platform }))
    },

    async qrStatus(token: string): Promise<{ status: 'pending' | 'confirmed' | 'expired'; user?: PeerProfile }> {
      let r: AuthLoginTokenWire
      try {
        r = await rest.get<AuthLoginTokenWire>(`/auth/qr/${token}`)
      } catch (e) {
        // Протухший (или чужой) код — ОТКАЗ, а не третий конструктор
        // объединения: так у оригинала (`AUTH_TOKEN_EXPIRED`). Наружу отдаём
        // тем же дискриминированным результатом — HttpError не переживает
        // границу worker-RPC.
        if (e instanceof HttpError && e.status === 404) return { status: 'expired' }
        throw e
      }
      if (r._ === 'auth.loginToken') return { status: 'pending' }
      // Подтверждённый код несёт ТОТ ЖЕ исход входа, что и обычный шаг.
      return { status: 'confirmed', user: await toSession(r.authorization) }
    },

    async qrConfirm(token: string): Promise<void> {
      await rest.post('/auth/qr/confirm', { token })
    },

    // Публичный /me — используется прогревом/loadChats. Тело — fetchMe() (см.
    // выше): любой успешный вызов заодно освежает кэш воркера и рассылает
    // rt:me (фикс п.6), не только явные RPC-мутации/вход.
    async me(): Promise<PeerProfile | null> {
      return fetchMe()
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
        // Активный токен сменился на ДРУГОЙ живой аккаунт — это не логаут, а
        // переезд: объявляем намерение (вкладки поднимутся под новым токеном).
        onLoggingOut?.({ migrateTo: remaining[0].id })
        // Фикс повторного ревью, п.1: перевывести `me` под НОВЫМ токеном (см.
        // докблок fetchMe): без этого кэш воркера остаётся с личностью
        // удалённого аккаунта, и следующая мутация профиля (addPhoto/update/
        // premium) смерджит и разошлёт её всем вкладкам вместо личности того,
        // на кого реально переключились.
        await fetchMe(true)
        return { switched: true }
      }
      await store.clear()
      onMeChanged?.(null) // аккаунтов не осталось — настоящий логаут
      onLoggingOut?.({ migrateTo: null })
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
        // Фикс повторного ревью, п.1/п.2: раньше здесь стоял onMeChanged(null).
        // switched === true — НЕ логаут, а смена активного аккаунта на другой
        // уже вошедший; null ложно сигналил остальным вкладкам «никто не
        // вошёл», хотя сессия B жива и активна — соседняя вкладка получала
        // это и уходила на экран входа (useAuthGate), хотя bootData.hasToken
        // истинен и вернуть её можно было только ручной перезагрузкой. Теперь
        // намерение объявлено явно (migrateTo), а `me` перевыводится под
        // НОВЫМ активным токеном — та же проводка, что у switchAccount/
        // deleteAccount (см. докблок fetchMe).
        onLoggingOut?.({ migrateTo: remaining[0].id })
        await fetchMe(true)
        return { switched: true }
      }
      await store.clear()
      // Аккаунтов не осталось — настоящий логаут, null корректен и здесь.
      onMeChanged?.(null)
      onLoggingOut?.({ migrateTo: null })
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
      // Токен уже переключён — объявляем намерение ДО сетевого перевывода
      // ниже: соседние вкладки должны подняться под новым аккаунтом сразу, а
      // не ждать лишний round-trip /me (Important 2 раунда 4).
      onLoggingOut?.({ migrateTo: id })
      // Фикс повторного ревью, п.1: активный токен сменился — обязаны
      // перевывести `me` СРАЗУ под новым токеном (см. докблок fetchMe), а не
      // оставлять кэш воркера с личностью старого аккаунта. Достижимая
      // последовательность без этой строки: вкладка 1 переключается A → B и
      // перезагружается, вкладка 2 (жива, держит SharedWorker) остаётся с
      // кэшем A; пользователь меняет аватар из вкладки 2 →
      // profileManager.addPhoto мерджит {...A, avatarUrl} → rt:me →
      // проектор перезаписывает `me` (имя/username/телефон/meId) личностью A
      // ВО ВСЕХ вкладках, хотя обе уже под B.
      await fetchMe(true)
      return true
    },
    // «Добавить аккаунт»: текущий остаётся в реестре, активный токен снимается —
    // после reload покажется экран входа; новый вход добавит ещё один аккаунт.
    async addAccount(): Promise<void> {
      await store.clear()
      // Активный токен снят — активного пользователя больше нет, тем же
      // инвариантом, что у switchAccount/deleteAccount/logout выше.
      onMeChanged?.(null)
      // Осознанное расхождение с tweb (Minor 10 раунда 4). Там «добавить
      // аккаунт» — открытие СВОБОДНОГО слота (`sidebarLeft/index.ts:1652`:
      // changeAccount(totalAccounts + 1)), соседние вкладки не трогаются:
      // аккаунт живёт в URL вкладки и в её sessionStorage-скоупе. У нас
      // активный токен ОДИН на весь SharedWorker и общий для всех вкладок —
      // сняв его, мы реально обрываем сессию соседям, и промолчать нельзя:
      // они остались бы с authed=true и мёртвым токеном (ровно дефект, ради
      // которого заведён этот сигнал). Цена расхождения — соседняя вкладка
      // уходит на экран входа; убрать её можно только пер-вкладочным
      // аккаунтом, то есть переделкой мультиаккаунта целиком.
      onLoggingOut?.({ migrateTo: null })
    },
  }
}
