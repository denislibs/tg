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
import { describe, expect, it, beforeEach, vi } from 'vitest'
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
    // остаётся висеть. До этого гейта флип константы в false красил именно этот
    // ассерт (`ports.length` ожидался 0, реально оставался 1) и нарушал обещание
    // докблока «правится эта строка, без отката веток». Ассерт подстраивается под
    // текущее значение константы вместо того, чтобы требовать от прода держать её
    // true ради зелёного CI — и это не просто «не мешает» флипу: при
    // USE_LOCKS=false он утверждает, что порт остаётся и broadcast до него всё
    // ещё доезжает, то есть деградация «утечка, но безопасная» из докблока
    // константы становится проверяемым фактом, а не декларацией.
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
// монтирует bind() на глобальный скоуп: SharedWorker.onconnect (прод-путь всех
// десктопных браузеров) либо голый self в фолбэке без SharedWorker (Chrome for
// Android). До первого теста в этом файле start() не вызывалась НИГДЕ в наборе:
// worker.ts (не импортируем в тестах) делает `createWorkerCore().start()` и
// всё. Без этой строки ни одна вкладка не подключается — приложение мертво на
// 100%, а полный прогон (177 файлов/1173 теста) этого не замечал: мутация,
// вырезающая if('onconnect' in g){...}else{...} целиком, красила 0 тестов
// (воспроизведено и подтверждено красным выводом при добавлении теста ниже —
// вывод приведён в описании PR).
//
// Ветку else (фолбэк без SharedWorker) покрывают два теста сразу под этим
// комментарием: в happy-dom (тестовое окружение, vitest.config.ts) `'onconnect'
// in self` — false (onconnect есть только у SharedWorkerGlobalScope, не у
// Window), поэтому `core.start()` без единого стаба идёт именно веткой
// `bind(g as unknown as Endpoint)`, где g — self (есть addEventListener/
// postMessage, годится как Endpoint). Ветку if (SharedWorker.onconnect) без
// стаба не достать — happy-dom онеconnect не даёт вовсе; её покрывает
// отдельный тест `start() в SharedWorker-окружении` ниже через
// `vi.stubGlobal('self', ...)`. Обе ветки нужны порознь: старый набор ловил
// только else, а мутации именно в if-ветке (путаница индекса `ports[0]` →
// `ports[1]`, опустошение тела обработчика) полный прогон не замечал —
// найдено повторным ревью.
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

  // Ревью повторного прогона: два теста выше ходят ТОЛЬКО веткой else — в
  // happy-dom `'onconnect' in self` false, эта ветка недостижима без стаба.
  // А `if` — это SharedWorker.onconnect, прод-путь ВСЕХ десктопных браузеров
  // (else — фолбэк-путь только Chrome for Android). Мутации ревьюера, обе
  // зелёные на полном прогоне ДО этого теста: подмена `ports[0]` на `ports[1]`
  // в обработчике onconnect и опустошение тела ветки (`void bind` вместо
  // вызова) — рефактор мог сломать обработчик подключения на всех десктопах,
  // и ни один тест бы этого не заметил.
  it('start() в SharedWorker-окружении (onconnect есть в глобале) реально монтирует обработчик подключения — прод-путь всех десктопных браузеров', () => {
    const core = createWorkerCore()
    const scope: {
      onconnect: ((e: MessageEvent) => void) | null
      addEventListener: (t: string, cb: (e: MessageEvent) => void) => void
      postMessage: () => void
    } = {
      onconnect: null,
      addEventListener: () => {},
      postMessage: () => {},
    }
    vi.stubGlobal('self', scope)

    core.start()

    // Обработчик реально повешен на глобальный onconnect — не просто «start()
    // не упал», а именно эта ветка (`'onconnect' in g` true у стаба) сработала.
    expect(typeof scope.onconnect).toBe('function')

    const [right] = pair()
    // "wrong" — ловушка на путаницу индекса (ports[0] → ports[1] и любую
    // другую): если обработчик подключит НЕ ports[0], конструктор
    // SuperMessagePort бросит на addEventListener раньше, чем тест дойдёт до
    // ассерта ниже, — красный тест на брошенном исключении, а не тихое
    // совпадение по одинаковому количеству портов.
    const wrong = {
      addEventListener: () => { throw new Error('bind() использовал НЕ ports[0] — ловушка мутации индекса onconnect-обработчика') },
      postMessage: () => {},
    } as unknown as Endpoint
    scope.onconnect?.({ ports: [right, wrong] } as unknown as MessageEvent)

    expect(core.ports.length).toBe(1)

    vi.unstubAllGlobals()
  })
})

// Stage 1C.2 (Task 1): `me` — воркер единственный владелец. Раньше здесь жил
// голый meId для внутренних нужд, ниоткуда не выходивший наружу; теперь
// setMe() (см. workerCore.ts) публикует полного пользователя всем подключённым
// вкладкам (rt:me) — на старте и на каждой RPC-мутации профиля/премиума/
// логаута. Слушаем ЛОКАЛЬНО через core.workerScope.scope (тот же приём, что у
// теста «кадр от вкладки A применяется локально…» выше) — без реального
// REST/fetch: полный createWorkerCore() поднимает WS-транспорт и RestClient, и
// живой fetch-стаб на /me поверх него оказался нестабилен в этом окружении
// (воркер vitest падал между тестами — воспроизведено, не догадка); подмена
// auth.me()/безтокенный logout() даёт тот же сигнал о проводке (setMe реально
// вызван с нужным значением) без этого риска.
describe('createWorkerCore(): `me` — воркер публикует rt:me (Stage 1C.2, Task 1)', () => {
  // Один core на оба шага (не по одному на it()): каждый createWorkerCore()
  // поднимает WS-транспорт + несколько IDB-соединений (cursor/outbox/tokens),
  // ничего не закрывая явно — с 8 существующими экземплярами в этом файле
  // десятый-одиннадцатый (по одному на новый it()) сталкивал воркер vitest в
  // таймаут при завершении форка (воспроизведено: 10/10 тестов зелёные, затем
  // «Timeout terminating forks worker» → OOM при попытке добить процесс под
  // давлением памяти). Один общий core для обоих шагов держит прежние 9.
  it('boot .then(setMe) публикует rt:me; logout() публикует rt:me(null) — обе проводки живы', async () => {
    const core = createWorkerCore()
    const local: unknown[] = []
    core.workerScope.scope.addEventListener('rt:me', (p) => local.push(p))
    // auth.me() и registry.auth — ОДИН и тот же объект (registry = {..., auth}),
    // подмена метода на нём — то, что реально вызовет boot-цепочка внутри start().
    core.registry.auth.me = async () => ({ id: 42 } as never)

    core.start()
    await vi.waitFor(() => { expect(local.length).toBeGreaterThan(0) })
    expect(local[0]).toEqual({ id: 42 })

    // logout() не ждёт REST в этой ветке (без активной сессии — store.get()
    // пуст) — та же проводка onMeChanged, что боевая, второй независимый вход.
    await core.registry.auth.logout()
    expect(local[1]).toBeNull()
  })
})

// Проводка `onMeChanged: setMe` у newProfileManager(...)/newPremiumManager(...)
// (workerCore.ts) — СОЗНАТЕЛЬНО без отдельного end-to-end теста здесь: обе
// зовут реальный REST (rest.patch/rest.post), и живой fetch-стаб поверх
// полного createWorkerCore() оказался нестабилен в этом окружении (см. докблок
// выше). Сам факт «менеджер зовёт onMeChanged с правильным пользователем»
// покрыт БЕЗ сети — profileManager.test.ts/premiumManager.test.ts (fake rest +
// spy onMeChanged); сам факт «rt:me из setMe доходит до стора» — cold-start
// тест выше + storeProjection.me.test.ts. Строка вида
// `onMeChanged: setMe` — прямая передача уже покрытой функции, того же вида,
// что непокрытая по этой же причине `getMeId: () => me?.id ?? null` для
// messagesManager чуть выше по файлу (см. её докблок).
