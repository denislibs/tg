// lazyLoadQueue — порт роли tweb `components/lazyLoadQueueBase.ts` +
// приоритезации из `components/lazyLoadQueue.ts` (`onVisibilityChange`/`getItem`):
// одна очередь на экран, из которой одновременно исполняется не больше
// `parallelLimit` задач. Использует экран стикеров (`StickersSearchTab`) для
// ОБОИХ уровней ленивости — запроса состава набора (`setBySlug`) и загрузки
// самих превью (внутри `StickerMedia`), кладя их в одну и ту же очередь: лимит
// общий на экран, а не свой у каждого уровня — как в tweb, где `Stickers`
// заводит один `new LazyLoadQueue()` и отдаёт его каждому `wrapSticker`
// (`sidebarRight/tabs/stickers.tsx:25,77`).
//
// PARALLEL_LIMIT = 8 — константа из tweb (`lazyLoadQueueBase.ts:6`), не
// подобрана заново.
const PARALLEL_LIMIT = 8

export interface LazyLoadQueue {
  /**
   * поставить задачу в очередь; резолвится/реджектится тем же исходом, что и
   * сама задача. `isVisible` — живой геттер («видима ли ЦЕЛЬ задачи ПРЯМО
   * СЕЙЧАС», а не на момент постановки) для приоритезации при выборе — порт
   * tweb `LazyLoadQueue.onVisibilityChange`/`getItem` (`lazyLoadQueue.ts:20-41`):
   * там видимые элементы переставляются в голову очереди при каждой смене
   * видимости, у нас эквивалент проще — выбор перепроверяет `isVisible()`
   * заново на каждый пик, поэтому строка, прокрученная мимо ПОСЛЕ постановки
   * в очередь (но ДО того, как до неё дошла своя очередь), сама уступает место
   * тому, что сейчас перед глазами, без явной команды «переставить». Без
   * `isVisible` задача всегда в приоритете (обычный FIFO) — так ведут себя
   * задачи, у которых нет понятия видимости цели.
   */
  push<T>(task: () => Promise<T>, isVisible?: () => boolean): Promise<T>
  /**
   * снять невыполненные задачи (tweb `clear()` — `this.queue.length = 0`) —
   * КАЖДУЮ явно реджектит (не просто роняет со счетов молча): вызывающий код
   * мемоизирует промис `push()` в кэше (`setStickersCache`/`StickerMedia`'s
   * `cache`), и подвисший НАВСЕГДА промис отравил бы кэш до перезагрузки
   * вкладки — see `StickersSearchTab.tsx` докблок у `queue.clear()`. Реджект
   * будит существующие `.catch(() => cache.delete(...))` у этих кэшей, и
   * следующий запрос того же ключа грузит заново, а не наследует вечно
   * pending промис. Уже исполняющиеся задачи не отменяются — доигрывают сами
   * по себе (у `fetch`/промиса нет `AbortController`, отмена «на лету» не
   * порт tweb-семантики этого метода — `LazyLoadQueueBase.clear()` тоже не
   * трогает `inProcess`).
   */
  clear(): void
}

interface QueueItem {
  isVisible: () => boolean
  run: () => void
  reject: (err: unknown) => void
}

const CLEARED_ERROR_MESSAGE = 'lazyLoadQueue: очередь очищена (clear()), задача снята до старта'

export function createLazyLoadQueue(parallelLimit = PARALLEL_LIMIT): LazyLoadQueue {
  const queue: QueueItem[] = []
  let inProcess = 0

  // Порт tweb `getItem` (`lazyLoadQueue.ts:39-41`): среди ожидающих выбираем
  // ПЕРВУЮ видимую ПРЯМО СЕЙЧАС (порядок среди видимых — FIFO, как и был),
  // а не просто голову очереди. Если видимых нет — берём голову как обычно
  // (не блокируем очередь навсегда out of view элементами).
  const pickNext = (): QueueItem | undefined => {
    if (!queue.length) return undefined
    const visibleIdx = queue.findIndex((item) => item.isVisible())
    const idx = visibleIdx === -1 ? 0 : visibleIdx
    return queue.splice(idx, 1)[0]
  }

  // Аналог tweb `_processQueue`: выбирает следующую задачу, пока есть место
  // и очередь не пуста. Вызывается и при постановке новой задачи, и по
  // завершении (успешному или нет) исполняющейся — иначе освободившееся
  // место осталось бы простаивать.
  const processNext = () => {
    while (inProcess < parallelLimit) {
      const item = pickNext()
      if (!item) return
      inProcess++
      item.run()
    }
  }

  const push = <T>(task: () => Promise<T>, isVisible: () => boolean = () => true): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      queue.push({
        isVisible,
        reject,
        run: () => {
          const settle = () => {
            inProcess--
            processNext()
          }
          let result: Promise<T>
          try {
            // task() зовётся синхронно (порт tweb `processItem`, там это
            // `await item.load()` внутри try/catch — синхронный throw ловится
            // тем же catch, что и отклонённый промис). Без try/catch здесь
            // синхронный throw вылетел бы ИЗ processNext, `inProcess` остался
            // бы навсегда увеличенным на эту задачу, и очередь дальше этого
            // места не продвигалась бы — восьми таких хватит, чтобы насмерть
            // заклинить весь экран.
            result = task()
          } catch (err) {
            reject(err)
            settle()
            return
          }
          result.then(resolve, reject).finally(settle)
        },
      })
      processNext()
    })
  }

  const clear = () => {
    const dropped = queue.splice(0, queue.length)
    for (const item of dropped) item.reject(new Error(CLEARED_ERROR_MESSAGE))
  }

  return { push, clear }
}
