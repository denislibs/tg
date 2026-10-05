// Проводка автоблокировки в `bind()` (tweb `index.worker.ts:335-337`, `:387-404`,
// `:424-428`): вкладка шлёт своё состояние простоя (`tabState`) и «непрерываемые»
// занятия, настройки — задачей канала код-пароля; когда простаивают ВСЕ вкладки
// дольше срока, воркер рассылает перезагрузку (`RELOAD_CHANNEL`) и завершается.
// Логику таймера пинит `lib/mainWorker/useAutoLock.test.ts`, здесь — что каналы
// дошли до неё через настоящий `bind()`.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { RELOAD_CHANNEL } from './passcode/protocol'

function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

const reloads: string[] = []
class FakeBroadcastChannel {
  constructor(public name: string) {}
  postMessage(message: string) { if (this.name === RELOAD_CHANNEL) reloads.push(message) }
  close() {}
}

let close: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  reloads.length = 0
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  close = vi.fn<() => void>()
  ;(self as unknown as { close: () => void }).close = close
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function setup() {
  const core = createWorkerCore()
  const tabs = [0, 1].map(() => {
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    return new SuperMessagePort(epTab)
  })
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  // разблокировка: ключ пришёл — воркер больше не заперт
  await tabs[0].invoke('passcode', { method: 'saveEncryptionKey', payload: key })
  await tabs[0].invoke('passcode', { method: 'setAutoLockSettings', payload: { enabled: true, autoLockTimeoutMins: 1 } })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  return tabs
}

describe('автоблокировка в bind() (tweb index.worker.ts:387-404)', () => {
  it('простаивает одна вкладка из двух — нет; обе — перезагрузка вкладок и завершение воркера', async () => {
    const [a, b] = await setup()
    await a.invoke('tabState', { idleStartTime: 1 })
    await b.invoke('tabState', { idleStartTime: 0 })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(reloads).toEqual([])
    expect(close).not.toHaveBeenCalled()

    await b.invoke('tabState', { idleStartTime: 2 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reloads).toEqual(['reload'])
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('«непрерываемое» занятие вкладки (видео) держит приложение открытым', async () => {
    const [a, b] = await setup()
    await a.invoke('toggleUninteruptableActivity', { activity: 'UsingVideoPlayer', active: true })
    await a.invoke('tabState', { idleStartTime: 1 })
    await b.invoke('tabState', { idleStartTime: 1 })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(reloads).toEqual([])

    await a.invoke('toggleUninteruptableActivity', { activity: 'UsingVideoPlayer', active: false })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reloads).toEqual(['reload'])
  })
})
