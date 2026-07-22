import { describe, it, expect } from 'vitest'
import { countUnmutedUnread, titleFor } from './appBadge'

const d = (unread: number, muted = false, archived = false) => ({ unread, muted, archived })

describe('countUnmutedUnread', () => {
  it('суммирует unread по обычным диалогам', () => {
    expect(countUnmutedUnread([d(2), d(3), d(0)])).toBe(5)
  })

  it('muted-чаты бейдж не красят', () => {
    expect(countUnmutedUnread([d(2), d(7, true), d(1)])).toBe(3)
  })

  it('архив не считается (tweb: бейдж по папке «Все»)', () => {
    expect(countUnmutedUnread([d(2), d(4, false, true)])).toBe(2)
  })

  it('пустой список → 0', () => {
    expect(countUnmutedUnread([])).toBe(0)
  })
})

describe('titleFor', () => {
  it('unread > 0 → «(N) Telegram»', () => {
    expect(titleFor(1)).toBe('(1) Telegram')
    expect(titleFor(42)).toBe('(42) Telegram')
  })

  it('unread = 0 → «Telegram»', () => {
    expect(titleFor(0)).toBe('Telegram')
  })
})
