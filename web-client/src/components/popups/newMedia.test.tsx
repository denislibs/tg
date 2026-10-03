// Мост `popups/newMedia.ts` (ВРЕМЕННО до порта newMedia.tsx): попап сам шлёт
// выборку, как tweb `newMedia.tsx:1022-1106` — пакет параметров один на всю
// выборку, альбом общим `groupedId`, плашка ответа гаснет после отправки;
// `getCurrentNewMediaPopup().addFiles` дописывает в открытый попап.
import { act, render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { usePopupStore, type PopupApi } from '@stores/popupStore'
import type { MessageSendingParams } from '@core/managers/messages/sendingParams'

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

const { default: showNewMediaPopup, getCurrentNewMediaPopup } = await import('./newMedia')

const photo = (name: string) => new File(['x'], name, { type: 'image/png' })
const doc = (name: string) => new File(['x'], name, { type: 'application/pdf' })

function makeChat(params: MessageSendingParams) {
  const sendFile = vi.fn(async() => {})
  const onHelperCancel = vi.fn()
  const getMessageSendingParams = vi.fn(() => params)
  const chat = {
    peerId: 5 as PeerId,
    managers: { messages: { sendFile } } as never,
    input: { getMessageSendingParams, onHelperCancel },
  }
  return { chat, sendFile, onHelperCancel, getMessageSendingParams }
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
    const { chat, sendFile, onHelperCancel, getMessageSendingParams } = makeChat({ replyToMsgId: 42 })
    showNewMediaPopup(chat, [photo('1.png'), photo('2.png')], 'media')
    mountTopPopup()

    act(() => lastProps!.onSend('подпись', false, null, [false, true]))
    await flush()

    expect(getMessageSendingParams).toHaveBeenCalledTimes(1)
    expect(sendFile).toHaveBeenCalledTimes(2)
    const [a, b] = sendFile.mock.calls.map((c) => (c as unknown as [Record<string, unknown>])[0])
    expect(a.groupedId).toBeDefined()
    expect(a.groupedId).toBe(b.groupedId)
    expect([a.caption, b.caption]).toEqual(['подпись', ''])
    expect([a.type, a.isMedia, a.replyToMsgId]).toEqual(['photo', true, 42])
    expect([a.spoiler, b.spoiler]).toEqual([false, true])
    expect(onHelperCancel).toHaveBeenCalledTimes(1)
    expect(usePopupStore.getState().popups).toHaveLength(0)
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
