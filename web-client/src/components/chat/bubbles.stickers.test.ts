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
//   (3) клик по стикеру открывает НАБОР (tweb :3432-3442: попап набора —
//       `StickerSetModal`, выбранный стикер уходит `chat.input`) и НЕ открывает
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
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles, type TestChatOptions } from './testChat'

// Попап набора лента грузит чанком по клику (`import('@components/stickers/StickerSetModal')`);
// мокается граница — сам вызов попапа.
const { openStickerSetModal } = vi.hoisted(() => ({
  openStickerSetModal: vi.fn<(address: { id: number }, onPick?: (sticker: unknown) => void) => void>(),
}))
vi.mock('@components/stickers/StickerSetModal', () => ({ openStickerSetModal }))

const ME = 1
const CHAT = 60
const FRIEND = 8
const SET: InputStickerSetID = { _: 'inputStickerSetID', id: 777 }

const chatContext = (over: TestChatOptions = {}) => createTestChat({ peerId: CHAT, ...over })

const managersWith = (messages: MyMessage[], stickers?: BubblesManagers['stickers']): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> =>
      ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0), getDialogReadState: vi.fn(async () => undefined) },
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

    bubbles = mountTestBubbles(chatContext(), managersWith([withSticker(1, stickerDoc(22, SET))]))
    await (await bubbles.setPeer())?.promise
    await settle()

    expect(load).toHaveBeenCalledTimes(1)
    const params = load.mock.calls[0][0]
    expect(params.autoplay).toBe(true)
    expect(params.loop).toBe(true)
  })

  it('обычному стикеру не передаётся emoji — иначе цикл гаснет во враппере', async () => {
    vi.spyOn(lottieLoader, 'loadAnimationWorker').mockImplementation(async () => stubPlayer())

    bubbles = mountTestBubbles(chatContext(), managersWith([withSticker(1, stickerDoc(22, SET))]))
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
    openStickerSetModal.mockClear()
    const sendMessageWithDocument = vi.fn(() => true)

    bubbles = mountTestBubbles(
      chatContext({ input: { sendMessageWithDocument } }),
      managersWith([withSticker(1, stickerDoc(22, SET))]),
    )
    await (await bubbles.setPeer())?.promise
    await settle()

    document.body.append(bubbles.container)
    clickSticker(bubbles.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"] .attachment')!)
    await settle()

    expect(openStickerSetModal).toHaveBeenCalledWith({ id: SET.id }, expect.any(Function))
    expect(opened).not.toHaveBeenCalled()

    // Выбранный в попапе стикер уходит композером (tweb `showStickersPopup(…, chat.input)`).
    const picked = { id: 99 }
    openStickerSetModal.mock.calls[0][1]!(picked)
    expect(sendMessageWithDocument).toHaveBeenCalledWith({ document: picked })
    bubbles.container.remove()
  })

  it('стикер без набора не открывает ни набор, ни медиавьювер', async () => {
    vi.spyOn(lottieLoader, 'loadAnimationWorker').mockImplementation(async () => stubPlayer())
    const opened = vi.fn()
    vi.spyOn(viewer, 'openMediaViewer').mockImplementation((args) => { opened(args); return undefined })
    openStickerSetModal.mockClear()

    bubbles = mountTestBubbles(
      chatContext(),
      managersWith([withSticker(1, stickerDoc(22, { _: 'inputStickerSetEmpty' }))]),
    )
    await (await bubbles.setPeer())?.promise
    await settle()

    document.body.append(bubbles.container)
    clickSticker(bubbles.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"] .attachment')!)
    await settle()

    expect(openStickerSetModal).not.toHaveBeenCalled()
    expect(opened).not.toHaveBeenCalled()
    bubbles.container.remove()
  })

  it('стикер приветствия пустого чата тоже играет и зациклен', async () => {
    const load = vi.spyOn(lottieLoader, 'loadAnimationWorker').mockImplementation(async () => stubPlayer())
    const greeting = stickerDoc(555, SET)

    bubbles = mountTestBubbles(
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

// Имя автора у стикера. tweb рисует имя только НЕ у standalone-медиа
// (`shouldRenderSenderNameWithEphemeralBadge` = `needName && (!isStandaloneMedia
// || isEphemeral)`, placeEphemeralBadge.ts:1-7, вызов — bubbles.ts:10885-10889;
// до эфемерных сообщений то же условие стояло буквально: `!context.isStandaloneMedia
// && needName`). Иначе бабл получает `hide-name` (:10908-10910), а ответ,
// оставшийся без имени, сам становится плавающей плашкой (:10974-10976).
// Стикер — standalone (`wrapSticker`, :7012). Прежде у нас имя вставлялось и
// сюда: `.floating-part` у `just-media` — абсолютная плашка, которая «болталась»
// в стороне от стикера.
describe('ChatBubbles — имя автора у стикера в группе', () => {
  const groupContext = (over: TestChatOptions = {}) =>
    chatContext({ isLikeGroup: true, isMegagroup: true, ...over })
  const bubbleOf = (b: ChatBubbles, mid: number) =>
    b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

  beforeEach(() => {
    vi.spyOn(lottieLoader, 'loadAnimationWorker').mockImplementation(async () => stubPlayer())
  })

  it('входящий стикер: имени нет, бабл hide-name', async () => {
    bubbles = mountTestBubbles(groupContext(), managersWith([withSticker(1, stickerDoc(22, SET))]))
    await (await bubbles.setPeer())?.promise
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('just-media')).toBe(true)
    expect(bubble.querySelector('.name')).toBeNull()
    expect(bubble.classList.contains('hide-name')).toBe(true)
  })

  it('свой стикер при известном myId: имени нет', async () => {
    const own = makeMessage({
      peerId: CHAT, fromId: ME, out: true, id: 1, text: '',
      createdAt: '2026-08-15T12:00:00Z', media: stickerMedia(stickerDoc(22, SET)),
    })
    bubbles = mountTestBubbles(groupContext(), managersWith([own]))
    await (await bubbles.setPeer())?.promise
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('is-out')).toBe(true)
    expect(bubble.querySelector('.name')).toBeNull()
    expect(bubble.classList.contains('hide-name')).toBe(true)
  })

  it('ответ стикером без имени — сам плавающая плашка (.reply.floating-part)', async () => {
    const original = makeMessage({ peerId: CHAT, fromId: FRIEND, id: 1, text: 'вопрос', createdAt: '2026-08-15T11:59:00Z' })
    const reply = makeMessage({
      peerId: CHAT, fromId: 2, id: 2, text: '', replyToMsgId: 1,
      createdAt: '2026-08-15T12:00:00Z', media: stickerMedia(stickerDoc(22, SET)),
    })
    bubbles = mountTestBubbles(groupContext(), managersWith([original, reply]))
    await (await bubbles.setPeer())?.promise
    await settle()

    const replyNode = bubbleOf(bubbles, 2).querySelector<HTMLElement>('.reply')!
    expect(replyNode.classList.contains('floating-part')).toBe(true)
  })

  // Обычный (не standalone) бабл той же группы имя по-прежнему несёт —
  // гейт стоит на виде медиа, а не на группе.
  it('входящий текст рядом — имя на месте', async () => {
    const text = makeMessage({ peerId: CHAT, fromId: 2, id: 1, text: 'привет', createdAt: '2026-08-15T12:00:00Z' })
    bubbles = mountTestBubbles(groupContext(), managersWith([text]))
    await (await bubbles.setPeer())?.promise
    await settle()

    expect(bubbleOf(bubbles, 1).querySelector('.name')).not.toBeNull()
  })
})
