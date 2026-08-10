// Задача 2 (worker-importable): поведенческие тесты проводки bind() — замена
// текстового инварианта worker.bindWiring.test.ts (Задача 1 сделала
// createWorkerCore() импортируемой в тестах, вынеся тело worker.ts в фабрику,
// см. workerCore.ts). Раньше bind() нельзя было ВЫЗВАТЬ в тесте — только читать
// исходник текстом; теперь зовём настоящий прод-код (тот же bind(), что worker.ts
// делегирует в start()) через фейковые эндпоинты и проверяем эффект, а не текст.
//
// fake-indexeddb — ПЕРВАЯ строка модуля: newCursor()/newConnectionManager()
// (вызываются синхронно внутри createWorkerCore()) читают IndexedDB при
// конструировании. Без полифилла гидратация курсора/outbox молча возвращает
// пустоту вместо ошибки — тест позеленел бы по неверной причине.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach } from 'vitest'
import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

// createWorkerCore() держит модульные синглтоны (persist.ts: dbPromise/lockedCache;
// secret/keyStore, AppConfig) — несколько инстансов фабрики в одном процессе делят
// это состояние. cursor/connectionManager читают IDB через idbGet/idbSet (новое
// соединение на каждый вызов, без кеша), поэтому свежая IDBFactory на каждый тест
// даёт им пустое хранилище и не даёт состоянию одного кейса протечь в другой.
beforeEach(() => { indexedDB = new IDBFactory() })

// Пара связанных эндпоинтов с синхронной доставкой (порт superMessagePort.test.ts:
// pair()) — один конец играет роль воркерной стороны порта (передаётся в bind()),
// другой — вкладки (на нём поднимается SuperMessagePort теста). addEventListener
// копит СПИСОК слушателей (не один), т.к. bind() при DNP-ON вешает второй слушатель
// 'message' поверх того, что уже повесил конструктор SuperMessagePort.
function pair(): [Endpoint, Endpoint] {
  // listenersA/B — слушатели, зарегистрированные НА этом конце (срабатывают,
  // когда postMessage зовут на ДРУГОМ конце).
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

describe('createWorkerCore().bind — проводка портов (замена worker.bindWiring.test.ts)', () => {
  it('bind(ep) добавляет порт в ports', () => {
    const core = createWorkerCore()
    const [workerEp] = pair()

    expect(core.ports.length).toBe(0)
    core.bind(workerEp)
    expect(core.ports.length).toBe(1)
  })

  it('событие, отправленное воркером (workerScope.broadcast), доезжает до всех подключённых портов', () => {
    const core = createWorkerCore()
    const [epWorkerA, epTabA] = pair()
    const [epWorkerB, epTabB] = pair()
    core.bind(epWorkerA)
    core.bind(epWorkerB)
    const tabA = new SuperMessagePort(epTabA)
    const tabB = new SuperMessagePort(epTabB)
    const gotA: unknown[] = []
    const gotB: unknown[] = []
    tabA.on('rt:resync', (p) => gotA.push(p))
    tabB.on('rt:resync', (p) => gotB.push(p))

    core.workerScope.broadcast('rt:resync', { hello: 1 })

    expect(gotA).toEqual([{ hello: 1 }])
    expect(gotB).toEqual([{ hello: 1 }])
  })

  it('кадр от вкладки A применяется локально (workerScope) и ретранслируется вкладке B, но не A', () => {
    const core = createWorkerCore()
    const [epWorkerA, epTabA] = pair()
    const [epWorkerB, epTabB] = pair()
    core.bind(epWorkerA)
    core.bind(epWorkerB)
    const tabA = new SuperMessagePort(epTabA)
    const tabB = new SuperMessagePort(epTabB)

    const local: unknown[] = []
    core.workerScope.scope.addEventListener('rt:resync', (p) => local.push(p))
    const gotA: unknown[] = []
    const gotB: unknown[] = []
    tabA.on('rt:resync', (p) => gotA.push(p))
    tabB.on('rt:resync', (p) => gotB.push(p))

    tabA.emit('rt:resync', { fromTab: 'A' })

    expect(local).toEqual([{ fromTab: 'A' }])
    expect(gotB).toEqual([{ fromTab: 'A' }])
    expect(gotA).toEqual([]) // источнику кадр не возвращается — иначе кольцо
  })

  it('отключение порта (лок вкладки освобождён) снимает его из ports[], и последующие broadcast в него не летят', () => {
    const core = createWorkerCore()
    const [epWorkerA, epTabA] = pair()
    core.bind(epWorkerA)
    expect(core.ports.length).toBe(1)

    const tabA = new SuperMessagePort(epTabA)
    const gotA: unknown[] = []
    tabA.on('rt:resync', (p) => gotA.push(p))

    // Пустой id лока — сигнал вкладки «ухожу» (фолбэк beforeunload, см.
    // handleLockTask в superMessagePort.ts) — тот же кадр, что шлёт bootstrap.ts.
    tabA.sendLock('')

    expect(core.ports.length).toBe(0)

    core.workerScope.broadcast('rt:resync', { after: 'disconnect' })
    expect(gotA).toEqual([])
  })
})
