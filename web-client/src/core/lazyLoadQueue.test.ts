import { describe, expect, it } from 'vitest'
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
})
