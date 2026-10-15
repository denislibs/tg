// Мост `popups/shareUrl.bridge.ts` (ВРЕМЕННО до 2C-24): адрес уходит текстом в каждый
// выбранный чат; у платного чата сперва спрашивается согласие (tweb `shareUrl.ts:55-60`
// — `PaidMessagesInterceptor.prepareStarsForPayment`), цена одного сообщения уезжает
// пакетом `confirmedPaymentResult`; отказ пропускает только этот чат.
import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { usePopupStore, type PopupApi } from '@stores/popupStore'

type PickerProps = { onPick: (peerIds: number[]) => Promise<void> | void, onClose: () => void }
let picker: PickerProps | undefined
const { sendText, setInnerPeer, prepare } = vi.hoisted(() => ({
  sendText: vi.fn(async(_args: Record<string, unknown>) => ({ ok: true })),
  setInnerPeer: vi.fn(),
  prepare: vi.fn(),
}))

vi.mock('@components/messages/ChatDialogs', () => ({
  ForwardPicker: (props: PickerProps) => { picker = props; return null },
}))
vi.mock('@/client/bootstrap', () => ({ startClient: () => ({ managers: { messages: { sendText } } }) }))
vi.mock('@lib/appImManager', () => ({ default: { setInnerPeer } }))
vi.mock('@components/chat/paidMessagesInterceptor', async(importOriginal) => {
  const actual = await importOriginal<typeof import('@components/chat/paidMessagesInterceptor')>()
  return { ...actual, default: { prepareStarsForPayment: prepare } }
})

import { PAYMENT_REJECTED } from '@components/chat/paidMessagesInterceptor'
import shareUrlToPeers from './shareUrl.bridge'

function mountTopPopup() {
  const popups = usePopupStore.getState().popups
  const entry = popups[popups.length - 1]
  const api: PopupApi = { open: true, requestClose: () => {}, onExitComplete: () => {}, destroy: () => usePopupStore.getState().remove(entry.id) }
  return render(entry.render(api) as ReactElement)
}

beforeEach(() => {
  usePopupStore.getState().clear()
  picker = undefined
  vi.clearAllMocks()
})
afterEach(() => cleanup())

describe('shareUrl.bridge — платные чаты', () => {
  it('согласие спрашивается у каждого получателя; цена уезжает пакетом, отказанный чат пропускается', async() => {
    prepare.mockImplementation(async({ peerId }: { peerId: number }) =>
      peerId === -100 ? { starsAmount: 5, canUndo: false } : peerId === -200 ? PAYMENT_REJECTED : undefined)
    shareUrlToPeers({ url: 'https://t.me/x' })
    mountTopPopup()

    await picker!.onPick([-100, -200, 7])

    expect(prepare.mock.calls.map(([a]) => a)).toEqual([
      { messageCount: 1, peerId: -100 }, { messageCount: 1, peerId: -200 }, { messageCount: 1, peerId: 7 },
    ])
    expect(sendText).toHaveBeenCalledTimes(2)
    expect(sendText.mock.calls[0][0]).toMatchObject({ peerId: -100, text: 'https://t.me/x', confirmedPaymentResult: { starsAmount: 5, canUndo: false } })
    expect(sendText.mock.calls[1][0]).toMatchObject({ peerId: 7, confirmedPaymentResult: undefined })
  })

  it('единственный получатель с openAfter: чат открывается, только если отправка состоялась', async() => {
    prepare.mockResolvedValue(PAYMENT_REJECTED)
    shareUrlToPeers({ url: 'u', openAfter: true })
    mountTopPopup()
    await picker!.onPick([-100])
    expect(setInnerPeer).not.toHaveBeenCalled()

    prepare.mockResolvedValue(undefined)
    await picker!.onPick([-100])
    expect(setInnerPeer).toHaveBeenCalledWith({ peerId: -100 })
  })
})
