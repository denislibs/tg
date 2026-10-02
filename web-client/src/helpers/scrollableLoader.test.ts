// Порт tweb `helpers/scrollableLoader.ts` (задача 0б-6 волны 7): догрузка по низу
// скроллера до ответа «всё загружено», параллельный вызов ждёт идущий запрос,
// первая загрузка промиса не возвращает (как у оригинала).
import { describe, expect, it, vi } from 'vitest'
import type Scrollable from '@components/scrollable'
import ScrollableLoader from './scrollableLoader'

const scrollableStub = () => ({ onScrolledBottom: undefined, checkForTriggers: vi.fn() }) as unknown as Scrollable & { checkForTriggers: ReturnType<typeof vi.fn> }

describe('ScrollableLoader', () => {
  it('грузит по низу скроллера, пока ответ не скажет «всё»; потом снимает триггер', async() => {
    const scrollable = scrollableStub()
    const pages = [false, true]
    const getPromise = vi.fn(async() => pages.shift()!)
    const loader = new ScrollableLoader({ scrollable, getPromise })

    expect(loader.load()).toBeUndefined()
    expect(loader.loading).toBe(true)
    // запрос уже идёт — второй вызов отдаёт тот же промис и сеть не зовёт
    const pending = loader.load()
    expect(getPromise).toHaveBeenCalledTimes(1)
    await pending
    expect(scrollable.checkForTriggers).toHaveBeenCalledTimes(1)

    scrollable.onScrolledBottom!()
    await vi.waitFor(() => expect(scrollable.onScrolledBottom).toBeUndefined())
    expect(getPromise).toHaveBeenCalledTimes(2)

    await loader.load()
    expect(getPromise).toHaveBeenCalledTimes(2)
  })

  it('ошибка запроса снимает «идёт загрузка», следующий вызов повторяет', async() => {
    const scrollable = scrollableStub()
    const getPromise = vi.fn().mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce(true)
    const loader = new ScrollableLoader({ scrollable, getPromise })

    loader.load()
    await vi.waitFor(() => expect(loader.loading).toBe(false))
    loader.load()
    await vi.waitFor(() => expect(scrollable.onScrolledBottom).toBeUndefined())
    expect(getPromise).toHaveBeenCalledTimes(2)
  })
})
