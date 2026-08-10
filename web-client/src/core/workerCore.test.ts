// Задача 2 (worker-importable): поведенческие тесты проводки bind() — замена
// текстового инварианта worker.bindWiring.test.ts (Задача 1 сделала
// createWorkerCore() импортируемой в тестах, вынеся тело worker.ts в фабрику,
// см. workerCore.ts). Раньше bind() нельзя было ВЫЗВАТЬ в тесте — только читать
// исходник текстом; теперь зовём настоящий прод-код (тот же bind(), что worker.ts
// делегирует в start()) через фейковые эндпоинты и проверяем эффект, а не текст.
// Покрыты ВСЕ строки проводки bind(), включая обнаруженную ревью четвёртую
// (registerManagers) — см. CLAUDE.md «Тесты» про критерий приёмки для таких файлов.
//
// fake-indexeddb — ПЕРВАЯ строка модуля: newCursor()/newConnectionManager()
// (вызываются синхронно внутри createWorkerCore()) читают IndexedDB при
// конструировании. Без полифилла гидратация курсора/outbox молча возвращает
// пустоту вместо ошибки — тест позеленел бы по неверной причине.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach } from 'vitest'
import { createWorkerCore } from './workerCore'
import { SuperMessagePort, USE_LOCKS, type Endpoint } from '../rpc/superMessagePort'

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

    // I-3 (ревью worker-importable): гейт ассерта на USE_LOCKS, а не жёсткое
    // ожидание отключения. Рубильник superMessagePort.ts гасит ВЕСЬ
    // handleLockTask, включая пустой id (гейт стоит до ветки `!id` намеренно —
    // см. докблок USE_LOCKS) — при USE_LOCKS=false кадр `lock` игнорируется, порт
    // остаётся висеть (задокументированная деградация «утечка, но безопасная»).
    // Без этого гейта флип константы в false красил бы этот тест и нарушал
    // обещание докблока «правится эта строка, без отката веток» — здесь и был
    // сломан флип (см. REPORT.md, красный прогон при USE_LOCKS=false). Ассерт
    // подстраивается под текущее значение константы вместо того, чтобы требовать
    // от прода держать её true ради зелёного CI.
    expect(core.ports.length).toBe(USE_LOCKS ? 0 : 1)

    core.workerScope.broadcast('rt:resync', { after: 'disconnect' })
    expect(gotA).toEqual(USE_LOCKS ? [] : [{ after: 'disconnect' }])
  })

  // Пятый пункт (добавлен по итогам ревью первого прогона этого файла): проводки в
  // bind() на самом деле ЧЕТЫРЕ строки, не три — регистрация RPC-хендлера 'manager'
  // (registerManagers) осталась незамеченной обоими предыдущими списками (брифом
  // Задачи 2 и текстовым инвариантом, который эта задача заменяет). Без неё ни один
  // из 32 менеджеров не отвечает вкладке — RPC-мост мёртв, но полный прогон тестов
  // молчит: registerManagers юнит-тестируется в managersProxy.test.ts, а что bind()
  // её ЗОВЁТ — нет. persist.stateKey взят как дешёвый метод (пишет в уже
  // полифилленный IndexedDB, без мокания REST/сети).
  it('bind(ep) регистрирует RPC-хендлер «manager» (registerManagers) — invoke с вкладки реально доезжает до менеджера и обратно', async () => {
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)

    await expect(
      tab.invoke('manager', { name: 'persist', method: 'stateKey', args: ['recentSearch', ['x']] }),
    ).resolves.toBeUndefined()
  })
})

// C-1 (ревью worker-importable): start() — единственная строка, которая реально
// монтирует bind() на глобальный скоуп (onconnect в SharedWorker / голый self в
// воркерном фолбэке без SharedWorker). До этого теста она не вызывалась НИГДЕ в
// наборе: worker.ts (не импортируем в тестах) делает `createWorkerCore().start()`
// и всё. Без этой строки ни одна вкладка не подключается — приложение мертво на
// 100%, а полный прогон (177 файлов/1173 теста) этого не замечал (мутация,
// вырезающая if('onconnect' in g){...}else{...} целиком, красит 0 тестов — см.
// REPORT.md). В happy-dom (тестовое окружение, vitest.config.ts) `'onconnect' in
// self` — false (onconnect есть только у SharedWorkerGlobalScope, не у Window),
// поэтому start() идёт веткой `bind(g as unknown as Endpoint)`, где g — self:
// у него есть addEventListener/postMessage, то есть он годится как Endpoint без
// единого мока — ровно то же самое понижение, что и в фолбэке без SharedWorker
// (Chrome for Android), которым worker.ts пользуется в проде.
describe('createWorkerCore().start — проводка bind() к глобальному скоупу (C-1)', () => {
  it('start() монтирует bind() на глобальный объект — единственный путь, которым SharedWorker/воркер реально подключает вкладку', () => {
    const core = createWorkerCore()

    expect(core.ports.length).toBe(0)
    core.start()
    expect(core.ports.length).toBe(1)
  })

  // Второй ассерт по BRIEF.md: start() НЕ идемпотентна — повторный вызов снова
  // проходит ветку bind(g) и удваивает порт на том же глобальном эндпоинте. Это
  // законный текущий результат (worker.ts зовёт start() ровно один раз за жизнь
  // модуля — двойного вызова в проде не бывает), фиксируем как есть, а не чиним.
  it('повторный start() не идемпотентен — второй вызов снова монтирует bind() и удваивает порт (зафиксировано как есть, не идемпотентность — не гарантия)', () => {
    const core = createWorkerCore()

    core.start()
    expect(core.ports.length).toBe(1)
    core.start()
    expect(core.ports.length).toBe(2)
  })
})
