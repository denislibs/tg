// Время и реакции В БАБЛЕ — стыковка ленты с портами `setTime` и
// `ReactionsElement`.
//
// Свои тесты у обоих узлов уже есть (`messageTime.test.ts`,
// `reactions.test.ts`); здесь проверяется то, чего они видеть не могут: что
// лента их СОЗДАЁТ и складывает в том порядке, который требует оригинал —
// время ПЕРЕЕЗЖАЕТ внутрь контейнера реакций (tweb bubbles.ts:9855).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { generateTempMessageId } from '@core/history/messageId'
import { makeMessage } from '@core/messages/testMessage'
import type { MessageReactions, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

/** Открыть окно ленты и дождаться ОТРИСОВКИ. `setPeer` (как в оригинале)
 *  возвращает управление, едва отправив запрос: рендер и доводка живут во
 *  ВТОРОМ промисе результата — `{cached, promise}`, и ждёт его `Chat.setPeer`
 *  (tweb chat.ts:1119-1122). */
async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

const CHAT = 80

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
  // Ручка отметки прочтения: наблюдатель непрочитанных живёт в самой ленте
  // (порт tweb bubbles.ts:2941-3012), поэтому она обязательна у КАЖДОГО стенда.
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

const reactions: MessageReactions = {
  _: 'messageReactions',
  results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 2 }],
}

const msg = (id: number, over: { reactions?: MessageReactions } = {}): MyMessage => {
  const m = makeMessage({ peerId: CHAT, fromId: 2, id, text: 'привет', createdAt: '2026-08-15T12:34:00' })
  return { ...m, ...(over.reactions ? { reactions: over.reactions } : {}) } as MyMessage
}

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  // Личность зрителя: `out` выводит `isOutMessage` из неё, а не из поля
  // (`rootScope.myId` пишет проектор на rt:me).
  rootScope.myId = 1
})

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

describe('ChatBubbles — время и реакции в бабле', () => {
  it('лента заводит время в конце тела сообщения', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1)]))
    await openFeed(bubbles)
    await settle()

    const messageDiv = bubbleOf(bubbles, 1).querySelector('.message')!
    const time = messageDiv.querySelector<HTMLElement>('.time')!
    expect(time).not.toBeNull()
    expect(time.textContent).toContain('12:34')
    expect(messageDiv.lastElementChild).toBe(time)
  })

  it('у сообщения С РЕАКЦИЯМИ время лежит ВНУТРИ контейнера реакций', async () => {
    // tweb :9855 — чипы и время образуют одну строку-обёртку. Останься время
    // соседом реакций, оно уехало бы на свою строку под чипами.
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1, { reactions })]))
    await openFeed(bubbles)
    await settle()

    const messageDiv = bubbleOf(bubbles, 1).querySelector('.message')!
    const reactionsEl = messageDiv.querySelector<HTMLElement>('.reactions')!
    expect(reactionsEl).not.toBeNull()

    const time = messageDiv.querySelector<HTMLElement>('.time')!
    expect(time.parentElement).toBe(reactionsEl)
    expect(reactionsEl.lastElementChild).toBe(time)
  })

  // Значок отправки — порт `setBubbleSendingStatus` (:6382-6408). Он стоит в
  // ОБОИХ узлах времени, потому что обе копии занимают место.
  it('своё неотправленное сообщение несёт значок «отправляется» в обеих копиях времени', async () => {
    // Номер до ack — ДРОБНЫЙ, а не отрицательный: клиентское пространство
    // отличается именно этим (`isLocalMessageId` = «не целое»).
    const tempId = generateTempMessageId(0)
    const pending = makeMessage({
      peerId: CHAT, fromId: 1, id: tempId, out: true, text: 'привет',
      createdAt: '2026-08-15T12:34:00',
    })
    bubbles = new ChatBubbles(chatContext(), managersWith([pending]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, tempId)
    expect(bubble.querySelectorAll('.time-sending-status')).toHaveLength(2)
    expect(bubble.classList.contains('is-sending')).toBe(true)
  })

  it('ЧУЖОЕ сообщение значка отправки не несёт', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1)]))
    await openFeed(bubbles)
    await settle()

    expect(bubbleOf(bubbles, 1).querySelector('.time-sending-status')).toBeNull()
  })

  // Тоггл реакции — порт `Chat.sendReaction` (:3245-3279). Что делать, лента
  // решает по КЛИКНУТОМУ ЧИПУ, а не перечитыванием сообщения.
  describe('клик по чипу реакции', () => {
    const withToggle = (messages: MyMessage[]) => {
      const react = vi.fn(async () => {})
      const unreact = vi.fn(async () => {})
      const managers = managersWith(messages)
      Object.assign(managers.messages, { react, unreact })
      return { managers, react, unreact }
    }

    const mine: MessageReactions = {
      _: 'messageReactions',
      results: [{
        _: 'reactionCount',
        reaction: { _: 'reactionEmoji', emoticon: '👍' },
        count: 1,
        chosen_order: 0,
      }],
    }

    it('чужая реакция — СТАВИТСЯ', async () => {
      const { managers, react, unreact } = withToggle([msg(1, { reactions })])
      bubbles = new ChatBubbles(chatContext(), managers)
      await openFeed(bubbles)
      await settle()

      document.body.append(bubbles.container)
      bubbleOf(bubbles, 1).querySelector<HTMLElement>('.reaction')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

      expect(react).toHaveBeenCalledWith(CHAT, 1, '👍')
      expect(unreact).not.toHaveBeenCalled()
      bubbles.container.remove()
    })

    it('СВОЯ реакция (is-chosen) — СНИМАЕТСЯ', async () => {
      const { managers, react, unreact } = withToggle([msg(1, { reactions: mine })])
      bubbles = new ChatBubbles(chatContext(), managers)
      await openFeed(bubbles)
      await settle()

      document.body.append(bubbles.container)
      bubbleOf(bubbles, 1).querySelector<HTMLElement>('.reaction')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

      expect(unreact).toHaveBeenCalledWith(CHAT, 1, '👍')
      expect(react).not.toHaveBeenCalled()
      bubbles.container.remove()
    })
  })

  it('без реакций контейнера нет вовсе — пустой занял бы строку', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1)]))
    await openFeed(bubbles)
    await settle()

    expect(bubbleOf(bubbles, 1).querySelector('.reactions')).toBeNull()
  })
})
