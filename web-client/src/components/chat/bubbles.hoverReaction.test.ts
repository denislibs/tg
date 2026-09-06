// Ховер-реакция над баблом — порт `onBubblesMouseMove`
// (tweb bubbles.ts:2708-2828) и его спутников `setHoverVisible`/
// `unhoverPrevious` (:2837-2863).
//
// Пины на РЕЗУЛЬТАТ: разметка кнопки в `.bubble-content`, роль `select` в её
// стикере, классы показа (`is-visible forwards` на кнопке,
// `hover-reaction-visible` на баббл-контенте) и то, что уходит в сеть по клику
// (тоггл `react`/`unreact`). Факт вызова `wrapSticker` сам по себе ничего не
// доказывает — мок повторяет то, что делает настоящий враппер с узлом
// (`wrappers/sticker.ts:160` — `div.dataset.docId`), и проверяется узел.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { resetChatFullMirror } from '@core/chatFullCache'
import { makeMessage } from '@core/messages/testMessage'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import type { MessageReactions, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import lottieLoader from '@lib/lottie/lottieLoader'
import wrapSticker from '@components/wrappers/sticker'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

vi.mock('@components/wrappers/sticker', () => ({ default: vi.fn() }))
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { waitForFirstFrame: vi.fn((player: unknown) => Promise.resolve(player)) },
}))

const wrapStickerMock = vi.mocked(wrapSticker)
const waitForFirstFrame = vi.mocked(lottieLoader.waitForFirstFrame)

const CHAT = 80
const SELECT_ID = 555
const STATIC_ID = 333

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

const mine: MessageReactions = {
  _: 'messageReactions',
  results: [{
    _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1, chosen_order: 0,
  }],
}

const msg = (agg?: MessageReactions): MyMessage => ({
  ...makeMessage({ peerId: CHAT, fromId: 2, id: 1, text: 'привет', createdAt: '2026-08-15T12:34:00' }),
  ...(agg ? { reactions: agg } : {}),
} as MyMessage)

function stand(agg?: MessageReactions) {
  const messages = [msg(agg)]
  const react = vi.fn(async() => {})
  const unreact = vi.fn(async() => {})
  const managers: BubblesManagers = {
    messages: {
      getHistory: vi.fn(async(): Promise<HistoryResult> => ({
        messages, count: 1, reachedTop: true, reachedBottom: true,
      })),
      getAround: vi.fn(async() => ({ messages, reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async() => null),
      react,
      unreact,
    },
    peers: { fillMirror: vi.fn(async() => {}) },
    dialogs: { getReadMaxSeqIfUnread: vi.fn(async() => 0), getHistoryMaxSeq: vi.fn(async() => 0) },
    realtime: { markRead: vi.fn(async() => ({ ok: true })) },
    // Порядок каталога и есть порядок панели: первая активная — 👍.
    reactions: {
      list: vi.fn(async(): Promise<AvailableReaction[]> => [
        {
          emoji: '👍', title: '', position: 0, premium: false, inactive: false,
          selectMediaId: SELECT_ID, staticMediaId: STATIC_ID,
        },
        {
          emoji: '❤️', title: '', position: 1, premium: false, inactive: false,
          selectMediaId: SELECT_ID + 1, staticMediaId: STATIC_ID + 1,
        },
      ] as AvailableReaction[]),
    },
  }
  return { managers, react, unreact }
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
async function settle() {
  for(let i = 0; i < 8; ++i) await tick()
}
/** `pause(400)` перед показом (tweb :2773) + rAF-задержка `setTransition`. */
const settleHover = () => tick(520)

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined; document.body.replaceChildren() })

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  resetChatFullMirror()
  vi.clearAllMocks()
  wrapStickerMock.mockImplementation(({ div, mediaId }) => {
    div.dataset.docId = String(mediaId) // wrappers/sticker.ts:160
    const player = Object.create(LottiePlayer.prototype) as LottiePlayer
    return { render: Promise.resolve(player), width: 18, height: 18, destroy: vi.fn() }
  })
  waitForFirstFrame.mockImplementation((player) => Promise.resolve(player))
})

async function open(agg?: MessageReactions) {
  const s = stand(agg)
  bubbles = new ChatBubbles(chatContext(), s.managers)
  await (await bubbles.setPeer())?.promise
  await settle()
  document.body.append(bubbles.container)
  // Первый `.bubble-content` в ленте принадлежит ДАТА-баблу (`bubble service
  // is-date`) — нужен контент бабла сообщения.
  const content = bubbles.container.querySelector<HTMLElement>('.bubble[data-mid] .bubble-content')!
  return { ...s, content }
}

function hover(target: HTMLElement) {
  target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
}

function button(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.bubble-hover-reaction')
}

describe('ховер-реакция над баблом', () => {
  it('наведение рисует кнопку в `.bubble-content` разметкой tweb', async() => {
    const { content } = await open()

    hover(content)
    await settleHover()

    const hoverReaction = button()!
    expect(hoverReaction).not.toBeNull()
    expect(hoverReaction.parentElement).toBe(content)
    const sticker = hoverReaction.querySelector<HTMLElement>('.bubble-hover-reaction-sticker')!
    expect(sticker).not.toBeNull()
    // Роль `select` ПЕРВОЙ разрешённой реакции — то, что рисует оригинал (:2779).
    expect(sticker.dataset.docId).toBe(String(SELECT_ID))
  })

  it('кнопка показывается только по первому кадру', async() => {
    // Первый кадр не приезжает — кнопка в дереве есть, но невидима.
    waitForFirstFrame.mockImplementation(() => new Promise(() => {}))
    const { content } = await open()

    hover(content)
    await settleHover()

    const hoverReaction = button()!
    expect(hoverReaction.dataset.loaded).toBeUndefined()
    expect(hoverReaction.classList.contains('is-visible')).toBe(false)
    expect(content.classList.contains('hover-reaction-visible')).toBe(false)
  })

  it('по первому кадру зажигаются классы показа', async() => {
    const { content } = await open()

    hover(content)
    await settleHover()

    const hoverReaction = button()!
    expect(hoverReaction.dataset.loaded).toBe('1')
    expect(hoverReaction.classList.contains('is-visible')).toBe(true)
    expect(hoverReaction.classList.contains('forwards')).toBe(true)
    expect(content.classList.contains('hover-reaction-visible')).toBe(true)
  })

  it('уход курсора мимо бабла гасит кнопку и убирает её из дерева', async() => {
    const { content } = await open()

    hover(content)
    await settleHover()
    expect(content.classList.contains('hover-reaction-visible')).toBe(true)

    hover(bubbles!.container)
    expect(content.classList.contains('hover-reaction-visible')).toBe(false)
    expect(button()!.classList.contains('forwards')).toBe(false)

    await tick(320) // duration 200 мс (tweb :2845)
    expect(button()).toBeNull()
  })

  it('клик СТАВИТ первую разрешённую реакцию', async() => {
    const { content, react, unreact } = await open()

    hover(content)
    await settleHover()
    button()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(react).toHaveBeenCalledWith(CHAT, 1, '👍')
    expect(unreact).not.toHaveBeenCalled()
  })

  it('клик по уже своей реакции её СНИМАЕТ (tweb — тоггл)', async() => {
    const { content, react, unreact } = await open(mine)

    hover(content)
    await settleHover()
    button()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(unreact).toHaveBeenCalledWith(CHAT, 1, '👍')
    expect(react).not.toHaveBeenCalled()
  })

  it('клик прячет кнопку сразу (tweb :2824 `unhoverPrevious`)', async() => {
    const { content } = await open()

    hover(content)
    await settleHover()
    button()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(content.classList.contains('hover-reaction-visible')).toBe(false)
  })

  it('в «Избранном» кнопки нет вовсе (tweb :2719 `peerId !== myId`)', async() => {
    const s = stand()
    bubbles = new ChatBubbles({ ...chatContext(), peerId: 0 }, s.managers)
    await (await bubbles.setPeer())?.promise
    await settle()
    document.body.append(bubbles.container)

    const content = bubbles.container.querySelector<HTMLElement>('.bubble[data-mid] .bubble-content')!
    hover(content)
    await settleHover()

    expect(button()).toBeNull()
  })

  it('над служебным баблом (дата) кнопки нет (tweb :2717 `service`)', async() => {
    await open()

    const date = bubbles!.container.querySelector<HTMLElement>('.bubble.service .bubble-content')!
    hover(date)

    // СИНХРОННО: узел кнопки оригинал вставляет до всякого ожидания (:2758),
    // так что «через полсекунды его нет» доказывает только то, что его успели
    // снять по другой причине.
    expect(button()).toBeNull()
    await settleHover()
    expect(button()).toBeNull()
  })
})
