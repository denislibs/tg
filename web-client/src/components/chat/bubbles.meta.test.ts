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

  // ПРАВКА. `message_edit` у нас — воронка ЛЮБОГО изменения сообщения
  // (`core/history/messagesMirror.ts:192`: и `replace`, и каждый `patch` —
  // реакция, `media_read`, опрос). Пересобирая тело, лента обязана заново
  // выложить и конец тела: время, значок отправки и реакции. Прежняя реализация
  // сносила их `replaceChildren` и не возвращала.
  describe('правка сообщения', () => {
    const editTo = (message: MyMessage) => {
      rootScope.dispatchEventSingle('message_edit', {
        storageKey: String(CHAT), peerId: CHAT, mid: message.id, message,
      })
    }

    it('время остаётся в конце тела', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([msg(1)]))
      await openFeed(bubbles)
      await settle()

      editTo(msg(1))

      const messageDiv = bubbleOf(bubbles, 1).querySelector('.message')!
      const time = messageDiv.querySelector<HTMLElement>('.time')!
      expect(time).not.toBeNull()
      expect(time.textContent).toContain('12:34')
      expect(messageDiv.lastElementChild).toBe(time)
    })

    it('чипы реакций остаются, и время лежит ВНУТРИ их контейнера', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([msg(1, { reactions })]))
      await openFeed(bubbles)
      await settle()

      editTo(msg(1, { reactions }))

      const messageDiv = bubbleOf(bubbles, 1).querySelector('.message')!
      const reactionsEl = messageDiv.querySelector<HTMLElement>('.reactions')!
      expect(reactionsEl).not.toBeNull()
      expect(reactionsEl.querySelectorAll('.reaction')).toHaveLength(1)
      // tweb :9855 — время переезжает внутрь контейнера реакций.
      expect(messageDiv.querySelector<HTMLElement>('.time')!.parentElement).toBe(reactionsEl)
    })

    it('приехавшая с правкой реакция ПОЯВЛЯЕТСЯ (её и объявляет `patch {reactions}`)', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([msg(1)]))
      await openFeed(bubbles)
      await settle()
      expect(bubbleOf(bubbles, 1).querySelector('.reactions')).toBeNull()

      editTo(msg(1, { reactions }))

      expect(bubbleOf(bubbles, 1).querySelectorAll('.reaction')).toHaveLength(1)
    })

    it('исчезнувшая реакция УБИРАЕТСЯ, а время возвращается в тело', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([msg(1, { reactions })]))
      await openFeed(bubbles)
      await settle()

      editTo(msg(1))

      const messageDiv = bubbleOf(bubbles, 1).querySelector('.message')!
      expect(messageDiv.querySelector('.reactions')).toBeNull()
      expect(messageDiv.lastElementChild).toBe(messageDiv.querySelector('.time'))
    })

    it('значок отправки своего неотправленного бабла переживает правку', async () => {
      const tempId = generateTempMessageId(0)
      const pending = makeMessage({
        peerId: CHAT, fromId: 1, id: tempId, out: true, text: 'привет',
        createdAt: '2026-08-15T12:34:00',
      })
      bubbles = new ChatBubbles(chatContext(), managersWith([pending]))
      await openFeed(bubbles)
      await settle()

      editTo(pending)

      expect(bubbleOf(bubbles, tempId).querySelectorAll('.time-sending-status')).toHaveLength(2)
    })
  })

  // ПРОВОДКА реакций из ленты. Сам агрегат покрыт `reactions.test.ts`, но он
  // видит только `createReactionsElement(reactions, options)` — то, что лента
  // ДАЁТ ему `options`, оттуда не видно. А без них порт молча сваливается в
  // ветку оригинала `canRenderAvatars === false`: чипы рисуются текстом, эффект
  // не играет, аватарок нет. Снятие второго аргумента в `renderMessageMeta` не
  // красило ни одного теста — ровно тот случай, который норма покрытия требует
  // закрыть.
  it('лента отдаёт агрегату своё окружение: в личке чип показывает аватарки', async () => {
    const withRecent: MessageReactions = {
      ...reactions,
      recent_reactions: [{
        _: 'messagePeerReaction',
        peer_id: { _: 'peerUser', user_id: 2 },
        reaction: { _: 'reactionEmoji', emoticon: '👍' },
      }],
    } as MessageReactions
    // `CHAT = 80` — положительный ключ, то есть ЛИЧКА (`isUser`), а реакций
    // меньше четырёх: обе половины условия `canRenderAvatars` (tweb
    // reactions.ts:304-307) истинны — но только если `options` доехали.
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1, { reactions: withRecent })]))
    await openFeed(bubbles)
    await settle()

    const chip = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.reaction')!
    expect(chip).not.toBeNull()
    expect(chip.querySelector('.stacked-avatars')).not.toBeNull()
    // И зеркальная половина: место числа занято аватарками, а не счётчиком.
    expect(chip.querySelector('.reaction-counter')).toBeNull()
  })

  it('без реакций контейнера нет вовсе — пустой занял бы строку', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1)]))
    await openFeed(bubbles)
    await settle()

    expect(bubbleOf(bubbles, 1).querySelector('.reactions')).toBeNull()
  })
})
