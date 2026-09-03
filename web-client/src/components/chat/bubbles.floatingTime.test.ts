// Время и реакции у МЕДИА БЕЗ ПОДПИСИ (`has-floating-time`) — порт развилки
// tweb `appendReactionsElementToBubble` (bubbles.ts:9822-9875) и соседнего шага
// `isFloatingTime` (bubbles.ts:9257-9276).
//
// Диагноз со стенда: класс `has-floating-time` СТОИТ на бабле, но узел `.time`
// лежал внутри `.message.spoilers-container` со `position: static` — правый
// край времени совпадал с правым краем КОЛОНКИ, а не бабла. Причина — наша
// вставка в `renderMessageMeta` была БЕЗУСЛОВНОЙ: время всегда уходило в
// `messageDiv` (или в контейнер реакций внутри него), а развилка оригинала
// (время — прямой ребёнок `.bubble-content` с классом `is-floating`, реакции —
// ребёнок `.bubble-content-wrapper`, а НЕ `.message`) не была портирована.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { saveDocument, type MessageMedia } from '@core/media/messageMedia'
import { makeMessage } from '@core/messages/testMessage'
import rootScope from '@lib/rootScope'
import type { MessageReactions, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

/** Открыть окно ленты и дождаться ОТРИСОВКИ (см. bubbles.meta.test.ts). */
async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

const CHAT = 95

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

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => { resetMessagesMirror(); resetPeerMirror(); rootScope.myId = 1 })

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

const reactions: MessageReactions = {
  _: 'messageReactions',
  results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '🔥' }, count: 3 }],
}

// Стикер — standalone-медиа: tweb ставит и `is-message-empty`, и
// `has-floating-time` разом (bubbles.ts:9261-9274; у нас — bubbleClasses.ts:129,
// подтверждено живым DOM и bubbles.media.test.ts «стикер получает свои классы»).
const stickerMedia: MessageMedia = {
  _: 'messageMediaDocument',
  document: saveDocument({
    _: 'document', id: 22, mime_type: 'image/webp', size: 2048,
    attributes: [
      { _: 'documentAttributeSticker', alt: '🙂', stickerset: { _: 'inputStickerSetEmpty' } },
      { _: 'documentAttributeImageSize', w: 512, h: 512 },
    ],
  }),
}

const withSticker = (id: number, over: { reactions?: MessageReactions } = {}): MyMessage => {
  const m = makeMessage({
    peerId: CHAT, fromId: 2, id, text: '', createdAt: '2026-08-15T12:34:00', media: stickerMedia,
  })
  return { ...m, ...(over.reactions ? { reactions: over.reactions } : {}) } as MyMessage
}

const withText = (id: number, over: { reactions?: MessageReactions } = {}): MyMessage => {
  const m = makeMessage({ peerId: CHAT, fromId: 2, id, text: 'привет', createdAt: '2026-08-15T12:34:00' })
  return { ...m, ...(over.reactions ? { reactions: over.reactions } : {}) } as MyMessage
}

describe('ChatBubbles — время и реакции у медиа без подписи (has-floating-time)', () => {
  it('has-floating-time стоит у стикера без подписи (гарантия предпосылки теста)', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([withSticker(1)]))
    await openFeed(bubbles)
    await settle()

    expect(bubbleOf(bubbles, 1).classList.contains('has-floating-time')).toBe(true)
  })

  // ПИН 2 (время). tweb :9273-9276: `timeSpan.classList.add('is-floating')` +
  // `appendBubbleTime(bubble, bubbleContainer, () => bubbleContainer.append(timeSpan))`
  // — время лежит ПРЯМО на `.bubble-content` (сосед `.message`, не потомок), с
  // классом `is-floating` (CSS `_chatBubble.scss:1818` — `position: absolute`,
  // прижимает время к правому нижнему углу МЕДИА, а не к краю колонки).
  it('время у стикера без подписи — на .bubble-content с классом is-floating, а не в .message', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([withSticker(1)]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    const bubbleContent = bubble.querySelector<HTMLElement>(':scope > .bubble-content-wrapper > .bubble-content')!
    const time = bubble.querySelector<HTMLElement>('.time')!

    expect(time).not.toBeNull()
    expect(time.classList.contains('is-floating')).toBe(true)
    expect(time.parentElement).toBe(bubbleContent)
    expect(bubble.querySelector('.message .time')).toBeNull()
  })

  // ПИН 1 (реакции). tweb :9849-9851: у `has-floating-time` узел реакций —
  // ребёнок `.bubble-content-wrapper`, а НЕ `.message` (в оригинале `.message`
  // у этой ветки вовсе снесён из DOM).
  it('реакции у стикера без подписи — ребёнок .bubble-content-wrapper, а не .message', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([withSticker(1, { reactions })]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    const contentWrapper = bubble.querySelector<HTMLElement>(':scope > .bubble-content-wrapper')!
    const reactionsEl = bubble.querySelector<HTMLElement>('.reactions')!

    expect(reactionsEl).not.toBeNull()
    expect(reactionsEl.parentElement).toBe(contentWrapper)
    expect(bubble.querySelector('.message .reactions')).toBeNull()
  })

  // tweb :9852-9856: `appendBubbleTime`, который переносит `timeSpan` ВНУТРЬ
  // `reactionsElement`, стоит ТОЛЬКО в ветке `else` (не floating/service) —
  // у floating-бабла время в реакции не переезжает, а остаётся на
  // `.bubble-content`, где его уже разместил `is-floating`-шаг (пин выше).
  // Иначе абсолютное позиционирование `is-floating` резолвится относительно
  // `.bubble-content-wrapper` (родителя reactions-element), а не медиа —
  // ровно тот дефект, который чинила эта задача.
  it('время у стикера С реакциями остаётся на .bubble-content, а не переезжает в контейнер реакций', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([withSticker(1, { reactions })]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    const bubbleContent = bubble.querySelector<HTMLElement>(':scope > .bubble-content-wrapper > .bubble-content')!
    const reactionsEl = bubble.querySelector<HTMLElement>('.reactions')!
    const time = bubble.querySelector<HTMLElement>('.time')!

    expect(time.parentElement).toBe(bubbleContent)
    expect(time.classList.contains('is-floating')).toBe(true)
    expect(reactionsEl.querySelector(':scope > .time')).toBeNull()
  })

  // ПИН 3 (неизменность). Обычный текстовый бабл `has-floating-time` не несёт
  // — развилка не должна его тронуть: время остаётся в конце `.message`,
  // реакции — тоже ребёнок `.message`, как раньше (bubbles.meta.test.ts).
  describe('обычный текстовый бабл — без изменений', () => {
    it('время лежит в конце .message, без is-floating', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([withText(1)]))
      await openFeed(bubbles)
      await settle()

      const bubble = bubbleOf(bubbles, 1)
      expect(bubble.classList.contains('has-floating-time')).toBe(false)

      const messageDiv = bubble.querySelector<HTMLElement>('.message')!
      const time = messageDiv.querySelector<HTMLElement>('.time')!
      expect(time).not.toBeNull()
      expect(time.classList.contains('is-floating')).toBe(false)
      expect(messageDiv.lastElementChild).toBe(time)
    })

    it('реакции — ребёнок .message, а не .bubble-content-wrapper', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([withText(1, { reactions })]))
      await openFeed(bubbles)
      await settle()

      const bubble = bubbleOf(bubbles, 1)
      const messageDiv = bubble.querySelector<HTMLElement>('.message')!
      const reactionsEl = messageDiv.querySelector<HTMLElement>('.reactions')!

      expect(reactionsEl).not.toBeNull()
      expect(reactionsEl.parentElement).toBe(messageDiv)
    })
  })
})
