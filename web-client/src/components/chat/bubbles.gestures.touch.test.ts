// Тач-ветка ответа жестом — вторая половина развилки tweb bubbles.ts:1496-1543.
//
// Живёт отдельным файлом, потому что развилку решают КОНСТАНТЫ окружения
// (`IS_MOBILE`, `IS_TOUCH_SUPPORTED`), которые считаются один раз на импорт
// модуля: подменить их можно только на уровне файла (`vi.mock` поднимается
// выше импортов). В соседнем `bubbles.gestures.test.ts` окружение настоящее
// (jsdom выдаёт себя за десктоп) и проверяется ветка даблклика.
//
// Сам жест здесь не проигрывается — он покрыт `replySwipe.test.ts` вместе с
// порогом. Здесь проверяется ровно проводка: лента ВЕШАЕТ свайп на свой
// контейнер, взаимоисключающе с даблкликом, и СНИМАЕТ слушатели на `destroy`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'

vi.mock('@environment/touchSupport', () => ({ default: true }))
vi.mock('@environment/userAgent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@environment/userAgent')>()),
  IS_MOBILE: true,
}))

const removeListeners = vi.fn()
const attachReplySwipe = vi.fn((container: HTMLElement) => {
  void container
  return { removeListeners }
})
vi.mock('./replySwipe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./replySwipe')>()),
  attachReplySwipe,
}))

const ChatBubbles = (await import('./bubbles')).default
type BubblesManagers = import('./bubbles').BubblesManagers
type ChatContext = import('./bubbles').ChatContext

const CHAT = 91

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: { getHistory: vi.fn(async (): Promise<HistoryResult> => ({
    messages, count: messages.length, reachedTop: true, reachedBottom: true,
  })) },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
})

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
  canSend: () => true,
  initMessageReply: vi.fn(),
})

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = 1
  attachReplySwipe.mockClear()
  removeListeners.mockClear()
})

let feed: InstanceType<typeof ChatBubbles> | undefined
afterEach(() => { feed?.destroy(); feed = undefined })

const message = makeMessage({ peerId: CHAT, fromId: 2, id: 1, text: 'привет', createdAt: '2026-08-15T12:34:00' })

describe('ChatBubbles — свайп-ответ на таче', () => {
  it('лента вешает свайп на СВОЙ контейнер', async () => {
    feed = new ChatBubbles(chatContext(), managersWith([message]))

    expect(attachReplySwipe).toHaveBeenCalledTimes(1)
    expect(attachReplySwipe.mock.calls[0][0]).toBe(feed.container)
  })

  it('даблклик на таче НЕ вешается — ветки взаимоисключающие', async () => {
    // Держать оба сразу нельзя: на таче даблклик стрелял бы по концу свайпа.
    const chat = chatContext()
    chat.canSendPlain = () => true
    feed = new ChatBubbles(chat, managersWith([message]))
    await feed.loadFirstHistory()
    await new Promise((resolve) => setTimeout(resolve, 0))
    document.body.append(feed.container)

    feed.chatInner.querySelector<HTMLElement>('.bubble[data-mid="1"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))

    expect(chat.initMessageReply).not.toHaveBeenCalled()
    feed.container.remove()
  })

  it('destroy снимает слушатели жеста — они висят на ownerDocument, а он переживает ленту', async () => {
    feed = new ChatBubbles(chatContext(), managersWith([message]))

    feed.destroy()
    feed = undefined

    expect(removeListeners).toHaveBeenCalledTimes(1)
  })
})
