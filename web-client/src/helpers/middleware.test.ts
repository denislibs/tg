// web-client/src/helpers/middleware.test.ts
// Пины семантики вендореного tweb-примитива (src/helpers/middleware.ts, 1:1).
// Файл не меняем — фиксируем гарантии, на которые опирается прикладной код
// (эффекты с RPC, будущий setPeer): см. docs/superpowers/plans/2026-08-10-middleware-activation.md.
import { describe, expect, it, vi } from 'vitest'
import { getMiddleware } from './middleware'

describe('MiddlewareHelper: пины семантики tweb', () => {
  it('middleware() истинен до clean() и ложен навсегда после; новое поколение живо', () => {
    const helper = getMiddleware()
    const middleware = helper.get()
    expect(middleware()).toBe(true)
    helper.clean()
    expect(middleware()).toBe(false)
    const fresh = helper.get()
    expect(fresh()).toBe(true)
    expect(middleware()).toBe(false) // старое замыкание мертво навсегда
  })

  it('onClean: на живом — копится до clean(), на протухшем — вызывается немедленно', () => {
    const helper = getMiddleware()
    const middleware = helper.get()
    const cb = vi.fn()
    middleware.onClean(cb)
    expect(cb).not.toHaveBeenCalled()
    helper.clean()
    expect(cb).toHaveBeenCalledTimes(1)
    const late = vi.fn()
    middleware.onClean(late)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('create(): дочерний хелпер уничтожается вместе с родителем', () => {
    const parent = getMiddleware()
    const child = parent.get().create()
    const childMiddleware = child.get()
    expect(childMiddleware()).toBe(true)
    parent.clean()
    expect(childMiddleware()).toBe(false)
  })

  it('destroy() дочернего отцепляет: parent.clean() уничтожает только оставшихся детей', () => {
    const parent = getMiddleware()
    const parentMiddleware = parent.get()

    // Создаём двух детей
    const child1 = parentMiddleware.create()
    const child1Middleware = child1.get()

    const child2 = parentMiddleware.create()
    const child2Middleware = child2.get()

    expect(child1Middleware()).toBe(true)
    expect(child2Middleware()).toBe(true)

    // Уничтожаем первого ребёнка явно (должен отцепиться от родителя)
    const onDestroy1 = vi.fn()
    child1.onDestroy(onDestroy1)
    child1.destroy()
    expect(onDestroy1).toHaveBeenCalledTimes(1)
    expect(child1Middleware()).toBe(false)

    // Во время parent.clean():
    // - Если отцепление работало: iterates только над [child2], вызывает destroy только на child2
    // - Если отцепления не было: iterates над [child1, child2], вызывает destroy дважды
    // Проверяем через onDestroy1, который НЕ должен быть вызван повторно
    parent.clean()

    // Если отцепление сработало, onDestroy1 был вызван только один раз
    expect(onDestroy1).toHaveBeenCalledTimes(1)

    // Оба дети должны быть мертвы
    expect(child1Middleware()).toBe(false)
    expect(child2Middleware()).toBe(false)
    expect(parentMiddleware()).toBe(false)
  })

  it('create() на протухшем middleware бросает {type: MIDDLEWARE}', () => {
    const helper = getMiddleware()
    const middleware = helper.get()
    helper.clean()
    let thrown: unknown
    try {
      middleware.create()
    } catch (e) {
      thrown = e
    }
    expect((thrown as { type?: string } | undefined)?.type).toBe('MIDDLEWARE')
  })

  it('get(additionalCallback): доп-условие актуальности', () => {
    const helper = getMiddleware()
    let current = 1
    const middleware = helper.get(() => current === 1)
    expect(middleware()).toBe(true)
    current = 2
    expect(middleware()).toBe(false)
  })

  it('destroy(): onDestroy вызывается; после destroy — немедленно', () => {
    const helper = getMiddleware()
    const onDestroy = vi.fn()
    helper.onDestroy(onDestroy)
    helper.destroy()
    expect(onDestroy).toHaveBeenCalledTimes(1)
    const late = vi.fn()
    helper.onDestroy(late)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('после destroy() хелпер снова выдаёт живой middleware (пин под StrictMode-ремаунт)', () => {
    const helper = getMiddleware()
    helper.destroy()
    expect(helper.get()()).toBe(true)
  })
})
