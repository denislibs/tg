// isUnreadByReadCursor — порт tweb 79d6a8f95
// (`appManagers/utils/messages/isUnreadByReadCursor.ts`).
import { describe, expect, it } from 'vitest'
import isUnreadByReadCursor from './isUnreadByReadCursor'

describe('isUnreadByReadCursor', () => {
  it('непрочитано только то, что ВЫШЕ курсора прочтения', () => {
    expect(isUnreadByReadCursor(40, 41)).toBe(true)
    expect(isUnreadByReadCursor(40, 40)).toBe(false)
    expect(isUnreadByReadCursor(40, 39)).toBe(false)
  })

  it('курсор 0 — ничего не прочитано', () => {
    expect(isUnreadByReadCursor(0, 1)).toBe(true)
  })

  it('неизвестный курсор отвечается консервативно: непрочитано', () => {
    // наблюдатель — единственный, кто отмечает историю прочитанной; пропустить
    // его на догадке нельзя
    expect(isUnreadByReadCursor(undefined, 1)).toBe(true)
    expect(isUnreadByReadCursor(NaN, 1)).toBe(true)
  })
})
