// Подписчик настройки `notifyPush` (порт tweb uiNotificationsManager.ts:320-322:
// `createEffect(on(() => this.settings.push, this.onPushConditionsChange))`).
// Побочка переключателя «Show offline notifications» живёт у настройки, а не в
// обработчике строки экрана: кто бы ни выключил настройку — браузерная
// push-подписка снимается. Граница — только браузерный Push API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../settings'
import { watchPushConditions } from './pushSetup'

vi.mock('./bootstrap', () => ({ startClient: vi.fn() }))

let unsubscribe: ReturnType<typeof vi.fn>
let getSubscription: ReturnType<typeof vi.fn>
let stop: (() => void) | undefined

beforeEach(() => {
  unsubscribe = vi.fn(async() => true)
  getSubscription = vi.fn(async() => ({ unsubscribe }))
  vi.stubGlobal('PushManager', function PushManager() {})
  // `denied` — включение до подписки не доходит (`setupPush` выходит на
  // разрешении), проверяется только снятие
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'denied', requestPermission: vi.fn() }))
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription } }) },
  })
  useSettingsStore.getState().update({ notifyPush: true })
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('watchPushConditions', () => {
  it('выключили notifyPush — подписка снята; чужой ключ — ничего', async() => {
    stop = watchPushConditions()
    await flush()
    expect(unsubscribe).not.toHaveBeenCalled()

    useSettingsStore.getState().update({ notifyPush: false })
    await flush()
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    useSettingsStore.getState().update({ notifySound: false })
    await flush()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('на старте с выключенной настройкой снимает оставшуюся подписку (как on без defer)', async() => {
    useSettingsStore.getState().update({ notifyPush: false })
    stop = watchPushConditions()
    await flush()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('после отписки подписчика переключения не слышны', async() => {
    stop = watchPushConditions()
    stop()
    stop = undefined
    useSettingsStore.getState().update({ notifyPush: false })
    await flush()
    expect(unsubscribe).not.toHaveBeenCalled()
  })
})
