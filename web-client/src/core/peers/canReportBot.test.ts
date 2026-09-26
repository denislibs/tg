// Порт tweb `src/tests/canReportBot.test.ts` (2488f2cf0) в части, у которой есть
// предмет (support/бот кодов — см. шапку `canReportBot.ts`).
import { describe, expect, it } from 'vitest'

import canReportBot from './canReportBot'
import type { User } from './peer'

describe('canReportBot', () => {
  it('allows ordinary bots', () => {
    expect(canReportBot({ _: 'user', id: 1, pFlags: { bot: true } })).toBe(true)
  })

  it('rejects regular users', () => {
    expect(canReportBot({ _: 'user', id: 1, pFlags: {} })).toBe(false)
  })

  it('rejects an unknown or empty user', () => {
    expect(canReportBot(undefined)).toBe(false)
    expect(canReportBot({ _: 'userEmpty', id: 1 } as User)).toBe(false)
  })
})
