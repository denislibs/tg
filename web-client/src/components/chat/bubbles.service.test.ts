// Сервисные баблы В ЛЕНТЕ — стыковка `bubbles.ts` с портом пилюли
// (`serviceMessage.ts::createServiceBubble`).
//
// Свой тест у самого узла уже есть (`serviceMessage.test.ts`, каркас и фраза);
// здесь проверяется то, чего он видеть не может, — что ЛЕНТА уводит служебное
// сообщение по своей ветке (порт tweb bubbles.ts:6708-6712 → :7293-7301):
//   (1) пилюля вместо обычного бабла: `.bubble.service`, тела `.message` нет;
//   (2) превью ЗАКРЕПЛЁННОГО лента разрешает сама по `reply_to`
//       (порт `messageActionTextNewUnsafe.ts:400-419`);
//   (3) звонок и подарок по этой ветке НЕ идут — у них свой вид бабла
//       (`getMessageKind`, роль tweb `SERVICE_AS_REGULAR`);
//   (4) правка не превращает пилюлю обратно в пустой обычный бабл.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { makeMessage, makeServiceMessage } from '@core/messages/testMessage'
import type { MessageAction } from '@core/messages/messageAction'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

/** Открыть окно ленты и дождаться ОТРИСОВКИ (см. `bubbles.test.ts`). */
async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

const CHAT = 90
const ANYA = 5

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
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

const text = (id: number): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: `m${id}`, createdAt: '2026-08-15T12:00:00Z' })

const pill = (id: number, action: MessageAction, over: { replyToMsgId?: number } = {}): MyMessage =>
  makeServiceMessage({ peerId: CHAT, fromId: ANYA, id, action, createdAt: '2026-08-15T12:00:00Z', ...over })

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = 1
  // Имя в пилюле берётся из зеркала карточек (`PeerTitle`), а не из действия.
  applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ANYA, first_name: 'Аня', pFlags: {} }] }])
})

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

describe('ChatBubbles — служебное сообщение уходит по ветке пилюли', () => {
  it('пилюля, а не пустой обычный бабл', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      pill(1, { _: 'messageActionChatAddUser', users: [7] }),
    ]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    // Классы бабла ветка ЗАМЕНЯЕТ целиком (tweb :6723 `bubble.className =
    // 'bubble service'`), а не дополняет: ни `is-in`, ни `hide-name`, ни
    // прочего от `bubbleClasses` на пилюле не остаётся. Края серии дописывает
    // `BubbleGroup.updateClassNames` — пилюля стоит одна (`GroupItem.single`,
    // `bubbleGroups.ts:489`), поэтому их два.
    expect(bubble.className).toBe('bubble service is-group-first is-group-last')
    // Каркас пилюли (tweb :6723-6727 + живой DOM `03-service-round.json`):
    // тела сообщения у неё нет вовсе, вместо него `.service-msg`.
    expect(bubble.querySelector('.message')).toBeNull()
    expect(bubble.querySelector('.bubble-content-wrapper > .bubble-content > .service-msg > span.i18n')).not.toBeNull()
    expect(bubble.textContent).toContain('Аня добавил(а)')
  })

  it('«закрепил(а)» несёт превью цели, разрешённое по reply_to из окна', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      text(1),
      pill(2, { _: 'messageActionPinMessage' }, { replyToMsgId: 1 }),
    ]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 2)
    // Порт `wrapLinkToMessage` (messageActionTextNewUnsafe.ts:31-42): адрес
    // цели лежит в `data-saved-from`, по нему лента и прыгает.
    const link = bubble.querySelector<HTMLElement>('i[data-saved-from]')!
    expect(link).not.toBeNull()
    expect(link.dataset.savedFrom).toBe(`${CHAT}_1`)
    expect(link.textContent).toBe('m1')
  })

  it('без цели в окне — формулировка без превью (tweb ActionPinnedNoText)', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      pill(2, { _: 'messageActionPinMessage' }, { replyToMsgId: 999 }),
    ]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 2)
    expect(bubble.querySelector('i[data-saved-from]')).toBeNull()
    expect(bubble.textContent).toContain('закрепил(а) сообщение')
  })

  it('правка пилюли пересобирает фразу, а не стирает класс service', async () => {
    const before = pill(1, { _: 'messageActionChatEditTitle', title: 'Старое' })
    bubbles = new ChatBubbles(chatContext(), managersWith([before]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    rootScope.dispatchEventSingle('message_edit', {
      storageKey: String(CHAT),
      peerId: CHAT,
      mid: 1,
      message: pill(1, { _: 'messageActionChatEditTitle', title: 'Новое' }),
    })

    // Узел ТОТ ЖЕ (правка не пересоздаёт бабл), классы целы, фраза новая.
    expect(bubbleOf(bubbles, 1)).toBe(bubble)
    expect(bubble.className).toBe('bubble service is-group-first is-group-last')
    expect(bubble.textContent).toContain('Новое')
    expect(bubble.textContent).not.toContain('Старое')
  })

  it('звонок и подарок по ветке пилюли НЕ идут — у них свой вид бабла', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      pill(1, { _: 'messageActionPhoneCall', duration: 42 }),
      pill(2, {
        _: 'messageActionStarGift',
        gift: { _: 'starGift', id: 1, stars: 10, convert_stars: 5 },
      }),
    ]))
    await openFeed(bubbles)
    await settle()

    expect(bubbleOf(bubbles, 1).classList.contains('service')).toBe(false)
    expect(bubbleOf(bubbles, 2).classList.contains('service')).toBe(false)
  })
})
