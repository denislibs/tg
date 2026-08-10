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

  it('destroy() отцепляет дочернего из parent.details.inner: новое поколение живо после parent.clean()', () => {
    const parent = getMiddleware()
    const parentMiddleware = parent.get()
    const child = parentMiddleware.create()

    // Уничтожаем дочернего — создаёт свежее поколение details
    child.destroy()
    expect(parentMiddleware()).toBe(true) // родитель остаётся живо

    // Берём свежее поколение после destroy
    const afterDestroyMiddleware = child.get()
    expect(afterDestroyMiddleware()).toBe(true) // живо, закрывает новые details

    // Если отцепление работает: child больше не в parent.details.inner,
    // parent.clean() не трогает его, свежее поколение остаётся живо
    // Если отцепления нет: child остаётся в parent.details.inner,
    // parent.clean() вызывает child.destroy() повторно, clean() помечает новые details.cleaned,
    // afterDestroyMiddleware() вернёт false
    parent.clean()
    expect(afterDestroyMiddleware()).toBe(true) // ← укус теста: падает без отцепления
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
