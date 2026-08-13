import { describe, it, expect, vi } from 'vitest'
import { SequentialCursorFetcher, type SequentialCursorFetcherResult } from './sequentialCursorFetcher'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('SequentialCursorFetcher', () => {
  it('тянет страницы, пока не наберёт нужное количество', async () => {
    const calls: (number | undefined)[] = []
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      calls.push(cursor)
      return { cursor: (cursor ?? 0) + 10, count: 10 }
    })
    f.fetchUntil(25)
    await flush()
    expect(calls).toEqual([undefined, 10, 20])
  })

  it('конкурентные вызовы не запускают второй цикл', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await flush()
      inFlight--
      return { cursor: (cursor ?? 0) + 1, count: 1 }
    })
    f.fetchUntil(3)
    f.fetchUntil(3)
    f.fetchUntil(3)
    await flush()
    await flush()
    await flush()
    await flush()
    expect(maxInFlight).toBe(1)
  })

  it('пустая страница останавливает цикл', async () => {
    const fetcher = vi.fn(async () => ({ cursor: 1, count: 0 }))
    const f = new SequentialCursorFetcher<number>(fetcher)
    f.fetchUntil(100)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('totalCount из ответа замещает накопленный счётчик', async () => {
    const calls: (number | undefined)[] = []
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      calls.push(cursor)
      return { cursor: (cursor ?? 0) + 1, count: 1, totalCount: 50 }
    })
    f.fetchUntil(10)
    await flush()
    expect(calls.length).toBe(1)
  })

  it('setCursor/setFetchedItemsCount откатывают курсор после обрезки списка', async () => {
    const calls: (number | undefined)[] = []
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      calls.push(cursor)
      return { cursor: (cursor ?? 0) + 10, count: 10 }
    })
    f.fetchUntil(10)
    await flush()
    f.setCursor(5)
    f.setFetchedItemsCount(5)
    f.fetchUntil(15)
    await flush()
    expect(calls).toEqual([undefined, 5])
  })

  it('reset обнуляет курсор и счётчики', async () => {
    const calls: (number | undefined)[] = []
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      calls.push(cursor)
      return { cursor: (cursor ?? 0) + 10, count: 10 }
    })
    f.fetchUntil(10)
    await flush()
    f.reset()
    f.fetchUntil(10)
    await flush()
    expect(calls).toEqual([undefined, undefined])
  })

  it('tryToFetchMore тянет ещё одну страницу поверх набранного', async () => {
    const fetcher = vi.fn(async (cursor?: number) => ({ cursor: (cursor ?? 0) + 10, count: 10 }))
    const f = new SequentialCursorFetcher<number>(fetcher)
    f.fetchUntil(10)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    f.tryToFetchMore()
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  // Ниже — тесты на дополнительные ветки вендорного контракта, которых нет в
  // брифе дословно: без них мутация соответствующей строки не красит ни один
  // тест (проверено буквально — строка ломалась, прогонялся набор из брифа,
  // он оставался зелёным).

  it('второй параметр fetchUntil выставляет fetchedItemsCount напрямую, минуя фетч', async () => {
    const fetcher = vi.fn(async () => ({ cursor: 1, count: 1 }))
    const f = new SequentialCursorFetcher<number>(fetcher)
    f.fetchUntil(5, 5)
    await flush()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('повторный fetchUntil с меньшим значением не уменьшает уже набранную цель', async () => {
    const fetcher = vi.fn(async (cursor?: number) => ({ cursor: (cursor ?? 0) + 10, count: 10 }))
    const f = new SequentialCursorFetcher<number>(fetcher)
    f.fetchUntil(30)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(3)
    f.setFetchedItemsCount(25)
    f.fetchUntil(20)
    await flush()
    // neededCount остаётся max(30, 20) = 30, а не падает до 20 — иначе 25 >= 20
    // и цикл не продолжился бы новым фетчем.
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('setNeededCount задаёт цель независимо от fetchUntil', async () => {
    const fetcher = vi.fn(async (cursor?: number) => ({ cursor: (cursor ?? 0) + 10, count: 10 }))
    const f = new SequentialCursorFetcher<number>(fetcher)
    f.setNeededCount(15)
    f.tryToFetchMore()
    await flush()
    // tryToFetchMore прогоняет цикл минимум раз (needToFetchMore), а дальше
    // цикл продолжается, только если fetchedItemsCount < neededCount(=15).
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('отклонённый fetcher не выбрасывает наружу и не блокирует следующий цикл', async () => {
    let call = 0
    const f = new SequentialCursorFetcher<number>(async () => {
      call++
      throw new Error('boom')
    })
    expect(() => f.fetchUntil(10)).not.toThrow()
    await flush()
    expect(call).toBe(1)
    f.fetchUntil(10)
    await flush()
    expect(call).toBe(2)
  })

  it('reset обнуляет neededCount, а не только fetchedItemsCount и cursor', async () => {
    const fetcher = vi.fn(async (cursor?: number) => ({ cursor: (cursor ?? 0) + 10, count: 10 }))
    const f = new SequentialCursorFetcher<number>(fetcher)
    f.fetchUntil(30)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(3)
    f.reset()
    f.fetchUntil(5)
    await flush()
    // Если бы neededCount не сбрасывался, Math.max(30, 5) удержал бы старую
    // цель 30 и потребовал бы ещё три страницы вместо одной.
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('reset посреди цикла снимает isFetching и разрешает новый цикл поверх незавершённого', async () => {
    let resolveFirst: (value: SequentialCursorFetcherResult<number>) => void = () => {}
    const first = new Promise<SequentialCursorFetcherResult<number>>((resolve) => {
      resolveFirst = resolve
    })
    let call = 0
    const f = new SequentialCursorFetcher<number>(async (cursor) => {
      call++
      if (call === 1) return first
      return { cursor: (cursor ?? 0) + 1, count: 1 }
    })
    f.fetchUntil(1)
    await flush()
    expect(call).toBe(1)
    f.reset()
    f.fetchUntil(1)
    await flush()
    expect(call).toBe(2)
    resolveFirst({ cursor: 1, count: 1 })
    await flush()
  })
})
