// Порядок диалогов — производная от данных: из одних и тех же данных всегда
// один и тот же индекс, поэтому кэш и сеть не расходятся и список не
// перетасовывается после ответа сети.
import { describe, expect, it } from 'vitest'
import { dialogIndex } from './dialogIndex'
import type { Dialog } from '../models'

const at = (iso: string): Dialog['lastMessage'] => ({ seq: 1, text: 'x', senderId: 1, at: iso })

const dlg = (over: Partial<Dialog>): Dialog => ({
  peerId: 1,
  type: 'private',
  lastReadSeq: 0,
  peerReadSeq: 0,
  unread: 0,
  muted: false,
  pinned: false,
  archived: false,
  lastMessage: at('2026-08-09T10:00:00Z'),
  ...over,
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

  // Черновик в нашем репозитории живёт не в Dialog, а в отдельном сторе
  // (AppState.drafts → Draft.updatedAt), поэтому дата приезжает третьим
  // аргументом — модуль остаётся чистым.
  it('черновик свежее последнего сообщения — поднимает диалог', () => {
    const withoutDraft = dialogIndex(dlg({ lastMessage: at('2026-08-09T10:00:00Z') }), [])
    const withDraft = dialogIndex(dlg({ lastMessage: at('2026-08-09T10:00:00Z') }), [], {
      updatedAt: '2026-08-09T12:00:00Z',
    })

    expect(withDraft).toBeGreaterThan(withoutDraft)
  })

  it('черновик старше последнего сообщения — индекс не меняется', () => {
    const base = dialogIndex(dlg({ lastMessage: at('2026-08-09T10:00:00Z') }), [])
    const stale = dialogIndex(dlg({ lastMessage: at('2026-08-09T10:00:00Z') }), [], {
      updatedAt: '2026-08-09T09:00:00Z',
    })

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

  it('битая дата не ломает индекс', () => {
    const broken = dialogIndex(dlg({ peerId: 4, lastMessage: at('не-дата') }), [])

    expect(Number.isFinite(broken)).toBe(true)
    expect(broken).toBe(dialogIndex(dlg({ peerId: 4, lastMessage: undefined }), []))
  })
})
