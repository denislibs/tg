import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ядро локализации наполняется побочным эффектом создания хранилища языка
// (`i18n/index.tsx::applyToCore`); в продукте этот импорт лежит на пути холодного
// старта (`main.tsx` → `client/boot.ts`, где `loadLang()` ещё и дожидается до
// первого рендера). Здесь строятся узлы `i18n()`, поэтому импорт нужен явно —
// без него ядро пусто и печатает имя ключа.
import '@/i18n'
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
