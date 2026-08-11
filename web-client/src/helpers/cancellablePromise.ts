// Порт tweb `helpers/cancellablePromise.ts` — 1:1 по логике; правки только под
// формат `.oxlintrc.json` этого репозитория и под `strictNullChecks` (у нас
// включён, в tweb выключен — см. TWEB/tsconfig.json):
//   • без `;` (чинится `oxlint --fix`);
//   • `any` → `unknown`/`unknown[]` в сигнатурах callback-аргументов
//     (`typescript/no-explicit-any`; значения только форвардятся дальше, не
//     анализируются по типу — сужение безопасно);
//   • `void` перед РЕАЛЬНО fire-and-forget промисом в `bindPromiseToDeferred`
//     (`typescript/no-floating-promises`). `Object.assign(deferred,
//     deferredHelper)` в `deferredPromise()` — НЕ промис по смыслу (обычный
//     merge объекта), `void` там раньше стоял ошибочно и убран по ревью:
//     линтер путает его с промисом только потому, что `deferred:
//     CancellablePromise<T>` структурно расширяет `Promise<T>`, и
//     `no-floating-promises` от этого даёт предупреждение (не ошибку) —
//     принято как есть, не маскируется;
//   • `resolve = _resolve, reject = _reject` (comma-expression statement)
//     разбит на два присваивания (`eslint/no-unused-expressions`);
//   • `!` на `_resolve`/`_reject`/`onFinish` внутри `deferredHelper` и на
//     `resolve`/`reject`/`deferred.resolve`/`deferred.reject` снаружи —
//     все они опциональны по типу (мержатся в рантайме через `Object.assign`
//     до первого вызова), но не по сужению TS;
//   • `let resolve!, reject!` (definite assignment assertion) — оба
//     присваиваются синхронно внутри `new Promise(executor)`, но TS не умеет
//     доказать, что исполнитель `Promise` вызывается синхронно;
//   • `notify`/`notifyAll`/`lastNotify` в интерфейсе получили `| null` —
//     `onFinish()` намеренно обнуляет их для GC, а `null` не входит в
//     `T | undefined`.
// Два `any` оставлены как в оригинале — `CancellablePromise<any>` на
// приведении общего `deferredHelper` (общий на все инстансы объект должен
// мержиться в `CancellablePromise<T>` для любого T через `Object.assign`,
// `unknown` этого не пропустит) и `self as any` на debug-mount в глобальный
// объект.
//
// В брифе Задачи 2 назван зависимостью `hooks/useHeavyAnimationCheck.ts` —
// но та функциональность уже портирована раньше в `@core/dom/heavyAnimation`
// (см. правку в шапке `helpers/fastSmoothScroll.ts`), с собственным локальным
// `deferredPromise` без этого файла. Довезён здесь как реальная зависимость
// `@helpers/animation` (`animateSingle`/`cancelAnimationByKey` — там
// `CancellablePromise`/`deferredPromise` используются по-настоящему).
import noop from '@helpers/noop'

export interface CancellablePromise<T> extends Promise<T> {
  resolve?: (value: T) => void,
  reject?: (...args: unknown[]) => void,
  cancel?: (reason?: unknown) => void,

  notify?: ((...args: unknown[]) => void) | null,
  notifyAll?: ((...args: unknown[]) => void) | null,
  lastNotify?: unknown[] | null,
  listeners?: Array<(...args: unknown[]) => void>,
  addNotifyListener?: (callback: (...args: unknown[]) => void) => void,

  isFulfilled?: boolean,
  isRejected?: boolean,

  onFinish?: () => void,
  _resolve?: (value: T) => void,
  _reject?: (...args: unknown[]) => void
}

const deferredHelper = {
  isFulfilled: false,
  isRejected: false,

  notify: () => {},
  notifyAll: function(...args: unknown[]) {
    this.lastNotify = args
    this.listeners?.forEach((callback: (...args: unknown[]) => void) => callback(...args))
  },

  addNotifyListener: function(callback: (...args: unknown[]) => void) {
    if(this.lastNotify) {
      callback(...this.lastNotify)
    }

    (this.listeners ??= []).push(callback)
  },

  resolve: function(value) {
    if(this.isFulfilled || this.isRejected) return

    this.isFulfilled = true
    this._resolve!(value)
    this.onFinish!()
  },

  reject: function(...args) {
    if(this.isRejected || this.isFulfilled) return

    this.isRejected = true
    this._reject!(...args)
    this.onFinish!()
  },

  onFinish: function() {
    this.notify = this.notifyAll = this.lastNotify = null
    if(this.listeners) this.listeners.length = 0

    if(this.cancel) {
      this.cancel = noop
    }
  },
} as CancellablePromise<any>

export default function deferredPromise<T>() {
  let resolve!: (value: T) => void, reject!: (...args: unknown[]) => void
  const deferred: CancellablePromise<T> = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  Object.assign(deferred, deferredHelper)
  deferred._resolve = resolve
  deferred._reject = reject

  return deferred
}

export function bindPromiseToDeferred<T>(promise: Promise<T>, deferred: CancellablePromise<T>) {
  void promise.then(deferred.resolve!.bind(deferred), deferred.reject!.bind(deferred))
}

(self as any).deferredPromise = deferredPromise
