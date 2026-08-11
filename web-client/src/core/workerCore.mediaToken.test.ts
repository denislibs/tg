// Stage 1C.2 (Task 3): стык владельца с зеркалом. Здесь НЕ «проверка через
// витрину» — она видела бы обе стороны одним глазом (урок Задачи 2): ответ
// владельца сравнивается с состоянием зеркала НАПРЯМУЮ, вплоть до готового URL,
// плюс считается число походов в сеть за токеном.
//
// Прогон настоящий: createWorkerCore() (тот же mediaManager, тот же веер
// workerScope, тот же RPC-мост, что в проде), к нему подключены фейковые порты
// вкладок; со стороны вкладки — настоящий core/mediaUrl.ts.
//
// fake-indexeddb — ПЕРВОЙ строкой: newCursor()/newConnectionManager() читают
// IndexedDB прямо в конструкторе createWorkerCore(), а RestClient гейтит
// запросы на tokens.ready() (тоже IDB).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { RT } from './realtime/events'
import type { MediaTokenInfo } from './managers/mediaManager'

// Зеркало тянет startClient() только чтобы СПРОСИТЬ токен; здесь спрашиваем у
// настоящего воркера напрямую (invoke по порту), поэтому бутстрап вкладки не
// нужен — и не должен подниматься на импорте.
vi.mock('../client/bootstrap', () => ({ startClient: () => { throw new Error('startClient в этом тесте не нужен') } }))

let mirror: typeof import('./mediaUrl')
let tokenFetches = 0

// Пара связанных эндпоинтов с синхронной доставкой (порт из workerCore.test.ts).
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

beforeEach(async () => {
  // Свежая IDB на кейс: cursor/connectionManager/tokens ходят в неё через
  // idbGet/idbSet, состояние одного кейса не должно течь в другой.
  vi.stubGlobal('indexedDB', new IDBFactory())
  tokenFetches = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.endsWith('/media/token')) {
      tokenFetches++
      return new Response(JSON.stringify({
        token: `wtok${tokenFetches}`,
        expires_at: new Date(Date.now() + 900_000).toISOString(),
      }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  }))
  // Свежий модуль зеркала на каждый кейс: token/expiresAt живут в нём модульно.
  vi.resetModules()
  mirror = await import('./mediaUrl')
})

afterEach(() => { vi.unstubAllGlobals() })

describe('медиа-токен: владелец — воркер, core/mediaUrl — зеркало (Stage 1C.2, Task 3)', () => {
  // Владелец добыл токен → веер донёс снимок вкладке → зеркало собирает ТОТ ЖЕ
  // URL, что владелец отдал бы своим async-путём. Расходись зеркало с
  // владельцем хоть в одном символе — картинка получила бы 401.
  it('снимок владельца доезжает вкладке, и URL зеркала совпадает с URL владельца', async () => {
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const got: MediaTokenInfo[] = []
    tab.on(RT.mediaToken, (p) => got.push(p as MediaTokenInfo))

    const owner = await core.registry.media.tokenInfo()

    expect(got).toEqual([owner]) // веер донёс ровно то, что владелец отдал звонящему

    mirror.applyMediaToken(got[0])

    expect(mirror.hasMediaToken()).toBe(true)
    expect(mirror.mediaContentUrl(42)).toBe(await core.registry.media.contentUrl(42))
    expect(tokenFetches).toBe(1) // зеркало не добавило ни одного похода в сеть
  })

  // Вторая вкладка подключается к живому воркеру: стартовый бродкаст она
  // пропустила (SuperMessagePort кадры не буферизует). Токен она получает
  // ответом RPC — тем самым, который зовёт primeMediaToken, — из кэша владельца,
  // без похода в сеть, и НЕ ждёт следующего планового обновления.
  it('поздняя вкладка получает текущий токен ответом RPC, а не следующим обновлением', async () => {
    const core = createWorkerCore()
    const [epWorkerA] = pair()
    core.bind(epWorkerA)
    const owner = await core.registry.media.tokenInfo() // токен добыт до её подключения

    const [epWorkerB, epTabB] = pair()
    core.bind(epWorkerB)
    const tabB = new SuperMessagePort(epTabB)
    const gotB: MediaTokenInfo[] = []
    tabB.on(RT.mediaToken, (p) => gotB.push(p as MediaTokenInfo))

    expect(gotB).toEqual([]) // бродкаст был до неё — событий нет

    const late = await tabB.invoke('manager', { name: 'media', method: 'tokenInfo', args: [] }) as MediaTokenInfo
    mirror.applyMediaToken(late)

    expect(late).toEqual(owner)
    expect(mirror.mediaContentUrl(42)).toBe(await core.registry.media.contentUrl(42))
    expect(tokenFetches).toBe(1) // из кэша владельца, сеть не трогали
  })

  // Плановое обновление владельца (его собственный таймер) доезжает вкладке само
  // — без всякого расписания на стороне зеркала. Что ломается иначе: у зеркала
  // таймера больше нет, значит протухший токен никто бы не заменил.
  it('плановое обновление владельца доезжает вкладке, и зеркало снова совпадает с владельцем', async () => {
    // Часы подменяем ДО первого запроса: таймер обновления арминается внутри
    // него, и настоящий setTimeout фейковое время бы не увидел. Подменяем
    // ТОЛЬКО setTimeout/Date: fake-indexeddb (гейт RestClient на tokens.ready)
    // едет на setImmediate — заморозив и его, тест повис бы на первом же запросе.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const core = createWorkerCore()
      const [epWorker, epTab] = pair()
      core.bind(epWorker)
      const tab = new SuperMessagePort(epTab)
      const got: MediaTokenInfo[] = []
      tab.on(RT.mediaToken, (p) => got.push(p as MediaTokenInfo))

      mirror.applyMediaToken(await core.registry.media.tokenInfo())
      expect(mirror.mediaContentUrl(1)).toContain('wtok1')
      expect(got).toHaveLength(1)

      // Дальше — только ход времени: ни вкладка, ни зеркало ничего не запрашивают.
      await vi.advanceTimersByTimeAsync(900_000 - 60_000 + 1_000)

      expect(tokenFetches).toBe(2)
      expect(got).toHaveLength(2)
      mirror.applyMediaToken(got[1])
      expect(mirror.mediaContentUrl(1)).toContain('wtok2')
      expect(mirror.mediaContentUrl(1)).toBe(await core.registry.media.contentUrl(1))
    } finally {
      vi.useRealTimers()
    }
  })
})
