import { describe, expect, it, vi } from 'vitest'
import { createLazyLoadQueue } from './lazyLoadQueue'

describe('createLazyLoadQueue', () => {
  it('держит не больше parallelLimit задач одновременно', async () => {
    const queue = createLazyLoadQueue(2)
    let running = 0
    let peak = 0
    const resolvers: Array<() => void> = []

    const task = () => {
      running++
      peak = Math.max(peak, running)
      return new Promise<void>((resolve) => {
        resolvers.push(() => { running--; resolve() })
      })
    }

    const all = Promise.all([queue.push(task), queue.push(task), queue.push(task), queue.push(task)])
    await Promise.resolve()
    expect(peak).toBe(2)

    // Каждое разрешение — через `.then().finally()` очереди, а это минимум
    // один тик микрозадач до того, как освободившийся слот заберёт следующую
    // задачу и та положит СВОЙ резолвер в `resolvers`. Без `await` между
    // вызовами цикл успевает слить только два изначальных резолвера и
    // выходит раньше, чем появятся резолверы третьей/четвёртой задачи —
    // `await all` повис бы навсегда.
    while (resolvers.length) {
      resolvers.shift()!()
      await Promise.resolve()
    }
    await all
    expect(peak).toBe(2)
  })

  it('упавшая задача не блокирует очередь', async () => {
    const queue = createLazyLoadQueue(1)
    const failed = queue.push(() => Promise.reject(new Error('boom')))
    await expect(failed).rejects.toThrow('boom')
    await expect(queue.push(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  // Ревью L3, Important 1: task() зовётся синхронно внутри processNext; без
  // try/catch синхронный throw (а не отклонённый промис) вылетел бы наружу,
  // inProcess остался бы навсегда увеличенным на эту задачу, и очередь дальше
  // этого места не продвигалась бы — восьми таких хватило бы, чтобы насмерть
  // заклинить весь экран.
  it('синхронный throw в задаче реджектит её и не блокирует очередь (как отклонённый промис)', async () => {
    const queue = createLazyLoadQueue(1)
    const thrown = queue.push(() => { throw new Error('sync boom') })
    await expect(thrown).rejects.toThrow('sync boom')
    await expect(queue.push(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  // Ревью L3, Critical: вызывающий код мемоизирует промис push() в модульном
  // кэше (StickersSearchTab.setStickersCache, StickerMedia.cache). Если
  // clear() молча роняет ещё не начатые задачи, их промисы никогда не settle —
  // кэш травится навсегда подвисшим промисом, и следующий запрос того же
  // ключа (даже в другом месте приложения — бабл в чате, пикер) получает его
  // же, а не свежую загрузку. clear() обязан реджектить снятые — тогда
  // существующий `p.catch(() => cache.delete(key))` у потребителей сам
  // вычищает отравленную запись.
  it('clear() реджектит ещё не начатые задачи, не трогая уже исполняющуюся', async () => {
    const queue = createLazyLoadQueue(1)
    let releaseRunning!: () => void
    const running = queue.push(() => new Promise<void>((resolve) => { releaseRunning = resolve }))
    await Promise.resolve() // дать первой задаче реально занять единственный слот

    const queuedButNotStarted = vi.fn(() => Promise.resolve('should not run'))
    const queued = queue.push(queuedButNotStarted)

    queue.clear()
    await expect(queued).rejects.toThrow(/clear/i)
    expect(queuedButNotStarted).not.toHaveBeenCalled() // не начатая задача не стартовала вовсе

    // уже исполняющаяся clear() не тронул — доигрывает сама
    releaseRunning()
    await expect(running).resolves.toBeUndefined()
  })

  // Ревью L3, Important 2 (порт tweb LazyLoadQueue.onVisibilityChange/getItem):
  // задача с isVisible()===true обгоняет уже стоящую в очереди невидимую —
  // время исполнителей отдаётся тому, что сейчас перед глазами, а не тому,
  // что было поставлено раньше, но уже прокручено мимо.
  it('видимая задача обгоняет невидимую, вставшую в очередь раньше', async () => {
    const queue = createLazyLoadQueue(1)
    const order: string[] = []
    let releaseBlocker!: () => void
    // занимает единственный слот, чтобы обе следующие задачи гарантированно попали в очередь
    void queue.push(() => new Promise<void>((resolve) => { releaseBlocker = resolve }))
    await Promise.resolve()

    const invisible = queue.push(() => { order.push('invisible'); return Promise.resolve() }, () => false)
    const visible = queue.push(() => { order.push('visible'); return Promise.resolve() }, () => true)

    releaseBlocker()
    await Promise.all([visible, invisible])
    expect(order).toEqual(['visible', 'invisible'])
  })

  it('без isVisible задача ведёт себя как обычный FIFO (по умолчанию всегда «видима»)', async () => {
    const queue = createLazyLoadQueue(1)
    const order: string[] = []
    let releaseBlocker!: () => void
    void queue.push(() => new Promise<void>((resolve) => { releaseBlocker = resolve }))
    await Promise.resolve()

    const first = queue.push(() => { order.push('first'); return Promise.resolve() })
    const second = queue.push(() => { order.push('second'); return Promise.resolve() })

    releaseBlocker()
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })
})
