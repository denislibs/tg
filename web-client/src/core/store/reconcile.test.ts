import { describe, expect, it } from 'vitest'
import { reconcileById, reconcileEntity } from './reconcile'

const byId = (e: { id: number }) => e.id

describe('reconcileEntity', () => {
  it('данные не изменились — возвращает СТАРЫЙ объект (та же ссылка)', () => {
    const prev = { id: 1, title: 'Работа' }

    expect(reconcileEntity(prev, { id: 1, title: 'Работа' })).toBe(prev)
  })

  it('поле изменилось — новый объект', () => {
    const prev = { id: 1, title: 'Работа' }
    const out = reconcileEntity(prev, { id: 1, title: 'Отдых' })

    expect(out).not.toBe(prev)
    expect(out.title).toBe('Отдых')
  })

  it('прежнего нет — возвращает пришедший', () => {
    const next = { id: 2, title: 'Новая' }

    expect(reconcileEntity(undefined, next)).toBe(next)
  })

  it('сравнение глубокое: вложенный массив без изменений — та же ссылка', () => {
    const prev = { id: 1, peerIds: [1, 2, 3] }

    expect(reconcileEntity(prev, { id: 1, peerIds: [1, 2, 3] })).toBe(prev)
  })

  // Парный к предыдущему: без него «глубокое сравнение», которое всегда says true
  // для вложенных структур, прошло бы тест выше и молча съело бы реальное изменение.
  it('сравнение глубокое: вложенный массив изменился — новый объект', () => {
    const prev = { id: 1, peerIds: [1, 2, 3] }
    const out = reconcileEntity(prev, { id: 1, peerIds: [1, 2, 4] })

    expect(out).not.toBe(prev)
    expect(out.peerIds).toEqual([1, 2, 4])
  })
})

describe('reconcileById', () => {
  it('ответ идентичен — тот же массив по ссылке и changed=false', () => {
    const prev = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]

    const r = reconcileById(prev, [{ id: 1, t: 'a' }, { id: 2, t: 'b' }], byId)

    expect(r.changed).toBe(false)
    expect(r.list).toBe(prev)
  })

  it('одна запись изменилась — новая ссылка только у неё', () => {
    const a = { id: 1, t: 'a' }
    const b = { id: 2, t: 'b' }

    const r = reconcileById([a, b], [{ id: 1, t: 'a' }, { id: 2, t: 'B!' }], byId)

    expect(r.changed).toBe(true)
    expect(r.list[0]).toBe(a) // не тронута — ссылка сохранена
    expect(r.list[1]).not.toBe(b)
    expect(r.updated.map(byId)).toEqual([2])
    expect(r.added).toEqual([])
    expect(r.removed).toEqual([])
  })

  it('добавление и удаление разложены по корзинам', () => {
    const r = reconcileById([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], byId)

    expect(r.added.map(byId)).toEqual([3])
    expect(r.removed.map(byId)).toEqual([1])
    expect(r.list.map(byId)).toEqual([2, 3])
  })

  it('порядок берётся из next (порядок задаёт вызывающий)', () => {
    const r = reconcileById([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], byId)

    expect(r.list.map(byId)).toEqual([2, 1])
    expect(r.changed).toBe(true)
  })
})
