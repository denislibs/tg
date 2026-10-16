import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toastNew } from '@components/toast'
import showPinLimitReached from './showPinLimitReached'

vi.mock('@components/toast', () => ({ toastNew: vi.fn() }))

beforeEach(() => vi.mocked(toastNew).mockClear())

// Ф7-И2: сервер отдаёт имя оригинала PINNED_DIALOGS_TOO_MUCH (tweb
// showPinLimitReached.ts:18); наш прежний текст `pin limit reached` больше не
// производится и отказом лимита не считается.
describe('showPinLimitReached', () => {
  it('PINNED_DIALOGS_TOO_MUCH и PINNED_TOO_MUCH — тост', () => {
    showPinLimitReached({ type: 'PINNED_DIALOGS_TOO_MUCH' })
    showPinLimitReached({ type: 'PINNED_TOO_MUCH' })
    expect(vi.mocked(toastNew)).toHaveBeenCalledTimes(2)
  })

  it('прочие отказы, в том числе прежний `pin limit reached`, — без тоста', () => {
    showPinLimitReached({ type: 'pin limit reached' })
    showPinLimitReached(new Error('boom'))
    expect(vi.mocked(toastNew)).not.toHaveBeenCalled()
  })
})
