import type { AccountAuthorizations, Authorization } from '@layer'
import tsNow from '@helpers/tsNow'
import type { RestClient } from '../net/restClient'
import type { NewAuthorizationEvt } from '../realtime/events'
import type { AppState } from '../state/state'

/**
 * Сессии устройств и «новый вход». Провод — конструкторы схемы: `GET /sessions`
 * отдаёт `account.authorizations` с вектором `authorization` (backend
 * `internal/domain/mtaccount.go`), и ровно он же уезжает потребителю.
 *
 * Плоской копии (`Session` + `mapSession`) здесь БОЛЬШЕ НЕТ: два представления
 * одной сущности — это то, что программа TL вычищала задачами #55 и #98.
 * Потребитель списка — вкладка «Устройства»
 * (`components/sidebarLeft/tabs/activeSessions.solid.tsx`) — работает с
 * `Authorization.authorization` напрямую, как и её оригинал в tweb.
 *
 * Тип берётся ГЕНЕРИРУЕМЫЙ (`layer.d.ts`), а не рукописный: схема одна на
 * обе стороны, дубликат объявления неизбежно разъедется с ней.
 *
 * Строки конструктора заполнены целиком: имя и версию клиента, ОС и дату входа
 * бэкенд производит (`mtaccount.go`, докблок `Authorization`). В реестре
 * опущенного остались только `api_id` и `region`: номер приложения бывает
 * лишь у клиентов MTProto, а город со страной приезжают из GeoIP одной
 * строкой. Вкладка их не читает вовсе.
 *
 * ── «Новый вход» ────────────────────────────────────────────────────────────
 * Порт tweb `lib/appManagers/appAccountManager.ts:13-299`, `:385-411`, `:431-478`
 * (812502980; бизнес-бота и passkey-ручек в этом файле нет — они у `authManager`).
 * Сервер ставит строке сессии флаг `unconfirmed`, когда в аккаунт вошли способом,
 * который не одобрила уже вошедшая сессия, и присылает остальным устройствам
 * `updateNewAuthorization`. Владелец списка запросов — воркер: он единственный
 * держит State (`unconfirmedAuthorizations`, `currentAuthorizationDate`) и
 * объявляет вкладкам событие `unconfirmed_authorizations_update`.
 *
 * Расхождения с оригиналом:
 *  1. Часы и таймер срока — `tsNow(true)` и глобальный `setTimeout` воркера (у tweb
 *     `ctx.setTimeout`, то же).
 *  2. Срок показа (`authorization_autoconfirm_period`) — константа 7 суток: сервер ключ
 *     `authorization_autoconfirm_period` в `help.getAppConfig` не отдаёт (`rootScope 'app_config'`,
 *     `:79-83` не портирован), сервер применяет тот же дефолт (бэклог №7 пачки М).
 *  3. State читается лениво, при первом обращении, а не в `after()`: у tweb менеджеры
 *     создаются после готового State, у нас воркер собирается раньше `persistScope`
 *     (чтение State до смены скоупа отдало бы данные прошлого аккаунта).
 *  4. `user_auth` (`:112-120`) — вызовы `getAuthorizations()` из `workerCore`: после
 *     входа (`onLoggedIn`), на старте воркера с живым токеном и после перехода на другой
 *     аккаунт; `reset()` обнуляет память менеджера на смене аккаунта (у tweb аккаунт —
 *     отдельный экземпляр менеджеров).
 *  5. `changeAuthorizationSettings` шлёт только `confirmed`: флаги звонков и секретных
 *     чатов (`call_requests_disabled`, `encrypted_requests_disabled`) сервером не читаются,
 *     потребителя у них нет (бэклог №4 пачки М).
 *  6. `update.pFlags?.unconfirmed`: у конструктора без флагов `pFlags` на нашем проводе
 *     опущен (`omitempty`), а tweb достраивает его десериализатором (`pFlags ??= {}`).
 */

/** tweb `UnconfirmedAuthorization` (appAccountManager.ts:15-20). */
export type UnconfirmedAuthorization = {
  hash: string | number
  date: number
  device: string
  location: string
}

/** tweb `authorizationAutoconfirmPeriod.ts:1`, секунды. */
export const DEFAULT_AUTHORIZATION_AUTOCONFIRM_PERIOD = 7 * 24 * 60 * 60

/**
 * Первые сутки сессия не просматривает другие (tweb `appAccountManager.ts:71-77`):
 * и `resetAuthorization`, и `changeAuthorizationSettings` отвечают FRESH_*_FORBIDDEN.
 * Запрос, поднятый в это окно, мог бы только упереться в отказ, поэтому он ждёт.
 */
export const FRESH_AUTHORIZATION_PERIOD = 24 * 60 * 60

type UnconfirmedAuthorizationMutation = {
  version: number
  authorization?: UnconfirmedAuthorization
}

const isSameAuthorization = (a: UnconfirmedAuthorization, b: UnconfirmedAuthorization) => {
  return '' + a.hash === '' + b.hash &&
    a.date === b.date &&
    a.device === b.device &&
    a.location === b.location
}

const areSameAuthorizations = (a: UnconfirmedAuthorization[], b: UnconfirmedAuthorization[]) => {
  return a.length === b.length && a.every((authorization, index) => {
    return isSameAuthorization(authorization, b[index])
  })
}

/** tweb `applyUnconfirmedAuthorizationUpdate` (appAccountManager.ts:41-59). */
export function applyUnconfirmedAuthorizationUpdate(
  authorizations: UnconfirmedAuthorization[],
  update: NewAuthorizationEvt,
) {
  const updated = authorizations.filter((authorization) => {
    return '' + authorization.hash !== '' + update.hash
  })

  if(update.pFlags?.unconfirmed) { // расхождение 6
    updated.unshift({
      hash: update.hash,
      date: update.date ?? 0,
      device: update.device ?? '',
      location: update.location ?? '',
    })
  }

  return updated
}

/** tweb `filterExpiredUnconfirmedAuthorizations` (appAccountManager.ts:61-69). */
export function filterExpiredUnconfirmedAuthorizations(
  authorizations: UnconfirmedAuthorization[],
  period: number,
  now = tsNow(true),
) {
  return authorizations.filter((authorization) => {
    return authorization.date + period > now
  })
}

/** Куда менеджер пишет State (диск и зеркало вкладкам) — `persist.stateKey`. */
interface SessionsState {
  getState(): Promise<Partial<AppState>>
  pushToState<K extends 'unconfirmedAuthorizations' | 'currentAuthorizationDate'>(key: K, value: AppState[K]): unknown
}

interface SessionsDeps {
  rest: RestClient
  state: SessionsState
  /** Событие вкладкам (`workerCore::broadcast`). */
  broadcast: (event: string, payload: unknown) => void
}

export function newSessionsManager({ rest, state, broadcast }: SessionsDeps) {
  let unconfirmedAuthorizations: UnconfirmedAuthorization[] = []
  let publishedUnconfirmedAuthorizations: UnconfirmedAuthorization[] = []
  let currentAuthorizationDate = 0
  let authorizationsPromise: Promise<AccountAuthorizations.accountAuthorizations> | undefined
  let mutationVersion = 0
  let clearVersion = 0
  let mutations = new Map<string, UnconfirmedAuthorizationMutation>()
  const authorizationAutoconfirmPeriod = DEFAULT_AUTHORIZATION_AUTOCONFIRM_PERIOD // расхождение 2
  let expirationTimeout: ReturnType<typeof setTimeout> | undefined
  /** Поколение аккаунта: ответ и чтение State прошлого поколения не применяются. */
  let generation = 0
  let loadedPromise: Promise<void> | undefined

  const pushToState = <K extends 'unconfirmedAuthorizations' | 'currentAuthorizationDate'>(key: K, value: AppState[K]) => {
    void Promise.resolve(state.pushToState(key, value)).catch(() => {})
  }

  const isCurrentAuthorizationFresh = (now = tsNow(true)) => {
    return currentAuthorizationDate > 0 &&
      currentAuthorizationDate + FRESH_AUTHORIZATION_PERIOD > now
  }

  const getVisibleUnconfirmed = () => {
    if(isCurrentAuthorizationFresh()) return []

    return unconfirmedAuthorizations.slice()
  }

  // Kept apart from the stored list: a session that is still too fresh to review
  // anything holds every prompt back without forgetting it.
  const publishUnconfirmedAuthorizations = () => {
    const visible = getVisibleUnconfirmed()
    if(areSameAuthorizations(publishedUnconfirmedAuthorizations, visible)) return

    publishedUnconfirmedAuthorizations = visible
    broadcast('unconfirmed_authorizations_update', visible)
  }

  const scheduleAuthorizationExpiration = () => {
    if(expirationTimeout !== undefined) {
      clearTimeout(expirationTimeout)
      expirationTimeout = undefined
    }

    if(!unconfirmedAuthorizations.length) return

    const wakeUpAt = unconfirmedAuthorizations.map((authorization) => {
      return authorization.date + authorizationAutoconfirmPeriod
    })

    if(isCurrentAuthorizationFresh()) {
      wakeUpAt.push(currentAuthorizationDate + FRESH_AUTHORIZATION_PERIOD)
    }

    const delay = Math.max(0, Math.min(...wakeUpAt) - tsNow(true)) * 1000

    expirationTimeout = setTimeout(() => {
      expirationTimeout = undefined
      setUnconfirmedAuthorizations(unconfirmedAuthorizations)
    }, delay)
  }

  const setUnconfirmedAuthorizations = (authorizations: UnconfirmedAuthorization[]) => {
    const updated = filterExpiredUnconfirmedAuthorizations(authorizations, authorizationAutoconfirmPeriod)

    if(!areSameAuthorizations(unconfirmedAuthorizations, updated)) {
      unconfirmedAuthorizations = updated
      pushToState('unconfirmedAuthorizations', updated)
    }

    publishUnconfirmedAuthorizations()
    scheduleAuthorizationExpiration()
  }

  const setCurrentAuthorizationDate = (date?: number) => {
    if(!(date !== undefined && date > 0) || currentAuthorizationDate === date) return

    currentAuthorizationDate = date
    pushToState('currentAuthorizationDate', date)
    publishUnconfirmedAuthorizations()
    scheduleAuthorizationExpiration()
  }

  /**
   * State читается один раз на поколение и лениво (расхождение 3). Запросы и
   * кадры, пришедшие до чтения, ждут его и применяются по порядку прихода.
   */
  const ensureLoaded = (): Promise<void> => {
    if(loadedPromise) return loadedPromise

    const gen = generation
    const promise: Promise<void> = loadedPromise = state.getState().then((loaded) => {
      if(gen !== generation) return

      currentAuthorizationDate = loaded.currentAuthorizationDate || 0

      const saved = loaded.unconfirmedAuthorizations ?? []
      const restored = filterExpiredUnconfirmedAuthorizations(saved, authorizationAutoconfirmPeriod)

      unconfirmedAuthorizations = restored
      if(!areSameAuthorizations(saved, restored)) {
        pushToState('unconfirmedAuthorizations', restored)
      }

      // a restored prompt is news to everyone who asked before the state was read
      publishUnconfirmedAuthorizations()
      scheduleAuthorizationExpiration()
    }).catch((err) => {
      // Чтение State не вышло: менеджер живёт с пустым списком, следующий вход/старт
      // перечитает его. Следующее обращение пробует заново.
      if(loadedPromise === promise) loadedPromise = undefined
      throw err
    })

    return promise
  }

  const recordUnconfirmedAuthorizationMutation = (
    hash: string | number,
    authorization?: UnconfirmedAuthorization,
  ) => {
    mutations.set('' + hash, {
      version: ++mutationVersion,
      authorization,
    })
  }

  const applyUnconfirmedAuthorizationMutations = (
    authorizations: UnconfirmedAuthorization[],
    afterVersion: number,
  ) => {
    if(clearVersion > afterVersion) {
      authorizations = []
      afterVersion = clearVersion
    }

    const pending = Array.from(mutations.entries())
    .filter(([, mutation]) => mutation.version > afterVersion)
    .sort((a, b) => a[1].version - b[1].version)

    return pending.reduce((updated, [hash, mutation]) => {
      updated = updated.filter((authorization) => '' + authorization.hash !== hash)
      if(mutation.authorization) {
        updated.unshift(mutation.authorization)
      }

      return updated
    }, authorizations)
  }

  const removeUnconfirmedAuthorization = (hash: string | number) => {
    recordUnconfirmedAuthorizationMutation(hash)
    setUnconfirmedAuthorizations(unconfirmedAuthorizations.filter((authorization) => {
      return '' + authorization.hash !== '' + hash
    }))
  }

  const applyNewAuthorizationUpdate = (update: NewAuthorizationEvt) => {
    const updated = applyUnconfirmedAuthorizationUpdate(unconfirmedAuthorizations, update)
    recordUnconfirmedAuthorizationMutation(
      update.hash,
      updated.find((authorization) => '' + authorization.hash === '' + update.hash),
    )
    setUnconfirmedAuthorizations(updated)
  }

  // `unconfirmed` sits on the session row itself — it is what makes the user's
  // OTHER devices ask about a login, not a per-viewer flag — so the session we
  // are running on can come back carrying it. Asking a device about itself is
  // both pointless and unanswerable (the server refuses to let a session review
  // itself), so `current` never becomes a prompt; tdesktop and Android sidestep
  // this by never reading the flag from the session list at all.
  const getUnconfirmedAuthorizationsFromSessions = (authorizations: Authorization.authorization[]) => {
    return authorizations
    .filter((authorization) => authorization.pFlags.unconfirmed && !authorization.pFlags.current)
    .map((authorization): UnconfirmedAuthorization => ({
      hash: authorization.hash,
      date: authorization.date_created,
      device: [authorization.device_model, authorization.platform].filter(Boolean).join(', ') ||
        [authorization.app_name, authorization.app_version].filter(Boolean).join(' '),
      location: [authorization.region, authorization.country].filter(Boolean).join(', '),
    }))
    .sort((a, b) => b.date - a.date)
  }

  const getAuthorizations = (): Promise<AccountAuthorizations.accountAuthorizations> => {
    if(authorizationsPromise) return authorizationsPromise

    const version = mutationVersion
    const gen = generation
    const promise: Promise<AccountAuthorizations.accountAuthorizations> = authorizationsPromise = ensureLoaded()
    .then(() => rest.get<AccountAuthorizations.accountAuthorizations>('/sessions'))
    .then((authorizations) => {
      // Аккаунт сменился, пока шёл запрос: чужой список не применяется.
      if(gen !== generation) return authorizations

      const list = authorizations.authorizations ?? []
      setCurrentAuthorizationDate(list.find((authorization) => authorization.pFlags.current)?.date_created)

      setUnconfirmedAuthorizations(
        applyUnconfirmedAuthorizationMutations(getUnconfirmedAuthorizationsFromSessions(list), version),
      )

      return authorizations
    })
    .finally(() => {
      if(authorizationsPromise === promise) authorizationsPromise = undefined
    })

    return promise
  }

  return {
    /**
     * Список устройств (`account.getAuthorizations`) и заодно сверка запросов
     * «это вы?» с флагами строк. Параллельные вызовы делят один запрос.
     */
    getAuthorizations,

    /** Только строки списка — для вкладки «Устройства». */
    async list(): Promise<Authorization.authorization[]> {
      const r = await getAuthorizations()
      return r.authorizations ?? []
    },

    /**
     * Кадр `updateNewAuthorization`: с `unconfirmed` — запрос в начало списка, без —
     * запрос по `hash` снимается (tweb `processNewAuthorizationUpdate`, `:271-280`).
     * Кадр, пришедший до чтения State, ждёт его (tweb `pendingUpdates`, `:93-106`).
     */
    processNewAuthorizationUpdate(update: NewAuthorizationEvt): void {
      const gen = generation
      // Кадр сокета прошлого аккаунта после смены аккаунта не применяется.
      void ensureLoaded().then(() => { if(gen === generation) applyNewAuthorizationUpdate(update) }, () => {})
    },

    /** Запросы, которые показывает плашка: при свежей текущей сессии список пуст (`:201-209`). */
    async getUnconfirmedAuthorizations(): Promise<UnconfirmedAuthorization[]> {
      await ensureLoaded()
      return getVisibleUnconfirmed()
    },

    /**
     * Гасит одну сессию: её токен умирает сразу, сокеты закрывает сервер.
     *
     * Отдаёт ИСХОД, а не `void`: бэкенд отвечает конструктором `Bool`
     * (`session_handler.go::Revoke` → `domain.NewBool(true)`), и вкладка
     * снимает строку только по успеху — 1:1 с оригиналом
     * (`activeSessions.tsx:117-121`, `.then((value) => {if(value) …})`).
     * Раньше ответ выбрасывался, и «получилось» было неотличимо от
     * «не получилось». Разворачивание `Bool` в булево — то же, что делает
     * `profileManager.checkUsername` (и уровень MTProto в оригинале).
     * Запрос «это вы?» об этой сессии снимается (tweb `resetAuthorization`, `:431-439`).
     */
    async terminate(id: number): Promise<boolean> {
      const res = await rest.del<{ _: string }>(`/sessions/${id}`)
      const ok = res._ === 'boolTrue'
      if(ok) removeUnconfirmedAuthorization(id)
      return ok
    },

    /** «Terminate All Other Sessions» — всё, кроме текущей. Исход — см. `terminate`; запросы очищаются (`:441-451`). */
    async terminateOthers(): Promise<boolean> {
      // Числа отозванных в ответе нет: его не читал никто, а список сессий
      // экран перезапрашивает.
      const res = await rest.del<{ _: string }>('/sessions/others')
      const ok = res._ === 'boolTrue'
      if(ok) {
        clearVersion = ++mutationVersion
        mutations.clear()
        setUnconfirmedAuthorizations([])
      }
      return ok
    },

    /**
     * `account.changeAuthorizationSettings` (tweb `:457-478`): «Да, это я» —
     * `confirmed`. Свежая текущая сессия получает 406 FRESH_CHANGE_AUTHORIZATION_FORBIDDEN
     * (`getAuthorizationErrorLangKey` разбирает любой `FRESH_*`). Расхождение 5.
     */
    async changeAuthorizationSettings(hash: string | number, options: { confirmed?: boolean }): Promise<boolean> {
      const res = await rest.post<{ _: string }>(`/sessions/${hash}/settings`, { confirmed: options.confirmed })
      const ok = res._ === 'boolTrue'
      if(ok && options.confirmed) removeUnconfirmedAuthorization(hash)
      return ok
    },

    /** tweb `confirmUnconfirmedAuthorization` (`:481-483`). */
    confirmUnconfirmedAuthorization(hash: string | number): Promise<boolean> {
      return this.changeAuthorizationSettings(hash, { confirmed: true })
    },

    /**
     * Смена аккаунта (`onLoggingOut`/`onLoggedIn`): память менеджера и ключи State
     * обнуляются, ответы и чтения прошлого аккаунта больше не применяются. Иначе
     * вошедший в том же браузере Боб видел бы плашки Алисы (расхождение 4).
     */
    reset(): void {
      ++generation
      // Память после сброса — истина: ключи State уже записаны пустыми, а чтение диска
      // сразу за записью могло бы обогнать её и вернуть список прошлого аккаунта. Запросы
      // нового аккаунта приедут со списком сессий (`getAuthorizations`) и кадрами.
      loadedPromise = Promise.resolve()
      authorizationsPromise = undefined
      if(expirationTimeout !== undefined) {
        clearTimeout(expirationTimeout)
        expirationTimeout = undefined
      }
      mutationVersion = 0
      clearVersion = 0
      mutations = new Map()
      const hadState = unconfirmedAuthorizations.length > 0 || currentAuthorizationDate > 0
      unconfirmedAuthorizations = []
      currentAuthorizationDate = 0
      pushToState('unconfirmedAuthorizations', [])
      pushToState('currentAuthorizationDate', 0)
      if(publishedUnconfirmedAuthorizations.length || hadState) {
        publishedUnconfirmedAuthorizations = []
        broadcast('unconfirmed_authorizations_update', [])
      }
    },
  }
}

export type SessionsManager = ReturnType<typeof newSessionsManager>
