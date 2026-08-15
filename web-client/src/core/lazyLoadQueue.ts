// lazyLoadQueue — порт роли tweb `components/lazyLoadQueueBase.ts`: одна
// очередь на экран, из которой одновременно исполняется не больше
// `parallelLimit` задач; упавшая задача не блокирует запуск следующей
// (`_processQueue` там же продолжает выборку, что бы ни случилось с
// предыдущей — `LazyLoadQueueBase.processItem` гасит ошибку в try/catch и
// зовёт `processQueue()` в любом случае). Использует экран стикеров
// (`StickersSearchTab`) для ОБОИХ уровней ленивости — запроса состава набора
// (`setBySlug`) и загрузки самих превью (внутри `StickerMedia`), кладя их в
// одну и ту же очередь: лимит общий на экран, а не свой у каждого уровня —
// как в tweb, где `Stickers` заводит один `new LazyLoadQueue()` и отдаёт его
// каждому `wrapSticker` (`sidebarRight/tabs/stickers.tsx:25,77`).
//
// PARALLEL_LIMIT = 8 — константа из tweb (`lazyLoadQueueBase.ts:6`), не
// подобрана заново.
const PARALLEL_LIMIT = 8

export interface LazyLoadQueue {
  /** поставить задачу в очередь; резолвится/реджектится тем же исходом, что и сама задача */
  push<T>(task: () => Promise<T>): Promise<T>
  /**
   * снять невыполненные задачи (tweb `clear()` — `this.queue.length = 0`).
   * Уже исполняющиеся задачи не отменяются — доигрывают сами по себе (см.
   * докблок в вызывающем коде StickersSearchTab: у fetch/промиса нет
   * AbortController, отмена «на лету» не порт tweb-семантики этого метода).
   */
  clear(): void
}

interface QueueItem {
  run: () => void
}

export function createLazyLoadQueue(parallelLimit = PARALLEL_LIMIT): LazyLoadQueue {
  const queue: QueueItem[] = []
  let inProcess = 0

  // Аналог tweb `_processQueue`: выбирает следующую задачу, пока есть место
  // и очередь не пуста. Вызывается и при постановке новой задачи, и по
  // завершении (успешному или нет) исполняющейся — иначе освободившееся
  // место осталось бы простаивать.
  const processNext = () => {
    while (inProcess < parallelLimit) {
      const item = queue.shift()
      if (!item) return
      inProcess++
      item.run()
    }
  }

  const push = <T>(task: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      queue.push({
        run: () => {
          task().then(resolve, reject).finally(() => {
            inProcess--
            processNext()
          })
        },
      })
      processNext()
    })
  }

  const clear = () => {
    queue.length = 0
  }

  return { push, clear }
}
