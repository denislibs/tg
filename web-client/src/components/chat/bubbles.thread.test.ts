// Плашка «Обсуждение началось» в ветке комментариев — порт
// `appMessagesManager.generateThreadServiceStartMessage`
// (appMessagesManager.ts:6109-6135) + его вставка в слайс треда (:9776-9797).
//
// Пины:
//   (1) в окне ТРЕДА, сведённом с верхом, за корнем встаёт служебная пилюля
//       с действием `messageActionDiscussionStarted`;
//   (2) её номер — дробь поверх номера корня, поэтому она стоит именно ЗА ним;
//   (3) в обычном чате (без треда) её нет;
//   (4) верх треда не сведён — плашки нет (условие `isTopEnd` оригинала);
//   (5) второй страницей она не задваивается.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { clearChatPositions } from '@core/chat/chatPositions'
import { useSettingsStore } from '@/settings'
import { generateTempMessageId } from '@core/history/messageId'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const GROUP = -30
const CHANNEL = -31
const ROOT_MID = 100
const AUTHOR = 5

const chatContext = (threadId?: number): ChatContext => ({
  peerId: GROUP,
  threadId,
  messagesStorageKey: threadId ? `${GROUP}_${threadId}` : String(GROUP),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

/** Зеркало поста в группе обсуждения — корень треда: номер у него СВОЙ,
 *  не равный номеру поста в канале (`resolveThreadRootForQuery`). */
const rootMirror = (): MyMessage =>
  makeMessage({ peerId: GROUP, fromId: CHANNEL, id: 1, text: 'пост', createdAt: '2026-08-15T12:00:00Z' })

const comment = (id: number): MyMessage =>
  makeMessage({ peerId: GROUP, fromId: AUTHOR, id, text: `c${id}`, createdAt: '2026-08-15T12:05:00Z', threadRootId: 1 })

function managersWith(messages: MyMessage[], reachedTop = true): BubblesManagers {
  return {
    messages: {
      getHistory: vi.fn(async (): Promise<HistoryResult> =>
        ({ messages, count: messages.length, reachedTop, reachedBottom: true })),
      getAround: vi.fn(async () => ({ messages, reachedTop, reachedBottom: true })),
      messageByDate: vi.fn(async () => null),
    },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
    realtime: { markRead: vi.fn(async () => ({ ok: true })) },
  }
}

async function settle() {
  for(let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const plate = (feed: ChatBubbles) =>
  feed.chatInner.querySelector<HTMLElement>(`.bubble.service[data-mid="${generateTempMessageId(1)}"]`)

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  clearChatPositions()
  useSettingsStore.setState({ reduceMotion: true })
  rootScope.myId = 1
  applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: AUTHOR, first_name: 'Аня', pFlags: {} }] }])
})

describe('ChatBubbles — плашка «Обсуждение началось»', () => {
  it('в сведённом с верхом окне треда встаёт за корнем', async () => {
    bubbles = new ChatBubbles(chatContext(ROOT_MID), managersWith([rootMirror(), comment(2)]))
    await (await bubbles.setPeer())?.promise
    await settle()

    const node = plate(bubbles)!
    expect(node).not.toBeNull()
    expect(node.querySelector('.service-msg')!.textContent).toBe('Обсуждение началось')

    // Порядок в DOM: корень → плашка → комментарии.
    const mids = Array.from(bubbles.chatInner.querySelectorAll<HTMLElement>('.bubble[data-mid]'))
      .map((b) => Number(b.dataset.mid))
      .filter((mid) => !Number.isNaN(mid))
    expect(mids).toEqual([1, generateTempMessageId(1), 2])
  })

  it('в обычном чате плашки нет', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([rootMirror(), comment(2)]))
    await (await bubbles.setPeer())?.promise
    await settle()

    expect(plate(bubbles)).toBeNull()
  })

  it('верх треда не сведён — плашки нет', async () => {
    bubbles = new ChatBubbles(chatContext(ROOT_MID), managersWith([rootMirror(), comment(2)], false))
    await (await bubbles.setPeer())?.promise
    await settle()

    expect(plate(bubbles)).toBeNull()
  })

  it('вторая страница её не задваивает', async () => {
    bubbles = new ChatBubbles(chatContext(ROOT_MID), managersWith([rootMirror(), comment(2)]))
    await (await bubbles.setPeer())?.promise
    await settle()
    await bubbles.performHistoryResult([rootMirror(), comment(2)], true, { top: true })
    await settle()

    expect(bubbles.chatInner.querySelectorAll(`.bubble[data-mid="${generateTempMessageId(1)}"]`)).toHaveLength(1)
  })
})
