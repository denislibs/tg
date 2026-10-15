// Мост `popups/newMedia.ts` (ВРЕМЕННО до порта newMedia.tsx): попап сам шлёт
// выборку, как tweb `newMedia.tsx:1022-1106` — пакет параметров один на всю
// выборку, альбом общим `groupedId`, плашка ответа гаснет после отправки;
// `getCurrentNewMediaPopup().addFiles` дописывает в открытый попап.
import { act, render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { usePopupStore, type PopupApi } from '@stores/popupStore'
import type { MessageSendingParams } from '@core/managers/messages/sendingParams'
import { PAYMENT_REJECTED, type PreparedPaymentResult } from '@components/chat/paidMessagesInterceptor'

type StubProps = {
  files: File[]
  initialAsFile: boolean
  onClose: () => void
  onSend: (caption: string, asFile: boolean, paidPrice?: number | null, spoilers?: boolean[]) => void
}
let lastProps: StubProps | undefined

vi.mock('@components/messages/SendMediaPopup', () => ({
  default: (props: StubProps) => {
    lastProps = props
    return null
  },
}))
vi.mock('@core/media/scaleImageForSend', () => ({
  scaleImageForSend: async(file: File) => ({ file, width: 10, height: 20 }),
}))

import { ChatType } from '@components/chat/chatType'

const { default: showNewMediaPopup, getCurrentNewMediaPopup } = await import('./newMedia')

const photo = (name: string) => new File(['x'], name, { type: 'image/png' })
const doc = (name: string) => new File(['x'], name, { type: 'application/pdf' })

function makeChat(params: MessageSendingParams, type = ChatType.Chat) {
  const sendFile = vi.fn(async() => {})
  const sendGrouped = vi.fn(async() => {})
  const onHelperCancel = vi.fn()
  const getMessageSendingParams = vi.fn(() => params)
  const scheduleSending = vi.fn((_callback: () => void) => {})
  const resetSendingFlags = vi.fn()
  const prepareStarsForPayment = vi.fn(async(_messageCount: number): Promise<PreparedPaymentResult> => undefined)
  const chat = {
    peerId: 5 as PeerId,
    managers: { messages: { sendFile, sendGrouped } } as never,
    type,
    input: { getMessageSendingParams, onHelperCancel, scheduleSending, resetSendingFlags, paidMessageInterceptor: { prepareStarsForPayment } },
  }
  return { chat, sendFile, sendGrouped, onHelperCancel, getMessageSendingParams, scheduleSending, resetSendingFlags, prepareStarsForPayment }
}

function mountTopPopup() {
  const popups = usePopupStore.getState().popups
  const entry = popups[popups.length - 1]
  const api: PopupApi = {
    open: true,
    requestClose: () => {},
    onExitComplete: () => {},
    destroy: () => usePopupStore.getState().remove(entry.id),
  }
  return render(entry.render(api) as ReactElement)
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('popups/newMedia — мост попапа медиа', () => {
  beforeEach(() => {
    usePopupStore.getState().clear()
    lastProps = undefined
  })
  afterEach(() => cleanup())

  it('willAttachType документа открывает попап «как файл»', () => {
    const { chat } = makeChat({})
    showNewMediaPopup(chat, [doc('a.pdf')], 'document')
    mountTopPopup()
    expect(lastProps?.initialAsFile).toBe(true)
  })

  it('несколько фото — один пакет параметров, общий groupedId, подпись на первом, плашка ответа гаснет', async() => {
    const { chat, sendFile, sendGrouped, onHelperCancel, getMessageSendingParams } = makeChat({ replyToMsgId: 42 })
    showNewMediaPopup(chat, [photo('1.png'), photo('2.png')], 'media')
    mountTopPopup()

    act(() => lastProps!.onSend('подпись', false, null, [false, true]))
    await flush()

    expect(getMessageSendingParams).toHaveBeenCalledTimes(1)
    // tweb `sendGrouped` (appMessagesManager.ts:3593): альбом — ОДИН вызов со всеми файлами
    expect(sendFile).not.toHaveBeenCalled()
    expect(sendGrouped).toHaveBeenCalledTimes(1)
    const [a, b] = (sendGrouped.mock.calls[0] as unknown as [Record<string, unknown>[]])[0]
    expect(a.groupedId).toBeDefined()
    expect(a.groupedId).toBe(b.groupedId)
    expect([a.caption, b.caption]).toEqual(['подпись', ''])
    expect([a.type, a.isMedia, a.replyToMsgId]).toEqual(['photo', true, 42])
    expect([a.spoiler, b.spoiler]).toEqual([false, true])
    expect(onHelperCancel).toHaveBeenCalledTimes(1)
    expect(usePopupStore.getState().popups).toHaveLength(0)
  })

  // Контрольный проход Ф7-Г п.1, tweb newMedia.tsx:1013-1018 -> :1032-1036: в ленте отложенных
  // сперва календарь (попап открыт), затем согласие на плату и только потом закрытие.
  it('лента отложенных: календарь → согласие → закрытие попапа; отказ после календаря оставляет попап', async() => {
    const { chat, sendGrouped, scheduleSending, prepareStarsForPayment, resetSendingFlags } = makeChat({ scheduleDate: 1_900_000_000 }, ChatType.Scheduled)
    showNewMediaPopup(chat, [photo('1.png'), photo('2.png')], 'media')
    mountTopPopup()

    act(() => lastProps!.onSend('', false))
    await flush()
    expect(scheduleSending).toHaveBeenCalledTimes(1)
    expect(prepareStarsForPayment).not.toHaveBeenCalled() // календарь ещё открыт
    expect(usePopupStore.getState().popups).toHaveLength(1)

    prepareStarsForPayment.mockResolvedValueOnce(PAYMENT_REJECTED)
    scheduleSending.mock.calls[0][0]()
    await flush()
    expect(prepareStarsForPayment).toHaveBeenCalledWith(2)
    expect(sendGrouped).not.toHaveBeenCalled()
    expect(resetSendingFlags).toHaveBeenCalledTimes(1) // время календаря не утекает
    expect(usePopupStore.getState().popups).toHaveLength(1)

    scheduleSending.mock.calls[0][0]()
    await flush()
    expect(sendGrouped).toHaveBeenCalledTimes(1)
    expect(usePopupStore.getState().popups).toHaveLength(0)
  })

  // Ф7-Г (MC-06), tweb newMedia.tsx:1032-1036: согласие на плату за ВСЕ сообщения
  // выборки; цена одного уезжает пакетом в каждый файл.
  it('платный чат: согласие спрашивается на число файлов и уезжает в каждый файл пакетом', async() => {
    const { chat, sendGrouped, prepareStarsForPayment } = makeChat({})
    prepareStarsForPayment.mockResolvedValue({ starsAmount: 5, canUndo: false })
    showNewMediaPopup(chat, [photo('1.png'), photo('2.png')], 'media')
    mountTopPopup()

    act(() => lastProps!.onSend('', false))
    await flush()

    expect(prepareStarsForPayment).toHaveBeenCalledWith(2)
    const items = (sendGrouped.mock.calls[0] as unknown as [Record<string, unknown>[]])[0]
    expect(items.map((c) => c.confirmedPaymentResult)).toEqual([{ starsAmount: 5, canUndo: false }, { starsAmount: 5, canUndo: false }])
  })

  it('платный чат: отказ от оплаты — ничего не уходит, плашка ответа остаётся', async() => {
    const { chat, sendFile, sendGrouped, onHelperCancel, prepareStarsForPayment } = makeChat({ replyToMsgId: 42 })
    prepareStarsForPayment.mockResolvedValue(PAYMENT_REJECTED)
    showNewMediaPopup(chat, [photo('1.png')], 'media')
    mountTopPopup()

    act(() => lastProps!.onSend('', false))
    await flush()

    expect(sendFile).not.toHaveBeenCalled()
    expect(sendGrouped).not.toHaveBeenCalled()
    expect(onHelperCancel).not.toHaveBeenCalled()
    // tweb newMedia.tsx:1035 — попап остаётся открытым, выборка и подпись не теряются
    expect(usePopupStore.getState().popups).toHaveLength(1)
  })

  // tweb newMedia.tsx:1013-1018: в ленте отложенных сперва календарь, затем
  // выборка уходит с пакетом, где уже лежит выбранное время.
  it('лента отложенных: отправка спрашивает время, выборка уходит после выбора', async() => {
    const { chat, sendGrouped, scheduleSending } = makeChat({ scheduleDate: 1_900_000_000 }, ChatType.Scheduled)
    showNewMediaPopup(chat, [photo('1.png'), photo('2.png')], 'media')
    mountTopPopup()

    act(() => lastProps!.onSend('', false))
    await flush()
    expect(sendGrouped).not.toHaveBeenCalled()
    expect(scheduleSending).toHaveBeenCalledTimes(1)

    scheduleSending.mock.calls[0][0]()
    await flush()
    const calls = (sendGrouped.mock.calls[0] as unknown as [Record<string, unknown>[]])[0]
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.scheduleDate === 1_900_000_000)).toBe(true)
    expect(calls[0].groupedId).toBe(calls[1].groupedId)
  })

  // tweb newMedia.tsx:897-907 — `send` в `finally` снимает разовые флаги
  // композера: этот путь мимо `onMessageSent`, и без сброса выбранное время и
  // повтор унаследовали бы следующие опрос или голосовое.
  it('после отправки разовые флаги пакета снимаются (время и повтор не утекают)', async() => {
    const flags: MessageSendingParams = {}
    const { chat, sendFile, scheduleSending, getMessageSendingParams, resetSendingFlags } = makeChat(flags, ChatType.Scheduled)
    getMessageSendingParams.mockImplementation(() => ({ ...flags }))
    resetSendingFlags.mockImplementation(() => { delete flags.scheduleDate; delete flags.scheduleRepeatPeriod })
    showNewMediaPopup(chat, [photo('1.png')], 'media')
    mountTopPopup()

    act(() => lastProps!.onSend('', false))
    await flush()
    // календарь выставил флаги и вызвал отправку
    Object.assign(flags, { scheduleDate: 1_900_000_000, scheduleRepeatPeriod: 86400 })
    scheduleSending.mock.calls[0][0]()
    await flush()

    expect(sendFile).toHaveBeenCalledWith(expect.objectContaining({ scheduleDate: 1_900_000_000, scheduleRepeatPeriod: 86400 }))
    expect(flags).toEqual({})
  })

  it('«как файл» — без альбома и без цены, без ответа плашку не трогает', async() => {
    const { chat, sendFile, onHelperCancel } = makeChat({})
    showNewMediaPopup(chat, [photo('1.png'), photo('2.png')], 'media')
    mountTopPopup()

    act(() => lastProps!.onSend('', true, 50))
    await flush()

    const calls = sendFile.mock.calls.map((c) => (c as unknown as [Record<string, unknown>])[0])
    expect(calls.map((c) => [c.type, c.groupedId, c.paidMediaPrice, c.isMedia])).toEqual([
      ['document', undefined, null, false],
      ['document', undefined, null, false],
    ])
    expect(onHelperCancel).not.toHaveBeenCalled()
  })

  it('getCurrentNewMediaPopup().addFiles дописывает в открытый попап; закрытие снимает его', () => {
    const { chat } = makeChat({})
    expect(getCurrentNewMediaPopup()).toBeUndefined()
    showNewMediaPopup(chat, [photo('1.png')], 'media')
    const view = mountTopPopup()

    act(() => getCurrentNewMediaPopup()!.addFiles([photo('2.png')]))
    expect(lastProps!.files.map((f) => f.name)).toEqual(['1.png', '2.png'])

    view.unmount()
    expect(getCurrentNewMediaPopup()).toBeUndefined()
  })
})
