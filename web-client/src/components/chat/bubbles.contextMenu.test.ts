// Контекстное меню В ЛЕНТЕ — стыковка `bubbles.ts` с портом `contextMenu.ts`.
//
// Само меню покрыто своими тестами (`contextMenu.test.ts`: состав пунктов,
// фильтрация, позиционирование, закрытие). Здесь проверяется ровно то, чего они
// видеть не могут: что лента вешает `chat.contextMenu` на СВОЙ контейнер
// (`attachContainerListeners`, tweb bubbles.ts:1478), а `contextMenu.destroy()`
// (его зовёт `Chat.destroy`, tweb chat.ts:845) эти слушатели снимает.
//
// Без этого теста связка гниёт молча: удали строку `attachTo` — и меню просто
// перестанет открываться, а все 15 тестов порта останутся зелёными.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles } from './testChat'
import type { ContextMenuManagers } from './contextMenu'

const CHAT = 93

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> => ({
      messages, count: messages.length, reachedTop: true, reachedBottom: true,
    })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0), getDialogReadState: vi.fn(async () => undefined) },
  // Ручка отметки прочтения: наблюдатель непрочитанных живёт в самой ленте
  // (порт tweb bubbles.ts:2941-3012), поэтому она обязательна у КАЖДОГО стенда.
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

const settle = async () => {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const msg = (id: number) =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: 'привет', createdAt: '2026-08-15T12:34:00' })

/** Правый клик — десктопный путь `attachContextMenuListener`. */
function rightClick(target: HTMLElement) {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pageX', { value: 10 })
  Object.defineProperty(e, 'pageY', { value: 10 })
  target.dispatchEvent(e)
}

const menuElement = () => document.getElementById('bubble-contextmenu')

let bubbles: ChatBubbles | undefined
afterEach(() => {
  bubbles?.destroy()
  bubbles?.container.remove()
  bubbles = undefined
  menuElement()?.remove()
})
beforeEach(() => {
  // Меню живёт в `document.body`, а не в ленте: чужой хвост от прошлого теста
  // сделал бы следующий недостоверным.
  menuElement()?.remove()
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = 1
})

const menuManagers: ContextMenuManagers = {
  messages: {
    votePoll: vi.fn().mockResolvedValue(undefined),
    closePoll: vi.fn().mockResolvedValue(undefined),
    viewers: vi.fn().mockResolvedValue([]),
    setFactCheck: vi.fn().mockResolvedValue(undefined),
    removeFactCheck: vi.fn().mockResolvedValue(undefined),
  },
  chats: { getReadDate: vi.fn().mockResolvedValue(null) },
}

/** Лента с настоящим меню — в порядке `Chat.init`. */
async function feedWithMenu(messages: MyMessage[]) {
  const chat = createTestChat({ peerId: CHAT })
  const feed = mountTestBubbles(chat, managersWith(messages), { menuManagers })
  bubbles = feed
  await (await feed.setPeer())?.promise
  await settle()
  document.body.append(feed.container)
  return { feed, chat }
}

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

describe('ChatBubbles — контекстное меню', () => {
  it('правый клик по баблу ленты открывает меню', async () => {
    const { feed } = await feedWithMenu([msg(1)])

    rightClick(bubbleOf(feed, 1).querySelector<HTMLElement>('.bubble-content')!)
    await settle()

    expect(menuElement()).not.toBeNull()
  })

  it('contextMenu.destroy снимает слушатели — после него правый клик меню не открывает', async () => {
    // Именно это и гарантирует `destroy` у оригинала (tweb contextMenu.ts:
    // 689-692): `cleanup()` + `attachListenerSetter.removeAll()`. Закрывать
    // УЖЕ ОТКРЫТОЕ меню он не обязан — этого нет и в tweb, поэтому проверять
    // такое значило бы пинить поведение, которого у оригинала не существует
    // (см. долг в задаче #77).
    const { feed, chat } = await feedWithMenu([msg(1)])
    const content = bubbleOf(feed, 1).querySelector<HTMLElement>('.bubble-content')!

    chat.contextMenu.destroy()
    await settle()
    menuElement()?.remove()

    rightClick(content)
    await settle()

    expect(menuElement()).toBeNull()
  })
})
