// Ф7-Г: история уходит в чаты по одному, у каждого платного — своё согласие (tweb
// `stories/share.ts:17`); отказ от оплаты пропускает только этот чат.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prepare = vi.hoisted(() => vi.fn())
vi.mock('@components/chat/paidMessagesInterceptor', async(importOriginal) => {
  const actual = await importOriginal<typeof import('@components/chat/paidMessagesInterceptor')>()
  return { ...actual, default: { prepareStarsForPayment: prepare } }
})

import { PAYMENT_REJECTED } from '@components/chat/paidMessagesInterceptor'
import { shareStoryToChats } from './share'

describe('shareStoryToChats', () => {
  beforeEach(() => vi.clearAllMocks())

  it('по чату за вызов; сумма — результатом согласия; отказавший пропущен', async() => {
    prepare.mockImplementation(async({ peerId }: { peerId: number }) =>
      peerId === -100 ? { starsAmount: 5, canUndo: false } : peerId === -200 ? PAYMENT_REJECTED : undefined)
    const share = vi.fn(async() => 1)

    const sent = await shareStoryToChats({ stories: { share } } as never, 10, 42, [-100, -200, 7])

    expect(sent).toBe(2)
    expect(share.mock.calls).toEqual([
      [10, 42, [-100], { starsAmount: 5, canUndo: false }],
      [10, 42, [7], undefined],
    ])
  })
})
