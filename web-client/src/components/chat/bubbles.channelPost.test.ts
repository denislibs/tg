// Признаки ПОСТА КАНАЛА на бабле — порт блока tweb bubbles.ts:7671-7691:
// класс `channel-post`, кнопка «переслать» сбоку (`bubble-beside-button
// with-hover forward` + `with-beside-button` на бабле) и её клик
// (`showForwardPopup({[peerId]: getMidsByMessage(message)})`, :3511-3517).
//
// ПИН ГЕЙТА: признак поста выводится из САМОГО сообщения — `isMessage &&
// message.views` (:7672), а не из вида чата. До починки лента звала
// вычислитель классов со стабом, где «это канал» стояло захардкоженным `false`
// (`bubbles.ts::STUB_CTX`), и ни один бабл признаков поста не получал вовсе.
// Поэтому здесь пары: канал + сообщение БЕЗ просмотров (признаков нет) и
// обычный чат + сообщение С просмотрами (признаки есть) — мутация «вернуть
// гейт по виду чата» краснит обеими.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import type { MessageReal, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const CHAT: PeerId = -700

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

const post = (id: number, over: { views?: number, groupedId?: number } = {}): MyMessage =>
  makeMessage({
    peerId: CHAT, fromId: 2, id, text: 'привет', createdAt: '2026-08-15T12:34:00',
    ...(over.views != null ? { views: over.views } : {}),
    ...(over.groupedId != null ? { groupedId: over.groupedId } : {}),
  })

async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

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

describe('ChatBubbles — признаки поста канала', () => {
  it('пост канала: `channel-post`, `with-beside-button` и узел кнопки', async () => {
    bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([post(1, { views: 2 })]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    // tweb :7673 и :7680.
    expect(bubble.classList.contains('channel-post')).toBe(true)
    expect(bubble.classList.contains('with-beside-button')).toBe(true)

    // tweb :7676-7679 — узел лежит в `.bubble-content`, классы дословные,
    // внутри узел иконки `forward_filled`. Живой DOM — docs/tweb/channels.md:60.
    const button = bubble.querySelector<HTMLElement>('.bubble-content > .bubble-beside-button')!
    expect(button).not.toBeNull()
    expect(button.classList.contains('with-hover')).toBe(true)
    expect(button.classList.contains('forward')).toBe(true)
    expect(button.firstElementChild!.classList.contains('tgico')).toBe(true)
  })

  it('в КАНАЛЕ сообщение без просмотров признаков поста не получает', async () => {
    bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([post(1)]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('channel-post')).toBe(false)
    expect(bubble.classList.contains('with-beside-button')).toBe(false)
    expect(bubble.querySelector('.bubble-beside-button')).toBeNull()
  })

  // Второе слагаемое условия оригинала (:7675) — у пересылки, ведущей к
  // ОРИГИНАЛУ (`fwd_from.saved_from_msg_id`), сбоку висит «перейти к
  // оригиналу», а не «переслать». Данных под это на проводе пока нет вовсе,
  // но правило оригинала переносится, значит и проверяется.
  it('у пересылки с `saved_from_msg_id` кнопки нет, а класс поста есть', async () => {
    const forwarded: MessageReal = {
      ...(post(1, { views: 2 }) as MessageReal),
      fwd_from: { _: 'messageFwdHeader', date: 0, saved_from_msg_id: 9 },
    }
    bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([forwarded]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('channel-post')).toBe(true)
    expect(bubble.classList.contains('with-beside-button')).toBe(false)
    expect(bubble.querySelector('.bubble-beside-button')).toBeNull()
  })

  it('в ОБЫЧНОМ чате сообщение с просмотрами признаки поста получает', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([post(1, { views: 5 })]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('channel-post')).toBe(true)
    expect(bubble.classList.contains('with-beside-button')).toBe(true)
    expect(bubble.querySelector('.bubble-beside-button.forward')).not.toBeNull()
  })

  describe('клик по кнопке ведёт в попап пересылки', () => {
    it('адресат — запись `{peerId: [номер]}` (tweb :3512-3514)', async () => {
      const showForward = vi.fn()
      bubbles = new ChatBubbles(
        chatContext({ isBroadcast: true, navigation: { showForward } }),
        managersWith([post(1, { views: 2 })]),
      )
      await openFeed(bubbles)
      await settle()

      document.body.append(bubbles.container)
      // Клик приходит с УЗЛА ИКОНКИ — так его и получает боевая кнопка.
      bubbleOf(bubbles, 1).querySelector<HTMLElement>('.bubble-beside-button.forward > .tgico')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      bubbles.container.remove()

      expect(showForward).toHaveBeenCalledWith({ [CHAT]: [1] })
    })

    it('у альбома уходят номера ВСЕЙ группы (`getMidsByMessage`)', async () => {
      const showForward = vi.fn()
      bubbles = new ChatBubbles(
        chatContext({ isBroadcast: true, navigation: { showForward } }),
        managersWith([
          post(1, { views: 2, groupedId: 5 }),
          post(2, { views: 2, groupedId: 5 }),
        ]),
      )
      await openFeed(bubbles)
      await settle()

      document.body.append(bubbles.container)
      // Бабл у альбома ОДИН — главного сообщения группы (первого по номеру).
      bubbleOf(bubbles, 1).querySelector<HTMLElement>('.bubble-beside-button.forward')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      bubbles.container.remove()

      expect(showForward).toHaveBeenCalledWith({ [CHAT]: [1, 2] })
    })

    it('клик по телу поста в пересылку не ведёт', async () => {
      const showForward = vi.fn()
      bubbles = new ChatBubbles(
        chatContext({ isBroadcast: true, navigation: { showForward } }),
        managersWith([post(1, { views: 2 })]),
      )
      await openFeed(bubbles)
      await settle()

      document.body.append(bubbles.container)
      bubbleOf(bubbles, 1).querySelector<HTMLElement>('.message')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      bubbles.container.remove()

      expect(showForward).not.toHaveBeenCalled()
    })
  })
})
