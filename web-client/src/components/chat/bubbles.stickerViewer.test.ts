// ПРЕДПРОСМОТР СТИКЕРА ПО ЗАЖАТИЮ В ЛЕНТЕ — tweb bubbles.ts:1591-1599:
// `attachStickerViewerListeners` на скроллере ленты, цель — `.attachment`
// стикера/GIF. Механика жеста — `components/stickerViewer.test.ts`; здесь — что
// лента его подключила и что отпускание не открывает набор кликом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import rootScope from '@lib/rootScope'
import { saveDocument, type InputStickerSetID, type MyDocument } from '@core/media/messageMedia'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import lottieLoader from '@lib/lottie/lottieLoader'
import * as stickerContent from '@components/wrappers/stickerContent'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles } from './testChat'

// Реестр документов воркера (`managers.docs.getDoc`) — та же функция модуля:
// документ стикера проходит `saveDocument`.
vi.mock('@/client/bootstrap', async () => {
  const { getDoc } = await import('@core/media/messageMedia')
  return { startClient: () => ({ managers: { docs: { getDoc: async (id: number) => getDoc(id) } } }) }
})

// Попап набора, который открыл бы клик по стикеру (tweb :3432-3442).
const { openStickerSetModal } = vi.hoisted(() => ({ openStickerSetModal: vi.fn() }))
vi.mock('@components/stickers/StickerSetModal', () => ({ openStickerSetModal }))

const CHAT = 60
const SET: InputStickerSetID = { _: 'inputStickerSetID', id: 777 }

const stickerDoc = (id: number): MyDocument =>
  saveDocument({
    _: 'document', id, mime_type: 'application/x-tgsticker', size: 4096,
    attributes: [
      { _: 'documentAttributeSticker', alt: '🙂', stickerset: SET },
      { _: 'documentAttributeImageSize', w: 512, h: 512 },
    ],
  })

const withSticker = (id: number, doc: MyDocument): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: '', createdAt: '2026-08-15T12:00:00Z', media: { _: 'messageMediaDocument', document: doc } })

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> =>
      ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0), getDialogReadState: vi.fn(async () => undefined) },
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

const stubPlayer = () => ({ onFirstFrame: vi.fn(), canvas: [document.createElement('canvas')] }) as unknown as LottiePlayer

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const mouse = (type: string, target: EventTarget) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1 }))

let bubbles: ChatBubbles | undefined
afterEach(() => {
  vi.useRealTimers()
  bubbles?.container.remove()
  bubbles?.destroy()
  bubbles = undefined
})
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  vi.restoreAllMocks()
  rootScope.myId = 1
  vi.spyOn(stickerContent, 'loadStickerContent').mockResolvedValue({ kind: 'lottie', data: { v: '5.5' } })
})

describe('ChatBubbles — предпросмотр стикера по зажатию', () => {
  it('зажатие на стикере бабла открывает .sticker-viewer с этим стикером; отпускание закрывает, а клик набор не открывает', async () => {
    const load = vi.spyOn(lottieLoader, 'loadAnimationWorker').mockImplementation(async () => stubPlayer())
    bubbles = mountTestBubbles(createTestChat({ peerId: CHAT }), managersWith([withSticker(1, stickerDoc(22))]))
    await (await bubbles.setPeer())?.promise
    await settle()
    document.body.append(bubbles.container)
    expect(load).toHaveBeenCalledTimes(1) // стикер самого бабла

    const attachment = bubbles.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"] .attachment.media-sticker-wrapper')!
    const media = document.createElement('img')
    attachment.append(media)

    vi.useFakeTimers()
    mouse('mousedown', media)
    await vi.advanceTimersByTimeAsync(400)

    const v = document.querySelector('.sticker-viewer.is-visible')
    expect(v).not.toBeNull()
    expect(v!.querySelector<HTMLElement>('.sticker-viewer-sticker')!.dataset.docId).toBe('22')
    expect(load).toHaveBeenCalledTimes(2) // второй плеер — у просмотрщика

    mouse('mouseup', media)
    await vi.advanceTimersByTimeAsync(250)
    expect(document.querySelector('.sticker-viewer')).toBeNull()

    mouse('click', media)
    vi.useRealTimers()
    for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(openStickerSetModal).not.toHaveBeenCalled()
  })
})
