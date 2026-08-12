// Тесты порта tweb `src/helpers/listLoader.ts` (свои: в tweb на listLoader
// тестов нет). Пины поведения 1:1: сплайс previous/next в go(), onJump(item,
// older), дозагрузка при остатке < loadWhenLeft (анкор/направление/порядок
// вставки, в т.ч. reverse), дедуп по loadPromise, loadedAll при неполной
// странице, setTargets, reset, index, goUnsafe.
import { describe, expect, test, vi } from 'vitest'
import ListLoader, { ListLoaderResult } from './listLoader'

type Item = { id: number }
const item = (id: number): Item => ({ id })
const ids = (arr: Item[]) => arr.map((x) => x.id)

type Deferred = {
  promise: Promise<ListLoaderResult<Item>>,
  resolve: (result: ListLoaderResult<Item>) => void
}
const deferred = (): Deferred => {
  let resolve!: Deferred['resolve']
  const promise = new Promise<ListLoaderResult<Item>>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// loadWhenLeft: 0 — выключает автодозагрузку в тестах движения
// (условие tweb `length < loadWhenLeft` при 0 не срабатывает никогда)
const makeLoader = (options: {
  loadCount?: number,
  loadWhenLeft?: number,
  onJump?: (i: Item, older: boolean) => void,
  loadMore?: (anchor: Item | undefined, older: boolean, loadCount: number) => Promise<ListLoaderResult<Item>>,
  onLoadedMore?: () => void,
} = {}) => {
  const loadMore = vi.fn(options.loadMore ?? (() => Promise.resolve({ count: 0, items: [] as Item[] })))
  const loader = new ListLoader<Item, Item>({ ...options, loadMore })
  return { loader, loadMore }
}

describe('ListLoader.go — сплайс previous/next и current', () => {
  test('go(+1): current уходит в хвост previous, голова next становится current', () => {
    const { loader } = makeLoader({ loadWhenLeft: 0 })
    const [a, b, c, d, e, f] = [1, 2, 3, 4, 5, 6].map(item)
    loader.setTargets([a, b], [d, e, f], false)
    loader.current = c

    expect(loader.go(1)).toBe(d)
    expect(loader.current).toBe(d)
    expect(ids(loader.previous)).toEqual([1, 2, 3])
    expect(ids(loader.next)).toEqual([5, 6])
  })

  test('go(+2): прыжок через элемент — промежуточные оседают в previous', () => {
    const { loader } = makeLoader({ loadWhenLeft: 0 })
    const [a, b, c, d, e, f] = [1, 2, 3, 4, 5, 6].map(item)
    loader.setTargets([a, b], [d, e, f], false)
    loader.current = c

    expect(loader.go(2)).toBe(e)
    expect(ids(loader.previous)).toEqual([1, 2, 3, 4])
    expect(ids(loader.next)).toEqual([6])
  })

  test('go(-1): current уходит в голову next, хвост previous становится current', () => {
    const { loader } = makeLoader({ loadWhenLeft: 0 })
    const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(item)
    loader.setTargets([a, b, c], [e], false)
    loader.current = d

    expect(loader.go(-1)).toBe(c)
    expect(loader.current).toBe(c)
    expect(ids(loader.previous)).toEqual([1, 2])
    expect(ids(loader.next)).toEqual([4, 5])
  })

  test('go(-2): прыжок назад — промежуточные оседают в next', () => {
    const { loader } = makeLoader({ loadWhenLeft: 0 })
    const [a, b, c, d] = [1, 2, 3, 4].map(item)
    loader.setTargets([a, b], [d], false)
    loader.current = c

    expect(loader.go(-2)).toBe(a)
    expect(ids(loader.previous)).toEqual([])
    expect(ids(loader.next)).toEqual([2, 3, 4])
  })

  test('go на пустом крае возвращает undefined и ничего не меняет', () => {
    const { loader } = makeLoader({ loadWhenLeft: 0 })
    const [a, b] = [1, 2].map(item)
    loader.setTargets([a], [], false)
    loader.current = b

    expect(loader.go(1)).toBeUndefined()
    expect(loader.current).toBe(b)
    expect(ids(loader.previous)).toEqual([1])
    expect(ids(loader.next)).toEqual([])
  })
})

describe('ListLoader.onJump', () => {
  test('зовётся с (item, older): вперёд older=true, назад older=false', () => {
    const onJump = vi.fn()
    const { loader } = makeLoader({ loadWhenLeft: 0, onJump })
    const [a, b, c] = [1, 2, 3].map(item)
    loader.setTargets([a], [c], false)
    loader.current = b

    loader.go(1)
    expect(onJump).toHaveBeenLastCalledWith(c, true)

    loader.go(-1)
    expect(onJump).toHaveBeenLastCalledWith(b, false)
    expect(onJump).toHaveBeenCalledTimes(2)
  })

  test('dispatchJump=false и пустой край — не зовётся', () => {
    const onJump = vi.fn()
    const { loader } = makeLoader({ loadWhenLeft: 0, onJump })
    const [a, b] = [1, 2].map(item)
    loader.setTargets([], [b], false)
    loader.current = a

    loader.go(1, false) // явно подавили
    loader.go(1) // пустой next — раннего return достаточно
    expect(onJump).not.toHaveBeenCalled()
  })
})

describe('ListLoader.load — дозагрузка при остатке < loadWhenLeft', () => {
  test('остаток next < loadWhenLeft: loadMore(анкор=хвост next, older=true, loadCount); один инфлайт', async () => {
    const d = deferred()
    const onLoadedMore = vi.fn()
    const { loader, loadMore } = makeLoader({
      loadWhenLeft: 2, loadCount: 10, onLoadedMore, loadMore: () => d.promise,
    })
    const prev = [1, 2, 3, 4, 5].map(item)
    const [c, n1, n2, n3] = [6, 7, 8, 9].map(item)
    loader.setTargets(prev, [n1, n2, n3], false)
    loader.current = c

    loader.go(1) // next=[n2,n3], 2 ≮ 2 — рано
    expect(loadMore).not.toHaveBeenCalled()

    loader.go(1) // next=[n3], 1 < 2 — пора
    expect(loadMore).toHaveBeenCalledTimes(1)
    expect(loadMore).toHaveBeenCalledWith(n3, true, 10)

    loader.go(1) // инфлайт-промис не дублируется
    expect(loadMore).toHaveBeenCalledTimes(1)

    const loaded = [10, 11, 12].map(item)
    d.resolve({ count: 42, items: loaded })
    await loader.load(true) // во время полёта load() отдаёт тот же инфлайт-промис

    // older && !reverse: порядок сервера сохраняется, push в next
    expect(ids(loader.next)).toEqual([10, 11, 12])
    expect(loader.count).toBe(42)
    expect(onLoadedMore).toHaveBeenCalledTimes(1)
  })

  test('неполная страница ⇒ loadedAll: повторной дозагрузки в ту сторону нет', async () => {
    const { loader, loadMore } = makeLoader({
      loadWhenLeft: 2,
      loadCount: 10,
      loadMore: () => Promise.resolve({ count: 0, items: [item(20)] }), // 1 < loadCount
    })
    const prev = [1, 2, 3].map(item)
    const [c, n1] = [4, 5].map(item)
    loader.setTargets(prev, [n1], false)
    loader.current = c

    loader.go(1) // next пуст — дозагрузка
    expect(loadMore).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(ids(loader.next)).toEqual([20]))

    loader.go(1) // next снова пуст, но loadedAllDown
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  test('остаток previous < loadWhenLeft: older=false, анкор previous[0] ?? current, вставка unshift реверсом', async () => {
    const d = deferred()
    const { loader, loadMore } = makeLoader({
      loadWhenLeft: 2, loadCount: 10, loadMore: () => d.promise,
    })
    const [p1, c, n1, n2] = [1, 2, 3, 4].map(item)
    loader.setTargets([p1], [n1, n2], false)
    loader.current = c

    loader.go(-1) // previous пуст — дозагрузка вверх
    expect(loadMore).toHaveBeenCalledTimes(1)
    expect(loadMore).toHaveBeenCalledWith(p1, false, 10) // previous[0] уже съеден go(), анкор = current

    const loaded = [10, 11].map(item)
    d.resolve({ count: 0, items: loaded })
    await loader.load(false) // тот же инфлайт-промис

    // !older && !reverse: forEachReverse + unshift — порядок сервера переворачивается
    expect(ids(loader.previous)).toEqual([11, 10])
  })
})

describe('ListLoader.setTargets и reverse', () => {
  test('setTargets подменяет previous/next/reverse', () => {
    const { loader } = makeLoader()
    const prev = [1, 2].map(item)
    const next = [3, 4].map(item)
    loader.setTargets(prev, next, true)
    expect(loader.previous).toBe(prev)
    expect(loader.next).toBe(next)
    expect(loader.reverse).toBe(true)
  })

  test('reverse: нехватка next идёт как older=false, результаты push после реверса', async () => {
    const d = deferred()
    const { loader, loadMore } = makeLoader({
      loadWhenLeft: 2, loadCount: 10, loadMore: () => d.promise,
    })
    const prev = [1, 2, 3].map(item)
    const [c, n1, n2] = [4, 5, 6].map(item)
    loader.setTargets(prev, [n1, n2], true)
    loader.current = c

    loader.go(1) // next=[n2], 1 < 2 — при reverse это НЕ older
    expect(loadMore).toHaveBeenCalledTimes(1)
    expect(loadMore).toHaveBeenCalledWith(n2, false, 10)

    const loaded = [10, 11, 12].map(item)
    d.resolve({ count: 0, items: loaded })
    await loader.load(false) // тот же инфлайт-промис (reverse: нехватка next = не-older)

    // !older && reverse: forEachReverse + push
    expect(ids(loader.next)).toEqual([6, 12, 11, 10])
  })
})

describe('ListLoader.reset и index', () => {
  test('reset очищает current/previous/next; reset(false) оставляет дозагрузку живой', () => {
    const { loader, loadMore } = makeLoader({ loadWhenLeft: 0 })
    loader.setTargets([item(1)], [item(3)], false)
    loader.current = item(2)

    loader.reset()
    expect(loader.current).toBeUndefined()
    expect(loader.previous).toEqual([])
    expect(loader.next).toEqual([])

    void loader.load(true)
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  test('reset(true) помечает обе стороны loadedAll — load() не ходит в сеть', async () => {
    const { loader, loadMore } = makeLoader()
    loader.reset(true)
    await loader.load(true)
    await loader.load(false)
    expect(loadMore).not.toHaveBeenCalled()
  })

  test('index: -1 до первого count, потом previous.length', () => {
    const { loader } = makeLoader({ loadWhenLeft: 0 })
    loader.setTargets([item(1), item(2)], [], false)
    expect(loader.index).toBe(-1)
    loader.count = 5
    expect(loader.index).toBe(2)
  })
})

describe('ListLoader.goUnsafe', () => {
  test('в пределах — {item, leftLength: 0}, за пределами — item undefined и остаток', () => {
    const { loader } = makeLoader({ loadWhenLeft: 0 })
    const [a, b, c] = [1, 2, 3].map(item)
    loader.setTargets([], [b, c], false)
    loader.current = a

    expect(loader.goUnsafe(1)).toEqual({ item: b, leftLength: 0 })
    expect(loader.goUnsafe(3)).toEqual({ item: undefined, leftLength: 2 })
  })
})
