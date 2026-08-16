// src/helpers/batchProcessor.ts
//
// Порт tweb `BatchProcessor` (`TWEB/src/helpers/sortedList.ts:15-126`). В
// оригинале класс живёт в одном файле с `SortedList` (соседство историческое —
// общего с сортированным списком у него ничего нет), а `SortedList` мы не
// портировали, поэтому здесь отдельный файл под тем же именем класса.
//
// Что это такое. Очередь «единиц работы», каждая из которых может быть промисом.
// `addToQueue` кладёт единицу и возвращает промис ВСЕЙ текущей пачки. Пачка
// стартует не сразу, а через `pause(0)` — макрозадачу: всё, что успело лечь в
// очередь за текущий тик, обрабатывается ОДНИМ вызовом `process(batch)` и в
// порядке добавления. Пока пачка обрабатывается, новые единицы копятся в
// очереди; по её завершении `processQueue` перезапускается на накопленном
// (`if(this.queue.length) return processQueue()`), поэтому `queuePromise`
// разрешается только когда очередь ДЕЙСТВИТЕЛЬНО пуста — на это и опирается
// ждущий код (в ленте — обработчик `history_update`, tweb bubbles.ts:785-787).
//
// `queuePromise` выставляется СИНХРОННО внутри `addToQueue`: подписчик,
// добавивший единицу, может тут же её дождаться, не пропустив старт пачки.
//
// Не портировано: `log` (в tweb — именованный логгер `BATCH-PROCESSOR-N` и
// замеры `performance.now()` на каждую единицу; у нас логгера-подсистемы нет,
// а замеры без него некуда писать). Всё остальное — 1:1, включая `possibleError`
// (ошибка «предмет протух», которую `process` вправе бросить, не считаясь сбоем).
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import middlewarePromise from '@helpers/middlewarePromise'
import pause from '@helpers/schedulers/pause'

/** Функция-«шлагбаум» из `middlewarePromise`: пробрасывает результат промиса и
 *  бросает `possibleError`, если предмет протух за время ожидания. */
export type MiddlewareAwaiter = ReturnType<typeof middlewarePromise>

export class BatchProcessor<Item> {
  private queue: (Item | Promise<Item>)[] = []
  private promise: Promise<void> | undefined
  private middlewareHelper: MiddlewareHelper
  private process: (batch: Item[], m: MiddlewareAwaiter) => Promise<unknown>
  private possibleError: unknown

  constructor(options: {
    process: BatchProcessor<Item>['process']
    possibleError?: unknown
  }) {
    this.process = options.process
    this.possibleError = options.possibleError
    this.middlewareHelper = getMiddleware()
  }

  public get queuePromise(): Promise<void> | undefined {
    return this.promise
  }

  /** Порт tweb `clear`: очередь и её промис забываются, всё летящее протухает
   *  (`middlewareHelper.clean()`) — то есть уже стартовавшая пачка не допишет
   *  ничего в новое поколение ленты. */
  public clear() {
    this.queue.length = 0
    this.promise = undefined
    this.middlewareHelper.clean()
  }

  public addToQueue(item: Item | Promise<Item>): Promise<void> {
    this.queue.push(item)
    return this.setQueue()
  }

  private setQueue(): Promise<void> {
    if (!this.queue.length) {
      return Promise.resolve()
    }

    if (this.promise) {
      return this.promise
    }

    const middleware = this.middlewareHelper.get()
    const m = middlewarePromise(middleware, this.possibleError)

    const processQueue = async (): Promise<void> => {
      const queue = this.queue.splice(0, this.queue.length)

      const renderedQueue = await m(Promise.all(queue))
      await m(this.process(renderedQueue, m))

      if (this.queue.length) {
        return processQueue()
      }
    }

    const promise = this.promise = m(pause(0))
      .then(
        () => processQueue(),
        (err: unknown) => { throw err },
      )
      .finally(() => {
        if (this.promise === promise) {
          this.promise = undefined
        }
      })

    return promise
  }
}

export default BatchProcessor
