// Задача 2 (worker-rootscope): отключение вкладки через Web Locks, порт tweb
// superMessagePort.ts:220-236 (вкладка берёт лок) + :503-515 (воркер ждёт его
// освобождения). Тестируем реальный SuperMessagePort — не копию: приёмник
// (симулирует workerCore.ts:bind()) реально зовёт setOnPortDisconnect и
// indexOfAndSplice из вендореного helpers/array/indexOfAndSplice, как в
// продакшене, — мутация любого из двух ловится этими тестами (Шаг 6 брифа).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SuperMessagePort, type Endpoint } from './superMessagePort'
import indexOfAndSplice from '../helpers/array/indexOfAndSplice'

// Пара эндпоинтов с синхронной доставкой (как в superMessagePort.test.ts).
// removeEventListener снимает слушатель СВОЕЙ стороны; close() (Б-4 ревью —
// фейк ОБЯЗАН его иметь, иначе disconnectPort()'ный `this.ep.close?.()`
// (самая опасная строка правки) не выполняется НИ В ОДНОМ тесте) закрывает
// канал в ОБЕ стороны — модель реального MessagePort.close(): закрытый порт
// не шлёт и не принимает. Этим мы проверяем сценарий 2 брифа («последующий
// dispatchEvent в него не пишет») по-настоящему на транспортном уровне, а не
// как следствие уже проверенной пустоты ports[] (Б-5 ревью — прежняя версия
// гоняла emit по уже пустому ports[], что тавтологично: цикл с нуля итераций
// ничего не доказывает сверх того, что доказала пустота массива).
function pair(): [Endpoint, Endpoint] {
  let listenerA: ((ev: MessageEvent) => void) | undefined
  let listenerB: ((ev: MessageEvent) => void) | undefined
  let closed = false
  const epA: Endpoint = {
    postMessage: (m) => { if (!closed) listenerB?.({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenerA = l },
    removeEventListener: () => { listenerA = undefined },
    close: () => { closed = true },
  }
  const epB: Endpoint = {
    postMessage: (m) => { if (!closed) listenerA?.({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenerB = l },
    removeEventListener: () => { listenerB = undefined },
    close: () => { closed = true },
  }
  return [epA, epB]
}

// Navigator.locks в lib.dom.d.ts — readonly и обязательный; Omit убирает его перед
// переобъявлением опциональным, иначе `delete` ниже не проходит тайпчек (TS2790).
type NavigatorWithLocks = Omit<Navigator, 'locks'> & { locks?: LockManager }

/** Фейковый navigator.locks: request() запоминает (id, колбэк) и НЕ зовёт колбэк
 *  сам — имитирует «лок занят, вкладка жива». release(id) — ручной триггер
 *  освобождения (то, что в реальном браузере делает сама Locks-подсистема, когда
 *  browsing context вкладки-держателя умирает). happy-dom Web Locks не реализует
 *  (см. бриф Step 5) — подставляем целиком. */
function installFakeLocks() {
  const cbs = new Map<string, () => void>()
  const requestCalls: string[] = []
  const locks = {
    request: ((id: string, cb: () => void) => {
      requestCalls.push(id)
      cbs.set(id, cb)
      return Promise.resolve()
    }) as unknown as LockManager['request'],
  } as LockManager
  // happy-dom объявляет navigator.locks геттером без сеттера (getter-only) —
  // прямое присваивание падает TypeError'ом, нужен defineProperty.
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true, writable: true })
  return { requestCalls, release: (id: string) => cbs.get(id)?.() }
}

function uninstallFakeLocks() {
  delete (navigator as NavigatorWithLocks).locks
}

afterEach(() => { uninstallFakeLocks() })

describe('SuperMessagePort — Web Locks (отключение вкладки)', () => {
  it('вкладка подключилась → воркер запросил лок с тем же id', () => {
    const fake = installFakeLocks()
    const [epTab, epWorker] = pair()
    const tab = new SuperMessagePort(epTab)
    // Воркерный SMP нужен только для приёма кадра lock (регистрирует слушатель в
    // конструкторе) — методы на нём в этом тесте не вызываются.
    new SuperMessagePort(epWorker)

    tab.sendLock('lock-abc')

    expect(fake.requestCalls).toEqual(['lock-abc'])
  })

  it('лок освободился → порт ушёл из ports[], последующий broadcast в него не пишет', () => {
    const fake = installFakeLocks()
    const [epTab, epWorker] = pair()
    const tab = new SuperMessagePort(epTab)
    const worker = new SuperMessagePort(epWorker)
    // Ровно та проводка, что workerCore.ts:bind() вешает на каждый подключённый порт.
    const ports: SuperMessagePort[] = [worker]
    worker.setOnPortDisconnect(() => { indexOfAndSplice(ports, worker) })
    const received: unknown[] = []
    tab.on('tick', (p) => received.push(p))

    tab.sendLock('lock-1')
    fake.release('lock-1')

    expect(ports).toEqual([])
    // Прямой emit НА САМ отключённый порт (не цикл по уже опустевшему ports[] —
    // это было бы тавтологией, см. комментарий у pair() / Б-5 ревью): реальная
    // проверка транспортного уровня — disconnectPort() закрыл epWorker
    // (`this.ep.close?.()`), закрытый канал по фейку не доставляет НИ В ОДНУ
    // сторону, поэтому даже прямой вызов emit на уже отключённом worker не
    // достигает tab-слушателя.
    worker.emit('tick', 1)
    expect(received).toEqual([])
  })

  it('отключение идемпотентно: двойное срабатывание лока не роняет и не чистит лишнего', () => {
    const fake = installFakeLocks()
    const [epTab, epWorker] = pair()
    const tab = new SuperMessagePort(epTab)
    const worker = new SuperMessagePort(epWorker)
    const ports: SuperMessagePort[] = [worker]
    const onDisconnect = vi.fn(() => { indexOfAndSplice(ports, worker) })
    worker.setOnPortDisconnect(onDisconnect)

    tab.sendLock('lock-2')
    fake.release('lock-2')
    fake.release('lock-2') // повторное срабатывание того же колбэка (гонка/дубль)

    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(ports).toEqual([])
  })

  it('нет Web Locks API (или фолбэк beforeunload с пустым id) → немедленное отключение', () => {
    uninstallFakeLocks() // в happy-dom его и так нет — явно на случай порядка тестов
    const [epTab, epWorker] = pair()
    const tab = new SuperMessagePort(epTab)
    const worker = new SuperMessagePort(epWorker)
    const ports: SuperMessagePort[] = [worker]
    worker.setOnPortDisconnect(() => { indexOfAndSplice(ports, worker) })

    // Эквивалент кадра, который bootstrap.ts:attachLock шлёт на beforeunload,
    // когда navigator.locks недоступен.
    tab.sendLock('')

    expect(ports).toEqual([])
  })

  it('непустой id, но у воркера нет navigator.locks → порт НЕ отключается (Б-2: деградация, а не отказ живой вкладке)', () => {
    uninstallFakeLocks() // воркер лишён Web Locks API — но вкладка id всё же прислала
    const [epTab, epWorker] = pair()
    const tab = new SuperMessagePort(epTab)
    const worker = new SuperMessagePort(epWorker)
    const ports: SuperMessagePort[] = [worker]
    const onDisconnect = vi.fn(() => { indexOfAndSplice(ports, worker) })
    worker.setOnPortDisconnect(onDisconnect)

    // Непустой id доказывает, что вкладка ЖИВА (см. attachLock — кадр уходит
    // только из колбэка гранта) — воркер не умеет проверить лок сам, но это
    // НЕ повод рвать живое соединение (в отличие от пустого id — см. тест выше).
    tab.sendLock('lock-7')

    expect(onDisconnect).not.toHaveBeenCalled()
    expect(ports).toEqual([worker])
  })

  it('живая вкладка не отцепляется — лок удерживается, disconnect не срабатывает', () => {
    installFakeLocks()
    const [epTab, epWorker] = pair()
    const tab = new SuperMessagePort(epTab)
    const worker = new SuperMessagePort(epWorker)
    const ports: SuperMessagePort[] = [worker]
    const onDisconnect = vi.fn(() => { indexOfAndSplice(ports, worker) })
    worker.setOnPortDisconnect(onDisconnect)

    tab.sendLock('lock-5')
    // release() НЕ вызываем — вкладка «жива», лок не освобождён.

    expect(onDisconnect).not.toHaveBeenCalled()
    expect(ports).toEqual([worker])
  })

  it('disconnectPort отклоняет зависшие invoke порта (dispose) при отключении', async () => {
    const fake = installFakeLocks()
    const [epTab, epWorker] = pair()
    const tab = new SuperMessagePort(epTab)
    const worker = new SuperMessagePort(epWorker)
    worker.setOnPortDisconnect(() => {})
    // Хэндлер есть, но никогда не резолвится — invoke реально «висит» до
    // disconnectPort'ового dispose(), а не падает синхронно с «no handler».
    tab.handle('never-answered', () => new Promise(() => {}))
    const pending = worker.invoke('never-answered', {})

    tab.sendLock('lock-6')
    fake.release('lock-6')

    await expect(pending).rejects.toThrow(/port disconnected/)
  })
})
