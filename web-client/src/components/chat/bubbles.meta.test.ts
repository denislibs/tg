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

const CHAT = 80

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: { getHistory: vi.fn(async (): Promise<HistoryResult> => ({
    messages, count: messages.length, reachedTop: true, reachedBottom: true,
  })) },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
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
    await bubbles.loadFirstHistory()
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
    await bubbles.loadFirstHistory()
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
    await bubbles.loadFirstHistory()
    await settle()

    const bubble = bubbleOf(bubbles, tempId)
    expect(bubble.querySelectorAll('.time-sending-status')).toHaveLength(2)
    expect(bubble.classList.contains('is-sending')).toBe(true)
  })

  it('ЧУЖОЕ сообщение значка отправки не несёт', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1)]))
    await bubbles.loadFirstHistory()
    await settle()

    expect(bubbleOf(bubbles, 1).querySelector('.time-sending-status')).toBeNull()
  })

  it('без реакций контейнера нет вовсе — пустой занял бы строку', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1)]))
    await bubbles.loadFirstHistory()
    await settle()

    expect(bubbleOf(bubbles, 1).querySelector('.reactions')).toBeNull()
  })
})
