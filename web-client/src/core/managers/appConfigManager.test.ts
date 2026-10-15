// Конфиг приложения (порт tweb `apiManagerMethods.ts:310-394` + `formatJSONValue`,
// `tl_utils.ts:791-806`). Фикстуры различают верное поведение и неверное: два
// разных конфига с разными hash, свежий и просроченный кэш, премиум и не премиум
// с РАЗНЫМИ числами (реакции 1/3), чтобы подмена ключа или ветки краснела.
import { describe, it, expect, vi } from 'vitest'

import type { HelpAppConfig, JSONValue } from '@layer'
import { formatJSONValue, newAppConfigManager, type MTAppConfig } from './appConfigManager'
import { HttpError, type RestClient } from '../net/restClient'

const num = (value: number): JSONValue => ({ _: 'jsonNumber', value })
const bool = (value: boolean): JSONValue => ({ _: 'jsonBool', value })
const obj = (entries: Record<string, JSONValue>): JSONValue.jsonObject => ({
  _: 'jsonObject',
  value: Object.entries(entries).map(([key, value]) => ({ _: 'jsonObjectValue', key, value })),
})

const appConfig = (hash: number, entries: Record<string, JSONValue>): HelpAppConfig =>
  ({ _: 'help.appConfig', hash, config: obj(entries) })
const NOT_MODIFIED: HelpAppConfig = { _: 'help.appConfigNotModified' }

const CFG_A = appConfig(111, {
  dialogs_pinned_limit_default: num(5),
  dialogs_pinned_limit_premium: num(9),
  reactions_user_max_default: num(1),
  reactions_user_max_premium: num(3),
  premium_purchase_blocked: bool(true),
})
const CFG_B = appConfig(222, {
  dialogs_pinned_limit_default: num(7),
  dialogs_pinned_limit_premium: num(9),
})

const DAY = 86400e3
const T0 = 1_700_000_000_000

function kv(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial))
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)) as unknown as <T>(key: string) => Promise<T | undefined>,
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
  }
}

function setup(opts: { responses?: unknown[], kvInitial?: Record<string, unknown>, premium?: boolean } = {}) {
  const queue = [...(opts.responses ?? [])]
  const get = vi.fn(async (_path: string, _query?: Record<string, string | number>) => {
    const next = queue.shift()
    if (next instanceof Error) throw next
    return next
  })
  const clock = { now: T0 }
  const store = kv(opts.kvInitial)
  const mgr = newAppConfigManager({
    rest: { get } as unknown as RestClient,
    kv: store,
    isPremium: () => opts.premium ?? false,
    now: () => clock.now,
  })
  return { mgr, get, store, clock }
}

describe('formatJSONValue (tl_utils.ts:791-806)', () => {
  // Провод TL: декодер tweb-типа JSONValue (`tl_utils.ts:804-806`) уже сворачивает
  // объект, и в менеджер приезжает плоский объект без `_` — он проходит как есть.
  it('уже плоский объект (провод TL) возвращается как есть', () => {
    const flat = { reactions_user_max_default: 1, premium_purchase_blocked: true }
    expect(formatJSONValue(flat as never)).toBe(flat)
  })

  it('jsonObject сворачивается в плоский объект, jsonNull — в null, скаляры — в value', () => {
    expect(formatJSONValue(obj({
      a: num(5),
      b: bool(true),
      c: { _: 'jsonString', value: 'x' },
      d: { _: 'jsonNull' },
      e: obj({ f: num(1) }),
    }))).toEqual({ a: 5, b: true, c: 'x', d: null, e: { f: 1 } })
  })
})

describe('getAppConfig (apiManagerMethods.ts:340-366)', () => {
  it('первый вызов: запрос с hash 0, ответ плоским объектом + hash + cachedTime, запись в кэш', async() => {
    const { mgr, get, store } = setup({ responses: [CFG_A] })

    const config = await mgr.getAppConfig()

    expect(get).toHaveBeenCalledWith('/help/app_config', { hash: 0 })
    expect(config).toMatchObject({ dialogs_pinned_limit_default: 5, premium_purchase_blocked: true, hash: 111, cachedTime: T0 })
    expect(store.store.get('appConfig')).toEqual(config)
  })

  it('второй вызов в течение суток сети не трогает', async() => {
    const { mgr, get, clock } = setup({ responses: [CFG_A, CFG_B] })
    await mgr.getAppConfig()
    clock.now += DAY - 1000

    await expect(mgr.getAppConfig()).resolves.toMatchObject({ hash: 111 })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('кэш из прошлой жизни воркера моложе суток — без сети вовсе', async() => {
    const cached: MTAppConfig = { hash: 111, cachedTime: T0 - DAY / 2, dialogs_pinned_limit_default: 5 }
    const { mgr, get } = setup({ kvInitial: { appConfig: cached } })

    await expect(mgr.getAppConfig()).resolves.toEqual(cached)
    expect(get).not.toHaveBeenCalled()
  })

  it('кэш старше суток: запрос с hash кэша; NotModified оставляет прежний конфиг и освежает cachedTime', async() => {
    const cached: MTAppConfig = { hash: 111, cachedTime: T0 - DAY - 1, dialogs_pinned_limit_default: 5 }
    const { mgr, get, store } = setup({ kvInitial: { appConfig: cached }, responses: [NOT_MODIFIED] })

    const config = await mgr.getAppConfig()

    expect(get).toHaveBeenCalledWith('/help/app_config', { hash: 111 })
    expect(config).toMatchObject({ hash: 111, dialogs_pinned_limit_default: 5, cachedTime: T0 })
    expect((store.store.get('appConfig') as MTAppConfig).cachedTime).toBe(T0)
  })

  it('после запроса в этой жизни воркера повторов нет, даже если кэш «состарился» (requestedAppConfig)', async() => {
    const cached: MTAppConfig = { hash: 111, cachedTime: T0 - DAY - 1 }
    const { mgr, get, clock } = setup({ kvInitial: { appConfig: cached }, responses: [NOT_MODIFIED] })
    await mgr.getAppConfig()
    clock.now += 3 * DAY

    await mgr.getAppConfig()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('новый конфиг заменяет прежний целиком и несёт новый hash', async() => {
    const cached: MTAppConfig = { hash: 111, cachedTime: T0 - DAY - 1, reactions_user_max_default: 1 }
    const { mgr } = setup({ kvInitial: { appConfig: cached }, responses: [CFG_B] })

    const config = await mgr.getAppConfig()

    expect(config.hash).toBe(222)
    expect(config.dialogs_pinned_limit_default).toBe(7)
    expect(config.reactions_user_max_default).toBeUndefined()
  })

  it('overwrite=true идёт в сеть при свежем кэше', async() => {
    const { mgr, get } = setup({ responses: [CFG_A, CFG_B] })
    await mgr.getAppConfig()

    await expect(mgr.getAppConfig(true)).resolves.toMatchObject({ hash: 222 })
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenLastCalledWith('/help/app_config', { hash: 111 })
  })

  it('два одновременных вызова — один запрос', async() => {
    const { mgr, get } = setup({ responses: [CFG_A] })

    const [a, b] = await Promise.all([mgr.getAppConfig(), mgr.getAppConfig()])

    expect(get).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('отказ сети при просроченном кэше — отдаём просроченный, а не падаем', async() => {
    const cached: MTAppConfig = { hash: 111, cachedTime: T0 - DAY - 1, dialogs_pinned_limit_default: 5 }
    const { mgr } = setup({ kvInitial: { appConfig: cached }, responses: [new HttpError(500, 'x')] })

    await expect(mgr.getAppConfig()).resolves.toMatchObject({ hash: 111, dialogs_pinned_limit_default: 5 })
  })

  it('отказ сети без кэша — пустой конфиг (ключи необязательны), и он НЕ кэшируется: после паузы вызов идёт в сеть', async() => {
    const { mgr, get, store, clock } = setup({ responses: [new HttpError(500, 'x'), CFG_A] })

    await expect(mgr.getAppConfig()).resolves.toEqual({})
    expect(store.store.has('appConfig')).toBe(false)

    clock.now += 31e3
    await expect(mgr.getAppConfig()).resolves.toMatchObject({ hash: 111 })
    expect(get).toHaveBeenCalledTimes(2)
  })

  // Каждый клик реакции и правый клик ждут конфиг: после отказа не шлём заведомо
  // падающий запрос на каждый из них, пока не прошла пауза.
  it('после отказа запрос не повторяется до конца паузы, overwrite её обходит', async() => {
    const { mgr, get, clock } = setup({ responses: [new HttpError(500, 'x'), CFG_A] })
    await mgr.getAppConfig()

    clock.now += 10e3
    await expect(mgr.getAppConfig()).resolves.toEqual({})
    expect(get).toHaveBeenCalledTimes(1)

    await expect(mgr.getAppConfig(true)).resolves.toMatchObject({ hash: 111 })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('медленный запрос: вызывающий через 5 с получает {}, а поздний ответ всё равно ложится в кэш', async() => {
    vi.useFakeTimers()
    try {
      const { mgr, get, store } = setup()
      let answer!: (v: unknown) => void
      get.mockImplementation(() => new Promise((resolve) => { answer = resolve }))
      const pending = mgr.getAppConfig()
      await vi.advanceTimersByTimeAsync(5000)
      await expect(pending).resolves.toEqual({})

      // Ответ приехал на 8-й секунде: запрос не бросали.
      answer(CFG_A)
      await vi.advanceTimersByTimeAsync(0)
      await expect(mgr.getAppConfig()).resolves.toMatchObject({ hash: 111 })
      expect(get).toHaveBeenCalledTimes(1)
      expect(store.store.has('appConfig')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('пока медленный запрос в полёте, новые вызовы не плодят запросов', async() => {
    vi.useFakeTimers()
    try {
      const { mgr, get, clock } = setup()
      get.mockImplementation(() => new Promise(() => {}))
      void mgr.getAppConfig()
      void mgr.getConfig()
      await vi.advanceTimersByTimeAsync(0) // полёты стартовали при часах T0
      clock.now += 5000
      await vi.advanceTimersByTimeAsync(5000)
      // Потолок от начала полёта истёк: следующий вызов отвечает сразу, без новых 5 с.
      await expect(mgr.getAppConfig()).resolves.toEqual({})
      await expect(mgr.getConfig()).resolves.toEqual({})
      expect(get).toHaveBeenCalledTimes(2) // по одному на ручку
    } finally {
      vi.useRealTimers()
    }
  })

  it('запись кэша на диск не ждётся: ответ приходит, даже если IndexedDB не отвечает', async() => {
    const { mgr, store } = setup({ responses: [CFG_A] })
    ;(store.set as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))
    await expect(mgr.getAppConfig()).resolves.toMatchObject({ hash: 111 })
  })
})

describe('getLimit (apiManagerMethods.ts:368-394)', () => {
  it('ключ _default / _premium по подписке; isPremium из аргумента главнее состояния', async() => {
    const free = setup({ responses: [CFG_A], premium: false })
    await expect(free.mgr.getLimit('pin')).resolves.toBe(5)
    await expect(free.mgr.getLimit('pin', true)).resolves.toBe(9)

    const prem = setup({ responses: [CFG_A], premium: true })
    await expect(prem.mgr.getLimit('pin')).resolves.toBe(9)
    await expect(prem.mgr.getLimit('pin', false)).resolves.toBe(5)
  })

  it('реакции: 1 без подписки и 3 с подпиской', async() => {
    const { mgr } = setup({ responses: [CFG_A] })
    await expect(mgr.getLimit('reactions', false)).resolves.toBe(1)
    await expect(mgr.getLimit('reactions', true)).resolves.toBe(3)
  })

  it('ключа в конфиге нет — undefined (как у tweb), а не выдуманное число', async() => {
    const { mgr } = setup({ responses: [CFG_B] })
    await expect(mgr.getLimit('reactions', false)).resolves.toBeUndefined()
  })
})

describe('getConfig (apiManagerMethods.ts:310-322)', () => {
  const CONFIG = { _: 'config', edit_time_limit: 172800, message_length_max: 4096, date: 1, expires: 3601 }

  it('один запрос на жизнь воркера; overwrite перечитывает', async() => {
    const { mgr, get } = setup({ responses: [CONFIG, { ...CONFIG, edit_time_limit: 60 }] })

    await expect(mgr.getConfig()).resolves.toMatchObject({ edit_time_limit: 172800 })
    await mgr.getConfig()
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/help/config')

    await expect(mgr.getConfig(true)).resolves.toMatchObject({ edit_time_limit: 60 })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('отказ сети — пустой конфиг, не кэшируется', async() => {
    const { mgr, get, clock } = setup({ responses: [new HttpError(500, 'x'), CONFIG] })

    await expect(mgr.getConfig()).resolves.toEqual({})
    await expect(mgr.getConfig()).resolves.toEqual({}) // пауза после отказа
    expect(get).toHaveBeenCalledTimes(1)
    clock.now += 31e3
    await expect(mgr.getConfig()).resolves.toMatchObject({ edit_time_limit: 172800 })
    expect(get).toHaveBeenCalledTimes(2)
  })
})
