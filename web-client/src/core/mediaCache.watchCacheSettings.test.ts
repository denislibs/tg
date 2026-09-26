/**
 * `watchCacheSettings` (`core/mediaCache.ts`) — побочка настроек `cacheTTL`/
 * `cacheSize` у самой настройки, а не в обработчике экрана (итог пилота плана
 * 2D, образец — `client/pushSetup.ts::watchPushConditions`). Вкладка «Данные и
 * память» пишет квоту на своём `destroy` через `setAppSettings`, SW узнаёт о
 * ней отсюда — кто бы настройку ни поменял.
 *
 * Граница — SW (`navigator.serviceWorker.ready` → `postMessage`), её и стабим.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULTS, useSettingsStore } from '@/settings'
import { watchCacheSettings } from './mediaCache'

let postMessage: ReturnType<typeof vi.fn>
let stop: (() => void) | undefined

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  postMessage = vi.fn()
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    serviceWorker: { ready: Promise.resolve({ active: { postMessage } }) },
  }))
  useSettingsStore.getState().update({ cacheTTL: DEFAULTS.cacheTTL, cacheSize: DEFAULTS.cacheSize, notifyVolume: DEFAULTS.notifyVolume })
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.unstubAllGlobals()
})

describe('watchCacheSettings', () => {
  it('на заводе отдаёт SW текущие cacheTTL/cacheSize', async() => {
    stop = watchCacheSettings()
    await flush()

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith({ type: 'cache-settings', cacheTTL: DEFAULTS.cacheTTL, cacheSize: DEFAULTS.cacheSize })
  })

  it('смена cacheTTL или cacheSize — новое сообщение SW; чужой ключ — ничего', async() => {
    stop = watchCacheSettings()
    await flush()
    postMessage.mockClear()

    useSettingsStore.getState().update({ notifyVolume: 0.2 })
    await flush()
    expect(postMessage).not.toHaveBeenCalled()

    useSettingsStore.getState().update({ cacheTTL: 86400 })
    await flush()
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'cache-settings', cacheTTL: 86400, cacheSize: DEFAULTS.cacheSize })

    useSettingsStore.getState().update({ cacheSize: 100 * 1024 * 1024 })
    await flush()
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'cache-settings', cacheTTL: 86400, cacheSize: 100 * 1024 * 1024 })
    expect(postMessage).toHaveBeenCalledTimes(2)
  })

  it('после отписки смена настройки SW не трогает', async() => {
    watchCacheSettings()()
    await flush()
    postMessage.mockClear()

    useSettingsStore.getState().update({ cacheTTL: 86400 * 2 })
    await flush()

    expect(postMessage).not.toHaveBeenCalled()
  })
})
