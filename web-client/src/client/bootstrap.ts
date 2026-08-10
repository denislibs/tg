import { SuperMessagePort, USE_LOCKS, type Endpoint } from '../rpc/superMessagePort'
import { createManagers } from '../rpc/managersProxy'
// Единый источник правды по составу и сигнатурам менеджеров — реестр воркера
// (WorkerRegistry). import type стирается при сборке, поэтому рантайм-код воркера
// в UI-бандл не подтягивается. UI-тип выводится из того же объекта, что и
// регистрируется в воркере, — рассинхрон невозможен by construction (как в tweb).
import type { WorkerRegistry } from '../core/worker'

// RPC всегда асинхронный: любой метод менеджера, синхронный он в воркере или нет,
// на UI-стороне возвращает Promise. Оборачиваем каждый метод в Promise<Awaited<…>>,
// чтобы выведенный тип точно отражал поведение границы.
type AsyncManager<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K]
}

export type Managers = { [K in keyof WorkerRegistry]: AsyncManager<WorkerRegistry[K]> }

let cached: { smp: SuperMessagePort; managers: Managers; ep: Endpoint } | null = null

export function startClient(): { smp: SuperMessagePort; managers: Managers; ep: Endpoint } {
  if (cached) return cached
  let ep: Endpoint
  if (typeof SharedWorker !== 'undefined') {
    // The `new URL(...)` must be inline in the constructor call so Vite
    // recognizes and bundles the worker into its own chunk.
    const w = new SharedWorker(new URL('../core/worker.ts', import.meta.url), { type: 'module' })
    ep = w.port
  } else {
    ep = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' }) as unknown as Endpoint
  }
  const smp = new SuperMessagePort(ep)
  attachLock(smp)
  const managers = createManagers<Managers>(smp)
  cached = { smp, managers, ep }
  return cached
}

/**
 * Web Locks (порт tweb superMessagePort.ts:220-236) — вкладка сигнализирует
 * воркеру, что она жива, держа лок со случайным id: пока лок удерживается,
 * воркерный navigator.locks.request(id, cb) (см. handleLockTask в
 * superMessagePort.ts) не срабатывает. Промис колбэка НИКОГДА не резолвится
 * сам — лок держится до тех пор, пока жив browsing context вкладки; браузер
 * освобождает его автоматически при закрытии/навигации, будильник воркера
 * дёргается только тогда и порт снимается с ports[] (Задача 2, workerCore.ts:bind).
 * Фолбэк без Web Locks API — beforeunload шлёт кадр `lock` с пустым id,
 * приёмник трактует его как немедленное отключение (см. комментарий в
 * handleLockTask). Отсутствие ОБОИХ (нет ни locks, ни window) не роняет
 * вкладку — просто порт останется в ports[] воркера до его перезапуска, как и
 * было до Задачи 2.
 *
 * Ревью (Б-1): sendLock(id) шлётся ТОЛЬКО изнутри колбэка гранта — 1:1 с tweb
 * (:226-229, resendLockTask вызывается там же). Если слать кадр ДО гранта, а
 * request() затем отклонится или лок достанется не этой вкладке (opaque
 * origin/sandboxed iframe → SecurityError, отказ в storage-доступе), воркер
 * получит лок ПЕРВЫМ и его колбэк сработает немедленно на ЖИВОЙ вкладке —
 * disconnectPort() снимет порт, invoke зависнут без дефолтного таймаута,
 * реконнекта нет. Экспортирован ради теста (bootstrap.lock.test.ts) — без
 * экспорта мутация тела/вызова этой функции не ловится НИ ОДНИМ тестом
 * (обнаружено ревью, Б-3).
 */
export function attachLock(smp: SuperMessagePort): void {
  // Аварийный рубильник (порт tweb USE_LOCKS, superMessagePort.ts:91): выключен —
  // вкладка не берёт лок и не шлёт кадр `lock` ни в основной ветке, ни в
  // beforeunload-фолбэке. Обоснование и цена деградации — у самой константы.
  if (!USE_LOCKS) return
  // Проверяем ЗНАЧЕНИЕ navigator.locks, не `'locks' in navigator` — happy-dom
  // (bootstrap.lock.test.ts) объявляет его геттером-заглушкой, который ЕСТЬ
  // (`in` даёт true), но возвращает null; truthy-проверка покрывает и это, и
  // реальные браузеры без Web Locks (свойства там нет вовсе).
  if (typeof navigator !== 'undefined' && navigator.locks) {
    const id = `smp-${Math.random().toString(36).slice(2)}`
    navigator.locks.request(id, () => {
      // Грант получен — вкладка реально держит лок. Только теперь безопасно
      // сообщить id воркеру.
      smp.sendLock(id)
      return new Promise<void>(() => {
        // Никогда не резолвится намеренно — лок живёт, пока жива вкладка.
      })
    }).catch((e: unknown) => {
      // request() может отклониться, не выдав лок вообще (SecurityError и
      // т.п.) — тогда кадр lock просто не уходит, порт останется в ports[]
      // воркера до его перезапуска (деградация к поведению «до Задачи 2»,
      // не отказ живой вкладке). Не глотать молча — хотя бы в консоль.
      console.warn('[bootstrap] navigator.locks.request отклонён — Web Lock не взят, порт не будет автоматически снят при закрытии вкладки', e)
    })
  } else if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => { smp.sendLock('') })
  }
}
