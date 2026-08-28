// Тред под сообщением — РАЗВИЛКА оригинала (tweb bubbles.ts:9682-9701), и обе
// её ветки рисуют разное:
//   • пост канала с привязанным обсуждением (`replies.pFlags.comments` +
//     `channel_id`) → футер `replies-element` под баблом (:9683);
//   • сообщение ГРУППЫ с ответами, у которого этих ключей нет (:9698) → число у
//     времени (`setBubbleRepliesCount`, :6410-6431).
// Различает их ровно наличие `comments`/`channel_id` — и данные приезжают
// именно такими: `hydrateThreads`
// (`backend/internal/usecase/chat/messagescontainer.go:113-134`) даёт каналу
// `NewMessageReplies(count, discussionChatId, repliers)`, а группе
// `NewMessageReplies(count, 0, nil)`.
//
// Пины: футер и счётчик НЕ ПУТАЮТСЯ МЕСТАМИ; клик по футеру открывает тред
// группы обсуждения (tweb :3315-3343); правка не удваивает футер.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import type { MessageReplies, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'
import { renderReplies } from './replies'

async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

/** Ключ чата ОТРИЦАТЕЛЬНЫЙ: ветка счётчика гейтится `isAnyGroup`
 *  (порт `appPeersManager.isAnyGroup`, :117-119 — «чат и не канал»). */
const CHAT: PeerId = -700
/** Группа обсуждения канала — `replies.channel_id` едет ГОЛЫМ id (long схемы),
 *  знак раскладывает клиент (`toPeerId(id, true)`, tweb `.toPeerId(true)`). */
const DISCUSSION_ID = 900

const chatContext = (over: Partial<ChatContext> = {}): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
  ...over,
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

/** Тред ПОСТА КАНАЛА — `comments` + `channel_id` парой (в схеме они делят бит). */
const commentThread = (replies: number, recent?: PeerId[]): MessageReplies => ({
  _: 'messageReplies',
  pFlags: { comments: true },
  replies,
  channel_id: DISCUSSION_ID,
  ...(recent ? { recent_repliers: recent.map((id) => ({ _: 'peerUser' as const, user_id: id })) } : {}),
})

/** Тред СООБЩЕНИЯ ГРУППЫ — голый счёт, без флага и без `channel_id`. */
const groupThread = (replies: number): MessageReplies => ({ _: 'messageReplies', replies })

const post = (id: number, replies?: MessageReplies, over: { groupedId?: number } = {}): MyMessage =>
  makeMessage({
    peerId: CHAT, fromId: 2, id, text: 'привет', createdAt: '2026-08-15T12:34:00',
    ...(replies ? { replies } : {}),
    ...(over.groupedId != null ? { groupedId: over.groupedId } : {}),
  })

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = 1
})

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

describe('ChatBubbles — тред под сообщением', () => {
  describe('пост КАНАЛА с обсуждением — футер', () => {
    it('футер лежит в `.bubble-content` и несёт классы оригинала', async () => {
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([post(1, commentThread(8))]))
      await openFeed(bubbles)
      await settle()

      const bubble = bubbleOf(bubbles, 1)
      // tweb :7775 — класс объявляет наличие футера.
      expect(bubble.classList.contains('with-replies')).toBe(true)

      const footer = bubble.querySelector<HTMLElement>('.bubble-content > .replies')!
      expect(footer).not.toBeNull()
      // tweb replies.ts:44 (`'replies', 'replies-' + type`) + живой DOM
      // (docs/tweb/comments.md:115).
      expect(footer.tagName.toLowerCase()).toBe('replies-element')
      expect(footer.classList.contains('replies-footer')).toBe(true)
      expect(footer.dataset.postKey).toBe(`${CHAT}_1`)
      expect(footer.querySelector('.replies-footer-text')!.textContent).toContain('8')
      // tweb replies.ts:123-128 — стрелка и ripple-контейнер ПОСЛЕДНИМИ.
      expect(footer.querySelector('.replies-footer-icon-next')).not.toBeNull()
      expect(footer.lastElementChild!.classList.contains('rp')).toBe(true)
    })

    it('счётчика у времени при этом НЕТ — это другая ветка', async () => {
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([post(1, commentThread(8))]))
      await openFeed(bubbles)
      await settle()

      expect(bubbleOf(bubbles, 1).querySelector('.time-replies')).toBeNull()
    })

    it('есть комментаторы — стек аватарок, нет — иконка (tweb replies.ts:56-84)', async () => {
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([
        post(1, commentThread(3, [11, 12])),
        post(2, commentThread(3)),
      ]))
      await openFeed(bubbles)
      await settle()

      const withAvatars = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.replies')!
      const stack = withAvatars.querySelector<HTMLElement>('.stacked-avatars.replies-footer-avatars')!
      expect(stack).not.toBeNull()
      expect(stack.querySelectorAll('.stacked-avatars-avatar-container')).toHaveLength(2)
      expect(withAvatars.querySelector('.replies-footer-icon-comments')).toBeNull()

      const withIcon = bubbleOf(bubbles, 2).querySelector<HTMLElement>('.replies')!
      expect(withIcon.querySelector('.stacked-avatars')).toBeNull()
      expect(withIcon.querySelector('.replies-footer-icon-comments')).not.toBeNull()
    })

    it('у АЛЬБОМА футер один и адресован НЕСУЩИМ тред сообщением', async () => {
      // tweb `getMessageWithReplies` (appMessagesManager.ts:9233-9235): у
      // альбома тред живёт на ОДНОМ сообщении группы, а бабл у альбома один.
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([
        post(1, undefined, { groupedId: 5 }),
        post(2, commentThread(4), { groupedId: 5 }),
      ]))
      await openFeed(bubbles)
      await settle()

      const footers = bubbles.chatInner.querySelectorAll<HTMLElement>('.replies')
      expect(footers).toHaveLength(1)
      expect(footers[0].dataset.postKey).toBe(`${CHAT}_2`)
    })
  })

  describe('сообщение ГРУППЫ с ответами — счётчик у времени', () => {
    it('число стоит в ОБОИХ узлах времени, футера нет', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([post(1, groupThread(1234))]))
      await openFeed(bubbles)
      await settle()

      const bubble = bubbleOf(bubbles, 1)
      expect(bubble.querySelector('.replies')).toBeNull()
      expect(bubble.classList.contains('with-replies')).toBe(false)

      // tweb :6412 `bubble.querySelectorAll('.time, .time-inner')` — видимая
      // копия одна, но место занимают обе.
      const counters = bubble.querySelectorAll<HTMLElement>('.time-replies')
      expect(counters).toHaveLength(2)
      // tweb :6425 `numberThousandSplitter(count)`.
      expect(counters[0].firstChild!.textContent).toBe('1 234')
      expect(counters[0].querySelector('.time-replies-icon')).not.toBeNull()
    })

    it('у КАНАЛА без обсуждения счётчик не появляется — у поста ветка одна', async () => {
      // `hydrateThreads` каналу без привязанного обсуждения тред не даёт вовсе
      // (CommentCounts отдаёт пустоту, discussion.go:255); но даже приехавший
      // голый счёт постом не рисуется — гейт :9698 требует НЕ канал.
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([post(1, groupThread(3))]))
      await openFeed(bubbles)
      await settle()

      const bubble = bubbleOf(bubbles, 1)
      expect(bubble.querySelector('.time-replies')).toBeNull()
      expect(bubble.querySelector('.replies')).toBeNull()
    })

    it('в ЛИЧНОМ чате счётчика нет — гейт `isAnyGroup` требует чат', async () => {
      const peerId: PeerId = 42
      const message = makeMessage({
        peerId, fromId: 2, id: 1, text: 'привет', createdAt: '2026-08-15T12:34:00',
        replies: groupThread(3),
      })
      bubbles = new ChatBubbles(
        chatContext({ peerId, messagesStorageKey: String(peerId) }),
        managersWith([message]),
      )
      await openFeed(bubbles)
      await settle()

      expect(bubbleOf(bubbles, 1).querySelector('.time-replies')).toBeNull()
    })

    it('ВНУТРИ треда счётчика нет (tweb :6411 `if(this.chat.threadId) return`)', async () => {
      bubbles = new ChatBubbles(
        chatContext({ threadId: 7, messagesStorageKey: `${CHAT}:7` }),
        managersWith([post(1, groupThread(3))]),
      )
      await openFeed(bubbles)
      await settle()

      expect(bubbleOf(bubbles, 1).querySelector('.time-replies')).toBeNull()
    })
  })

  describe('клик по футеру открывает тред', () => {
    it('адресат — ГРУППА ОБСУЖДЕНИЯ и номер поста (tweb :3332-3338)', async () => {
      const openDiscussion = vi.fn()
      bubbles = new ChatBubbles(
        chatContext({ isBroadcast: true, navigation: { openDiscussion } }),
        managersWith([post(1, commentThread(8))]),
      )
      await openFeed(bubbles)
      await settle()

      document.body.append(bubbles.container)
      bubbleOf(bubbles, 1).querySelector<HTMLElement>('.replies-footer-text')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      bubbles.container.remove()

      // tweb :3335 — пир треда это группа обсуждения, а не канал; знак
      // раскладывает `toPeerId(channel_id, true)`.
      expect(openDiscussion).toHaveBeenCalledWith({ peerId: -DISCUSSION_ID, postMid: 1 })
    })

    it('клик по баблу БЕЗ футера тред не открывает', async () => {
      const openDiscussion = vi.fn()
      bubbles = new ChatBubbles(
        chatContext({ navigation: { openDiscussion } }),
        managersWith([post(1, groupThread(3))]),
      )
      await openFeed(bubbles)
      await settle()

      document.body.append(bubbles.container)
      bubbleOf(bubbles, 1).querySelector<HTMLElement>('.message')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      bubbles.container.remove()

      expect(openDiscussion).not.toHaveBeenCalled()
    })
  })

  describe('правка сообщения', () => {
    const editTo = (message: MyMessage) => {
      rootScope.dispatchEventSingle('message_edit', {
        storageKey: String(CHAT), peerId: CHAT, mid: message.id, message,
      })
    }

    it('футер не удваивается', async () => {
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([post(1, commentThread(8))]))
      await openFeed(bubbles)
      await settle()

      editTo(post(1, commentThread(9)))

      const footers = bubbleOf(bubbles, 1).querySelectorAll<HTMLElement>('.replies')
      expect(footers).toHaveLength(1)
      expect(footers[0].querySelector('.replies-footer-text')!.textContent).toContain('9')
    })

    it('исчезнувший тред снимает и футер, и класс `with-replies`', async () => {
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([post(1, commentThread(8))]))
      await openFeed(bubbles)
      await settle()

      editTo(post(1))

      const bubble = bubbleOf(bubbles, 1)
      expect(bubble.querySelector('.replies')).toBeNull()
      expect(bubble.classList.contains('with-replies')).toBe(false)
    })

    it('счётчик группы переезжает на новое число, а ноль его снимает', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([post(1, groupThread(3))]))
      await openFeed(bubbles)
      await settle()

      editTo(post(1, groupThread(4)))
      expect(bubbleOf(bubbles, 1).querySelector('.time-replies')!.firstChild!.textContent).toBe('4')

      // tweb :6415-6418 — `count === 0` снимает счётчик: ответы можно удалить.
      editTo(post(1, groupThread(0)))
      expect(bubbleOf(bubbles, 1).querySelector('.time-replies')).toBeNull()
    })
  })
})

// Вариант `beside` (tweb messageRender.ts:404-406): у стикера, большого эмодзи
// и кружка футера под баблом быть не может — там нет прямоугольного низа,
// поэтому тред уезжает кнопкой сбоку. Проверяется на самом `renderReplies`:
// ванильного бабла-стикера с тредом в ленте пока не собрать (`renderMedia`
// стикер рисует, но фикстуры документа тут ни при чём — гейт читает КЛАСС).
describe('renderReplies — форма футера', () => {
  const build = (bubbleClass?: string) => {
    const bubble = document.createElement('div')
    if (bubbleClass) bubble.classList.add(bubbleClass)
    const bubbleContainer = document.createElement('div')
    bubble.append(bubbleContainer)
    const isFooter = renderReplies({
      bubble,
      bubbleContainer,
      replies: commentThread(1200),
      peerId: CHAT,
      mid: 1,
      middleware: Object.assign(() => true, { create: () => ({ get: () => () => true }) }) as never,
      managers: { peers: { fillMirror: async () => {} } },
    })
    return { isFooter, element: bubbleContainer.querySelector<HTMLElement>('.replies')! }
  }

  it('обычный бабл — `footer`', () => {
    const { isFooter, element } = build()
    expect(isFooter).toBe(true)
    expect(element.classList.contains('replies-footer')).toBe(true)
  })

  it.each(['sticker', 'emoji-big', 'round'])('бабл `%s` — `beside`', (cls) => {
    const { isFooter, element } = build(cls)
    expect(isFooter).toBe(false)
    // tweb replies.ts:132-135.
    expect(element.classList.contains('replies-beside')).toBe(true)
    expect(element.classList.contains('bubble-beside-button')).toBe(true)
    expect(element.querySelector('.replies-beside-text')!.textContent).toBe('1.2K')
  })
})
