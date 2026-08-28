// Порядок диалогов — производная от данных: из одних и тех же данных всегда
// один и тот же индекс, поэтому кэш и сеть не расходятся и список не
// перетасовывается после ответа сети.
import { describe, expect, it } from 'vitest'
import { dialogIndex } from './dialogIndex'
import type { Dialog } from '../models'
import { makeDialog, makeLastMessage } from './testDialog'

const at = (iso: string): Dialog['lastMessage'] =>
  makeLastMessage({ peerId: 1, id: 1, fromId: 1, text: 'x', createdAt: iso })

const dlg = (over: { peerId?: PeerId; pinned?: boolean; lastMessage?: Dialog['lastMessage'] }): Dialog =>
  makeDialog({
    peerId: over.peerId ?? 1,
    pinned: over.pinned,
    lastMessage: 'lastMessage' in over ? over.lastMessage : at('2026-08-09T10:00:00Z'),
  })

describe('dialogIndex', () => {
  it('свежее сообщение — больший индекс (выше в списке)', () => {
    const older = dialogIndex(dlg({ peerId: 1, lastMessage: at('2026-08-09T10:00:00Z') }), [])
    const newer = dialogIndex(dlg({ peerId: 2, lastMessage: at('2026-08-09T11:00:00Z') }), [])

    expect(newer).toBeGreaterThan(older)
  })

  it('закреплённый всегда выше любого незакреплённого', () => {
    const pinnedOld = dialogIndex(dlg({ peerId: 1, pinned: true, lastMessage: at('2020-01-01T00:00:00Z') }), [1])
    const freshUnpinned = dialogIndex(dlg({ peerId: 2, lastMessage: at('2026-08-09T23:59:00Z') }), [])

    expect(pinnedOld).toBeGreaterThan(freshUnpinned)
  })

  it('порядок закреплённых — по позиции в pinnedOrder', () => {
    const order = [5, 6, 7]
    const first = dialogIndex(dlg({ peerId: 5, pinned: true }), order)
    const second = dialogIndex(dlg({ peerId: 6, pinned: true }), order)
    const third = dialogIndex(dlg({ peerId: 7, pinned: true }), order)

    expect(first).toBeGreaterThan(second)
    expect(second).toBeGreaterThan(third)
  })

  it('закреплённый, которого нет в pinnedOrder, встаёт первым среди закреплённых', () => {
    const order = [5, 6]
    const known = dialogIndex(dlg({ peerId: 5, pinned: true }), order)
    const unknown = dialogIndex(dlg({ peerId: 9, pinned: true }), order)

    expect(unknown).toBeGreaterThan(known)
  })

  // Черновик лежит В САМОМ диалоге (`dialog.draft`), как у оригинала: третьим
  // аргументом он больше не приезжает, и дата активности собирается из одного
  // источника, а не из двух.
  const draftAt = (date: number) => ({ _: 'draftMessage' as const, message: 'ч', date })

  it('черновик свежее последнего сообщения — поднимает диалог', () => {
    const withoutDraft = dialogIndex(dlg({ lastMessage: at('2026-08-09T10:00:00Z') }), [])
    const withDraft = dialogIndex(
      { ...dlg({ lastMessage: at('2026-08-09T10:00:00Z') }), draft: draftAt(1786276800) }, [])

    expect(withDraft).toBeGreaterThan(withoutDraft)
  })

  it('черновик старше последнего сообщения — индекс не меняется', () => {
    const base = dialogIndex(dlg({ lastMessage: at('2026-08-09T10:00:00Z') }), [])
    const stale = dialogIndex(
      { ...dlg({ lastMessage: at('2026-08-09T10:00:00Z') }), draft: draftAt(1786266000) }, [])

    expect(stale).toBe(base)
  })

  it('детерминированность: те же данные — тот же индекс', () => {
    const d = dlg({ peerId: 3, lastMessage: at('2026-08-09T10:00:00Z') })

    expect(dialogIndex(d, [])).toBe(dialogIndex(d, []))
  })

  it('ничья по дате разводится peerId — одинаково при любом порядке обработки', () => {
    const a = dialogIndex(dlg({ peerId: 10, lastMessage: at('2026-08-09T10:00:00Z') }), [])
    const b = dialogIndex(dlg({ peerId: 11, lastMessage: at('2026-08-09T10:00:00Z') }), [])

    expect(a).not.toBe(b)
    expect(b).toBeGreaterThan(a)
  })

  it('диалог без сообщений не падает', () => {
    expect(Number.isFinite(dialogIndex(dlg({ lastMessage: undefined }), []))).toBe(true)
  })

  // Дата на проводе — `date:int`, но непригодное значение (NaN из битого JSON)
  // отравило бы сортировку ЦЕЛИКОМ: сравнения с NaN ложны в обе стороны.
  it('непригодная дата не ломает индекс', () => {
    const broken = dialogIndex(dlg({ peerId: 4, lastMessage: at('не-дата') }), [])

    expect(Number.isFinite(broken)).toBe(true)
    expect(broken).toBe(dialogIndex(dlg({ peerId: 4, lastMessage: undefined }), []))
  })
})
