// «✓» → «✓✓» в ленте: статус бабла выбирается от горизонта ИСХОДЯЩИХ окна
// (tweb bubbles.ts:11101-11110, правило :9716-9719), рост горизонта
// перекрашивает свои баблы (`dialog_unread` → `updateUnreadByDialog`,
// :2318-2326, :4858-4879). Горизонт приезжает тем же `getDialogReadState`,
// что курсор входящих, а рост — операциями владельцев (диалог, тема).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import { RT } from '@core/realtime/events'
import Icon from '@components/icon'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles, type TestChatOptions } from './testChat'
import { ChatType } from './chatType'

const CHAT = 92
const ME = 1

async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

class FakeIntersectionObserver {
  constructor(public cb: unknown) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

function managersWith(messages: MyMessage[], readOutboxMaxSeq?: number) {
  const managers: BubblesManagers = {
    messages: {
      getScheduledMessages: vi.fn(async () => messages),
      getHistory: vi.fn(async (): Promise<HistoryResult> => ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })),
      getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async () => null),
    },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: {
      getReadMaxSeqIfUnread: vi.fn(async () => 0),
      getHistoryMaxSeq: vi.fn(async () => 0),
      getDialogReadState: vi.fn(async () => ({ readInboxMaxSeq: 0, unreadCount: 0, ...(readOutboxMaxSeq !== undefined ? { readOutboxMaxSeq } : {}) })),
    },
    realtime: { markRead: vi.fn(async () => ({ ok: true })) },
  }
  return managers
}

const own = (id: number, peerId = CHAT) =>
  makeMessage({ peerId, fromId: ME, out: true, id, text: `m${id}`, createdAt: '2026-08-15T12:00:00Z' })

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = ME
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  window.dispatchEvent(new Event('focus'))
})

const bubbleOf = (b: ChatBubbles, mid: number) => b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!
/** значок узнаётся по глифу: `Icon` класса с именем не ставит (`components/icon.ts`) */
const glyph = (name: 'check' | 'checks') => Icon(name).textContent
const icon = (bubble: HTMLElement) => bubble.querySelector('.time > .time-sending-status')?.textContent ?? ''
const isRead = (bubble: HTMLElement) => bubble.classList.contains('is-read') && icon(bubble) === glyph('checks') &&
  bubble.querySelector('.time-inner > .time-sending-status')?.textContent === glyph('checks')

async function open(messages: MyMessage[], readOutboxMaxSeq: number | undefined, over: TestChatOptions = {}) {
  bubbles = mountTestBubbles(createTestChat({ peerId: CHAT, ...over }), managersWith(messages, readOutboxMaxSeq))
  await openFeed(bubbles)
  await settle()
  return bubbles
}

describe('ChatBubbles — «прочитано» по горизонту исходящих', () => {
  it('своё не выше горизонта — «✓✓» и `is-read`, выше — «✓» и `is-sent`', async () => {
    const b = await open([own(11), own(12), own(13)], 12)
    expect(isRead(bubbleOf(b, 11))).toBe(true)
    expect(isRead(bubbleOf(b, 12))).toBe(true)
    expect(bubbleOf(b, 13).classList.contains('is-sent')).toBe(true)
    expect(icon(bubbleOf(b, 13))).toBe(glyph('check'))
  })

  it('кадр прочтения диалога (`read_outbox_max_id`) перекрашивает свои баблы до горизонта живьём', async () => {
    const b = await open([own(11), own(12), own(13)], 11)
    expect(isRead(bubbleOf(b, 12))).toBe(false)
    rootScope.dispatchEventSingle(RT.dialogOp, { ops: [{ op: 'patch', peerId: CHAT, fields: { read_outbox_max_id: 12 } }] })
    expect(isRead(bubbleOf(b, 12))).toBe(true)
    expect(isRead(bubbleOf(b, 13))).toBe(false)
    // чужой диалог — не наш горизонт
    rootScope.dispatchEventSingle(RT.dialogOp, { ops: [{ op: 'patch', peerId: CHAT + 1, fields: { read_outbox_max_id: 99 } }] })
    expect(isRead(bubbleOf(b, 13))).toBe(false)
  })

  it('горизонт неизвестен — всё своё «✓» (как раньше)', async () => {
    const b = await open([own(11)], undefined)
    expect(bubbleOf(b, 11).classList.contains('is-sent')).toBe(true)
  })

  it('тема форума: горизонт — темы, рост приезжает операцией хранилища тем', async () => {
    const THREAD = 7
    const b = await open([own(11), own(12)], 10, { threadId: THREAD, isForum: true })
    expect(isRead(bubbleOf(b, 11))).toBe(false)
    // операция диалога форума тему не трогает
    rootScope.dispatchEventSingle(RT.dialogOp, { ops: [{ op: 'patch', peerId: CHAT, fields: { read_outbox_max_id: 50 } }] })
    expect(isRead(bubbleOf(b, 11))).toBe(false)
    rootScope.dispatchEventSingle(RT.forumTopicOp, { ops: [{ op: 'update', peerId: CHAT, topics: [{ id: THREAD, read_outbox_max_id: 11 } as never] }] })
    expect(isRead(bubbleOf(b, 11))).toBe(true)
    expect(isRead(bubbleOf(b, 12))).toBe(false)
  })

  it('операция `upsert` диалога тоже двигает горизонт', async () => {
    const b = await open([own(11), own(12)], 10)
    rootScope.dispatchEventSingle(RT.dialogOp, { ops: [{ op: 'upsert', items: [{ dialog: { peerId: CHAT, read_outbox_max_id: 12 } as never, index: 1 }] }] })
    expect(isRead(bubbleOf(b, 12))).toBe(true)
  })

  // tweb :11105 — отложенные всегда «✓» (`is_scheduled`), своя нумерация
  it('отложенные: операции диалога их не перекрашивают', async () => {
    const b = await open([own(11)], undefined, { type: ChatType.Scheduled })
    rootScope.dispatchEventSingle(RT.dialogOp, { ops: [{ op: 'patch', peerId: CHAT, fields: { read_outbox_max_id: 50 } }] })
    expect(isRead(bubbleOf(b, 11))).toBe(false)
  })
})

