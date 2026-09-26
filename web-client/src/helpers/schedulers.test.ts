// Изоляция колбэков `fastRaf`/`fastRafConventional` — порт теста tweb 12fbb8506
// (`src/tests/fastRafCallbackIsolation.test.ts`).
//
// Колбэки одного кадра друг с другом не связаны, а `fastRafPromise` резолвится
// из колбэка, стоящего в той же пачке, и кэширует промис в модульной
// переменной до резолва. Бросок соседа раньше срывал этот резолв — и КАЖДЫЙ
// следующий `fastRafPromise()` отдавал тот же мёртвый промис: лента, ждущая
// его в `processBatch` (`components/chat/bubbles.ts`), вставала навсегда.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { fastRaf, fastRafConventional, fastRafPromise } from './schedulers'

/** Копит колбэки кадра вместо исполнения — тест сбрасывает пачку руками. */
function captureFrames() {
  const frames: (() => void)[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(() => cb(0))
    return frames.length
  })

  return () => {
    const pending = frames.splice(0, frames.length)
    pending.forEach((frame) => frame())
  }
}

describe('fastRaf: изоляция колбэков', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('бросивший колбэк не отменяет остальные колбэки кадра', () => {
    const flush = captureFrames()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ran: string[] = []

    fastRaf(() => {
      throw new Error('boom')
    })
    fastRaf(() => ran.push('second'))
    fastRaf(() => ran.push('third'))

    flush()

    expect(ran).toEqual(['second', 'third'])
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })

  test('fastRafPromise резолвится, даже если раньше в его пачке кто-то бросил', async () => {
    const flush = captureFrames()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    fastRaf(() => {
      throw new Error('boom')
    })
    const promise = fastRafPromise()

    flush()

    // суть бага: потерянный резолв оставлял модульный `rafPromise` вечно
    // ожидающим и раздавал этот же мёртвый промис всем следующим
    await expect(promise).resolves.toBeUndefined()
    errors.mockRestore()
  })

  test('следующий fastRafPromise не отравлен прошлой пачкой', async () => {
    const flush = captureFrames()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    fastRaf(() => {
      throw new Error('boom')
    })
    const first = fastRafPromise()
    flush()
    await first

    const second = fastRafPromise()
    expect(second).not.toBe(first)
    flush()
    await expect(second).resolves.toBeUndefined()
    errors.mockRestore()
  })

  test('fastRafConventional продолжает пачковать после броска', () => {
    const flush = captureFrames()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ran: string[] = []

    fastRafConventional(() => {
      throw new Error('boom')
    })
    fastRafConventional(() => ran.push('second'))
    flush()

    expect(ran).toEqual(['second'])

    // залипший `processing = true` исполнил бы это синхронно, а не следующим кадром
    const later: string[] = []
    fastRafConventional(() => later.push('deferred'))
    expect(later).toEqual([])
    flush()
    expect(later).toEqual(['deferred'])

    errors.mockRestore()
  })
})
