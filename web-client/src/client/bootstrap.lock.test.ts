// Задача 2 (worker-rootscope), правка по ревью (Б-3): superMessagePort.lock.test.ts
// тестировал только ПРИЁМНИК кадра `lock` — реальную вкладочную сторону
// (bootstrap.ts:attachLock) не покрывал НИЧЕМ: ревьюер опустошил тело
// attachLock и убрал сам вызов attachLock(smp) — весь набор тестов (174
// файла / 1158 тестов) остался зелёным. Здесь тестируется РЕАЛЬНЫЙ
// экспортированный attachLock из bootstrap.ts, а не его копия.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { attachLock, startClient } from './bootstrap'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

// Дубль фейкового navigator.locks из superMessagePort.lock.test.ts (маленький
// локальный хелпер — как и pair() там же дублируется по файлам, см. этот же паттерн).
// request() запоминает (id, колбэк гранта) и НЕ зовёт колбэк сам — grant(id)
// это делает вручную, имитируя момент реальной выдачи лока браузером.
type NavigatorWithLocks = Omit<Navigator, 'locks'> & { locks?: LockManager }

function installFakeLocks() {
  const cbs = new Map<string, () => Promise<void> | void>()
  const requestCalls: string[] = []
  const locks = {
    request: ((id: string, cb: () => Promise<void> | void) => {
      requestCalls.push(id)
      cbs.set(id, cb)
      return Promise.resolve()
    }) as unknown as LockManager['request'],
  } as LockManager
  // happy-dom объявляет navigator.locks геттером без сеттера — прямое
  // присваивание падает TypeError'ом, нужен defineProperty.
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true, writable: true })
  return { requestCalls, grant: (id: string) => cbs.get(id)?.() }
}

function uninstallFakeLocks() {
  delete (navigator as NavigatorWithLocks).locks
}

/** SMP с эндпоинтом-заглушкой (postMessage в никуда) — нужен только как
 *  получатель sendLock(); реального воркера на другом конце нет. */
function makeSmp() {
  const ep: Endpoint = { postMessage: () => {}, addEventListener: () => {} }
  const smp = new SuperMessagePort(ep)
  const sendLock = vi.spyOn(smp, 'sendLock').mockImplementation(() => {})
  return { smp, sendLock }
}

afterEach(() => {
  uninstallFakeLocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('bootstrap.attachLock (вкладочная сторона Web Locks)', () => {
  it('вкладка реально берёт Web Lock сразу при подключении порта', () => {
    const fake = installFakeLocks()
    const { smp } = makeSmp()

    attachLock(smp)

    expect(fake.requestCalls).toHaveLength(1)
  })

  it('id, отданный воркеру (sendLock), — тот же, которым взят лок, и уходит ТОЛЬКО после гранта (Б-1)', () => {
    const fake = installFakeLocks()
    const { smp, sendLock } = makeSmp()

    attachLock(smp)
    const [id] = fake.requestCalls
    expect(id).toBeTruthy()
    // Грант ещё не выдан (фейк request() не зовёт колбэк сам) — кадр не
    // должен был уйти ДО гранта, иначе воркер мог бы получить лок первым.
    expect(sendLock).not.toHaveBeenCalled()

    void fake.grant(id)

    expect(sendLock).toHaveBeenCalledTimes(1)
    expect(sendLock).toHaveBeenCalledWith(id)
  })

  it('нет navigator.locks → вешается beforeunload, кадр lock с пустым id уходит только на unload', () => {
    uninstallFakeLocks()
    const addSpy = vi.spyOn(window, 'addEventListener')
    const { smp, sendLock } = makeSmp()

    attachLock(smp)

    expect(sendLock).not.toHaveBeenCalled()
    // Каст первого аргумента к string — window.addEventListener перегружен по
    // ключам WindowEventMap, из-за чего прямое сравнение с литералом 'beforeunload'
    // не тайпчекается (TS2367) на инферированном из mock.calls объединении типов.
    const call = addSpy.mock.calls.find((c) => (c[0] as string) === 'beforeunload')
    expect(call).toBeDefined()
    const handler = call?.[1] as () => void
    handler()

    expect(sendLock).toHaveBeenCalledWith('')
  })

  it('нет ни navigator.locks, ни window → attachLock не роняет вкладку и ничего не шлёт', () => {
    uninstallFakeLocks()
    vi.stubGlobal('window', undefined)
    const { smp, sendLock } = makeSmp()

    expect(() => attachLock(smp)).not.toThrow()
    expect(sendLock).not.toHaveBeenCalled()
  })
})

// Тесты выше зовут attachLock() напрямую — они ловят порчу ЕЁ ТЕЛА, но не
// поймают, если из startClient() уберут САМУ СТРОКУ attachLock(smp) (ровно
// вторая мутация, которой ревьюер пробил старый набор тестов: «убрал сам
// вызов attachLock(smp) — тот же результат»). SharedWorker/Worker в happy-dom
// не определены — стабим Worker минимальной заглушкой (Endpoint-совместимой),
// чтобы startClient() дошёл до реальной проводки, включая вызов attachLock.
describe('bootstrap.startClient — реальная проводка вызывает attachLock', () => {
  it('startClient() действительно берёт Web Lock (не просто существование attachLock где-то в файле)', () => {
    class FakeWorker implements Endpoint {
      postMessage(): void {}
      addEventListener(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    const fake = installFakeLocks()

    startClient()

    expect(fake.requestCalls).toHaveLength(1)
  })
})
