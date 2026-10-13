// Мост `popups/forward.bridge.ts`: несколько получателей — пересылка сразу каждому. Платный
// получатель сперва спрашивает согласие на всю пачку (цена × число сообщений уезжает в
// `forwardMessages` результатом подтверждения), отказ от оплаты не пересылает ему ничего.
import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { usePopupStore, type PopupApi } from '@stores/popupStore'

type PickerProps = { onPick: (peerIds: number[]) => void }
let picker: PickerProps | undefined
const { forwardMessages, prepare } = vi.hoisted(() => ({
  forwardMessages: vi.fn(async(..._args: unknown[]) => []),
  prepare: vi.fn(),
}))

vi.mock('@components/messages/ChatDialogs', () => ({
  ForwardPicker: (props: PickerProps) => { picker = props; return null },
}))
vi.mock('@/client/bootstrap', () => ({ startClient: () => ({ managers: { messages: { forwardMessages } } }) }))
vi.mock('@lib/appImManager', () => ({ default: { chat: undefined, setInnerPeer: vi.fn() } }))
vi.mock('@components/toast', () => ({ toastNew: vi.fn() }))
vi.mock('@components/chat/paidMessagesInterceptor', async(importOriginal) => {
  const actual = await importOriginal<typeof import('@components/chat/paidMessagesInterceptor')>()
  return { ...actual, default: { prepareStarsForPayment: prepare } }
})

import { PAYMENT_REJECTED } from '@components/chat/paidMessagesInterceptor'
import showForwardPopup from './forward.bridge'

function mountTopPopup() {
  const popups = usePopupStore.getState().popups
  const entry = popups[popups.length - 1]
  const api: PopupApi = { open: true, requestClose: () => {}, onExitComplete: () => {}, destroy: () => usePopupStore.getState().remove(entry.id) }
  return render(entry.render(api) as ReactElement)
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  usePopupStore.getState().clear()
  picker = undefined
  vi.clearAllMocks()
})
afterEach(() => cleanup())

describe('forward.bridge — платные получатели', () => {
  it('согласие на пачку источника; платному — сумма результатом, отказавшему — ничего', async() => {
    prepare.mockImplementation(async({ peerId }: { peerId: number }) =>
      peerId === -100 ? { starsAmount: 5, canUndo: false } : peerId === -200 ? PAYMENT_REJECTED : undefined)
    await showForwardPopup({ 9: [1, 2, 3] })
    mountTopPopup()

    picker!.onPick([-100, -200, 7])
    await flush()
    await flush()

    expect(prepare).toHaveBeenCalledWith({ peerId: -100, messageCount: 3 })
    expect(forwardMessages).toHaveBeenCalledTimes(2)
    expect(forwardMessages.mock.calls[0]).toEqual([-100, 9, [1, 2, 3], { silent: undefined, scheduleDate: undefined, scheduleRepeatPeriod: undefined, confirmedPaymentResult: { starsAmount: 5, canUndo: false } }])
    expect(forwardMessages.mock.calls[1][0]).toBe(7)
  })
})
