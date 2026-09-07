// Пины `SortedUserList` (`components/sortedUserList.ts`, порт tweb
// `src/components/sortedUserList.ts`).
//
// Предмет — РЕЗУЛЬТАТ в DOM: порядок строк в `ul.chatlist` (онлайн первыми —
// `getUserStatusForSort` убывающим индексом), подпись статуса, ранг правым
// слотом заголовка, снятие строки на `delete`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { UserStatus } from '@core/peers/peer'
import SortedUserList from './sortedUserList'

const managers = { peers: { fillMirror: async () => {} } }

const user = (id: number, name: string, status: UserStatus) =>
  ({ _: 'user' as const, id, first_name: name, pFlags: {}, status })

/** Дать пачке `SortedList` (`pause(0)` + обработка) и `fastRaf` отработать. */
const settle = async () => {
  for(let i = 0; i < 4; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
}

const ids = (list: SortedUserList) =>
  Array.from(list.list.children).map((el) => +(el as HTMLElement).dataset.peerId!)

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    user(1, 'Оффлайн', { _: 'userStatusOffline', was_online: 1_000 }),
    user(2, 'Онлайн', { _: 'userStatusOnline', expires: 2_000_000_000 }),
    user(3, 'Недавно', { _: 'userStatusRecently' }),
  ] }])
})
afterEach(() => document.body.replaceChildren())

function build() {
  const list = new SortedUserList({
    rippleEnabled: false,
    managers,
    middleware: getMiddleware().get(),
  })
  document.body.append(list.list)
  return list
}

describe('SortedUserList', () => {
  it('list — ul.chatlist; строки — a.chatlist-chat-abitbigger без ripple', async () => {
    const list = build()
    expect(list.list.className).toBe('chatlist')
    void list.add(1)
    await settle()
    const row = list.list.firstElementChild as HTMLElement
    expect(row.classList.contains('chatlist-chat-abitbigger')).toBe(true)
    expect(row.classList.contains('rp')).toBe(false)
  })

  // `getUserStatusForSort`: у онлайна и оффлайна индекс — время (большое
  // число), у «был(а) недавно» — 3; поэтому известное время последнего входа
  // стоит ВЫШЕ скрытого «недавно», как в оригинале.
  it('сортирует по присутствию независимо от порядка добавления: онлайн → оффлайн со временем → недавно', async () => {
    const list = build()
    void list.add(3)
    void list.add(1)
    void list.add(2)
    await settle()
    expect(ids(list)).toEqual([2, 1, 3])
  })

  it('подпись строки — статус пользователя, ранг — правым слотом заголовка', async () => {
    const list = build()
    list.ranks.set(2, 1)
    list.ranks.set(3, 2)
    void list.add(1)
    void list.add(2)
    void list.add(3)
    await settle()
    const rows = Array.from(list.list.children) as HTMLElement[]
    const subtitle = (row: HTMLElement) => row.querySelector('.row-subtitle')!.textContent
    const rank = (row: HTMLElement) => row.querySelector('.row-title-right')!.textContent
    expect(ids(list)).toEqual([2, 1, 3])
    expect(subtitle(rows[0])).toBe('online')
    expect(rank(rows[0])).toBe('owner')
    expect(subtitle(rows[1])).toMatch(/^last seen .* at /)
    // без ранга правый слот ПУСТ (`replaceChildren()` без аргументов, tweb :90)
    expect(rank(rows[1])).toBe('')
    expect(subtitle(rows[2])).toBe('last seen recently')
    expect(rank(rows[2])).toBe('admin')
  })

  it('update() переставляет строку после смены статуса', async () => {
    const list = build()
    void list.add(1)
    void list.add(2)
    await settle()
    expect(ids(list)).toEqual([2, 1])

    applyPeerOps([{ op: 'upsert', peers: [user(1, 'Оффлайн', { _: 'userStatusOnline', expires: 3_000_000_000 })] }])
    await list.update(1)
    await settle()
    expect(ids(list)).toEqual([1, 2])
  })

  it('delete() снимает строку; has() отвечает по факту', async () => {
    const list = build()
    void list.add(1)
    void list.add(2)
    await settle()
    expect(list.has(1)).toBe(true)
    expect(list.delete(1)).toBe(true)
    await settle()
    expect(ids(list)).toEqual([2])
    expect(list.has(1)).toBe(false)
  })

  it('onListLengthChange зовётся на первое появление строки и на её снятие', async () => {
    let calls = 0
    const list = new SortedUserList({
      rippleEnabled: false,
      managers,
      middleware: getMiddleware().get(),
      onListLengthChange: () => { ++calls },
    })
    document.body.append(list.list)
    void list.add(1)
    await settle()
    expect(calls).toBe(1)
    await list.update(1)
    expect(calls).toBe(1)
    list.delete(1)
    await settle()
    expect(calls).toBe(2)
  })
})
