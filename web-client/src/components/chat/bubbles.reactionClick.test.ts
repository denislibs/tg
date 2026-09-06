// Клик по чипу реакции — порт ветки `reactionElement` обработчика ленты
// (tweb bubbles.ts:3245-3279).
//
// Пин ровно на то, чего не видели прежние стенды (`bubbles.meta.test.ts`): там
// каталога реакций у ленты нет, чип остаётся текстовым эмодзи — и путь,
// которым тоггл читал значение реакции, случайно работал. На РЕАЛЬНОМ чипе
// иконка приезжает стикером, а текстовый узел снимается
// (`chat/reactions.ts::renderIcon`), и тоггл обязан читать значение с самого
// чипа (`data-reaction`), как оригинал читает его из `reactionCount.reaction`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { resetChatFullMirror } from '@core/chatFullCache'
import { makeMessage } from '@core/messages/testMessage'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import type { MessageReactions, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import wrapSticker from '@components/wrappers/sticker'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

vi.mock('@components/wrappers/sticker', () => ({ default: vi.fn() }))
const wrapStickerMock = vi.mocked(wrapSticker)

const CHAT = 80
const CENTER_ID = 222

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

const reactions: MessageReactions = {
  _: 'messageReactions',
  results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 2 }],
}

const mine: MessageReactions = {
  _: 'messageReactions',
  results: [{
    _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1, chosen_order: 0,
  }],
}

/**
 * Платная ⭐-реакция: ключ чипа — сам конструктор (`reactionKey`), эмодзи у неё
 * нет. Стенд нужен потому, что снятый охранный терм тоггла
 * (`bubbles.ts::toggleReaction`) не ронял ни одного прежнего стенда: чипа с
 * `data-reaction="reactionPaid"` в них не было вовсе.
 */
const paid: MessageReactions = {
  _: 'messageReactions',
  results: [{ _: 'reactionCount', reaction: { _: 'reactionPaid' }, count: 7 }],
}

const msg = (agg: MessageReactions): MyMessage => ({
  ...makeMessage({ peerId: CHAT, fromId: 2, id: 1, text: 'привет', createdAt: '2026-08-15T12:34:00' }),
  reactions: agg,
} as MyMessage)

/** Лента С КАТАЛОГОМ: только тогда чип получает иконку и теряет текстовый узел. */
function stand(agg: MessageReactions) {
  const messages = [msg(agg)]
  const react = vi.fn(async () => {})
  const unreact = vi.fn(async () => {})
  const managers: BubblesManagers = {
    messages: {
      getHistory: vi.fn(async (): Promise<HistoryResult> => ({
        messages, count: 1, reachedTop: true, reachedBottom: true,
      })),
      getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async () => null),
      react,
      unreact,
    },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
    realtime: { markRead: vi.fn(async () => ({ ok: true })) },
    reactions: {
      list: vi.fn(async (): Promise<AvailableReaction[]> => [{
        emoji: '👍', title: '', position: 0, premium: false, inactive: false, centerMediaId: CENTER_ID,
      } as AvailableReaction]),
    },
  }
  return { managers, react, unreact }
}

async function settle() {
  for (let i = 0; i < 8; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined; document.body.replaceChildren() })

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  resetChatFullMirror()
  vi.clearAllMocks()
  // Иконка чипа «приехала» — ровно то состояние, в котором тоггл ломался.
  wrapStickerMock.mockImplementation(() => {
    const player = Object.create(LottiePlayer.prototype) as LottiePlayer
    Object.assign(player, { canvas: [document.createElement('canvas')], onFirstFrame: () => {} })
    return { render: Promise.resolve(player), width: 40, height: 40, destroy: vi.fn() }
  })
})

async function openWith(agg: MessageReactions) {
  const s = stand(agg)
  bubbles = new ChatBubbles(chatContext(), s.managers)
  await (await bubbles.setPeer())?.promise
  await settle()
  document.body.append(bubbles.container)
  const chip = bubbles.container.querySelector<HTMLElement>('.reaction')!
  return { ...s, chip }
}

describe('клик по чипу с УЖЕ ЗАГРУЖЕННОЙ иконкой', () => {
  it('текстового эмодзи в чипе больше нет — читать тоггл оттуда нечего', async () => {
    const { chip } = await openWith(reactions)
    expect(chip.querySelector('.reaction-sticker')!.textContent).toBe('')
    expect(chip.dataset.reaction).toBe('👍')
  })

  it('чужая реакция всё равно СТАВИТСЯ', async () => {
    const { chip, react, unreact } = await openWith(reactions)

    chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(react).toHaveBeenCalledWith(CHAT, 1, '👍')
    expect(unreact).not.toHaveBeenCalled()
  })

  it('своя реакция всё равно СНИМАЕТСЯ', async () => {
    const { chip, react, unreact } = await openWith(mine)

    chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(unreact).toHaveBeenCalledWith(CHAT, 1, '👍')
    expect(react).not.toHaveBeenCalled()
  })
})

describe('клик по платной ⭐-реакции', () => {
  it('чип есть, и ключ у него — конструктор, а не эмодзи', async () => {
    const { chip } = await openWith(paid)
    expect(chip.dataset.reaction).toBe('reactionPaid')
  })

  it('в менеджер НЕ уходит ничего: адресовать платную реакцию нечем', async () => {
    const { chip, react, unreact } = await openWith(paid)

    chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(react).not.toHaveBeenCalled()
    expect(unreact).not.toHaveBeenCalled()
  })
})
