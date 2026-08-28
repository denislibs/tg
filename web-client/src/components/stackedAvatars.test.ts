// Стек аватарок — порт tweb `components/stackedAvatars.ts`.
//
// Пины: разметка и порядок наложения (оригинал РЕВЕРСИРУЕТ список и берёт из
// него три — :38-41), края стека (`is-first`/`is-last`, :69-70), переиспользование
// уже стоящих узлов на повторном `render` (:45-51 — иначе аватарка
// перезагружалась бы на каждое обновление счётчика) и снятие лишних (:73-76).
import { describe, expect, it, vi } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import { resetPeerMirror } from '@core/peerCache'
import StackedAvatars from './stackedAvatars'

const managers = { peers: { fillMirror: vi.fn(async () => {}) } }

function make(avatarSize = 24) {
  resetPeerMirror()
  const helper = getMiddleware()
  const stack = new StackedAvatars({ avatarSize, middleware: helper.get(), managers })
  return { stack, helper }
}

const containers = (stack: StackedAvatars) =>
  Array.from(stack.container.querySelectorAll<HTMLElement>('.stacked-avatars-avatar-container'))

describe('StackedAvatars', () => {
  it('разметка и размер — как у оригинала', () => {
    const { stack } = make(30)
    stack.render([1, 2])

    expect(stack.container.classList.contains('stacked-avatars')).toBe(true)
    expect(stack.container.style.getPropertyValue('--avatar-size')).toBe('30px')

    const [first] = containers(stack)
    expect(first.firstElementChild!.classList.contains('stacked-avatars-avatar')).toBe(true)
  })

  it('список РЕВЕРСИРУЕТСЯ и режется до трёх (tweb :38-41)', () => {
    const { stack } = make()
    stack.render([1, 2, 3, 4])

    // reverse даёт [4,3,2,1], `slice(-3)` — [3,2,1]: в DOM попадают ПЕРВЫЕ три
    // ключа исходного списка, в обратном порядке.
    expect(containers(stack).map((el) => (el.firstElementChild as HTMLElement).dataset.peerId))
      .toEqual(['3', '2', '1'])
  })

  it('края стека помечены is-first/is-last', () => {
    const { stack } = make()
    stack.render([1, 2, 3])

    const els = containers(stack)
    expect(els.map((el) => el.classList.contains('is-first'))).toEqual([true, false, false])
    expect(els.map((el) => el.classList.contains('is-last'))).toEqual([false, false, true])
  })

  it('повторный render ПЕРЕИСПОЛЬЗУЕТ узлы, а не пересоздаёт их', () => {
    const { stack } = make()
    stack.render([1, 2])
    const before = containers(stack)

    stack.render([1, 2])
    const after = containers(stack)

    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
  })

  it('было три, стало два — лишний узел снимается (tweb :73-76)', () => {
    const { stack } = make()
    stack.render([1, 2, 3])
    expect(containers(stack)).toHaveLength(3)

    stack.render([1, 2])
    expect(containers(stack)).toHaveLength(2)
  })

  it('destroy убирает контейнер из DOM', () => {
    const { stack } = make()
    const host = document.createElement('div')
    host.append(stack.container)
    stack.render([1])

    stack.destroy()
    expect(host.querySelector('.stacked-avatars')).toBeNull()
  })
})
