// src/components/chat/bubbles.avatarOffset.test.ts
//
// Порт tweb `ChatBubbles.finishPeerChange` (bubbles.ts:5787-5792, зовётся из
// `Chat.finishPeerChange` chat.ts:1203) — единственный `forEach` по
// `[this.chatInner, this.remover]`, который ставит класс `is-chat`. Без него
// не срабатывает правило `styles/tweb/_chat.scss:1311-1316`
// (`&.is-chat, &.with-message-avatars { .is-in .bubble-content-wrapper {
// margin-inline-start: 2.875rem } }`) — аватарная колонка
// (`.bubbles-group-avatar-container`, `position: absolute`, не занимает места
// в потоке) ложится поверх бабла, а вместе с ней и реакции.
//
// Пин закрепляет НАБЛЮДАЕМОЕ: в групповом чате классы стоят на ОБОИХ узлах
// (`chatInner` и `remover` — в оригинале они в одном forEach: забыть
// `remover` значит рассинхронить анимацию удаления бабла с лентой), в личном
// чате — ни на одном.
//
// Из соседей по тому же forEach у нас есть предмет только для `is-broadcast`
// (`this.chat.isBroadcast` — обычное поле `Chat`, как и `isLikeGroup`).
// `no-messages` не портирован — нужен асинхронный `hasMessages()`
// (`Chat.hasMessages`, chat.ts), которого у ленты нет. `with-message-avatars`
// не портирован — гейтит `isVerificationBot(peerId)`, а ботов-верификаторов
// в нашей модели не существует вовсе.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MyMessage } from '@core/models'
import { makeMessage, type MessageFixture } from '@core/messages/testMessage'
import type { HistoryResult } from '@core/managers/messagesManager'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles, type TestChatOptions } from './testChat'

const CHAT = 60

function msg(over: Partial<MessageFixture> & { id: number }): MyMessage {
  return makeMessage({
    peerId: CHAT, fromId: 2, text: `m${over.id}`, createdAt: '2026-08-15T12:00:00Z', ...over,
  })
}

const historyResult = (messages: MyMessage[]): HistoryResult =>
  ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })

function managersWith(messages: MyMessage[]) {
  const getHistory = vi.fn(async () => historyResult(messages))
  const fillMirror = vi.fn(async () => {})
  const getReadMaxSeqIfUnread = vi.fn(async () => 0)
  const getHistoryMaxSeq = vi.fn(async () => 0)
  const markRead = vi.fn(async () => ({ ok: true }))
  const getAround = vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true }))
  const messageByDate = vi.fn(async (): Promise<number | null> => null)
  const managers: BubblesManagers = {
    messages: { getHistory, getAround, messageByDate },
    peers: { fillMirror },
    dialogs: { getReadMaxSeqIfUnread, getHistoryMaxSeq, getDialogReadState: vi.fn(async () => undefined) },
    realtime: { markRead },
  }
  return managers
}

const chatContext = (over: TestChatOptions = {}) => createTestChat({ peerId: CHAT, ...over })

async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

let bubbles: ChatBubbles | undefined

afterEach(() => {
  bubbles?.destroy()
  bubbles = undefined
})

describe('ChatBubbles — отступ под аватар (класс is-chat)', () => {
  it('в групповом чате is-chat стоит на chatInner И на remover', async () => {
    bubbles = mountTestBubbles(chatContext({ isLikeGroup: true }), managersWith([msg({ id: 1 })]))
    await openFeed(bubbles)

    expect(bubbles.chatInner.classList.contains('is-chat')).toBe(true)
    expect(bubbles.remover.classList.contains('is-chat')).toBe(true)
  })

  it('в личном чате is-chat не стоит ни на одном узле', async () => {
    bubbles = mountTestBubbles(chatContext(), managersWith([msg({ id: 1 })]))
    await openFeed(bubbles)

    expect(bubbles.chatInner.classList.contains('is-chat')).toBe(false)
    expect(bubbles.remover.classList.contains('is-chat')).toBe(false)
  })

  it('is-broadcast (тот же forEach, tweb :5790) стоит на обоих узлах в канале', async () => {
    bubbles = mountTestBubbles(chatContext({ isBroadcast: true }), managersWith([msg({ id: 1 })]))
    await openFeed(bubbles)

    expect(bubbles.chatInner.classList.contains('is-broadcast')).toBe(true)
    expect(bubbles.remover.classList.contains('is-broadcast')).toBe(true)
  })
})
