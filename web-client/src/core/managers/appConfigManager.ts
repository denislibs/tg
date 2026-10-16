import type { Config, HelpAppConfig, JSONValue } from '@layer'
import type { RestClient } from '../net/restClient'

/**
 * Конфиг приложения: `help.getAppConfig` (лимиты и флаги), `help.getConfig`
 * (плоский `config`) и `getLimit` поверх первого — порт tweb
 * `lib/appManagers/apiManagerMethods.ts:310-394` + `formatJSONValue`
 * (`lib/mtproto/tl_utils.ts:791-806`).
 *
 * Владелец — воркер: один SharedWorker на все вкладки, один запрос и одна запись
 * кэша. Вкладки спрашивают через `managers.appConfig`.
 *
 * Ключи — только те, что отдаёт наш сервер (`backend/internal/domain/mthelp.go`,
 * `NewAppConfig`): лимиты, которые он ПРИМЕНЯЕТ, и флаги покупок. Остальных ключей
 * tweb сервер не знает; за ними здесь пусто, и `getLimit` вернёт `undefined` — как
 * у tweb на ключе, которого в конфиге нет.
 *
 * Расхождения с оригиналом:
 *  1. Кэш (24 часа, `appConfig.cachedTime`) лежит в KV IndexedDB (`core/store/idbKv.ts`),
 *     а не в `appStateManager` вкладки: конфиг общий для аккаунтов и не должен
 *     стираться с аккаунтным стором на выходе.
 *  2. Отказ сети. У tweb запрос MTProto повторяется транспортом, пока не пройдёт;
 *     наш REST отказывает сразу. Поэтому: есть просроченная копия — отдаём её; нет
 *     ничего — пустой объект (все ключи `MTAppConfig` необязательны, потребитель
 *     читает `undefined`, как у tweb на ключе без значения). Пустой ответ не
 *     запоминается: следующий вызов идёт в сеть.
 *  3. Отказ не повторяется на каждый вызов: после него `RETRY_PAUSE_MS` отдаётся копия
 *     (или пустой объект) без запроса. Меню чата и реакция ждут конфиг и не должны висеть
 *     на мёртвой сети: ответ ждут не дольше `REQUEST_TIMEOUT_MS` от НАЧАЛА запроса, а кто
 *     пришёл позже, сразу получает копию (или пустой объект). Запрос при этом не бросается:
 *     он дорабатывает в фоне, и поздний ответ всё равно ложится в кэш. Воркер прогревает
 *     конфиг на старте (tweb `appMessagesManager.ts:757`), поэтому на живой сети ожидания нет.
 *     Зависший запрос (у `fetch` нет своего таймаута) не перезапускается, пока не завершится
 *     или пока не позовут `overwrite`.
 *  4. Кэш в KV привязан к origin, а не к серверу или аккаунту: значений, зависящих от
 *     пользователя, в конфиге нет (подписка читается живым геттером), а при смене бэкенда
 *     на том же origin старые флаги живут до суток.
 *  5. Перечитывание конфигов на входе в аккаунт (tweb `apiManager.ts:111-121`: `user_auth` →
 *     `updateConfig` → `getConfig(true)` + `getAppConfig(true)`) не портировано: `onLoggedIn`
 *     воркера зовёт оба геттера без `overwrite` (известный долг, «Не закрыто» Ф7-К).
 *  6. `getConfig` держит ответ до конца жизни воркера, как `this.config` у tweb;
 *     его `expires` не читается (tweb его тоже не читает — `config` обновляется
 *     переподключением, которого у REST нет, только `overwrite`).
 */

/** Ключи `help.getAppConfig`, которые отдаёт наш сервер (поля — по tweb `appConfig.d.ts`). */
export interface MTAppConfig {
  dialogs_pinned_limit_default?: number
  dialogs_pinned_limit_premium?: number
  stickers_faved_limit_default?: number
  stickers_faved_limit_premium?: number
  saved_gifs_limit_default?: number
  saved_gifs_limit_premium?: number
  dialog_filters_limit_default?: number
  dialog_filters_limit_premium?: number
  reactions_user_max_default?: number
  reactions_user_max_premium?: number
  /** Размер чата, до которого видно «кто прочитал» (`appConfig.d.ts:23`). */
  chat_read_mark_size_threshold?: number
  /** Секунды: насколько старое сообщение ещё показывает «кто прочитал» (`:22`). */
  chat_read_mark_expire_period?: number
  /** `appConfig.d.ts:159`. */
  passkeys_account_passkeys_max?: number
  /** Секунды (`:93-94`). */
  stories_stealth_future_period?: number
  stories_stealth_past_period?: number
  /** Флаги-выключатели покупок (`:33`, `:111`); `giveaway_gifts_purchase_available`
   *  (`:98`) сервер отдаёт декоративно, tweb его не читает. */
  premium_purchase_blocked?: boolean
  stars_purchase_blocked?: boolean
  giveaway_gifts_purchase_available?: boolean
  /** Служебные поля кэша (`appConfig.d.ts:107-108`). */
  cachedTime?: number
  hash?: number
}

/** Подмножество `ApiLimitType` tweb (`apiManagerMethods.ts:20-26`): типы, ключи которых отдаёт сервер. */
export type ApiLimitType = 'pin' | 'folders' | 'favedStickers' | 'reactions' | 'gifs'

/** Поля `config`, которые читает клиент (`edit_time_limit`, `message_length_max`, …). */
export type MTConfig = Partial<Config.config>

/** Хранилище ключ-значение (`core/store/idbKv.ts`). Инъекцией — ради тестов. */
export interface AppConfigKV {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
}

interface AppConfigDeps {
  rest: RestClient
  kv: AppConfigKV
  /** Подписка текущего пользователя (`rootScope.premium` у tweb, :388). */
  isPremium: () => boolean
  now?: () => number
}

/** Идущий запрос `/help/*` и момент его старта (мс по `now`, от него считается потолок). */
interface Flight<T> {
  promise: Promise<T>
  startedAt: number
}

const CACHE_KEY = 'appConfig'
/** Пауза после отказа сети: в это время запрос не шлётся (расхождение 3). */
const RETRY_PAUSE_MS = 30e3
/** Потолок ожидания ответа `/help/*` (расхождение 3). */
const REQUEST_TIMEOUT_MS = 5e3
/** `86400e3` — `apiManagerMethods.ts:344`. */
const CACHE_TTL_MS = 86400e3

const LIMIT_KEYS: { [type in ApiLimitType]: [keyof MTAppConfig, keyof MTAppConfig] } = {
  pin: ['dialogs_pinned_limit_default', 'dialogs_pinned_limit_premium'],
  folders: ['dialog_filters_limit_default', 'dialog_filters_limit_premium'],
  favedStickers: ['stickers_faved_limit_default', 'stickers_faved_limit_premium'],
  reactions: ['reactions_user_max_default', 'reactions_user_max_premium'],
  gifs: ['saved_gifs_limit_default', 'saved_gifs_limit_premium'],
}

/** Порт `TLDeserialization.formatJSONValue` (`tl_utils.ts:791-806`): `JSONValue` → обычное значение. */
export function formatJSONValue(jsonValue: JSONValue): unknown {
  if (!jsonValue._) return jsonValue
  switch (jsonValue._) {
    case 'jsonNull':
      return null
    case 'jsonObject': {
      const out: Record<string, unknown> = {}
      const objectValues = jsonValue.value
      for (let i = 0, length = objectValues.length; i < length; ++i) {
        const objectValue = objectValues[i]
        out[objectValue.key] = formatJSONValue(objectValue.value)
      }
      return out
    }
    default:
      return jsonValue.value
  }
}

export function newAppConfigManager({ rest, kv, isPremium, now = Date.now }: AppConfigDeps) {
  let appConfig: MTAppConfig | undefined
  // Копия с диска прочитана один раз за жизнь воркера (`appStateManager` tweb
  // отдаёт её на старте); читается лениво, чтобы `new` ничего не ждал.
  let loaded: Promise<void> | undefined
  /** `requestedAppConfig` (:342): после первого ответа в этой жизни воркера возраст копии не смотрим. */
  let requestedAppConfig = false
  let appConfigFlight: Flight<MTAppConfig> | undefined
  /** Раньше этого момента после отказа запрос не повторяется. */
  let retryAt = 0

  /**
   * Потолок ожидания ВЫЗЫВАЮЩЕГО: медленный `fetch` не держит меню и реакцию, но сам запрос
   * не бросается — он дорабатывает в фоне и при позднем успехе кладёт конфиг в память и в KV
   * (на сети с RTT дольше потолка конфиг иначе не приехал бы никогда). Поток `flight` сам
   * не отклоняется: отказы разобраны внутри `request*`.
   */
  function raceTimeout<T>({ promise: flight, startedAt }: Flight<T>, fallback: () => T): Promise<T> {
    return new Promise<T>((resolve) => {
      // Ждём только остаток потолка от НАЧАЛА полёта: когда он истёк, все следующие
      // вызывающие получают копию сразу, а не по 5 с на каждый клик. Сверху — сам потолок:
      // `now` — стенные часы, и перевод их назад не должен растянуть ожидание.
      const left = Math.min(REQUEST_TIMEOUT_MS, startedAt + REQUEST_TIMEOUT_MS - now())
      if (left <= 0) { resolve(fallback()); return }
      const timer = setTimeout(() => resolve(fallback()), left)
      flight.then(
        (value) => { clearTimeout(timer); resolve(value) },
        () => { clearTimeout(timer); resolve(fallback()) },
      )
    })
  }

  /**
   * Порт `invokeApiSingleProcess` (`apiManagerMethods.ts:170-222`): без `overwrite` вызов
   * делит идущий запрос; с `overwrite` всегда шлётся новый, и он становится текущим. Если
   * старый запрос завершился, пока текущим остаётся другой, его ответ (или отказ) не
   * обрабатывается, а его вызывающие получают ответ нового (`getNewPromise`, :189-199). Если
   * слот к этому моменту уже освобождён (новый ответил раньше), ответ старого обрабатывается,
   * как у tweb, и заменяет конфиг. Слот освобождает только текущий запрос (:210-216).
   */
  function singleProcess<R, T>(
    slot: { get: () => Flight<T> | undefined, set: (flight: Flight<T> | undefined) => void },
    overwrite: boolean | undefined,
    invoke: () => Promise<R>,
    processResult: (result: R) => T,
    processError: () => T,
  ): Flight<T> {
    const old = slot.get()
    if (old && !overwrite) return old
    const flight = { startedAt: now() } as Flight<T>
    const newer = () => {
      const current = slot.get()
      return current === flight ? undefined : current?.promise
    }
    flight.promise = invoke()
      .then((result) => newer() ?? processResult(result), () => newer() ?? processError())
      .finally(() => { if (slot.get() === flight) slot.set(undefined) })
    slot.set(flight)
    return flight
  }

  const appConfigSlot = { get: () => appConfigFlight, set: (f: Flight<MTAppConfig> | undefined) => { appConfigFlight = f } }

  let config: MTConfig | undefined
  let configFlight: Flight<MTConfig> | undefined
  const configSlot = { get: () => configFlight, set: (f: Flight<MTConfig> | undefined) => { configFlight = f } }
  let configRetryAt = 0

  function hydrate(): Promise<void> {
    return loaded ??= (async() => {
      try {
        appConfig ??= await kv.get<MTAppConfig>(CACHE_KEY)
      } catch {
        // Отказ IndexedDB — «копии нет»: приложение обязано подняться и там, где хранилище недоступно.
      }
    })()
  }

  /** Расхождение 2: просроченная копия лучше пустого ответа; расхождение 3: и пауза. */
  function failAppConfig(): MTAppConfig {
    retryAt = now() + RETRY_PAUSE_MS
    return appConfig ?? {}
  }

  function applyAppConfig(res: HelpAppConfig): MTAppConfig {
    try {
      requestedAppConfig = true
      retryAt = 0
      // `processResult` (:355-359): NotModified оставляет прежний конфиг.
      const fresh = res._ === 'help.appConfig' ? formatJSONValue(res.config) as MTAppConfig : appConfig
      if (!fresh) return {}
      fresh.hash = (res._ === 'help.appConfig' && res.hash) || fresh.hash
      fresh.cachedTime = now()
      appConfig = fresh
      // Запись на диск не ждём: она не на пути ответа (реакция, меню).
      void kv.set(CACHE_KEY, fresh).catch(() => {
        // Несохранённая копия хуже сохранённой, но не повод падать.
      })
      return fresh
    } catch {
      return failAppConfig()
    }
  }

  async function getAppConfig(overwrite?: boolean): Promise<MTAppConfig> {
    await hydrate()
    if (
      appConfig &&
      !overwrite &&
      (requestedAppConfig || (now() - (appConfig.cachedTime || 0)) < CACHE_TTL_MS)
    ) {
      return appConfig
    }
    if (!overwrite && now() < retryAt) return appConfig ?? {}
    const flight = singleProcess(
      appConfigSlot,
      overwrite,
      () => rest.get<HelpAppConfig>('/help/app_config', { hash: appConfig?.hash || 0 }),
      applyAppConfig,
      failAppConfig,
    )
    return raceTimeout(flight, () => appConfig ?? {})
  }

  function getConfig(overwrite?: boolean): Promise<MTConfig> {
    if (config && !overwrite) return Promise.resolve(config)
    if (!overwrite && now() < configRetryAt) return Promise.resolve({})
    const flight = singleProcess(
      configSlot,
      overwrite,
      () => rest.get<Config.config>('/help/config'),
      (res) => {
        config = res
        configRetryAt = 0
        return res
      },
      () => {
        configRetryAt = now() + RETRY_PAUSE_MS
        return {}
      },
    )
    return raceTimeout(flight, () => config ?? {})
  }

  return {
    getAppConfig,
    getConfig,
    /** Порт `getLimit` (:368-394). */
    async getLimit(type: ApiLimitType, premium?: boolean): Promise<number | undefined> {
      const cfg = await getAppConfig()
      const keys = LIMIT_KEYS[type]
      return cfg[keys[(premium ?? isPremium()) ? 1 : 0]] as number | undefined
    },
  }
}

export type AppConfigManager = ReturnType<typeof newAppConfigManager>
