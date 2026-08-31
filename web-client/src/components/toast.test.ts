import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Здесь строятся узлы `i18n()`. Строки в ядро кладёт холодный старт (`main.tsx` →
// `client/boot.ts` дожидается пакета до первого рендера), а в прогоне — общий сетап
// (`src/test/setup.ts`); на пустом ядре узел напечатал бы имя ключа.
import { toastNew } from './toast'

describe('toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('снимает узел по истечении показа', () => {
    toastNew({ langPackKey: 'Error.AnError' })
    expect(document.querySelector('.toast')).not.toBeNull()
    vi.advanceTimersByTime(5000)
    expect(document.querySelector('.toast')).toBeNull()
  })
})
