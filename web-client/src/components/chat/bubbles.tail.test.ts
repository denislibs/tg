// Хвост бабла в ленте — узел не был портирован вовсе (класс и CSS уже на
// месте, `<use>` резолвить было не во что). Три пина по брифу:
//   (1) `web-client/index.html` несёт спрайт `symbol#message-tail-filled`
//       (иначе `<use href="#message-tail-filled">` резолвить не во что —
//       tweb `index.html:64-68`);
//   (2) бабл с `can-have-tail` содержит `svg.bubble-tail > use[href=…]`
//       ПОСЛЕДНИМ ребёнком `.bubble-content`, а не где-то ещё в поддереве
//       (родитель и позиция — иначе порча «положили в bubble-content-wrapper»
//       пройдёт незамеченной; tweb bubbles.ts:9707-9712);
//   (3) у круглого видео узел добавляется, а `can-have-tail` — нет (tweb
//       :9707 гейтит `!isRound`).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { saveDocument, type DocumentAttribute, type MessageMedia } from '@core/media/messageMedia'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const here = dirname(fileURLToPath(import.meta.url))

/** Открыть окно ленты и дождаться ОТРИСОВКИ (см. остальные `bubbles.*.test.ts`). */
async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

/** Дать очереди рендера и промисам враппера разобраться. */
async function settle() {
  for (let i = 0; i < 5; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const CHAT = 90

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> => ({
      messages, count: messages.length, reachedTop: true, reachedBottom: true,
    })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

const textOut = (id: number): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: 'привет', out: true, createdAt: '2026-08-15T12:00:00Z' })

/** Кружок — видео-документ с `round_message`; тип бабла выводит `saveDocument`
 *  из атрибута, как у оригинала (bubbles.media.test.ts). */
const roundMedia: MessageMedia = {
  _: 'messageMediaDocument',
  document: saveDocument({
    _: 'document', id: 22, mime_type: 'video/mp4', size: 2048,
    attributes: [{ _: 'documentAttributeVideo', duration: 3, w: 384, h: 384, pFlags: { round_message: true } } as DocumentAttribute],
  }),
}

const roundVideo = (id: number): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: '', createdAt: '2026-08-15T12:00:00Z', media: roundMedia })

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => { resetMessagesMirror(); resetPeerMirror() })

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

describe('index.html — спрайт хвоста', () => {
  it('несёт symbol#message-tail-filled с viewBox 0 0 11 20 (tweb index.html:64-68)', () => {
    const html = readFileSync(resolve(here, '../../../index.html'), 'utf-8')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const symbol = doc.querySelector('symbol#message-tail-filled')
    expect(symbol).not.toBeNull()
    expect(symbol?.getAttribute('viewBox')).toBe('0 0 11 20')
  })
})

describe('ChatBubbles — узел хвоста', () => {
  it('can-have-tail: svg.bubble-tail > use[href] последним ребёнком .bubble-content', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([textOut(1)]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('can-have-tail')).toBe(true)

    const bubbleContent = bubble.querySelector<HTMLElement>('.bubble-content')!
    const tail = bubbleContent.lastElementChild
    expect(tail?.tagName.toLowerCase()).toBe('svg')
    expect(tail?.classList.contains('bubble-tail')).toBe(true)
    expect(tail?.parentElement).toBe(bubbleContent)

    const use = tail?.querySelector('use')
    expect(use?.getAttribute('href')).toBe('#message-tail-filled')
  })

  it('кружок: узел есть, а can-have-tail нет (tweb bubbles.ts:9707 гейтит !isRound)', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([roundVideo(1)]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('round')).toBe(true)
    expect(bubble.classList.contains('can-have-tail')).toBe(false)

    const bubbleContent = bubble.querySelector<HTMLElement>('.bubble-content')!
    const tail = bubbleContent.querySelector('svg.bubble-tail')
    expect(tail).not.toBeNull()
    expect(tail?.querySelector('use')?.getAttribute('href')).toBe('#message-tail-filled')
  })
})
