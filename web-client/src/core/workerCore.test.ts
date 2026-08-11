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
// вкладкам (rt:me) — на старте и на каждой RPC-мутации профиля/премиума/входа/
// логаута.
//
// Механизм кольца в happy-dom (найден ревью, воспроизведён и размотан
// полностью — не догадка): `self.postMessage()` здесь приходит эхом на тот же
// `self` (Window). `bind()`-фолбэк (`'onconnect' in self` false в happy-dom)
// вешает `SuperMessagePort` ПРЯМО на `self` — значит `smp.postMessage(x)`
// синхронно триггерит СВОЙ ЖЕ `self.addEventListener('message', …)`, и
// `smp.onAny` принимает это как кадр «от вкладки», зовёт
// `workerScope.receiveFrom(smp, …)`, который ретранслирует «остальным портам»
// (искл. по ИДЕНТИЧНОСТИ объекта `source`, не по эндпоинту). У теста
// «повторный start() не идемпотентен» выше по файлу core получает ДВА разных
// SMP на ОДНОМ физическом `self` — тогда «остальные порты» друг для друга не
// пусты, и ping-pong между ними при любом broadcast идёт экспоненциально,
// пока не набьёт кучу (замерено: один `core.start()` без стаба — 2 события на
// один broadcast; тот же `self`, но `start()` дважды на одном core — 1 048 570
// событий на ОДИН broadcast; этот файл целиком, до фикса — ~196 000 на
// boot+logout). Раз `self` — общий глобал на ВЕСЬ файл, поднятые здесь и там
// core делят его физически: broadcast из НОВОГО core тоже проходит через уже
// «отравленные» слушатели старого. В проде кольца нет: у SharedWorker у
// каждой вкладки свой MessagePort, у фолбэка `self.postMessage` уходит
// родительской странице, а не себе; витрина ре-эмитит принятое строго через
// `dispatchEventSingle` (см. `realtimeBridge.ts`). Фикс — стаб `self` с no-op
// `postMessage`/`addEventListener`: `start()` всё ещё реально монтирует
// bind() (что и проверяют тесты выше), но канал никуда физически не шлёт —
// кольцу неоткуда взяться. Без стаба `local[1]` в тесте ниже был вакуумным:
// мутация (снятие `onMeChanged` у `newAuthManager`) проходила ЗЕЛЁНОЙ, потому
// что `local` разбухал до сотен тысяч фантомных элементов чужих экземпляров
// раньше, чем логаут этого теста успевал дописать свой (см. task-1-report.md,
// раздел про ревью).
describe('createWorkerCore(): `me` — воркер публикует rt:me на старте, при мутации профиля и на логауте (Stage 1C.2, Task 1)', () => {
  // Один core, один self-стаб, одна последовательность вызовов — НЕ ради
  // экономии строк: два НЕЗАВИСИМЫХ self-стаб-цикла (`vi.stubGlobal('self',
  // …)`/`vi.unstubAllGlobals()` в двух разных it()) в этом файле воспроизводимо
  // роняли воркер vitest (OOM/таймаут завершения форка) даже несмотря на то,
  // что КАЖДЫЙ из них по отдельности (`-t` фильтром на один it()) отрабатывал
  // чисто и быстро. Точный механизм второй утечки не размотан (в отличие от
  // кольца выше — то воспроизведено и объяснено полностью); слить оба шага в
  // один self-стаб — рабочий обходной путь, а не маскировка: обе проводки
  // (boot, addPhoto/getMe, logout) по-прежнему реально исполняются и
  // проверяются, просто одним core вместо двух.
  it('boot .then(setMe) публикует rt:me; addPhoto() мерджит поверх РЕАЛЬНОГО кэша (getMe: () => me); logout() публикует rt:me(null)', async () => {
    // Единственный, кто реально монтирует bind() на self (`core.start()`) —
    // стаб обязателен именно и только здесь.
    vi.stubGlobal('self', { addEventListener: () => {}, postMessage: () => {} })
    // Единственный живой fetch в этом файле: addPhoto реально бьёт в REST
    // (`/me/photos`), которого не избежать без правки прод-кода.
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.endsWith('/me/photos')) {
        return new Response(JSON.stringify({ id: 9, url: '/media/9/content', video_url: null, created_at: 'x' }), { status: 200 })
      }
      throw new Error('unexpected fetch ' + u)
    }))
    try {
      const core = createWorkerCore()
      const local: unknown[] = []
      core.workerScope.scope.addEventListener('rt:me', (p) => local.push(p))
      // auth.me() и registry.auth — ОДИН и тот же объект (registry = {..., auth}),
      // подмена метода на нём — то, что реально вызовет boot-цепочка внутри
      // start(). auth.me() отдаёт УЖЕ смапленного User (mapUser внутри
      // authManager) — camelCase, не сырые snake_case-поля с проволоки.
      core.registry.auth.me = async () => ({
        id: 1, phone: '+7', username: null, firstName: '', lastName: '', displayName: 'Д',
        bio: '', birthday: null, avatarUrl: '/old.jpg', phoneVisibility: 'contacts',
        premium: false, emojiStatus: '',
      })

      core.start()
      await vi.waitFor(() => { expect(local.length).toBeGreaterThan(0) })
      expect(local[0]).toMatchObject({ id: 1, avatarUrl: '/old.jpg' })

      // Фикс ревью п.3: `getMe: () => me` (workerCore.ts, deps профиля) раньше
      // не был покрыт НИ тестом, НИ пометкой — мутация `() => null` проходила
      // зелёной (проверено). id/displayName ниже — от кэша воркера (id:1,
      // «Д»), заполненного строкой выше, а не null/пустышки: без
      // `getMe: () => me` (или с `() => null`) addPhoto не опубликовал бы
      // вовсе (см. profileManager.test.ts: «без getMe() — не зовёт
      // onMeChanged») — второго события просто не было бы.
      await core.registry.profile.addPhoto(9)
      expect(local).toHaveLength(2)
      expect(local[1]).toMatchObject({ id: 1, displayName: 'Д', avatarUrl: '/media/9/content' })

      // logout() не ждёт REST в этой ветке (без активной сессии — store.get()
      // пуст) — та же проводка onMeChanged, что боевая, третий независимый вход.
      await core.registry.auth.logout()
      expect(local).toHaveLength(3)
      expect(local[2]).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
