// src/core/realtime/pendingPts.test.ts
import { describe, it, expect } from 'vitest'
import { newPendingPts, type PendingItem } from './pendingPts'

// Мини-курсор для драйва drain(): apply двигает pts на +1 и пишет применённое.
function harness(startPts: number) {
  let cursor = startPts
  const applied: number[] = []
  const apply = (it: PendingItem) => { applied.push(it.pts); cursor = it.pts }
  return { getCursor: () => cursor, apply, applied, cur: () => cursor }
}

const item = (pts: number): PendingItem => ({ key: 'updateMessageReactions', pts, d: { pts } })

describe('newPendingPts', () => {
  it('drains contiguous items once the hole is filled', () => {
    const b = newPendingPts()
    b.push(item(5)); b.push(item(6)) // дыра: cursor=3, ждём 4
    const h = harness(3)
    b.drain(h.getCursor, h.apply)
    expect(h.applied).toEqual([]) // 5,6 не подряд с cursor=3 → всё придержано
    expect(b.size()).toBe(2)

    // приходит недостающий 4 (живой next применяется вызывающим), cursor→4, дренаж
    h.applied.length = 0
    const h2 = harness(4)
    b.drain(h2.getCursor, h2.apply)
    expect(h2.applied).toEqual([5, 6])
    expect(b.has()).toBe(false)
  })

  it('stops at the first remaining hole, keeps the tail buffered', () => {
    const b = newPendingPts()
    b.push(item(5)); b.push(item(7)) // 6 отсутствует
    const h = harness(4)
    b.drain(h.getCursor, h.apply)
    expect(h.applied).toEqual([5]) // 5 применился, 7 остался (дыра на 6)
    expect(b.size()).toBe(1)
  })

  it('drops buffered dups the cursor already passed (post catch-up)', () => {
    const b = newPendingPts()
    b.push(item(5)); b.push(item(6))
    // catch-up увёл курсор на 10 → оба буферных pts стали дублями
    const h = harness(10)
    b.drain(h.getCursor, h.apply)
    expect(h.applied).toEqual([])
    expect(b.has()).toBe(false)
  })

  it('dedupes re-delivered out-of-order frames by pts', () => {
    const b = newPendingPts()
    expect(b.push(item(5))).toBe(true)
    expect(b.push(item(5))).toBe(true) // тот же pts повторно
    expect(b.size()).toBe(1)
  })

  it('reports overflow so the caller can fall back to catch-up', () => {
    const b = newPendingPts(2)
    expect(b.push(item(5))).toBe(true)
    expect(b.push(item(6))).toBe(true)
    expect(b.push(item(7))).toBe(false) // переполнен
    expect(b.size()).toBe(2)
  })

  it('drains out-of-order pushes in pts order', () => {
    const b = newPendingPts()
    b.push(item(7)); b.push(item(5)); b.push(item(6)) // намеренно не по порядку
    const h = harness(4)
    b.drain(h.getCursor, h.apply)
    expect(h.applied).toEqual([5, 6, 7])
    expect(b.has()).toBe(false)
  })
})

describe('newPendingPts — pts_count (tweb popPendingPtsUpdate :136-172)', () => {
  it('элемент {pts:15, ptsCount:3} при курсоре 12 сливается', () => {
    const b = newPendingPts()
    b.push({ key: 'updatePts', pts: 15, ptsCount: 3, d: null })
    const h = harness(12)
    b.drain(h.getCursor, h.apply)
    expect(h.applied).toEqual([15])
    expect(b.has()).toBe(false)
  })

  it('при курсоре 11 тот же элемент остаётся ждать (дыра)', () => {
    const b = newPendingPts()
    b.push({ key: 'updatePts', pts: 15, ptsCount: 3, d: null })
    const h = harness(11)
    b.drain(h.getCursor, h.apply)
    expect(h.applied).toEqual([])
    expect(b.size()).toBe(1)
  })

  it('updatePts заменяет лежащий в буфере живой кадр с тем же pts', () => {
    const b = newPendingPts()
    b.push(item(13))
    b.push({ key: 'updatePts', pts: 13, ptsCount: 3, d: null })
    expect(b.size()).toBe(1)
    const h = harness(10)
    b.drain(h.getCursor, h.apply)
    expect(h.applied).toEqual([13]) // живой 13 с ptsCount 1 при курсоре 10 не слился бы
  })

  it('живой кадр с тем же pts не вытесняет updatePts', () => {
    const b = newPendingPts()
    b.push({ key: 'updatePts', pts: 13, ptsCount: 3, d: null })
    b.push(item(13))
    const h = harness(10)
    b.drain(h.getCursor, h.apply)
    expect(h.applied).toEqual([13])
  })
})
