// СТИКЕР В ЛЕНТЕ — проигрывание и клик.
//
// Пины:
//   (1) стикер бабла заводится ИГРАЮЩИМ и ЗАЦИКЛЕННЫМ (tweb bubbles.ts:6087-6088
//       `loop = true, play = true` + передача :6126-6136). Проверяется не форма
//       вызова враппера, а то, с чем создан ПЛЕЕР: `autoplay`/`loop` уходят в
//       `LottiePlayer`, и терм `animation.autoplay` — единственный гейт
//       `animationIntersector`, решающий, играть ли вообще;
//   (2) `emoji` обычному стикеру не передаётся (tweb :6135 — только у
//       `emoji-big`): во враппере оно тождественно гасит цикл
//       (`wrappers/sticker.ts:167`, tweb `sticker.ts:135`);
//   (3) клик по стикеру открывает НАБОР (tweb :3432-3442) и НЕ открывает
//       медиавьювер — ветка стоит до :3479;
//   (4) то же проигрывание у стикера-приветствия пустого чата (tweb :10571-10585).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import rootScope from '@lib/rootScope'
import { saveDocument, type InputStickerSet, type InputStickerSetID, type MessageMedia, type MyDocument } from '@core/media/messageMedia'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import lottieLoader from '@lib/lottie/lottieLoader'
import * as stickerContent from '@components/wrappers/stickerContent'
import * as viewer from '@components/mediaViewer/openMediaViewer'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const ME = 1
const CHAT = 60
const FRIEND = 8
const SET: InputStickerSetID = { _: 'inputStickerSetID', id: 777 }

const chatContext = (over: Partial<ChatContext> = {}): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
  ...over,
})

const managersWith = (messages: MyMessage[], stickers?: BubblesManagers['stickers']): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> =>
      ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
  ...(stickers ? { stickers } : {}),
})

/** Анимированный (tgs) стикер набора: `saveDocument` выводит тип и `animated`
 *  из mime, адрес набора — из `documentAttributeSticker`. */
const stickerDoc = (id: number, stickerset: InputStickerSet): MyDocument =>
  saveDocument({
    _: 'document', id, mime_type: 'application/x-tgsticker', size: 4096,
    attributes: [
      { _: 'documentAttributeSticker', alt: '🙂', stickerset },
      { _: 'documentAttributeImageSize', w: 512, h: 512 },
    ],
  })

const stickerMedia = (doc: MyDocument): MessageMedia => ({ _: 'messageMediaDocument', document: doc })

const withSticker = (id: number, doc: MyDocument): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: '', createdAt: '2026-08-15T12:00:00Z', media: stickerMedia(doc) })

/** Плеер lottie в jsdom не поднять (воркер + wasm), поэтому загрузчик заменён
 *  заглушкой: пин — на ПАРАМЕТРАХ, с которыми плеер создаётся. */
const stubPlayer = () => ({ onFirstFrame: vi.fn(), canvas: [document.createElement('canvas')] }) as unknown as LottiePlayer

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Клик приходит с САМОГО стикера (canvas/img внутри `.attachment`) — как в
 *  оригинале, где ветка читает `target.parentElement` (tweb :3432). */
function clickSticker(attachment: HTMLElement) {
  const media = document.createElement('img')
  attachment.append(media)
  media.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  vi.restoreAllMocks()
  rootScope.myId = ME
  vi.spyOn(stickerContent, 'loadStickerContent').mockResolvedValue({ kind: 'lottie', data: { v: '5.5' } })
})

describe('ChatBubbles — стикер в ленте', () => {
  it('стикер заводится играющим и зациклённым', async () => {
    const load = vi.spyOn(lottieLoader, 'loadAnimationWorker').mockImplementation(async () => stubPlayer())

    bubbles = new ChatBubbles(chatContext(), managersWith([withSticker(1, stickerDoc(22, SET))]))
    await (await bubbles.setPeer())?.promise
    await settle()

    expect(load).toHaveBeenCalledTimes(1)
    const params = load.mock.calls[0][0]
    expect(params.autoplay).toBe(true)
    expect(params.loop).toBe(true)
  })

  it('обычному стикеру не передаётся emoji — иначе цикл гаснет во враппере', async () => {
    vi.spyOn(lottieLoader, 'loadAnimationWorker').mockImplementation(async () => stubPlayer())

    bubbles = new ChatBubbles(chatContext(), managersWith([withSticker(1, stickerDoc(22, SET))]))
    await (await bubbles.setPeer())?.promise
    await settle()

    const attachment = bubbles.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"] .attachment')!
    expect(attachment.dataset.docId).toBe('22')
    expect(attachment.dataset.stickerEmoji).toBeUndefined()
  })

  it('клик по стикеру открывает набор, а не медиавьювер', async () => {
    vi.spyOn(lottieLoader, 'loadAnimationWorker').mockImplementation(async () => stubPlayer())
    const opened = vi.fn()
    vi.spyOn(viewer, 'openMediaViewer').mockImplementation((args) => { opened(args); return undefined })
    const showStickerSet = vi.fn()

    bubbles = new ChatBubbles(chatContext({ showStickerSet }), managersWith([withSticker(1, stickerDoc(22, SET))]))
    await (await bubbles.setPeer())?.promise
    await settle()

    document.body.append(bubbles.container)
    clickSticker(bubbles.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"] .attachment')!)

    expect(showStickerSet).toHaveBeenCalledWith(SET)
    expect(opened).not.toHaveBeenCalled()
    bubbles.container.remove()
  })

  it('стикер без набора не открывает ни набор, ни медиавьювер', async () => {
    vi.spyOn(lottieLoader, 'loadAnimationWorker').mockImplementation(async () => stubPlayer())
    const opened = vi.fn()
    vi.spyOn(viewer, 'openMediaViewer').mockImplementation((args) => { opened(args); return undefined })
    const showStickerSet = vi.fn()

    bubbles = new ChatBubbles(
      chatContext({ showStickerSet }),
      managersWith([withSticker(1, stickerDoc(22, { _: 'inputStickerSetEmpty' }))]),
    )
    await (await bubbles.setPeer())?.promise
    await settle()

    document.body.append(bubbles.container)
    clickSticker(bubbles.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"] .attachment')!)

    expect(showStickerSet).not.toHaveBeenCalled()
    expect(opened).not.toHaveBeenCalled()
    bubbles.container.remove()
  })

  it('стикер приветствия пустого чата тоже играет и зациклен', async () => {
    const load = vi.spyOn(lottieLoader, 'loadAnimationWorker').mockImplementation(async () => stubPlayer())
    const greeting = stickerDoc(555, SET)

    bubbles = new ChatBubbles(
      chatContext({ peerId: FRIEND, messagesStorageKey: String(FRIEND), canSend: () => true }),
      managersWith([], { searchByEmoji: vi.fn(async () => [greeting]) }),
    )
    await (await bubbles.setPeer())?.promise
    await settle()

    expect(load).toHaveBeenCalledTimes(1)
    const params = load.mock.calls[0][0]
    expect(params.autoplay).toBe(true)
    expect(params.loop).toBe(true)

    const sticker = bubbles.container.querySelector<HTMLElement>('.empty-bubble-placeholder-sticker')!
    expect(sticker.dataset.stickerEmoji).toBeUndefined()
  })
})
