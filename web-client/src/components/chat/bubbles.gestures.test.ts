// Ответ ЖЕСТОМ — стыковка ленты с портом `replySwipe.ts`.
//
// Сам порт (контроллер свайпа, предикат даблклика) покрыт своими тестами
// (`replySwipe.test.ts`, 35 штук); здесь проверяется то, чего они видеть не
// могут: что лента ВЕШАЕТ обработчик, отдаёт в предикат право `canSendPlain`
// и адресует ответ номером кликнутого бабла.
//
// Развилка оригинала (tweb bubbles.ts:1496-1543) взаимоисключающая: даблклик —
// на десктопе, свайп — на таче. jsdom выдаёт себя за десктоп (`IS_MOBILE`
// считает по user-agent, в jsdom он не мобильный), поэтому здесь живёт ветка
// даблклика; тач-ветка — в `bubbles.gestures.touch.test.ts`, где окружение
// подменено.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { generateTempMessageId } from '@core/history/messageId'
import { makeMessage } from '@core/messages/testMessage'
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

const CHAT = 90

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

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => {
  bubbles?.destroy()
  bubbles?.container.remove()
  bubbles = undefined
})
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = 1
})

const msg = (id: number) =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: 'привет', createdAt: '2026-08-15T12:34:00' })

/** Поднять ленту с заданным правом на текст и шпионом входа в reply. */
async function feedWith(messages: MyMessage[], canSendPlain: boolean) {
  const initMessageReply = vi.fn()
  const chat: ChatContext = {
    peerId: CHAT,
    messagesStorageKey: String(CHAT),
    container: document.createElement('div'),
    bubblesViewport: document.createElement('div'),
    canSendPlain: () => canSendPlain,
    initMessageReply,
  }
  const feed = new ChatBubbles(chat, managersWith(messages))
  bubbles = feed
  await openFeed(feed)
  await settle()
  // Слушатель делегирующий — событие должно всплыть до контейнера ленты.
  document.body.append(feed.container)
  return { feed, initMessageReply }
}

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

const dblclick = (node: HTMLElement) =>
  node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))

describe('ChatBubbles — ответ даблкликом (десктоп)', () => {
  it('даблклик по баблу зовёт вход в reply с ЕГО номером', async () => {
    const { feed, initMessageReply } = await feedWith([msg(1), msg(2)], true)

    dblclick(bubbleOf(feed, 2))

    expect(initMessageReply).toHaveBeenCalledWith(2)
  })

  it('без права на текст (canSendPlain) ответа нет', async () => {
    // tweb :1503 — гейт `chat.input.canSendPlain()`. Это ОТДЕЛЬНОЕ право: в
    // чате можно быть вправе слать медиа, но не текст.
    const { feed, initMessageReply } = await feedWith([msg(1)], false)

    dblclick(bubbleOf(feed, 1))

    expect(initMessageReply).not.toHaveBeenCalled()
  })

  it('хост не пробросил право — ответа нет (умолчание запрещающее)', async () => {
    // Порты жеста опциональны: лента поднимается и без окружения (так живут её
    // собственные тесты). Умолчание обязано быть ЗАПРЕЩАЮЩИМ — разрешающее
    // дало бы ответ в чате, где писать нельзя.
    const chat: ChatContext = {
      peerId: CHAT,
      messagesStorageKey: String(CHAT),
      container: document.createElement('div'),
      bubblesViewport: document.createElement('div'),
      initMessageReply: vi.fn(),
    }
    const feed = new ChatBubbles(chat, managersWith([msg(1)]))
    bubbles = feed
    await openFeed(feed)
    await settle()
    document.body.append(feed.container)

    dblclick(bubbleOf(feed, 1))

    expect(chat.initMessageReply).not.toHaveBeenCalled()
  })

  it('своё ещё не отправленное сообщение ответа не получает', async () => {
    // tweb :1535-1538 — `message.pFlags.is_outgoing` → выход. У нас признак
    // «ещё не отправлено» — ДРОБНЫЙ номер (`isLocalMessageId`), а не флаг.
    const tempId = generateTempMessageId(0)
    const pending = makeMessage({
      peerId: CHAT, fromId: 1, id: tempId, out: true, text: 'привет',
      createdAt: '2026-08-15T12:34:00',
    })
    const { feed, initMessageReply } = await feedWith([pending], true)

    dblclick(bubbleOf(feed, tempId))

    expect(initMessageReply).not.toHaveBeenCalled()
  })

  it('даблклик по времени игнорируется — там живёт вход в выделение', async () => {
    // tweb :1515 — `.time` в списке игнорируемых предков: по нему у оригинала
    // тоггл выделения, а не ответ.
    const { feed, initMessageReply } = await feedWith([msg(1)], true)

    dblclick(bubbleOf(feed, 1).querySelector<HTMLElement>('.time')!)

    expect(initMessageReply).not.toHaveBeenCalled()
  })
})
