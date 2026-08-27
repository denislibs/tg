// Мультиплексор пересечений (порт tweb `superIntersectionObserver.ts`).
//
// Пин ровно на то, ради чего он существует: у ленты несколько независимых
// вопросов «что сейчас видно» (непрочитанные, просмотры поста, метрики…), а
// нативный наблюдатель — ОДИН. Значит, наблюдение адресуется КОЛБЭКУ, и снятие
// одного потребителя не смеет ослеплять другого.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import SuperIntersectionObserver from './superIntersectionObserver'

class FakeIntersectionObserver {
  public static instances: FakeIntersectionObserver[] = []
  public targets: Element[] = []
  constructor(public cb: (entries: unknown[]) => void, public init?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this)
  }

  observe(el: Element) { this.targets.push(el) }
  unobserve(el: Element) { this.targets = this.targets.filter((t) => t !== el) }
  disconnect() { this.targets = [] }
}

const native = () => FakeIntersectionObserver.instances[0]
const fire = (el: Element) => { native().cb([{ target: el, isIntersecting: true }]) }

beforeEach(() => {
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

describe('SuperIntersectionObserver', () => {
  it('раздаёт запись ВСЕМ колбэкам узла, наблюдая его нативно ОДИН раз', () => {
    const sio = new SuperIntersectionObserver({ root: document.body })
    const el = document.createElement('div')
    const a = vi.fn()
    const b = vi.fn()

    sio.observe(el, a)
    sio.observe(el, b)
    expect(native().targets).toEqual([el])

    fire(el)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  // ГЛАВНЫЙ ПИН: без адресации по колбэку `unobserve` просмотров снял бы с бабла
  // и отметку прочтения.
  it('снятие одного колбэка не снимает наблюдение у второго', () => {
    const sio = new SuperIntersectionObserver()
    const el = document.createElement('div')
    const a = vi.fn()
    const b = vi.fn()
    sio.observe(el, a)
    sio.observe(el, b)

    sio.unobserve(el, a)
    expect(native().targets).toEqual([el])

    fire(el)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('нативное наблюдение уходит вместе с ПОСЛЕДНИМ колбэком', () => {
    const sio = new SuperIntersectionObserver()
    const el = document.createElement('div')
    const a = vi.fn()
    sio.observe(el, a)

    sio.unobserve(el, a)
    expect(native().targets).toEqual([])
  })

  // Одноразовое наблюдение (просмотры поста, tweb bubbles.ts:2308): колбэк
  // снимает себя ИЗ СЕБЯ — обход не должен на этом сломаться.
  it('колбэк вправе снять себя прямо из обработки записи', () => {
    const sio = new SuperIntersectionObserver()
    const el = document.createElement('div')
    const seen: number[] = []
    const once = vi.fn(() => { sio.unobserve(el, once); seen.push(1) })
    sio.observe(el, once)

    fire(el)
    expect(seen).toEqual([1])
    expect(native().targets).toEqual([])
  })

  it('disconnect забывает всё, но объект остаётся рабочим', () => {
    const sio = new SuperIntersectionObserver()
    const el = document.createElement('div')
    const a = vi.fn()
    sio.observe(el, a)

    sio.disconnect()
    expect(native().targets).toEqual([])

    sio.observe(el, a)
    fire(el)
    expect(a).toHaveBeenCalledTimes(1)
  })
})
