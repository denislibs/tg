import { describe, it, expect } from 'vitest'
import { goDownUnreadCount } from './goDownUnreadCount'

// tweb `chat/input.ts::setUnreadCount` (:2240-2241): бейдж — `dialog.unread_count`.
describe('goDownUnreadCount', () => {
  it('свои исходящие после горизонта прочтения бейдж не дают', () => {
    // Живой случай со стенда: горизонт входящих 33, последнее сообщение 37 —
    // и все четыре своими. Непрочитанного нет.
    const dialog = { unread_count: 0, read_inbox_max_id: 33, lastMessage: { id: 37 } }
    expect(goDownUnreadCount(dialog)).toBe(0)
  })

  it('число — счётчик непрочитанного диалога, а не разность номеров', () => {
    // Два входящих непрочитанных при дыре от удалённого сообщения.
    const dialog = { unread_count: 2, read_inbox_max_id: 10, lastMessage: { id: 14 } }
    expect(goDownUnreadCount(dialog)).toBe(2)
  })

  it('диалога нет — пустой бейдж', () => {
    expect(goDownUnreadCount(undefined)).toBe(0)
  })
})
