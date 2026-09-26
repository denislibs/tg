// withTimeout — порт tweb 293cb4509 (`helpers/schedulers/withTimeout.ts`,
// тесты — из `src/tests/spoilerShaderFetchRecovery.test.ts`).
//
// Ограничивает промис, который может НЕ осесть никогда (воркер перестал
// отвечать, запрос повис): `.catch()` такой промис не видит, и без дедлайна
// он паркует каждый `await` за собой на всю жизнь вкладки.
import { describe, expect, test, vi } from 'vitest'
import withTimeout from './withTimeout'

describe('withTimeout', () => {
  test('осевшее значение проходит насквозь', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1000, 'fallback')).resolves.toBe('done')
  })

  test('промис, который не оседает, отдаёт запасное значение', async () => {
    await expect(withTimeout(new Promise(() => {}), 5, 'fallback')).resolves.toBe('fallback')
  })

  test('отказ по-прежнему пробрасывается', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 1000, 'fallback')).rejects.toThrow('nope')
  })
})

describe('withTimeout: гигиена таймера', () => {
  test('таймер снимается, когда промис осел первым', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    await withTimeout(Promise.resolve('done'), 60000, 'fallback')
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  test('таймер снимается, когда промис первым отказал', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    await expect(withTimeout(Promise.reject(new Error('nope')), 60000, 'fallback')).rejects.toThrow('nope')
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
