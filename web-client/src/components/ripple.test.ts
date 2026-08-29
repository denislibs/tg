// Тест порта tweb `components/ripple.ts` — у файла тестов не было вовсе, хотя
// тач-путь несёт регрессию (нашла ревью задачи 7): `IS_TOUCH_SUPPORTED`
// вычисляется на уровне модуля при импорте, поэтому грузим модуль заново с
// замоканным `@environment/touchSupport` (тот же приём, что в
// `core/dom/swipeHandler.test.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest'

type RippleModule = typeof import('./ripple')

async function loadModule(): Promise<RippleModule> {
  vi.resetModules()
  vi.doMock('@environment/touchSupport', () => ({ default: true }))
  return await import('./ripple')
}

// happy-dom не даёт сконструировать настоящий TouchEvent — собираем базовый
// Event и довешиваем поля через defineProperty (тот же приём, что в
// `swipeHandler.test.ts`).
function makeEvent(type: string, props: Record<string, unknown> = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(e, key, { value, configurable: true })
  }
  return e
}

afterEach(() => {
  vi.doUnmock('@environment/touchSupport')
  vi.resetModules()
  document.body.replaceChildren()
})

describe('ripple (тач-путь)', () => {
  it('touchmove после touchstart не бросает исключение (регрессия cancelBubble)', async () => {
    const { default: ripple } = await loadModule()

    const el = document.createElement('button')
    document.body.append(el)
    ripple(el)

    el.dispatchEvent(makeEvent('touchstart', { touches: [{ clientX: 10, clientY: 10 }] }))

    // Регрессия: `e.cancelBubble = true` в обработчике `touchmove` — в
    // happy-dom `Event.prototype.cancelBubble` объявлен ТОЛЬКО геттером,
    // присваивание бросает `TypeError`. Обработчик обрывался до
    // `stopPropagation()`/`touchEnd()`, и рипл на тач-жесте не убирался.
    expect(() => window.dispatchEvent(makeEvent('touchmove'))).not.toThrow()
  })
})
