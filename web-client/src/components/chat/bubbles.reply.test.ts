// Reply-заголовок в императивном бабле — порт `MessageRender.setReply` (tweb
// messageRender.ts:418-593) и условия его показа (bubbles.ts:9372-9405), плюс
// ветка клика с прыжком к оригиналу (:3520-3616).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import type { UserReal } from '@core/peers/peer'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

/** Открыть окно ленты и дождаться ОТРИСОВКИ. `setPeer` (как в оригинале)
 *  возвращает управление, едва отправив запрос: рендер и доводка живут во
 *  ВТОРОМ промисе результата — `{cached, promise}`, и ждёт его `Chat.setPeer`
 *  (tweb chat.ts:1119-1122). */
async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

const CHAT = 70
const AUTHOR = 2

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
    // Прыжок к сообщению и календарь этот файл не проверяет, но обе ручки
    // обязательны в `BubblesManagers`: лента умеет и то и другое всегда.
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
})

const plain = (id: number, text: string): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: AUTHOR, id, text, createdAt: '2026-08-15T12:00:00Z' })

/** Ответ на сообщение окна. `topId` — корень треда (гейт показа шапки). */
const replying = (id: number, toMid: number, over: { text?: string; quote?: string; topId?: number } = {}): MyMessage => {
  const m = makeMessage({
    peerId: CHAT, fromId: AUTHOR, id, text: over.text ?? 'ответ', createdAt: '2026-08-15T12:05:00Z',
  })
  return {
    ...m,
    reply_to: {
      _: 'messageReplyHeader',
      reply_to_msg_id: toMid,
      ...(over.topId != null ? { reply_to_top_id: over.topId } : {}),
      ...(over.quote ? { pFlags: { quote: true as const }, quote_text: over.quote } : {}),
    },
  } as MyMessage
}

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: AUTHOR, first_name: 'Пётр' } as UserReal] }])
})

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

describe('ChatBubbles — reply-заголовок', () => {
  it('ответ несёт шапку с именем автора и превью оригинала', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([plain(1, 'оригинал'), replying(2, 1)]))
    await openFeed(bubbles)
    await settle()

    const reply = bubbleOf(bubbles, 2).querySelector<HTMLElement>('.reply')!
    expect(reply).not.toBeNull()
    // Разметка 1:1 с оригиналом (divAndCaption.ts:11-29).
    expect(reply.classList.contains('quote-like')).toBe(true)
    expect(reply.querySelector('.reply-border')).not.toBeNull()
    expect(reply.querySelector('.reply-title')!.textContent).toBe('Пётр')
    expect(reply.querySelector('.reply-subtitle')!.textContent).toBe('оригинал')
  })

  it('шапка встаёт ПЕРЕД телом сообщения', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([plain(1, 'оригинал'), replying(2, 1)]))
    await openFeed(bubbles)
    await settle()

    const content = bubbleOf(bubbles, 2).querySelector('.bubble-content')!
    expect(content.firstElementChild?.classList.contains('reply')).toBe(true)
  })

  it('ответ НА КОРЕНЬ ТРЕДА шапки не даёт (tweb :9377-9378)', async () => {
    // Иначе каждое сообщение комментариев несло бы ссылку на сам пост, который
    // пользователь и так видит сверху.
    bubbles = new ChatBubbles(chatContext(), managersWith([plain(1, 'пост'), replying(2, 1, { topId: 1 })]))
    await openFeed(bubbles)
    await settle()

    expect(bubbleOf(bubbles, 2).querySelector('.reply')).toBeNull()
  })

  it('цитата сильнее оригинала: показывается выделенный фрагмент', async () => {
    // Выделенный фрагмент нельзя вывести из сообщения, которое потом изменили.
    bubbles = new ChatBubbles(chatContext(), managersWith([
      plain(1, 'длинный оригинал целиком'), replying(2, 1, { quote: 'оригинал' }),
    ]))
    await openFeed(bubbles)
    await settle()

    const reply = bubbleOf(bubbles, 2).querySelector<HTMLElement>('.reply')!
    expect(reply.querySelector('.reply-subtitle')!.textContent).toBe('оригинал')
    expect(reply.classList.contains('quote-like-icon')).toBe(true)
  })

  it('оригинала нет в окне — шапка честно говорит об этом, а не молчит', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([replying(2, 999)]))
    await openFeed(bubbles)
    await settle()

    const reply = bubbleOf(bubbles, 2).querySelector<HTMLElement>('.reply')!
    expect(reply.querySelector('.reply-subtitle')!.textContent).toBe('Deleted message')
  })

  it('клик по шапке прыгает к оригиналу и подсвечивает его', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([plain(1, 'оригинал'), replying(2, 1)]))
    await openFeed(bubbles)
    await settle()

    document.body.append(bubbles.container)
    const reply = bubbleOf(bubbles, 2).querySelector<HTMLElement>('.reply')!
    reply.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    // Прыжок асинхронен, как и в оригинале: клик уходит в `setMessageId` →
    // `setPeer`, а тот сначала спрашивает у владельца диалога последнее
    // сообщение чата (`topMessageFullMid`, tweb bubbles.ts:5079) и только потом
    // решает, доскроллить до уже показанного бабла или пересобрать окно.
    await settle()

    expect(bubbleOf(bubbles, 1).classList.contains('is-highlighted')).toBe(true)
    bubbles.container.remove()
  })
})
