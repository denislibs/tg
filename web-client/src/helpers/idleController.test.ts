// idleController — «окно без пользователя» (порт tweb `helpers/idleController.ts`).
// Факт один на приложение: его читают и мигание вкладки (`client/appBadge.ts`),
// и глушилка анимаций (`components/animationIntersector.ts`).
import { describe, it, expect, vi } from 'vitest'
import { IdleController } from './idleController'

// Тач-ветку выбирает `IS_TOUCH_SUPPORTED`, посчитанный на импорте окружения;
// в happy-dom `ontouchstart` в window нет, значит будильник — 'mousemove'.
const WAKE_EVENT = 'mousemove'

describe('idleController', () => {
  it('после загрузки страницы окно считается простаивающим', () => {
    // tweb :28 `this._isIdle = !DO_NOT_IDLE` — иначе вкладка, открытая в фоне,
    // сразу крутила бы все анимации ленты.
    expect(new IdleController().isIdle).toBe(true)
  })

  it('blur → простой, focus → активен; событие change несёт значение', () => {
    const c = new IdleController()
    const changes: boolean[] = []
    c.addEventListener('change', (idle) => changes.push(idle))

    window.dispatchEvent(new Event('focus'))
    expect(c.isIdle).toBe(false)

    window.dispatchEvent(new Event('blur'))
    expect(c.isIdle).toBe(true)

    // повтор того же значения события не рождает (tweb :81-83)
    window.dispatchEvent(new Event('blur'))
    expect(changes).toEqual([false, true])
  })

  it('первое движение мыши будит окно ровно один раз (tweb: once)', () => {
    const c = new IdleController()
    window.dispatchEvent(new Event(WAKE_EVENT))
    expect(c.isIdle).toBe(false)

    window.dispatchEvent(new Event('blur'))
    expect(c.isIdle).toBe(true)

    // слушатель был `{once: true}` — второе движение уже не будит
    window.dispatchEvent(new Event(WAKE_EVENT))
    expect(c.isIdle).toBe(true)
  })

  it('слушатели вешаются на окно — без них факт мёртв', () => {
    const spy = vi.spyOn(window, 'addEventListener')
    // eslint-disable-next-line no-new
    new IdleController()
    const names = spy.mock.calls.map((c) => c[0])
    expect(names).toContain('blur')
    expect(names).toContain('focus')
    expect(names).toContain(WAKE_EVENT)
    spy.mockRestore()
  })
})
